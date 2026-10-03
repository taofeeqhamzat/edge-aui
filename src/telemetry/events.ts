/**
 * Canonical BehaviourEvent Schema & Telemetry Event Contracts
 * Implements specifications from docs/testbed/prd.md Sections 10, 14, 16, 29, 30.
 *
 * Schema version 1.1.0 additions (assessment §25 P0-2/P0-3/P0-5):
 * - viewport/document geometry carried on every event so MicroTensor re-derivation
 *   does not depend on a document-size fallback.
 * - `windowId` correlation identifier on windows, macro interactions and outcomes.
 * - `sessionId` / `experimentId` / `conditionId` correlation on macro + outcome events.
 * - outcome derivation metadata for auditability.
 * - lifecycle + focus event types required by the ABANDON / BACKTRACK outcomes.
 *
 * Schema version 1.3.0 (supervisor-ready deployment, assessment F-01 / F-07 / F-18):
 * - ONE clock: every `timestamp` below is epoch milliseconds. `performance.now()` is not
 *   durable across navigation, so mixing it with `Date.now()` made the trace's internal
 *   order unreconstructable (F-01). See `getWallClockTimestamp()`.
 * - `PolicyDecisionEvent` records the policy verdict and reason for every evaluation,
 *   including rejections and the baseline decision-only branch (F-07).
 * - `predictionId` / `evaluatedWindowIds` make window attribution explicit rather than
 *   inferred from "the newest window at the time" (F-18).
 */

export type BehaviourEventType =
  | 'mousemove'
  | 'mouseover'
  | 'mouseout'
  | 'mousedown'
  | 'mouseup'
  | 'click'
  | 'scroll'
  | 'wheel'
  | 'change'
  | 'input'
  | 'submit'
  | 'focus'
  | 'blur'
  | 'popstate'
  | 'hashchange'
  | 'navigation'
  | 'pagehide'
  | 'beforeunload'
  | 'unload';

/** Viewport geometry observed at the time the event was recorded. */
export interface ViewportGeometry {
  width: number;
  height: number;
}

/** Document geometry observed at the time the event was recorded. */
export interface DocumentGeometry {
  width: number;
  height: number;
  scrollableWidth: number;
  scrollableHeight: number;
}

/**
 * Typed canonical behavioural event produced by client-side observers.
 * Coordinates and scroll depths are normalized to [0, 1] relative to viewport.
 */
export interface BehaviourEvent {
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
  type: BehaviourEventType;

  x?: number; // Normalized [0, 1] relative to viewport width
  y?: number; // Normalized [0, 1] relative to viewport height

  scrollX?: number; // Normalized [0, 1] relative to document scrollable width
  scrollY?: number; // Normalized [0, 1] relative to document scrollable height

  /** Raw pixel offsets, retained only for parity-faithful kinematic reconstruction. */
  scrollTopPx?: number;

  componentId?: string;
  componentRole?: string;

  route?: string;
  action?: string;

  taskId?: string;
  taskStepId?: string;

  targetTag?: string;

  /**
   * Post-action disclosure state of the interaction target, when it declares one.
   *
   * Captured because macro-symbol derivation previously inferred "opened the filters" from
   * an `action` string containing "close", which nothing produced — so `CLOSE_FILTERS` was
   * unreachable and every accordion interaction collapsed into `OPEN_FILTERS`. The observed
   * `aria-expanded` value is the honest source for that distinction (assessment F-06).
   */
  ariaExpanded?: boolean;

  /** Observed geometry so downstream extraction never falls back to a constant. */
  viewport?: ViewportGeometry;
  document?: DocumentGeometry;
}

/**
 * 18-dimensional continuous kinematic window (9 metrics + 9 modality mask flags).
 *
 * `windowId` is a monotonically increasing per-session correlation identifier so a
 * window can be tied to the outcome, prediction, and intervention it produced.
 * `eventCount` is the number of canonical events inside the window; a window emitted
 * on the monotonic schedule with zero events is a genuine inactivity window and is
 * distinguishable from a window whose modalities were unavailable.
 */
