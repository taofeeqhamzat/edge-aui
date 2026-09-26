/**
 * UI Adapter and Integration Contract
 *
 * Implements Stage 3.4 & Stage 4.1 specifications from docs/plan/1/tasks/3.4.md and ADR-011.
 *
 * Defines the formal integration boundary (ports) separating the host UI from the
 * edge-aui core telemetry and model pipeline. The runtime core depends exclusively on
 * this interface, never directly on application or testbed concrete implementations.
 */

import { UIContext } from '../types/uiContext';

/**
 * Specification of a single step within a UI task.
 */
export interface UiTaskStep {
  stepId: string;
  description?: string;
  expectedComponentId?: string;
  expectedAction?: string;
}

/**
 * Specification of a user task in the target UI.
 */
export interface UiTaskDefinition {
  id: string;
  name: string;
  description?: string;
  steps?: UiTaskStep[];
}

/**
 * Snapshot of the current progress through a UI task.
 */
export interface UiTaskStateSnapshot {
  currentTaskId: string | null;
  status: 'Idle' | 'In Progress' | 'Completed' | 'Abandoned' | string;
  currentStepIndex: number;
  completedSteps: string[];
  startTime?: number;
  endTime?: number;
  errors: number;
  abandonmentReason?: 'reset' | 'timeout' | 'navigation' | string;
}

/**
 * Discrete lifecycle transition event emitted by a task state machine.
 */
export interface UiTaskLifecycleEvent {
  timestamp: number;
  type:
    | 'task_start'
    | 'task_step'
    | 'task_complete'
    | 'task_error'
    | 'task_reset'
    | 'task_abandon'
    | string;
  taskId: string | null;
  taskStepId?: string;
  status?: 'Idle' | 'In Progress' | 'Completed' | 'Abandoned' | string;
  errors?: number;
  durationMs?: number;
  reason?: 'reset' | 'timeout' | 'navigation' | string;
  metadata?: Record<string, unknown>;
}

/**
 * Port interface that a target UI implements to integrate with edge-aui.
 *
 * All ports are optional with sensible defaults so that a minimal integration requires
 * only an adapter identifier.
 */
export interface UiAdapter {
  /** Unique identifier for this UI adapter (e.g. 'edge-aui-testbed', 'checkout-wizard'). */
  readonly id: string;

  /** Version of the target UI integration, recorded in telemetry for reproducibility. */
  readonly version?: string;

  // ---------------------------------------------------------------------------
  // UI Context Port
  // ---------------------------------------------------------------------------
  /**
   * Resolves the current UI context snapshot (route, active component, available actions).
   * If omitted, the default DOM context provider using data-aui-* attributes is used.
   */
  getActiveContext?(options?: {
    targetElement?: Element | null;
    root?: Document | HTMLElement;
  }): UIContext;

  // ---------------------------------------------------------------------------
  // Task State & Lifecycle Ports
  // ---------------------------------------------------------------------------
  /**
   * Returns the current task state snapshot.
   * If omitted, the runtime assumes an Idle state with no active task.
   */
  getTaskState?(): UiTaskStateSnapshot;

  /**
   * Subscribes to changes in task state (step progression, task start, finish).
   * Returns an unsubscribe function.
   */
  onTaskStateChange?(callback: (state: UiTaskStateSnapshot) => void): () => void;

  /**
   * Subscribes to discrete task lifecycle events (start, completion, abandonment).
   * Returns an unsubscribe function.
   */
  onTaskLifecycle?(callback: (event: UiTaskLifecycleEvent) => void): () => void;

  /**
   * Informs the host UI that an interaction occurred on a component.
   */
  recordInteraction?(componentId: string, action: string): void;

  /**
   * Requests abandonment of the currently active task with a given reason.
   */
  abandonTask?(reason: string): void;

  // ---------------------------------------------------------------------------
  // Semantic Action Mapping Port
  // ---------------------------------------------------------------------------
  /**
   * Maps a browser DOM event type (e.g. 'click', 'submit', 'change') to a task action semantic.
   * If omitted, standard defaults ('click', 'submit', 'change', 'input') are applied.
   */
  getTaskActionForEvent?(eventType: string): string | undefined;

  // ---------------------------------------------------------------------------
  // Lifecycle Hooks
  // ---------------------------------------------------------------------------
  /**
   * Called when the AdaptiveRuntime initializes with this adapter.
   */
  onInit?(runtime: unknown): void;

  /**
   * Called when the AdaptiveRuntime is torn down.
   */
  onDestroy?(): void;
}
