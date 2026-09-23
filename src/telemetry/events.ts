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
  timestamp: number; // Monotonic millisecond timestamp (performance.now())
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
  timestamp: number;
  outcome: OutcomeType;
  /** Correlation identifiers. */
  sessionId?: string;
  windowId?: number;
  experimentId?: string;
  conditionId?: string;
  /** The canonical event that resolved the outcome, if any. */
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

/**
 * Model prediction record. The assessment (§16.3) identified the absence of any
 * prediction logging as a reproducibility gap.
 */
export interface PredictionEvent {
  timestamp: number;
  sessionId?: string;
  experimentId?: string;
  conditionId?: string;
  windowId?: number;
  matchedGate: 'fast' | 'slow' | 'none';
  outcome?: OutcomeType;
  interventionType?: string;
  confidence?: number;
  latencyMs?: number;
  /** True when both gates were evaluated and returned no intervention. */
  bothGatesEvaluated: boolean;
}

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
  timestamp: number;
  type: InterventionEventType;
  intervention: string;
  componentId?: string;
  source: 'fast' | 'slow' | 'rule';
  confidence?: number;
  /** Correlates the issued/accepted/applied/dismissed/reverted lifecycle of one episode. */
  interventionEpisodeId?: string;
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
