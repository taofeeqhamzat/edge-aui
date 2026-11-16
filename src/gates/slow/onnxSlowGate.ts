/**
 * ONNX-Backed Slow Gate
 *
 * Implements Stage 7.2 & 12 specifications from docs/plan/1/tasks/5.1.md and ADR-006.
 *
 * Runs inside the runtime worker (or in-process in test harness), hosting:
 * 1. TargetInterventionHead (intervention_head_int8.onnx):
 *    Dual inputs: sequence_input (1, T, 18) + context_input (1, 6) -> intervention_logits (1, 5).
 *    Produces learned candidate UI interventions conditioned on continuous kinematics and UIContext.
 * 2. FoundationOutcomeHead (model_int8.onnx):
 *    Single input: input (1, T, 18) -> output (1, 7).
 *    Retained alongside the intervention head for outcome diagnostics, auxiliary prediction,
 *    and controlled ablation comparison (ADR-006 Option A).
 *
 * Honest execution provider reporting: reports the provider actually serving each session
 * ('webgpu' | 'wasm' | 'cpu' | 'unavailable').
 */

import type * as OrtNamespace from 'onnxruntime-web';
import {
  SlowGate,
  SlowGateInput,
  SlowGateResult,
  SlowGateMappingSource
} from './types';
import { InterventionCommand, InterventionType } from '../../intervention/types';
import { OutcomeType } from '../../telemetry/events';
import {
  CONTEXT_VECTOR_DIM,
  encodeUIContext,
  ContextEncodingConfig
} from '../../types/contextVector';
import { defaultCollector } from '../../runtime/instrumentation';
import { argmax, OutcomeVocabulary } from '../contracts';
import { GatePrediction } from '../contracts';
import {
  DEFAULT_MODEL_URL,
  DEFAULT_INTERVENTION_MODEL_URL,
  DEFAULT_SLOW_GATE_MANIFEST,
  SlowGateManifest
} from '../../config/modelManifest';

/**
 * Outcome class order of the built-in foundation vocabulary.
 *
 * Compatibility alias: the active order is `manifest.foundation.vocabulary` (Task 20.3).
 * Tests and ADRs that cite the historical seven-class order still read this name.
 */
export const OUTCOME_CLASS_ORDER: OutcomeType[] = [
  ...(DEFAULT_SLOW_GATE_MANIFEST.foundation.vocabulary.outcomes as readonly OutcomeType[])
];

export const SLOW_GATE_NUM_CLASSES = OUTCOME_CLASS_ORDER.length;

/**
 * Intervention class order of the built-in intervention head.
 *
 * Compatibility alias: the active order is `manifest.intervention.vocabulary`.
 */
export const TARGET_INTERVENTION_ORDER: InterventionType[] = [
  ...(DEFAULT_SLOW_GATE_MANIFEST.intervention!.vocabulary.outcomes as readonly InterventionType[])
];

export const TARGET_INTERVENTION_NUM_CLASSES = TARGET_INTERVENTION_ORDER.length;

/**
 * Default outcome → intervention mapping for deterministic baseline / ablation arm.
 */
export const DEFAULT_OUTCOME_INTERVENTIONS: Partial<Record<OutcomeType, InterventionType>> = {
  HOVER_DWELL: 'expand_tooltip',
  BACKTRACK: 'offer_assistance',
  RAPID_SCROLL: 'simplify_options',
  ABANDON: 'offer_assistance',
  NO_OUTCOME: 'no_op',
  CLICK: 'no_op',
  FORM_SUBMIT: 'no_op'
};

/**
 * Default bundled graph URLs and artifact identity.
 *
 * Re-exported from the model manifest, which is now the single place that describes which
 * artifacts the built-in vocabulary belongs to (Task 20.3).
 */
export {
  DEFAULT_MODEL_URL,
  DEFAULT_INTERVENTION_MODEL_URL,
  TARGET_INTERVENTION_MODEL_VERSION
} from '../../config/modelManifest';