export interface MicroTensorWindow {
  windowId: number;
  windowStart: number;
  windowEnd: number;
  values: Float32Array; // length 18
  eventCount?: number;
  /** True when the window was emitted during verified user inactivity. */
  inactive?: boolean;
}

/**
 * High-level semantic interaction token
 */
export interface MacroInteraction {
  timestamp: number;
  symbol: string;
  componentId?: string;
  action?: string;
  sessionId?: string;
  windowId?: number;
  experimentId?: string;
  conditionId?: string;
  route?: string;
}

/**
 * Observable UI outcome states for evaluation and supervised target alignment
 */
export type OutcomeType =
  | 'CLICK'
  | 'FORM_SUBMIT'
  | 'BACKTRACK'
  | 'RAPID_SCROLL'
  | 'HOVER_DWELL'
  | 'ABANDON'
  | 'NO_OUTCOME';

/** Deterministic derivation metadata, mirroring model-preparation/target_generation.py. */
export interface OutcomeDerivationMetadata {
  lookaheadStartMs: number;
  lookaheadEndMs: number;
  candidateCount: number;
  earliestTimestampMs: number | null;
  tieBroken: boolean;
  source:
    | 'none'
    | 'lifecycle_event'
    | 'stream_exhaustion'
    | 'dom_action'
    | 'navigation_shift'
    | 'motor_stream';
  observableTermination: boolean;
}

export interface OutcomeEvent {
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
  outcome: OutcomeType;
  /** Correlation identifiers. */
  sessionId?: string;
  windowId?: number;
  experimentId?: string;
  conditionId?: string;
  /** The canonical event that resolved the outcome, if any. */
  /** Canonical trace clock: epoch milliseconds. */
  sourceEventTimestamp?: number;
  sourceEventType?: BehaviourEventType;
  componentId?: string;
  taskId?: string;
  taskStepId?: string;
  route?: string;
  /**
   * True when the full lookahead horizon had elapsed and observed events when the
   * outcome was derived. A `false` value means the label may still be revised
   * (the window is provisional), which distinguishes a settled label from a
   * provisional one during live capture.
   */
  lookaheadComplete?: boolean;
  /** Deterministic derivation metadata for auditability. */
  derivation?: OutcomeDerivationMetadata;
}

/** Closed taxonomy of generative mechanisms that can produce an intervention command (ADR-006 / Task 5.3). */
export type MappingSource =
  | 'learned_head'
  | 'deterministic_mapping'
  | 'fast_gate_pattern';

/**
 * Model prediction record. The assessment (§16.3) identified the absence of any
 * prediction logging as a reproducibility gap.
 * Schema 1.2.0 adds mappingSource, modelVersion, and contextEncodingVersion.
 * Schema 1.3.0 adds predictionId / evaluatedWindowIds so the evaluated window is named
 * explicitly instead of being read from "the newest window at evaluation time" (F-18).
 */
export interface PredictionEvent {
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
  /**
   * Stable identifier for this prediction, referenced by the policy decision and the
   * intervention episode it produces.
   */
  predictionId?: string;
  sessionId?: string;
  experimentId?: string;
  conditionId?: string;
  /** The window whose closing state was evaluated, captured at evaluation time. */
  windowId?: number;
  /**
   * Every window id contained in the evaluated sequence. `windowId` is the last of these.
   * Recorded so window attribution can be verified rather than assumed.
   */
  evaluatedWindowIds?: number[];
  matchedGate: 'fast' | 'slow' | 'none';
  outcome?: OutcomeType;
  interventionType?: string;
  mappingSource?: MappingSource;
  confidence?: number;
  latencyMs?: number;
  fastGateLatencyMs?: number;
  slowGateLatencyMs?: number;
  modelVersion?: string;
  contextEncodingVersion?: string;
  /** True when both gates were evaluated and returned no intervention. */
  bothGatesEvaluated: boolean;
}

/**
 * Policy verdict record. Every evaluation produces exactly one of these, whether or not an
 * intervention was emitted.
 *
 * This exists because the pre-1.3.0 trace could only answer "did an intervention happen?",
 * never "why did it not?" — rejection reasons lived only in transient debug state (F-07).
 * A rejection is a research result, not noise, so it must survive in the record.
 */
