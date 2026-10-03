/**
 * ExperimentTrace Schema & Validation Contract
 * Implements Stage 10.1 specifications from docs/testbed/prd.md Sections 33-34 & docs/plan/tasks/10.1.md.
 *
 * Schema 1.1.0 additions (assessment §16 / §25 P0-5):
 * - `predictions` array: every gate evaluation is logged so a prediction can be tied to
 *   the window that produced it.
 * - `experimentId` / `conditionId` on session and metadata, enabling baseline/adaptive
 *   separation and pooled-or-separated analysis.
 * - `session.startedAtEpochMs` so `durationMs` is computed from a single clock.
 *
 * Schema 1.3.0 additions (supervisor-ready deployment, assessment F-01 / F-07 / F-18):
 * - **One clock.** Every record timestamp is epoch milliseconds. `performance.now()` is not
 *   durable across navigation, so mixing it with `Date.now()` made the trace's internal
 *   order unreconstructable and task duration underivable (F-01). `clock` records the
 *   decision so the format is self-describing.
 * - `policyDecisions` array: one entry per evaluation, including rejections and the
 *   baseline decision-only branch, so "why did it not intervene?" is answerable post hoc
 *   (F-07).
 * - `predictionId` and `evaluatedWindowIds` so prediction → policy → episode → UI is a
 *   complete, verifiable chain (F-18).
 * - `provenance` records scripted vs participant origin so the two can never be pooled or
 *   confused (ADR-018).
 * - `mining` counters and `evictedRecords` so bounded execution and buffer pressure are
 *   visible rather than silent.
 *
 * Provides:
 * 1. Strict schema definition for offline experiment evaluation and replay.
 * 2. In-memory validation function verifying structural integrity without external libraries.
 * 3. Replay event chronological reconstruction stream.
 */

import {
  BehaviourEvent,
  MacroInteraction,
  OutcomeEvent,
  InterventionEvent,
  PredictionEvent,
  PolicyDecisionEvent,
  TaskEvent,
  ExperimentalCondition
} from './events';
import { SessionContext, SessionProvenance } from './session';
import { UiTaskStateSnapshot } from '../integration/types';
import type { RuntimeConfig } from '../config/runtimeConfig';

export const EXPERIMENT_TRACE_SCHEMA_VERSION = '1.3.0';
export const SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS = ['1.3.0', '1.2.0', '1.1.0'] as const;

/**
 * The single clock every trace record uses.
 *
 * Declared in metadata so a consumer never has to guess: a 1.2.0 trace contains both
 * `performance.now()` and `Date.now()` values in the same array, which is exactly the
 * defect 1.3.0 removes.
 */
export const TRACE_CLOCK_MODE = 'epoch_ms' as const;
export type TraceClockMode = typeof TRACE_CLOCK_MODE;

/** Bounded Fast Gate execution counters recorded at export time (F-02). */
export interface MiningCounters {
  /** Evaluations that ran the miner. */
  executed: number;
  /** Evaluations suppressed because the sequence was not yet full. */
  skipped: number;
  /** Evaluations dropped because a newer window arrived while one was in flight. */
  superseded: number;
  /** Evaluations abandoned at the mining deadline. */
  timedOut: number;
  /** Windows that could not be dispatched to the worker (queue/timeout failure). */
  droppedWindows: number;
  /** Largest single mining duration observed, in milliseconds. */
  observedMaxMiningMs?: number;
}

/** Counters proving telemetry was not silently truncated (F-16). */
export interface EvictionCounters {
  /** Records discarded by FIFO eviction, summed across every buffer. */
  total: number;
  /** Per-buffer eviction counts, keyed by buffer name. */
  byBuffer: Record<string, number>;
  /** A true value means the trace is incomplete and must not be treated as whole. */
  truncated: boolean;
}

/**
 * Slack added to the outcome-settlement allowance before a window is called orphaned.
 *
 * Covers the granularity at which settlement is applied (the runtime ticks at
 * `stride/2` = 125 ms) plus the possibility of a slightly late event extending a horizon.
 * Without it a healthy capture would be reported as corrupt because of sub-tick jitter.
 */
export const SETTLEMENT_TOLERANCE_MS = 500;