/**
 * Resolves a head URL.
 *
 * An explicit option wins (and `null` disables the head), then the manifest, then the
 * built-in default. This is what lets the legacy option names stay supported while a
 * manifest describes the same or a different artifact set.
 */
function resolveHeadUrl(
  explicit: string | null | undefined,
  manifestUrl: string | undefined,
  fallback: string | null
): string | null {
  if (explicit === null) return null;
  if (explicit !== undefined) return explicit;
  return manifestUrl ?? fallback;
}

/**
 * Resolves model path or URL in both browser worker and Node.js testing scopes.
 */
export function resolveModelPathOrUrl(url: string): string {
  if (typeof location !== 'undefined' && typeof location.origin === 'string') {
    return new URL(url, location.origin).href;
  }
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    if (url.startsWith('/models/')) {
      return `${process.cwd()}/public${url}`;
    }
  }
  return url;
}

export function resolveDefaultModelUrl(): string {
  return resolveModelPathOrUrl(DEFAULT_MODEL_URL);
}

export function resolveDefaultInterventionModelUrl(): string {
  return resolveModelPathOrUrl(DEFAULT_INTERVENTION_MODEL_URL);
}

export interface OnnxSlowGateOptions {
  /** Foundation outcome model URL. Defaults to /models/model_int8.onnx. Set null to disable. */
  modelUrl?: string | null;
  /** Target intervention head model URL. Defaults to /models/intervention_head_int8.onnx. Set null to disable. */
  interventionModelUrl?: string | null;
  /** Preferred execution provider order. */
  executionProviders?: ('webgpu' | 'wasm' | 'cpu')[];
  /**
   * Application route/action/task vocabulary used to encode UIContext.
   * Omitted means the framework default, which declares no application vocabulary.
   */
  contextEncoding?: ContextEncodingConfig;
  /** Minimum confidence required to emit a candidate intervention. Default 0.5. */
  confidenceThreshold?: number;
  /** Minimum outcome confidence for foundation head. */
  minOutcomeConfidence?: number;
  /** Explicit ablation arm: use deterministic mapping instead of learned head even if loaded. Default false. */
  useDeterministicMapping?: boolean;
  /** Outcome → intervention overrides for deterministic mapping. */
  interventionByOutcome?: Partial<Record<OutcomeType, InterventionType>>;
  /**
   * Model manifest: the ordered vocabularies, their versions and the artifact versions.
   *
   * Omitted means the built-in manifest, which describes the bundled
   * `model_int8.onnx` / `intervention_head_int8.onnx` artifacts and their 7/5-class
   * vocabularies — the compatibility path (Task 20.3).
   */
  manifest?: SlowGateManifest;
  /** Injected ORT module for tests. */
  ortModule?: typeof OrtNamespace;
}

export interface ModelSessionInfo {
  session: OrtNamespace.InferenceSession;
  executionProvider: string;
  inputNames: readonly string[];
  outputNames: readonly string[];
  modelLoaded: boolean;
}

export interface DualSessionBundle {
  ort: typeof OrtNamespace;
  foundation?: ModelSessionInfo;
  intervention?: ModelSessionInfo;
  primaryProvider: string;
  modelsLoaded: boolean;
}

let cached: DualSessionBundle | null = null;

