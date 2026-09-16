import { EXPERIMENTAL_TASKS, TaskId, TaskState } from './taskModel';

type StateChangeListener = (state: TaskState) => void;

export class TaskManager {
  private state: TaskState;
  private listeners: Set<StateChangeListener> = new Set();

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

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
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
  }

  public resetTask() {
    this.state = this.getInitialState();
    this.notify();
  }

  public recordInteraction(componentId: string, action: string) {
    if (this.state.status !== 'In Progress' || !this.state.currentTaskId) return;

    const task = EXPERIMENTAL_TASKS[this.state.currentTaskId];
    const currentStep = task.steps[this.state.currentStepIndex];

    if (currentStep && currentStep.expectedComponentId === componentId && currentStep.expectedAction === action) {
      // Step completed
      this.state.completedSteps.push(currentStep.stepId);
      this.state.currentStepIndex++;

      if (this.state.currentStepIndex >= task.steps.length) {
        this.state.status = 'Completed';
        this.state.endTime = Date.now();
      }
      this.notify();
    } else {
      // Potential error if not just a random click
      if (['click', 'change'].includes(action)) {
        this.state.errors++;
        this.notify();
      }
    }
  }

  public getState(): TaskState {
    return this.state;
  }
}

export const taskManager = new TaskManager();
