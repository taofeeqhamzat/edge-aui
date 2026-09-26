/**
 * UI Adapter Integration Module
 *
 * Implements Stage 3.4 specifications from docs/plan/1/tasks/3.4.md and ADR-011.
 * Provides the integration contract and a sensible default fallback adapter.
 */

import { UiAdapter, UiTaskStateSnapshot } from './types';
import { getActiveUIContext } from '../telemetry/contextProvider';

export * from './types';

/**
 * Standard browser event to task action mapping.
 * `mousedown` is deliberately excluded so clicks are not double-counted.
 */
export const DEFAULT_TASK_ACTION_BY_EVENT: Record<string, string> = {
  click: 'click',
  submit: 'submit',
  change: 'change',
  input: 'input'
};

/**
 * Default empty task state snapshot when no task state machine is bound.
 */
export const DEFAULT_TASK_STATE: UiTaskStateSnapshot = {
  currentTaskId: null,
  status: 'Idle',
  currentStepIndex: 0,
  completedSteps: [],
  errors: 0
};

/**
 * Minimal Default UI Adapter.
 *
 * Provides out-of-the-box defaults for telemetry observation when a host application
 * does not specify a custom adapter. Relies on standard DOM data-aui-* annotations.
 */
export class DefaultUiAdapter implements UiAdapter {
  readonly id: string;
  readonly version: string;

  constructor(id = 'default-ui', version = '1.0.0') {
    this.id = id;
    this.version = version;
  }

  getActiveContext(options?: {
    targetElement?: Element | null;
    root?: Document | HTMLElement;
  }) {
    return getActiveUIContext(options);
  }

  getTaskState(): UiTaskStateSnapshot {
    return { ...DEFAULT_TASK_STATE };
  }

  getTaskActionForEvent(eventType: string): string | undefined {
    return DEFAULT_TASK_ACTION_BY_EVENT[eventType];
  }
}