async function createSingleSession(
  ort: typeof OrtNamespace,
  rawUrl: string,
  providers: ('webgpu' | 'wasm' | 'cpu')[]
): Promise<ModelSessionInfo> {
  let session: OrtNamespace.InferenceSession;

  // In Node.js / test environments (e.g. jsdom where location.origin is http://localhost:3000),
  // read the file directly into a Uint8Array if it exists on disk.
  let loadedFromDisk = false;
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      let candidatePath = rawUrl;
      if (candidatePath.startsWith('http://localhost:3000/')) {
        candidatePath = candidatePath.replace('http://localhost:3000/', '/');
      }
      if (candidatePath.startsWith('/models/')) {
        candidatePath = path.join(process.cwd(), 'public', candidatePath);
      }
      if (fs.existsSync(candidatePath)) {
        const fileBuf = fs.readFileSync(candidatePath);
        const uint8 = new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength);
        session = await ort.InferenceSession.create(uint8, {
          executionProviders: providers as never
        });
        loadedFromDisk = true;
      }
    } catch {
      // Fall through to standard path
    }
  }

  if (!loadedFromDisk) {
    const modelUrl = resolveModelPathOrUrl(rawUrl);
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: providers as never
    });
  }

  const selected =
    (session! as unknown as { executionProvider?: string }).executionProvider ??
    providers[0] ??
    'wasm';

  return {
    session: session!,
    executionProvider: selected,
    inputNames: session!.inputNames,
    outputNames: session!.outputNames,
    modelLoaded: true
  };
}

/**
 * Execution providers this deployment uses.
 *
 * WebGPU was the preferred provider, but requesting it makes ONNX Runtime Web load the
 * `jsep` WASM build, and that single asset is 26,827,543 bytes — above Cloudflare Pages'
 * hard 25 MiB per-file limit, so the deployment was rejected outright. The stack already ran
 * with `numThreads = 1`, which is the configuration every existing ONNX test passes under,
 * so the provider list is `wasm, cpu`.
 *
 * This is a packaging and backend decision only. Model architecture, weights, the target head
 * and the intervention policy are unchanged. See ADR-016.
 */
export const DEPLOYMENT_EXECUTION_PROVIDERS: ('webgpu' | 'wasm' | 'cpu')[] = ['wasm', 'cpu'];

/**
 * Loads the ONNX Runtime Web entry point.
 *
 * `onnxruntime-web/wasm` resolves to the WASM-only distribution
 * (`ort-wasm-simd-threaded.wasm`, 13,479,978 bytes). The default entry point can pull in the
 * WebGPU/JSEP binary depending on how the bundler tree-shakes, which is what pushed the
 * deployed asset over the size limit.
 */
async function loadOrtModule(): Promise<typeof OrtNamespace> {
  return import('onnxruntime-web/wasm');
}

/**
 * Loads ONNX sessions once per worker and reports the providers that actually served
 * the sessions, rather than the providers that were requested.
 */
async function getSession(options: OnnxSlowGateOptions): Promise<DualSessionBundle | null> {
  if (cached) return cached;

  const ort = options.ortModule ?? (await loadOrtModule());
  const providers = options.executionProviders ?? DEPLOYMENT_EXECUTION_PROVIDERS;

  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;

  const manifest = options.manifest ?? DEFAULT_SLOW_GATE_MANIFEST;
  const foundationUrl = resolveHeadUrl(
    options.modelUrl,
    manifest.foundation.modelUrl,
    DEFAULT_MODEL_URL
  );
  // A manifest describes the whole artifact set: a head it does not declare is not loaded.
  // Without a manifest the legacy pair is loaded, which is the compatibility path.
  const interventionUrl = resolveHeadUrl(
    options.interventionModelUrl,
    manifest.intervention?.modelUrl,
    options.manifest === undefined ? DEFAULT_INTERVENTION_MODEL_URL : null
  );

  let foundation: ModelSessionInfo | undefined;
  let intervention: ModelSessionInfo | undefined;

  if (foundationUrl) {
    foundation = await createSingleSession(ort, foundationUrl, providers);
  }
  if (interventionUrl) {
    intervention = await createSingleSession(ort, interventionUrl, providers);
  }

  const primaryProvider =
    intervention?.executionProvider ?? foundation?.executionProvider ?? 'unavailable';
  const modelsLoaded = Boolean(intervention?.modelLoaded || foundation?.modelLoaded);

  cached = {
    ort,
    foundation,
    intervention,
    primaryProvider,
    modelsLoaded
  };

  return cached;
}