/**
 * Windows that have passed their whole settlement allowance without an outcome label.
 *
 * Outcomes settle lazily: a window is labelled once the observed stream has passed its
 * lookahead horizon (`windowEnd + lookaheadMax`) or the idle grace period expires. On the
 * 250 ms stride with a 1500 ms lookahead and a 2000 ms grace, a healthy *live* session always
 * has roughly a dozen windows legitimately awaiting settlement — they are in flight, not
 * missing.
 *
 * Treating in-flight windows as defects made every real capture fail verification, which is
 * exactly how the previous verifier came to pass only on hand-authored fixtures (F-13). This
 * function is the single definition of "orphaned": a window is only orphaned once the newest
 * window in the trace is older than that window plus the entire settlement allowance.
 *
 * @param windows          MicroTensor windows with `windowId`/`windowEnd` (epoch ms).
 * @param outcomeWindowIds Window ids that do have an outcome record.
 * @param lookaheadMaxMs   Maximum lookahead offset after `windowEnd`.
 * @param graceMs          Idle grace period applied when the stream goes quiet.
 */
export function findOrphanedWindows(
  windows: Array<{ windowId: number; windowEnd: number }>,
  outcomeWindowIds: Set<number>,
  lookaheadMaxMs: number,
  graceMs: number
): number[] {
  const allowance = lookaheadMaxMs + graceMs + SETTLEMENT_TOLERANCE_MS;
  const newestWindowEnd = windows.reduce(
    (max, w) => (Number.isFinite(w.windowEnd) && w.windowEnd > max ? w.windowEnd : max),
    0
  );

  return windows
    .filter((w) => !outcomeWindowIds.has(w.windowId))
    .filter(
      (w) => !Number.isFinite(w.windowEnd) || newestWindowEnd - w.windowEnd >= allowance
    )
    .map((w) => w.windowId);
}

export interface SerializableMicroTensorWindow {
  windowId: number;
  windowStart: number;
  windowEnd: number;
  values: number[]; // Serialized 18-element array
  eventCount?: number;
  inactive?: boolean;
}

export interface TraceReplayMetadata {
  durationMs: number;
  totalEvents: number;
  behaviourCount: number;
  microTensorCount: number;
  macroCount: number;
  outcomeCount: number;
  predictionCount: number;
  interventionCount: number;
  policyDecisionCount: number;
  taskEventCount: number;
  finalTaskStatus?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  uiVersion?: string;
  settlementDelayMs?: number;
  effectiveConfig?: RuntimeConfig;
  /** The single clock every record timestamp uses. */
  clock: TraceClockMode;
  /** Scripted/synthetic or participant-derived. Never inferred. */
  provenance: SessionProvenance;
  /** Application/package version that produced this trace. */
  applicationVersion: string;
  /** Model provenance as actually loaded, not as requested (F-10, F-19). */
  modelVersion?: string;
  /** Execution provider the ONNX session actually reported (F-10). */
  executionProvider?: string;
  /** Policy version in force for this trace. */
  policyVersion: string;
  /** Bounded Fast Gate execution counters (F-02). */
  mining?: MiningCounters;
  /** Buffer-eviction proof so truncation is never silent (F-16). */
  evictions?: EvictionCounters;
  /**
   * Non-fatal integrity problems detected at export time. A non-empty array means the
   * trace is usable but must not be treated as a clean capture.
   */
  integrityWarnings?: string[];
}

export interface SerializableExperimentTrace {
  schemaVersion: string;
  exportedAt: string; // ISO 8601 string
  session: SessionContext;
  task?: UiTaskStateSnapshot;
  metadata: TraceReplayMetadata;
  effectiveConfig?: RuntimeConfig;
  behaviourEvents: BehaviourEvent[];
  microTensors: SerializableMicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  predictions: PredictionEvent[];
  policyDecisions: PolicyDecisionEvent[];
  interventions: InterventionEvent[];
  taskEvents: TaskEvent[];
}

export interface TraceValidationResult {
  valid: boolean;
  errors: string[];
  isLegacyVersion?: boolean;
}

/**
 * Validates whether an unknown object conforms to the SerializableExperimentTrace contract.
 */
