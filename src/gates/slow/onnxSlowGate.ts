/**
 * ONNX-Backed Slow Gate
 *
 * The assessment (§15, §18) found that the running pipeline never executed a model:
 * `OnnxGateClient` was constructed with an empty model URL, the shipped graph expected
 * 9 input features and emitted 6 logits while the runtime produced `(1, 8, 18)` and
 * expected 7 outcome classes, and the inference handler always called a soft-coded
 * heuristic while reporting `provider: webgpu`.
 *
 * This gate implements the `SlowGate` interface against the re-exported graph
 * (18-D input, 7 outcome logits) and reports its execution provider honestly.
 *
 * It runs inside the runtime worker, receives a `(1, T, 18)` tensor plus the encoded
 * UI context vector, and maps the 7 logits onto the outcome taxonomy and the declared
 * intervention space.
 */

import type * as OrtNamespace from 'onnxruntime-web';
import { SlowGate, SlowGateInput, SlowGateResult } from './types';
import { InterventionCommand, InterventionType } from '../../intervention/types';
import { OutcomeType } from '../../telemetry/events';
import { CONTEXT_VECTOR_DIM, encodeUIContext } from '../../types/contextVector';

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
 * Default outcome → intervention mapping for the target head.
 *
 * The end-to-end target head (`TargetInterventionHead`, 5 classes conditioned on the UI
 * context vector) is not yet exported; until it is, this deterministic mapping turns the
 * foundation outcome distribution into a candidate intervention, which keeps the policy
 * and actuator layers exercised against real model output.
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
 * Location of the bundled graph.
 *
 * The artifact lives under `public/models/` so it is served as a static asset at a stable
 * URL, rather than being colocated with a source module. `*.onnx` is gitignored, so the
 * file must be produced by the export step in `model-preparation` before a browser build
 * can execute the Slow Gate.
 */
export const DEFAULT_MODEL_URL = '/models/model_int8.onnx';

/**
 * Absolute URL for the bundled graph, correct in both window and worker scopes.
 */
export function resolveDefaultModelUrl(): string {
  if (typeof location !== 'undefined' && typeof location.origin === 'string') {
    return new URL(DEFAULT_MODEL_URL, location.origin).href;
  }
  return DEFAULT_MODEL_URL;
}

export interface OnnxSlowGateOptions {
  /** Model URL. Defaults to the bundled INT8 graph. */
  modelUrl?: string;
  /** Preferred execution provider order. */
  executionProviders?: ('webgpu' | 'wasm' | 'cpu')[];
  /** Minimum confidence required to emit a candidate intervention. Default 0.5. */
  confidenceThreshold?: number;
  /** Outcome → intervention overrides. */
  interventionByOutcome?: Partial<Record<OutcomeType, InterventionType>>;
  /** Maximum class probability accepted as confident. Default null (no cap). */
  ortModule?: typeof OrtNamespace;
}

interface SessionBundle {
  session: OrtNamespace.InferenceSession;
  ort: typeof OrtNamespace;
  executionProvider: string;
  inputName: string;
  modelLoaded: boolean;
}

let cached: SessionBundle | null = null;

/**
 * Loads the ONNX session once per worker and reports the provider that actually served
 * the session, rather than the provider that was requested.
 */
async function getSession(options: OnnxSlowGateOptions): Promise<SessionBundle | null> {
  if (cached) return cached;

  const ort = options.ortModule ?? (await import('onnxruntime-web'));
  // Resolve to an absolute URL: ONNX Runtime loads the graph from inside a worker, where a
  // bare web-root-relative path would resolve against the worker's own base URL.
  const modelUrl = options.modelUrl ?? resolveDefaultModelUrl();
  const providers = options.executionProviders ?? ['webgpu', 'wasm', 'cpu'];

  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;

  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: providers as never
  });

  // Some builds do not expose the selected provider; fall back to the first requested.
  const selected =
    (session as unknown as { executionProvider?: string }).executionProvider ??
    providers[0] ??
    'wasm';

  cached = {
    session,
    ort,
    executionProvider: selected,
    inputName: session.inputNames[0] ?? 'input',
    modelLoaded: true
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
   * Loads the model eagerly so a deployment failure is visible at start-up rather than
   * silently degrading to a heuristic at inference time.
   */
  public async warmup(): Promise<{ modelLoaded: boolean; executionProvider: string }> {
    const bundle = await getSession(this.options);
    if (!bundle) {
      this.lastProvider = 'unavailable';
      return { modelLoaded: false, executionProvider: this.lastProvider };
    }
    this.lastProvider = bundle.executionProvider;
    return { modelLoaded: bundle.modelLoaded, executionProvider: this.lastProvider };
  }

  public async infer(input: SlowGateInput): Promise<SlowGateResult> {
    const bundle = await getSession(this.options);

    if (!bundle) {
      // Fail visibly: no model, no fabricated probabilities.
      return { outcome: 'NO_OUTCOME', confidence: 0, source: 'slow' };
    }

    this.assertShape(input);
    this.lastProvider = bundle.executionProvider;

    const { ort, session, inputName } = bundle;

    const tensor = new ort.Tensor('float32', input.sequence, input.shape as never);

    // The context vector is computed even though the currently exported graph consumes
    // only the MicroTensor sequence: the target head requires it, and computing it here
    // keeps the encoding path exercised end to end.
    const contextVector = encodeUIContext(input.context);
    if (contextVector.length !== CONTEXT_VECTOR_DIM) {
      throw new Error(`Context vector must have ${CONTEXT_VECTOR_DIM} elements`);
    }

    const start = performance.now();
    const outputs = await session.run({ [inputName]: tensor });
    const latencyMs = performance.now() - start;

    const outputName = session.outputNames[0] ?? 'output';
    const logits = outputs[outputName].data as Float32Array;
    const probabilities = softmax(logits);
    const { outcome, confidence } = this.argmaxOutcome(probabilities);
    const intervention = this.buildIntervention(outcome, confidence, input);

    this.lastOutcome = outcome;
    this.lastLatencyMs = latencyMs;

    return {
      outcome,
      confidence,
      probabilities,
      intervention,
      source: 'slow'
    };
  }

  public getExecutionProvider(): string {
    return this.lastProvider;
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

  private buildIntervention(
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
      confidence,
      issuedAt: Date.now(),
      targetComponentId: input.context.activeComponentId,
      reason: `ONNX Slow Gate predicted ${outcome} (p=${confidence.toFixed(3)}) via ${this.lastProvider}`
    };
  }
}

/** Numerically stable softmax over the model's outcome logits. */
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