/** Resets the cached session. Used by tests and on worker RESET. */
export function resetOnnxSlowGateSession(): void {
  cached = null;
}

/**
 * Fails visibly when a graph's output dimension contradicts the vocabulary that is supposed
 * to describe it. Silently falling back to a default order would relabel every class of a
 * mis-exported model.
 */
function assertVocabularyDimension(
  head: string,
  vocabulary: OutcomeVocabulary,
  received: number
): void {
  const expected = vocabulary.outcomes.length;
  if (received !== expected) {
    throw new Error(
      `[OnnxSlowGate] ${head} output dimension ${received} does not match vocabulary ` +
        `'${vocabulary.id}' (${vocabulary.version}) which declares ${expected} classes. ` +
        'The model and the manifest must agree.'
    );
  }
}

/** Argmax over the raw scores, following the configured class order by index. */
function argmaxOutcome(scores: Float32Array): { index: number; confidence: number } {
  return argmax(scores);
}

/**
 * The intervention head's logits are passed through the same argmax. Kept as a named
 * function so the call site states which head it is ranking.
 */
function logitsAsProbabilities(logits: Float32Array): Float32Array {
  return logits;
}

/** True when `label` belongs to the generic foundation taxonomy. */
function isFoundationOutcome(label: string | undefined): label is OutcomeType {
  return label !== undefined && (OUTCOME_CLASS_ORDER as string[]).includes(label);
}

/** The component a prediction was computed against, when one is known. */
function targetForContext(context: { activeComponentId?: string }) {
  return context.activeComponentId ? { componentId: context.activeComponentId } : undefined;
}

/**
 * Whether a predicted label is an assertion the policy must engage.
 *
 * `NO_OUTCOME` and `no_op` mean "the head predicts no change"; they are recorded but are not
 * matches, and a prediction with no confidence asserts nothing.
 */
function isAssertiveLabel(label: string | undefined, confidence: number): boolean {
  if (label === undefined || confidence <= 0) return false;
  return label !== 'NO_OUTCOME' && label !== 'no_op';
}

/** True when `label` names an intervention type. */
function isInterventionTypeString(label: string | undefined): label is InterventionType {
  return label !== undefined && (TARGET_INTERVENTION_ORDER as string[]).includes(label);
}

/** Provenance identity of this gate implementation, reported on every inference. */
const ONNX_GATE_VERSION = 'onnx-slow-gate/1.0.0';

export class OnnxSlowGate implements SlowGate {
  private readonly options: OnnxSlowGateOptions;
  private readonly manifest: SlowGateManifest;
  private lastProvider = 'uninitialised';
  private lastOutcome?: OutcomeType;
  private lastLatencyMs?: number;

  constructor(options: OnnxSlowGateOptions = {}) {
    this.options = options;
    this.manifest = options.manifest ?? DEFAULT_SLOW_GATE_MANIFEST;
  }

  /** Ordered outcome vocabulary of the loaded outcome graph (Task 20.3). */
  public get outcomeVocabulary(): OutcomeVocabulary {
    return this.manifest.foundation.vocabulary;
  }

  /** Ordered intervention vocabulary of the legacy intervention head, when configured. */
  public get interventionVocabulary(): OutcomeVocabulary | undefined {
    return this.manifest.intervention?.vocabulary;
  }

  /**
   * Version of the graph that serves the decision.
   *
   * The learned head answers when it is loaded and not ablated, so its identity is the one
   * recorded; otherwise the outcome graph's identity is.
   */
  public get modelVersion(): string {
    const useHead = !this.options.useDeterministicMapping && this.manifest.intervention;
    return useHead
      ? (this.manifest.intervention?.modelVersion ?? this.manifest.foundation.modelVersion)
      : this.manifest.foundation.modelVersion;
  }

