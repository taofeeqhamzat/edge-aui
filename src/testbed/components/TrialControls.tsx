/**
 * Trial Controls
 *
 * Makes the experimental task model and the experimental condition reachable from the
 * UI. Starting a task runs the testbed-owned normalization first, then emits `task_start`.
 */

import { useEffect, useState } from "react";
import { taskManager } from "../tasks/taskManager";
import {
  EXPERIMENTAL_TASKS,
  TargetTask,
  TargetTaskStep,
  TaskId,
  TaskState,
  TaskUiState,
} from "../tasks/taskModel";
import { bootTestbed, getRuntime, pendingTrialFinalization, switchCondition } from "../../runtime/boot";
import { ExperimentalCondition } from "../../telemetry/events";
import { sessionManager } from "../../telemetry/session";

/** Shared between the locked controls and the explanation they point at. */
const LOCK_NOTE_ID = "trial-lock-note";

export interface TrialControlsProps {
  /** Initial condition. */
  initialCondition?: ExperimentalCondition;
  /** Testbed-owned task-start normalization. Runs before `task_start`. */
  onPrepareTask?: (task: TargetTask) => TaskUiState;
  /** Testbed-owned UI reset when a trial is reset. */
  onResetTaskUi?: () => void;
}

interface ConditionSelectorProps {
  condition: ExperimentalCondition;
  disabled: boolean;
  onChange: (condition: ExperimentalCondition) => void;
  /** Id of the visible explanation for the locked state, when the controls are locked. */
  describedBy?: string;
}

function ConditionSelector({
  condition,
  disabled,
  onChange,
  describedBy,
}: ConditionSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Experimental condition"
      aria-describedby={describedBy}
      data-aui-component="condition-selector"
      data-aui-role="condition-selector"
      className="condition-selector"
    >
      <span className="condition-label">Condition:</span>
      {(["baseline", "adaptive"] as ExperimentalCondition[]).map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="radio"
          aria-checked={condition === candidate}
          data-aui-component={`condition-${candidate}`}
          data-aui-role="condition-option"
          data-aui-action="click"
          disabled={disabled}
          onClick={() => onChange(candidate)}
          className={`condition-btn ${condition === candidate ? "active" : ""}`}
        >
          {candidate}
        </button>
      ))}
    </div>
  );
}

interface TaskButtonsProps {
  startDisabled: boolean;
  resetDisabled: boolean;
  onStart: (taskId: TaskId) => void;
  onReset: () => void;
  /** Id of the visible explanation for the locked state, when the controls are locked. */
  describedBy?: string;
}

function TaskButtons({
  startDisabled,
  resetDisabled,
  onStart,
  onReset,
  describedBy,
}: TaskButtonsProps) {
  return (
    <div className="trial-actions" aria-describedby={describedBy}>
      {(Object.keys(EXPERIMENTAL_TASKS) as TaskId[]).map((taskId) => (
        <button
          key={taskId}
          type="button"
          data-aui-component={`btn-start-${taskId}`}
          data-aui-role="secondary-action"
          data-aui-action="click"
          disabled={startDisabled}
          onClick={() => onStart(taskId)}
          className="btn-start-task"
        >
          Start {taskId}: {EXPERIMENTAL_TASKS[taskId].name}
        </button>
      ))}
      <button
        type="button"
        data-aui-component="btn-reset-trial"
        data-aui-role="secondary-action"
        data-aui-action="click"
        disabled={resetDisabled}
        onClick={onReset}
        className="btn-reset-trial"
      >
        Reset Trial
      </button>
    </div>
  );
}

interface TrialStatusProps {
  taskState: TaskState;
  activeTask: TargetTask | null;
  currentStep: TargetTaskStep | undefined;
}

function TrialStatus({ taskState, activeTask, currentStep }: TrialStatusProps) {
  return (
    <div
      className="trial-status-row"
      data-aui-component="trial-status"
      data-aui-role="status"
    >
      <div>
        <strong>Status:</strong>{" "}
        <span data-aui-trial-status>{taskState.status}</span>
        {activeTask ? ` — ${activeTask.id}: ${activeTask.name}` : ""}
      </div>
      <div>
        <strong>Step:</strong>{" "}
        {currentStep
          ? `${currentStep.stepId} (${taskState.completedSteps.length + 1}/${activeTask!.steps.length}) — ${currentStep.description}`
          : taskState.status === "In Progress"
            ? "All steps visited — the task's required state is not met yet."
            : "N/A"}
      </div>
      <div>
        <strong>Errors:</strong>{" "}
        <span data-aui-trial-errors>{taskState.errors}</span>
        {taskState.abandonmentReason
          ? ` | Abandoned: ${taskState.abandonmentReason}`
          : ""}
        {taskState.failureReason
          ? ` | Failed: ${taskState.failureReason}`
          : ""}
      </div>
    </div>
  );
}

