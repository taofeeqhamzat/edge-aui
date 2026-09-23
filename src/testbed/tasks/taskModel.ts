export type TaskId = 'T1' | 'T2' | 'T3';
export type TaskStatus = 'Idle' | 'In Progress' | 'Completed' | 'Abandoned';

export interface TargetTaskStep {
  stepId: string;
  description: string;
  expectedComponentId?: string;
  expectedAction?: string;
}

export interface TargetTask {
  id: TaskId;
  name: string;
  description: string;
  steps: TargetTaskStep[];
}

export interface TaskState {
  currentTaskId: TaskId | null;
  status: TaskStatus;
  currentStepIndex: number;
  completedSteps: string[];
  startTime?: number;
  endTime?: number;
  errors: number;
  /** Set when the task was abandoned rather than completed. */
  abandonmentReason?: 'reset' | 'timeout' | 'navigation';
}

/**
 * Experimental task definitions.
 *
 * Every `expectedComponentId` below is validated against the rendered semantic DOM
 * annotation contract in `tests/task_wiring.test.tsx`, so a step can only reference an
 * element the testbed actually renders. T2 begins on Analytics (not Reports) because
 * the Results table — and therefore the Export action — is only rendered there.
 */
export const EXPERIMENTAL_TASKS: Record<TaskId, TargetTask> = {
  T1: {
    id: 'T1',
    name: 'Filter Analytics',
    description: 'Open the Region filter, choose a region, then apply the filters.',
    steps: [
      { stepId: 'T1-1', description: 'Navigate to Analytics', expectedComponentId: 'nav-Analytics', expectedAction: 'click' },
      { stepId: 'T1-2', description: 'Open Region Filter', expectedComponentId: 'filter-Region', expectedAction: 'click' },
      { stepId: 'T1-3', description: 'Select Region', expectedComponentId: 'filter-Region-select', expectedAction: 'change' },
      { stepId: 'T1-4', description: 'Apply Filters', expectedComponentId: 'btn-apply-filters', expectedAction: 'click' }
    ]
  },
  T2: {
    id: 'T2',
    name: 'Export Report',
    description: 'Export the currently viewed results table.',
    steps: [
      { stepId: 'T2-1', description: 'Navigate to Analytics', expectedComponentId: 'nav-Analytics', expectedAction: 'click' },
      { stepId: 'T2-2', description: 'Click Export Report', expectedComponentId: 'btn-export', expectedAction: 'click' }
    ]
  },
  T3: {
    id: 'T3',
    name: 'Configure Advanced Filter',
    description: 'Open Product Category, change the customer segment, then apply the filters.',
    steps: [
      { stepId: 'T3-1', description: 'Navigate to Analytics', expectedComponentId: 'nav-Analytics', expectedAction: 'click' },
      { stepId: 'T3-2', description: 'Open Product Category', expectedComponentId: 'filter-Product Category', expectedAction: 'click' },
      { stepId: 'T3-3', description: 'Change Segment', expectedComponentId: 'filter-segment-select', expectedAction: 'change' },
      { stepId: 'T3-4', description: 'Apply Filters', expectedComponentId: 'btn-apply-filters', expectedAction: 'click' }
    ]
  }
};

/**
 * Component ids that must exist in the rendered UI for a task to be completable.
 * Exposed so the DOM annotation contract can be asserted against the task model.
 */
export function getTaskRequiredComponentIds(taskId: TaskId): string[] {
  return EXPERIMENTAL_TASKS[taskId].steps
    .map((step) => step.expectedComponentId)
    .filter((id): id is string => Boolean(id));
}