  /**
   * Loads both models eagerly so a deployment failure is visible at start-up rather than
   * silently degrading to a heuristic at inference time.
   */
  public async warmup(): Promise<{
    modelLoaded: boolean;
    executionProvider: string;
    foundationLoaded: boolean;
    interventionLoaded: boolean;
    modelVersion: string;
    providers: { foundation?: string; intervention?: string };
  }> {
    const bundle = await getSession(this.options);
    if (!bundle || !bundle.modelsLoaded) {
      this.lastProvider = 'unavailable';
      return {
        modelLoaded: false,
        executionProvider: this.lastProvider,
        foundationLoaded: false,
        interventionLoaded: false,
        modelVersion: this.modelVersion,
        providers: {}
      };
    }
    this.lastProvider = bundle.primaryProvider;
    return {
      modelLoaded: bundle.modelsLoaded,
      executionProvider: this.lastProvider,
      foundationLoaded: Boolean(bundle.foundation?.modelLoaded),
      interventionLoaded: Boolean(bundle.intervention?.modelLoaded),
      modelVersion: this.modelVersion,
      providers: {
        foundation: bundle.foundation?.executionProvider,
        intervention: bundle.intervention?.executionProvider
      }
    };
  }

  public async infer(input: SlowGateInput): Promise<SlowGateResult> {
    const bundle = await getSession(this.options);

    if (!bundle || !bundle.modelsLoaded) {
      // Fail visibly: no model, no fabricated probabilities.
      return { outcome: 'NO_OUTCOME', confidence: 0, source: 'slow' };
    }

    this.assertShape(input);
    this.lastProvider = bundle.primaryProvider;

    const { ort } = bundle;
    const [batch] = input.shape;

    // Compute R^6 context vector
    const contextVector = encodeUIContext(input.context, this.options.contextEncoding);
    if (contextVector.length !== CONTEXT_VECTOR_DIM) {
      throw new Error(
        `[OnnxSlowGate] Context vector must have ${CONTEXT_VECTOR_DIM} elements, received ${contextVector.length}`
      );
    }

    const seqTensor = new ort.Tensor('float32', input.sequence, input.shape as never);
    const ctxTensor = new ort.Tensor('float32', contextVector, [batch, CONTEXT_VECTOR_DIM]);

    let seqInputName = 'sequence_input';
    let ctxInputName = 'context_input';
    if (bundle.intervention) {
      const names = bundle.intervention.inputNames;
      if (names.length !== 2) {
        throw new Error(
          `[OnnxSlowGate] TargetInterventionHead graph must declare 2 inputs (sequence and context), found ${names.length} (${names.join(', ')})`
        );
      }
      seqInputName = names.find((n) => n.includes('seq') || n === 'sequence_input') ?? names[0];
      ctxInputName = names.find((n) => n.includes('context') || n === 'context_input') ?? names[1];
    }

    let fndInputName = 'input';
    if (bundle.foundation) {
      fndInputName = bundle.foundation.inputNames[0] ?? 'input';
    }

    const start = performance.now();
    const [interventionOutputs, foundationOutputs] = await Promise.all([
      bundle.intervention
        ? defaultCollector.timeAsync(
            'ONNX inference',
            'model',
            () =>
              bundle.intervention!.session.run({
                [seqInputName]: seqTensor,
                [ctxInputName]: ctxTensor
              }),
            { metadata: { head: 'intervention' } }
          )
        : Promise.resolve(null),
      bundle.foundation
        ? defaultCollector.timeAsync(
            'ONNX inference',
            'model',
            () => bundle.foundation!.session.run({ [fndInputName]: seqTensor }),
            { metadata: { head: 'foundation' } }
          )
        : Promise.resolve(null)
    ]);
    const latencyMs = performance.now() - start;
    this.lastLatencyMs = latencyMs;

    // `outcome` is the generic seven-class label, and is only defined when the configured
    // vocabulary is that taxonomy. A custom vocabulary is described by `outcomeLabel`.
    let outcome: OutcomeType | undefined;
    let outcomeLabel: string | undefined;
    let outcomeConfidence = 0;
    let outcomeProbabilities: Float32Array | undefined;
    let outcomeIndex: number | undefined;

    if (foundationOutputs && bundle.foundation) {
      const vocabulary = this.outcomeVocabulary;
      const fndOutputName = bundle.foundation.outputNames[0] ?? 'output';
      const fndLogits = foundationOutputs[fndOutputName].data as Float32Array;
      assertVocabularyDimension('Foundation', vocabulary, fndLogits.length);
      outcomeProbabilities = softmax(fndLogits);
      const ranked = argmaxOutcome(fndLogits);
      outcomeLabel = vocabulary.outcomes[ranked.index];
      outcomeConfidence = ranked.confidence;
      outcomeIndex = ranked.index;
      outcome = isFoundationOutcome(outcomeLabel) ? outcomeLabel : undefined;
      this.lastOutcome = outcome;
    }

    let interventionProbabilities: Float32Array | undefined;
    let interventionConfidence = 0;
    let interventionIndex: number | undefined;
    let predictedInterventionType: InterventionType = 'no_op';

    if (interventionOutputs && bundle.intervention) {
      const vocabulary = this.interventionVocabulary;
      const intOutputName = bundle.intervention.outputNames[0] ?? 'intervention_logits';
      const intLogits = interventionOutputs[intOutputName].data as Float32Array;
      if (!vocabulary) {
        throw new Error(
          '[OnnxSlowGate] An intervention graph is loaded but the manifest declares no intervention vocabulary'
        );
      }
      assertVocabularyDimension('Intervention', vocabulary, intLogits.length);
      interventionProbabilities = softmax(intLogits);
      const ranked = argmaxOutcome(logitsAsProbabilities(intLogits));
      const label = vocabulary.outcomes[ranked.index];
      predictedInterventionType = isInterventionTypeString(label) ? label : 'no_op';
      interventionIndex = ranked.index;
      interventionConfidence = ranked.confidence;
    }

    let mappingSource: SlowGateMappingSource;
    let intervention: InterventionCommand | undefined;

    if (this.options.useDeterministicMapping || !interventionOutputs) {
      mappingSource = 'deterministic_mapping';
      intervention = this.buildDeterministicIntervention(outcome, outcomeConfidence, input);
    } else {
      mappingSource = 'learned_head';
      intervention = this.buildLearnedIntervention(
        predictedInterventionType,
        interventionConfidence,
        input
      );
    }

    return {
      outcome,
      confidence: outcomeConfidence,
      probabilities: outcomeProbabilities,
      intervention,
      interventionProbabilities,
      interventionConfidence,
      mappingSource,
      prediction: this.buildPrediction({
        mappingSource,
        outcomeLabel,
        outcomeIndex,
        outcomeConfidence,
        predictedInterventionType,
        interventionIndex,
        interventionConfidence,
        context: input.context
      }),
      gateVersion: ONNX_GATE_VERSION,
      source: 'slow'
    };
  }