function getActiveTask(taskState: TaskState): TargetTask | null {
  if (!taskState.currentTaskId) return null;
  return EXPERIMENTAL_TASKS[taskState.currentTaskId];
}

function getCurrentStep(
  task: TargetTask | null,
  taskState: TaskState,
): TargetTaskStep | undefined {
  return task?.steps.find((step) => !taskState.completedSteps.includes(step.stepId));
}

function sessionLabel(): string {
  return sessionManager.getActiveSession()?.sessionId ?? "starting…";
}

interface TrialActionOptions {
  onPrepareTask?: (task: TargetTask) => TaskUiState;
  onResetTaskUi?: () => void;
  onConditionChange: (condition: ExperimentalCondition) => void;
}

function useTrialActions({
  onPrepareTask,
  onResetTaskUi,
  onConditionChange,
}: TrialActionOptions) {
  const [busy, setBusy] = useState(false);

  const handleStart = async (taskId: TaskId) => {
    setBusy(true);
    try {
      // A finished trial is still settling and uploading when the participant reaches for the
      // next task. Crossing the boundary first keeps the old events out of the new record.
      const pending = pendingTrialFinalization();
      if (pending) await pending;
      const runtime = getRuntime();
      if (runtime) await runtime.resetTrial();
      const task = EXPERIMENTAL_TASKS[taskId];
      taskManager.startTask(taskId, onPrepareTask?.(task));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      taskManager.resetTask();
      // Reset records an abandonment, so the trial that just ended has to be snapshotted
      // before `resetTrial()` clears the recorder for the next one.
      const pending = pendingTrialFinalization();
      if (pending) await pending;
      onResetTaskUi?.();
      const runtime = getRuntime();
      if (runtime) await runtime.resetTrial();
    } finally {
      setBusy(false);
    }
  };

  const handleCondition = async (next: ExperimentalCondition) => {
    setBusy(true);
    try {
      // A condition switch rebuilds the runtime and clears the recorder, so the finished
      // trial must be snapshotted and closed first.
      const pending = pendingTrialFinalization();
      if (pending) await pending;
      onConditionChange(next);
      await switchCondition(next);
    } finally {
      setBusy(false);
    }
  };

  return { busy, handleStart, handleReset, handleCondition };
}

export function TrialControls({
  initialCondition = "adaptive",
  onPrepareTask,
  onResetTaskUi,
}: TrialControlsProps) {
  const [taskState, setTaskState] = useState<TaskState>(taskManager.getState());
  const [condition, setCondition] = useState<ExperimentalCondition>(initialCondition);
  const { busy, handleStart, handleReset, handleCondition } = useTrialActions({
    onPrepareTask,
    onResetTaskUi,
    onConditionChange: setCondition,
  });

  useEffect(() => taskManager.subscribe(setTaskState), []);

  const activeTask = getActiveTask(taskState);
  const currentStep = getCurrentStep(activeTask, taskState);
  const inProgress = taskState.status === "In Progress";

  return (
    <section
      data-aui-component="trial-controls"
      data-aui-role="trial-controls"
      data-aui-region="trial"
      aria-label="Experimental trial controls"
      className="trial-controls-card"
    >
      <div className="trial-controls-header">
        <div>
          <strong className="trial-title">Experimental Trial</strong>
          <span className="trial-session-id">
            Session: {sessionLabel()}
          </span>
        </div>
        <ConditionSelector
          condition={condition}
          disabled={busy || inProgress}
          onChange={handleCondition}
          describedBy={inProgress ? LOCK_NOTE_ID : undefined}
        />
      </div>

      <TaskButtons
        startDisabled={busy || inProgress}
        resetDisabled={busy}
        onStart={handleStart}
        onReset={handleReset}
        describedBy={inProgress ? LOCK_NOTE_ID : undefined}
      />

      {activeTask && (
        <p
          className="trial-instruction"
          data-aui-component="trial-instruction"
          data-aui-role="status"
        >
          <strong>Task:</strong> {activeTask.description}
        </p>
      )}

      {inProgress && (
        <p
          id={LOCK_NOTE_ID}
          className="trial-lock-note"
          data-aui-component="trial-lock-note"
          data-aui-role="status"
          aria-live="polite"
        >
          Task and condition controls are locked until this trial ends. Reset Trial ends the
          current trial early and records it as abandoned.
        </p>
      )}

      <TrialStatus
        taskState={taskState}
        activeTask={activeTask}
        currentStep={currentStep}
      />
    </section>
  );
}

export { bootTestbed };