export function validateExperimentTrace(data: unknown): TraceValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Trace must be a non-null object'] };
  }

  const trace = data as Partial<SerializableExperimentTrace>;

  const isCurrentVersion = trace.schemaVersion === EXPERIMENT_TRACE_SCHEMA_VERSION;
  const isSupportedLegacy = (SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS as readonly string[]).includes(
    trace.schemaVersion as string
  ) && !isCurrentVersion;

  /**
   * Requirements introduced by the canonical-clock contract apply only from 1.3.0.
   *
   * A 1.2.0 capture predates `policyDecisions` and the clock/provenance metadata fields, and
   * it cannot be retro-fixed. Demanding them of a legacy record would make the verifier
   * reject exactly the historical captures it exists to audit, which is the failure mode
   * that let real traces fail while fixture-only checks stayed green (F-13).
   */
  const requiresCanonicalContract =
    typeof trace.schemaVersion === 'string' &&
    trace.schemaVersion.localeCompare(EXPERIMENT_TRACE_SCHEMA_VERSION, undefined, { numeric: true }) >= 0;

  if (!isCurrentVersion && !isSupportedLegacy) {
    errors.push(
      `Invalid schemaVersion: expected '${EXPERIMENT_TRACE_SCHEMA_VERSION}' (or supported legacy ` +
        `${SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS.filter((v) => v !== EXPERIMENT_TRACE_SCHEMA_VERSION)
          .map((v) => `'${v}'`)
          .join(', ')}), received '${trace.schemaVersion}'`
    );
  }

  if (typeof trace.exportedAt !== 'string' || Number.isNaN(Date.parse(trace.exportedAt))) {
    errors.push('Invalid exportedAt: must be a valid ISO date string');
  }

  // Session validation
  if (!trace.session || typeof trace.session !== 'object') {
    errors.push('Missing or invalid session object');
  } else {
    if (typeof trace.session.sessionId !== 'string' || trace.session.sessionId.trim() === '') {
      errors.push('session.sessionId must be a non-empty string');
    }
    if (typeof trace.session.startedAt !== 'number') {
      errors.push('session.startedAt must be a numeric timestamp');
    }
    if (
      trace.session.startedAtEpochMs !== undefined &&
      typeof trace.session.startedAtEpochMs !== 'number'
    ) {
      errors.push('session.startedAtEpochMs must be a numeric timestamp when present');
    }
  }

  // Array validations
  const validateArrayField = (field: keyof SerializableExperimentTrace, name: string) => {
    if (!Array.isArray(trace[field])) {
      errors.push(`${name} must be an array`);
    }
  };

  validateArrayField('behaviourEvents', 'behaviourEvents');
  validateArrayField('microTensors', 'microTensors');
  validateArrayField('macroInteractions', 'macroInteractions');
  validateArrayField('outcomes', 'outcomes');
  validateArrayField('predictions', 'predictions');
  validateArrayField('interventions', 'interventions');
  validateArrayField('taskEvents', 'taskEvents');
  // `policyDecisions` is required from 1.3.0 onward. Pre-1.3.0 traces never carried it, so
  // demanding it there would reject the historical captures the verifier is meant to audit.
  if (requiresCanonicalContract) {
    validateArrayField('policyDecisions', 'policyDecisions');
  } else if (trace.policyDecisions !== undefined && !Array.isArray(trace.policyDecisions)) {
    errors.push('policyDecisions must be an array when present');
  }

  // Validate MicroTensor window format
  if (Array.isArray(trace.microTensors)) {
    for (let i = 0; i < trace.microTensors.length; i++) {
      const mt = trace.microTensors[i];
      if (!mt || typeof mt !== 'object') {
        errors.push(`microTensors[${i}] must be an object`);
        break;
      }
      if (typeof mt.windowStart !== 'number' || typeof mt.windowEnd !== 'number') {
        errors.push(`microTensors[${i}] has invalid windowStart/windowEnd timestamps`);
        break;
      }
      if (typeof mt.windowId !== 'number') {
        errors.push(`microTensors[${i}] is missing the windowId correlation identifier`);
        break;
      }
      if (!Array.isArray(mt.values) || mt.values.length !== 18) {
        errors.push(`microTensors[${i}].values must be an 18-element numeric array, found length ${mt.values?.length}`);
        break;
      }
    }
  }

  // Validate outcome correlation identity (assessment §16.3)
  if (Array.isArray(trace.outcomes)) {
    for (let i = 0; i < trace.outcomes.length; i++) {
      const outcome = trace.outcomes[i];
      if (!outcome || typeof outcome !== 'object') {
        errors.push(`outcomes[${i}] must be an object`);
        break;
      }
      if (typeof outcome.outcome !== 'string') {
        errors.push(`outcomes[${i}] is missing an outcome label`);
        break;
      }
      if (typeof outcome.windowId !== 'number') {
        errors.push(`outcomes[${i}] is missing the windowId correlation identifier`);
        break;
      }
    }
  }

  // Validate policy-decision attribution (F-07). Each decision must carry the policy
  // verdict and its reason: a decision without a reason is the defect being removed.
  if (Array.isArray(trace.policyDecisions)) {
    for (let i = 0; i < trace.policyDecisions.length; i++) {
      const pd = trace.policyDecisions[i];
      if (!pd || typeof pd !== 'object') {
        errors.push(`policyDecisions[${i}] must be an object`);
        break;
      }
      if (typeof pd.policyDecision !== 'string') {
        errors.push(`policyDecisions[${i}] is missing the policyDecision verdict`);
        break;
      }
      if (typeof pd.policyReason !== 'string' || pd.policyReason.trim() === '') {
        errors.push(`policyDecisions[${i}] is missing a non-empty policyReason`);
        break;
      }
      if (typeof pd.timestamp !== 'number') {
        errors.push(`policyDecisions[${i}] must carry a numeric timestamp`);
        break;
      }
    }
  }

  // Validate metadata
  if (!trace.metadata || typeof trace.metadata !== 'object') {
    errors.push('Missing or invalid metadata object');
  } else {
    if (typeof trace.metadata.totalEvents !== 'number') {
      errors.push('metadata.totalEvents must be a number');
    }
    if (typeof trace.metadata.durationMs !== 'number' || trace.metadata.durationMs < 0) {
      errors.push('metadata.durationMs must be a non-negative number');
    }
    if (typeof trace.metadata.conditionId !== 'string') {
      errors.push('metadata.conditionId must be a string for baseline/adaptive separation');
    }
    if (requiresCanonicalContract) {
      if (trace.metadata.clock !== TRACE_CLOCK_MODE) {
        errors.push(`metadata.clock must be '${TRACE_CLOCK_MODE}' for schema ${EXPERIMENT_TRACE_SCHEMA_VERSION}`);
      }
      if (trace.metadata.provenance !== 'scripted' && trace.metadata.provenance !== 'participant') {
        errors.push("metadata.provenance must be 'scripted' or 'participant'");
      }
      if (typeof trace.metadata.applicationVersion !== 'string' || trace.metadata.applicationVersion === '') {
        errors.push('metadata.applicationVersion must be a non-empty string');
      }
      if (typeof trace.metadata.policyVersion !== 'string' || trace.metadata.policyVersion === '') {
        errors.push('metadata.policyVersion must be a non-empty string');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    isLegacyVersion: isSupportedLegacy
  };
}

export type ReplayEventCategory =
  | 'behaviour'
  | 'macro'
  | 'outcome'
  | 'prediction'
  | 'policy'
  | 'intervention'
  | 'task';

export interface ReplayStreamItem {
  timestamp: number;
  category: ReplayEventCategory;
  event:
    | BehaviourEvent
    | MacroInteraction
    | OutcomeEvent
    | PredictionEvent
    | PolicyDecisionEvent
    | InterventionEvent
    | TaskEvent;
}

/**
 * Reconstructs a flat, strictly chronological stream of interactions and decisions
 * for offline simulation and model evaluation replay (Section 34).
 *
 * Every category is on the same epoch clock as of schema 1.3.0, so the sort below produces a
 * genuine causal order. For a legacy 1.2.0/1.1.0 trace the sort is still performed, but the
 * ordering is not meaningful because those records mix two clocks (F-01).
 */
export function reconstructReplayStream(trace: SerializableExperimentTrace): ReplayStreamItem[] {
  const stream: ReplayStreamItem[] = [];

  for (const ev of trace.behaviourEvents) {
    stream.push({ timestamp: ev.timestamp, category: 'behaviour', event: ev });
  }
  for (const ev of trace.macroInteractions) {
    stream.push({ timestamp: ev.timestamp, category: 'macro', event: ev });
  }
  for (const ev of trace.outcomes) {
    stream.push({ timestamp: ev.timestamp, category: 'outcome', event: ev });
  }
  for (const ev of trace.predictions ?? []) {
    stream.push({ timestamp: ev.timestamp, category: 'prediction', event: ev });
  }
  for (const ev of trace.policyDecisions ?? []) {
    stream.push({ timestamp: ev.timestamp, category: 'policy', event: ev });
  }
  for (const ev of trace.interventions) {
    stream.push({ timestamp: ev.timestamp, category: 'intervention', event: ev });
  }
  for (const ev of trace.taskEvents ?? []) {
    stream.push({ timestamp: ev.timestamp, category: 'task', event: ev });
  }

  // Sort strictly monotonically by timestamp
  return stream.sort((a, b) => a.timestamp - b.timestamp);
}