  /**
   * Builds the normalized prediction, naming the head that actually decided.
   *
   * The learned head predicts an intervention class (the legacy outcome vocabulary); the
   * outcome graph predicts an outcome class. Whichever decided supplies the vocabulary, the
   * index and the artifact version recorded on the prediction (Task 20.3).
   */
  private buildPrediction(params: {
    mappingSource: SlowGateMappingSource;
    outcomeLabel?: string;
    outcomeIndex?: number;
    outcomeConfidence: number;
    predictedInterventionType: InterventionType;
    interventionIndex?: number;
    interventionConfidence: number;
    context: { activeComponentId?: string };
  }): GatePrediction {
    const learned = params.mappingSource === 'learned_head';
    const vocabulary = learned ? this.interventionVocabulary : this.outcomeVocabulary;
    const label = learned ? params.predictedInterventionType : params.outcomeLabel;
    const confidence = learned ? params.interventionConfidence : params.outcomeConfidence;

    return {
      outcomeId: label ?? 'NO_OUTCOME',
      vocabularyId: vocabulary?.id,
      vocabularyVersion: vocabulary?.version ?? '',
      outcomeIndex: learned ? params.interventionIndex : params.outcomeIndex,
      confidence,
      matched: isAssertiveLabel(label, confidence),
      source: 'slow',
      modelVersion: learned
        ? this.manifest.intervention?.modelVersion
        : this.manifest.foundation.modelVersion,
      mappingSource: params.mappingSource,
      target: targetForContext(params.context)
    };
  }

