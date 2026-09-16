/**
 * Canonical BehaviourEvent Schema & Telemetry Event Contracts
 * Implements specifications from clipboard.9.md Sections 10, 14, 16, 29, 30.
 */

export type BehaviourEventType =
  | 'mousemove'
  | 'mouseover'
  | 'mouseout'
  | 'mousedown'
  | 'mouseup'
  | 'click'
  | 'scroll'
  | 'change'
  | 'input'
  | 'submit'
  | 'navigation'
  | 'pagehide';

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

  componentId?: string;
  componentRole?: string;

  route?: string;
  action?: string;

  taskId?: string;
  taskStepId?: string;

  targetTag?: string;
}

/**
 * 18-dimensional continuous kinematic window (9 metrics + 9 modality mask flags)
 */
export interface MicroTensorWindow {
  windowStart: number;
  windowEnd: number;
  values: Float32Array; // length 18
}

/**
 * High-level semantic interaction token
 */
export interface MacroInteraction {
  timestamp: number;
  symbol: string;
  componentId?: string;
  action?: string;
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

export interface OutcomeEvent {
  timestamp: number;
  outcome: OutcomeType;
  componentId?: string;
  taskId?: string;
  taskStepId?: string;
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
}
