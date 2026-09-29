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
import { SlowGate, SlowGateInput, SlowGateResult, SlowGateMappingSource } from './types';
import { InterventionCommand, InterventionType } from '../../intervention/types';
import { OutcomeType } from '../../telemetry/events';
import { CONTEXT_VECTOR_DIM, encodeUIContext } from '../../types/contextVector';
import { defaultCollector } from '../../runtime/instrumentation';

/** Outcome class order, aligned with model-preparation/config.yaml `foundation_classes`. */
export const OUTCOME_CLASS_ORDER: OutcomeType[] = [
  'NO_OUTCOME',
  'CLICK',
  'FORM_SUBMIT',
  'BACKTRACK',
  'RAPID_SCROLL',
  'HOVER_DWELL',
  'ABANDON'
];

export const SLOW_GATE_NUM_CLASSES = OUTCOME_CLASS_ORDER.length;

/**
 * Target intervention class order, aligned with model-preparation/src/config.yaml
 * and bundle.json `target_intervention_vocabulary`.
 */
export const TARGET_INTERVENTION_ORDER: InterventionType[] = [
  'simplify_options',
  'highlight_primary_action',
  'offer_assistance',
  'expand_tooltip',
  'no_op'
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

/** Default bundled graph URLs. */
export const DEFAULT_MODEL_URL = '/models/model_int8.onnx';
export const DEFAULT_INTERVENTION_MODEL_URL = '/models/intervention_head_int8.onnx';

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
  /** Minimum confidence required to emit a candidate intervention. Default 0.5. */
  confidenceThreshold?: number;
  /** Minimum outcome confidence for foundation head. */
  minOutcomeConfidence?: number;
  /** Explicit ablation arm: use deterministic mapping instead of learned head even if loaded. Default false. */
  useDeterministicMapping?: boolean;
  /** Outcome → intervention overrides for deterministic mapping. */
  interventionByOutcome?: Partial<Record<OutcomeType, InterventionType>>;
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
 * Loads ONNX sessions once per worker and reports the providers that actually served
 * the sessions, rather than the providers that were requested.
 */
async function getSession(options: OnnxSlowGateOptions): Promise<DualSessionBundle | null> {
  if (cached) return cached;

  const ort = options.ortModule ?? (await import('onnxruntime-web'));
  const providers = options.executionProviders ?? ['webgpu', 'wasm', 'cpu'];

  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;

  const foundationUrl =
    options.modelUrl === null
      ? null
      : options.modelUrl !== undefined
        ? options.modelUrl
        : DEFAULT_MODEL_URL;

  const interventionUrl =
    options.interventionModelUrl === null
      ? null
      : options.interventionModelUrl !== undefined
        ? options.interventionModelUrl
        : DEFAULT_INTERVENTION_MODEL_URL;

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

export class OnnxSlowGate implements SlowGate {
  private readonly options: OnnxSlowGateOptions;
  private lastProvider = 'uninitialised';
  private lastOutcome?: OutcomeType;
  private lastLatencyMs?: number;

  constructor(options: OnnxSlowGateOptions = {}) {
    this.options = options;
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
        providers: {}
      };
    }
    this.lastProvider = bundle.primaryProvider;
    return {
      modelLoaded: bundle.modelsLoaded,
      executionProvider: this.lastProvider,
      foundationLoaded: Boolean(bundle.foundation?.modelLoaded),
      interventionLoaded: Boolean(bundle.intervention?.modelLoaded),
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
    const contextVector = encodeUIContext(input.context);
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

    let outcome: OutcomeType = 'NO_OUTCOME';
    let outcomeConfidence = 0;
    let outcomeProbabilities: Float32Array | undefined;

    if (foundationOutputs && bundle.foundation) {
      const fndOutputName = bundle.foundation.outputNames[0] ?? 'output';
      const fndLogits = foundationOutputs[fndOutputName].data as Float32Array;
      if (fndLogits.length !== SLOW_GATE_NUM_CLASSES) {
        throw new Error(
          `[OnnxSlowGate] Expected foundation output dimension ${SLOW_GATE_NUM_CLASSES}, received ${fndLogits.length}`
        );
      }
      outcomeProbabilities = softmax(fndLogits);
      const argmax = this.argmaxOutcome(outcomeProbabilities);
      outcome = argmax.outcome;
      outcomeConfidence = argmax.confidence;
      this.lastOutcome = outcome;
    }

    let interventionProbabilities: Float32Array | undefined;
    let interventionConfidence = 0;
    let predictedInterventionType: InterventionType = 'no_op';

    if (interventionOutputs && bundle.intervention) {
      const intOutputName = bundle.intervention.outputNames[0] ?? 'intervention_logits';
      const intLogits = interventionOutputs[intOutputName].data as Float32Array;
      if (intLogits.length !== TARGET_INTERVENTION_NUM_CLASSES) {
        throw new Error(
          `[OnnxSlowGate] Expected intervention output dimension ${TARGET_INTERVENTION_NUM_CLASSES}, received ${intLogits.length}`
        );
      }
      interventionProbabilities = softmax(intLogits);
      const argmaxInt = this.argmaxIntervention(interventionProbabilities);
      predictedInterventionType = argmaxInt.type;
      interventionConfidence = argmaxInt.confidence;
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
      source: 'slow'
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

  private argmaxOutcome(probabilities: Float32Array): { outcome: OutcomeType; confidence: number } {
    let bestIdx = 0;
    let bestProb = -Infinity;
    for (let i = 0; i < probabilities.length; i++) {
      if (probabilities[i] > bestProb) {
        bestProb = probabilities[i];
        bestIdx = i;
      }
    }
    return { outcome: OUTCOME_CLASS_ORDER[bestIdx] ?? 'NO_OUTCOME', confidence: bestProb };
  }

  private argmaxIntervention(
    probabilities: Float32Array
  ): { type: InterventionType; confidence: number } {
    let bestIdx = 0;
    let bestProb = -Infinity;
    for (let i = 0; i < probabilities.length; i++) {
      if (probabilities[i] > bestProb) {
        bestProb = probabilities[i];
        bestIdx = i;
      }
    }
    return {
      type: TARGET_INTERVENTION_ORDER[bestIdx] ?? 'no_op',
      confidence: bestProb
    };
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
    outcome: OutcomeType,
    confidence: number,
    input: SlowGateInput
  ): InterventionCommand | undefined {
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
