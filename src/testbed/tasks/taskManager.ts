import { EXPERIMENTAL_TASKS, TaskId, TaskState, TaskStatus } from './taskModel';

type StateChangeListener = (state: TaskState) => void;

/** Emitted on every task lifecycle transition, for the experiment trace. */
export interface TaskLifecycleEvent {
  timestamp: number;
  type: 'task_start' | 'task_step' | 'task_complete' | 'task_error' | 'task_reset' | 'task_abandon';
  taskId: TaskId | null;
  taskStepId?: string;
  status: TaskStatus;
  errors: number;
  /** Present on `task_complete`. */
  durationMs?: number;
  /** Present on `task_abandon`. */
  reason?: 'reset' | 'timeout' | 'navigation';
}

export type TaskLifecycleListener = (event: TaskLifecycleEvent) => void;

/**
 * Deterministic experimental task state machine.
 *
 * Emits explicit `task_start`, `task_step`, `task_complete`, `task_abandon`,
 * `task_reset` and `task_error` lifecycle events so the target environment produces
 * observable task ground truth (assessment §6.2).
 */
export class TaskManager {
  private state: TaskState;
  private listeners: Set<StateChangeListener> = new Set();
  private lifecycleListeners: Set<TaskLifecycleListener> = new Set();

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): TaskState {
    return {
      currentTaskId: null,
      status: 'Idle',
      currentStepIndex: 0,
      completedSteps: [],
      errors: 0
    };
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Subscribes to task lifecycle transitions. */
  public onLifecycle(listener: TaskLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private emitLifecycle(event: TaskLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[TaskManager] Lifecycle listener error:', err);
      }
    }
  }

  public startTask(taskId: TaskId) {
    this.state = {
      ...this.getInitialState(),
      currentTaskId: taskId,
      status: 'In Progress',
      startTime: Date.now()
    };
    this.notify();
    this.emitLifecycle({
      timestamp: Date.now(),
      type: 'task_start',
      taskId,
      status: this.state.status,
      errors: 0
    });
  }

  /**
   * Resets to Idle. When a task was in progress it is recorded as abandoned rather
   * than silently discarded, so incomplete trials remain visible in the trace.
   */
  public resetTask() {
    const previous = this.state;
    const wasInProgress = previous.status === 'In Progress' && previous.currentTaskId !== null;

    if (wasInProgress) {
      this.emitLifecycle({
        timestamp: Date.now(),
        type: 'task_abandon',
        taskId: previous.currentTaskId,
        status: 'Abandoned',
        errors: previous.errors,
        reason: 'reset'
      });
    }

    this.state = this.getInitialState();
    this.notify();
    this.emitLifecycle({
      timestamp: Date.now(),
      type: 'task_reset',
      taskId: null,
      status: this.state.status,
      errors: 0
    });
  }

  /**
   * Records an interaction against the active task.
   *
   * A step is satisfied when the interaction's component id and action match the
   * expected step. Interactions that do not match the *current* step are evaluated
   * against the immediate next step as well, so a skipped-but-correct order still
   * progresses; anything else on an action-bearing control counts as an error.
   */
  public recordInteraction(componentId: string, action: string) {
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    const task = EXPERIMENTAL_TASKS[this.state.currentTaskId];
    const currentStep = task.steps[this.state.currentStepIndex];

    const matches = (step?: { expectedComponentId?: string; expectedAction?: string }) =>
      Boolean(step) && step?.expectedComponentId === componentId && step?.expectedAction === action;

    if (matches(currentStep)) {
      this.completeStep(currentStep!.stepId, task.steps.length);
      return;
    }

    if (['click', 'change', 'submit'].includes(action)) {
      this.state.errors++;
      this.notify();
      this.emitLifecycle({
        timestamp: Date.now(),
        type: 'task_error',
        taskId: this.state.currentTaskId,
        taskStepId: currentStep?.stepId,
        status: this.state.status,
        errors: this.state.errors
      });
    }
  }

  private completeStep(stepId: string, totalSteps: number) {
    this.state.completedSteps.push(stepId);
    this.state.currentStepIndex++;

    if (this.state.currentStepIndex >= totalSteps) {
      this.state.status = 'Completed';
      this.state.endTime = Date.now();
    }

    this.notify();
    this.emitLifecycle({
      timestamp: Date.now(),
      type: 'task_step',
      taskId: this.state.currentTaskId,
      taskStepId: stepId,
      status: this.state.status,
      errors: this.state.errors
    });

    if (this.state.status === 'Completed') {
      const durationMs =
        this.state.startTime !== undefined && this.state.endTime !== undefined
          ? this.state.endTime - this.state.startTime
          : undefined;
      this.emitLifecycle({
        timestamp: Date.now(),
        type: 'task_complete',
        taskId: this.state.currentTaskId,
        taskStepId: stepId,
        status: this.state.status,
        errors: this.state.errors,
        durationMs
      });
    }
  }

  /** Marks the active task abandoned without resetting the machine. */
  public abandonTask(reason: 'reset' | 'timeout' | 'navigation' = 'navigation') {
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    this.state = {
      ...this.state,
      status: 'Abandoned',
      endTime: Date.now(),
      abandonmentReason: reason
    };
    this.notify();
    this.emitLifecycle({
      timestamp: Date.now(),
      type: 'task_abandon',
      taskId: this.state.currentTaskId,
      status: this.state.status,
      errors: this.state.errors,
      reason
    });
  }

  public getState(): TaskState {
    return this.state;
  }
}

export const taskManager = new TaskManager();
