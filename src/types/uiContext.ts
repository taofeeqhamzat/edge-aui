/**
 * Semantic UI Context Contract
 *
 * The model-facing view of the interface at the moment an interaction occurs. This is what
 * `InterventionPolicy` consults for eligibility and what `contextVector.ts` encodes into the
 * `R^6` tensor the target intervention head expects.
 *
 * The single canonical behavioural event schema lives in `src/telemetry/events.ts`; this
 * module holds only the UI-context vocabulary.
 */

/**
 * Semantic DOM Annotation Roles conformant to docs/testbed/prd.md Stage 3.1
 */
export type AuiComponentRole =
  | 'navigation'
  | 'primary-action'
  | 'submit-action'
  | 'secondary-action'
  | 'filter'
  | 'form-field'
  | 'tooltip'
  | 'table-row'
  | 'accordion'
  | 'help'
  | 'kpi-card'
  | 'trial-controls'
  | 'condition-selector'
  | 'condition-option'
  | 'status'
  | 'table';

/**
 * Common user action semantics for data-aui-action
 */
export type AuiAction =
  | 'click'
  | 'change'
  | 'toggle'
  | 'hover'
  | 'select'
  | 'input'
  | 'focus';

/**
 * Experimental task relevance annotation for data-aui-task-role
 */
export type AuiTaskRole = 'required' | 'optional' | 'distractor';

/**
 * Stable Semantic DOM Annotation Contract
 */
export interface SemanticDOMAttributes {
  'data-aui-component': string;
  'data-aui-role': AuiComponentRole | string;
  'data-aui-action'?: AuiAction | string;
  'data-aui-task-role'?: AuiTaskRole | string;
}

/**
 * Scroll state observed at context-snapshot time.
 */
export interface ScrollState {
  /** Normalized [0, 1] scroll depth. */
  scrollY: number;
  /** Raw pixel offset, for parity-faithful re-derivation. */
  scrollTopPx: number;
  scrollableHeight: number;
  viewportHeight: number;
}

/**
 * Active UI Context snapshot supplied to the model-facing inference layer.
 *
 * Version 1.1.0 adds viewport, scrollState, conditionId and uiVersion so the minimum context
 * needed to map behaviour -> outcome -> intervention is present (assessment §12.2).
 */
export interface UIContext {
  route: string;
  activeComponentId?: string;
  componentRole?: AuiComponentRole | string;
  taskId?: string;
  taskStepId?: string;
  availableActions: (AuiAction | string)[];
  primaryActionAvailable: boolean;
  helpAvailable: boolean;
  expandable: boolean;
  /** Observed viewport geometry. */
  viewport?: { width: number; height: number };
  /** Observed document geometry. */
  document?: { width: number; height: number };
  /** Current scroll state. */
  scrollState?: ScrollState;
  /** Experimental condition governing whether adaptation is permitted. */
  conditionId?: 'baseline' | 'adaptive';
  /** Identifier of the UI revision under test, for reproducibility. */
  uiVersion?: string;
}

/** Stable identifier for the target UI revision under evaluation. */
export const TESTBED_UI_VERSION = '1.0.0';