export interface PolicyDecisionEvent {
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
  sessionId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  /** The window the prediction under this decision was evaluated on. */
  windowId?: number;
  /** The prediction this verdict is about, when a prediction was produced. */
  predictionId?: string;
  /** The candidate intervention considered, when one was produced. */
  candidate?: string;
  /** Confidence of the candidate, when one was produced. */
  confidence?: number;
  /** Whether the policy permitted actuation. */
  accepted: boolean;
  /**
   * The full verdict for the record:
   * - `accepted`      — permitted and (in the adaptive condition) actuated;
   * - `rejected`      — a candidate existed but the policy refused it;
   * - `decision_only` — permitted, but the baseline condition forbids DOM mutation;
   * - `no_prediction` — no candidate existed at all.
   */
  policyDecision: 'accepted' | 'rejected' | 'decision_only' | 'no_prediction';
  /** Human-readable reason. Never empty — a decision without a reason is the F-07 defect. */
  policyReason: string;
  /** Rejection category, for grouping without string matching. */
  rejectionCategory?: PolicyRejectionCategory;
  /** Consecutive-window persistence count at decision time, when applicable. */
  candidateCount?: number;
  /** Cooldown remaining in milliseconds at decision time. */
  cooldownRemainingMs?: number;
  /** Adaptation lifetime applied to an accepted command, when applicable. */
  ttlMs?: number;
  /** Stage this record describes, so a partially-completed evaluation is still traceable. */
  phase: 'no_prediction' | 'prediction' | 'policy' | 'actuation' | 'actuation_failed';
}

/** Grouping key for a policy refusal, so analysis never depends on parsing prose. */
export type PolicyRejectionCategory =
  | 'cooldown'
  | 'dismissed'
  | 'below_threshold'
  | 'ineligible_context'
  | 'pending_persistence'
  | 'unknown_candidate'
  | 'baseline_condition'
  | 'actuation_failed';

/**
 * Telemetry log for non-destructive interface adaptations
 */
export type InterventionEventType =
  | 'issued'
  | 'accepted'
  | 'applied'
  | 'dismissed'
  | 'reverted';

export interface InterventionEvent {
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
  type: InterventionEventType;
  intervention: string;
  componentId?: string;
  source: 'fast' | 'slow' | 'rule';
  /** Generative mechanism that produced this adaptation (Task 5.3). */
  mappingSource?: MappingSource;
  confidence?: number;
  /** Correlates the issued/accepted/applied/dismissed/reverted lifecycle of one episode. */
  interventionEpisodeId?: string;
  /** The prediction that produced this episode, completing the attribution chain. */
  predictionId?: string;
  /**
   * Why the episode terminated. An `applied` episode with no terminal event is the F-03
   * defect: the adaptation silently persisted for the rest of the session.
   */
  reason?: 'ttl' | 'user_dismissal' | 'session_end' | 'reset' | 'replaced';
  sessionId?: string;
  experimentId?: string;
  conditionId?: string;
  windowId?: number;
}

/** Experimental condition for the baseline vs adaptive contrast. */
export type ExperimentalCondition = 'baseline' | 'adaptive';

/** Status of an experimental task trial. */
export type TaskEventStatus = 'Idle' | 'In Progress' | 'Completed' | 'Abandoned';

/**
 * Task lifecycle record. The assessment (§6.2) found that the testbed produced no
 * task start/completion/failure/abandonment/reset events at all.
 */
export interface TaskEvent {
  /** Canonical trace clock: epoch milliseconds (`getWallClockTimestamp()`). */
  timestamp: number;
  type:
    | 'task_start'
    | 'task_step'
    | 'task_complete'
    | 'task_error'
    | 'task_reset'
    | 'task_abandon';
  taskId: string | null;
  taskStepId?: string;
  status: TaskEventStatus;
  errors: number;
  durationMs?: number;
  reason?: 'reset' | 'timeout' | 'navigation';
  sessionId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
}