  public getExecutionProvider(): string {
    return this.lastProvider;
  }

  public getExecutionProviders(): { foundation?: string; intervention?: string } {
    return {
      foundation: cached?.foundation?.executionProvider,
      intervention: cached?.intervention?.executionProvider
    };
  }

  public getLastOutcome(): OutcomeType | undefined {
    return this.lastOutcome;
  }

  public getLastLatencyMs(): number | undefined {
    return this.lastLatencyMs;
  }

  private assertShape(input: SlowGateInput): void {
    const [batch, seqLen, dim] = input.shape;
    const expected = batch * seqLen * dim;
    if (input.sequence.length !== expected) {
      throw new Error(
        `[OnnxSlowGate] Tensor length ${input.sequence.length} does not match shape ${input.shape.join('x')} (${expected})`
      );
    }
    if (dim !== 18) {
      throw new Error(`[OnnxSlowGate] Expected an 18-D MicroTensor, received ${dim}`);
    }
  }

  private buildLearnedIntervention(
    type: InterventionType,
    confidence: number,
    input: SlowGateInput
  ): InterventionCommand | undefined {
    const threshold = this.options.confidenceThreshold ?? 0.5;
    if (confidence < threshold) return undefined;
    if (type === 'no_op') return undefined;

    return {
      type,
      source: 'slow',
      mappingSource: 'learned_head',
      confidence,
      issuedAt: Date.now(),
      targetComponentId: input.context.activeComponentId,
      reason: `ONNX TargetInterventionHead predicted ${type} (p=${confidence.toFixed(3)}) via ${this.lastProvider}`
    };
  }

  private buildDeterministicIntervention(
    outcome: OutcomeType | undefined,
    confidence: number,
    input: SlowGateInput
  ): InterventionCommand | undefined {
    // A custom vocabulary has no entry in the generic outcome→intervention table, so the
    // deterministic path declares no intervention for it rather than guessing one.
    if (!outcome) return undefined;
    const threshold = this.options.confidenceThreshold ?? 0.5;
    if (confidence < threshold) return undefined;

    const table = { ...DEFAULT_OUTCOME_INTERVENTIONS, ...(this.options.interventionByOutcome ?? {}) };
    const type = table[outcome];
    if (!type || type === 'no_op') return undefined;

    return {
      type,
      source: 'slow',
      mappingSource: 'deterministic_mapping',
      confidence,
      issuedAt: Date.now(),
      targetComponentId: input.context.activeComponentId,
      reason: `ONNX Slow Gate (deterministic mapping) predicted ${outcome} -> ${type} (p=${confidence.toFixed(3)}) via ${this.lastProvider}`
    };
  }
}

/** Numerically stable softmax over model logits. */
export function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const value = Math.exp(logits[i] - max);
    exps[i] = value;
    sum += value;
  }
  if (sum > 0) {
    for (let i = 0; i < exps.length; i++) {
      exps[i] /= sum;
    }
  }
  return exps;
}

export function createOnnxSlowGate(options?: OnnxSlowGateOptions): OnnxSlowGate {
  return new OnnxSlowGate(options);
}
