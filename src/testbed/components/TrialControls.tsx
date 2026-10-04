/**
 * Trial Controls
 *
 * Makes the experimental task model and the experimental condition reachable from the
 * UI. The assessment (§6, §17) found no UI affordance could start, complete or reset a
 * task, and no condition switch existed, which made both dataset construction and the
 * baseline/adaptive comparison impossible.
 */

import { useEffect, useState } from "react";
import { taskManager } from "../tasks/taskManager";
import { EXPERIMENTAL_TASKS, TaskId, TaskState } from "../tasks/taskModel";
import { bootTestbed, getRuntime, switchCondition } from "../../runtime/boot";
import { ExperimentalCondition } from "../../telemetry/events";
import { sessionManager } from "../../telemetry/session";

export interface TrialControlsProps {
  /** Initial condition. */
  initialCondition?: ExperimentalCondition;
}

export function TrialControls({
  initialCondition = "adaptive",
}: TrialControlsProps) {
  const [taskState, setTaskState] = useState<TaskState>(taskManager.getState());
  const [condition, setCondition] =
    useState<ExperimentalCondition>(initialCondition);
  const [busy, setBusy] = useState(false);

  useEffect(() => taskManager.subscribe(setTaskState), []);

  const activeTask = taskState.currentTaskId
    ? EXPERIMENTAL_TASKS[taskState.currentTaskId]
    : null;
  const currentStep = activeTask?.steps[taskState.currentStepIndex];

  const handleStart = async (taskId: TaskId) => {
    setBusy(true);
    try {
      const runtime = getRuntime();
      if (runtime) {
        await runtime.resetTrial();
      }
      taskManager.startTask(taskId);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      // Records an abandonment when a task was in progress, then clears state.
      taskManager.resetTask();
      const runtime = getRuntime();
      if (runtime) {
        await runtime.resetTrial();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCondition = async (next: ExperimentalCondition) => {
    setBusy(true);
    try {
      setCondition(next);
      await switchCondition(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-aui-component="trial-controls"
      data-aui-role="trial-controls"
      aria-label="Experimental trial controls"
      className="trial-controls-card"
    >
      <div className="trial-controls-header">
        <div>
          <strong className="trial-title">Experimental Trial</strong>
          <span className="trial-session-id">
            Session: {sessionManager.getActiveSession()?.sessionId ?? "starting…"}
          </span>
        </div>

        <div
          role="radiogroup"
          aria-label="Experimental condition"
          data-aui-component="condition-selector"
          data-aui-role="condition-selector"
          className="condition-selector"
        >
          <span className="condition-label">Condition:</span>
          {(["baseline", "adaptive"] as ExperimentalCondition[]).map(
            (candidate) => (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={condition === candidate}
                data-aui-component={`condition-${candidate}`}
                data-aui-role="condition-option"
                data-aui-action="click"
                disabled={busy}
                onClick={() => handleCondition(candidate)}
                className={`condition-btn ${condition === candidate ? "active" : ""}`}
              >
                {candidate}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="trial-actions">
        {(Object.keys(EXPERIMENTAL_TASKS) as TaskId[]).map((taskId) => (
          <button
            key={taskId}
            type="button"
            data-aui-component={`btn-start-${taskId}`}
            data-aui-role="secondary-action"
            data-aui-action="click"
            disabled={busy}
            onClick={() => handleStart(taskId)}
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
          disabled={busy}
          onClick={handleReset}
          className="btn-reset-trial"
        >
          Reset Trial
        </button>
      </div>

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
            ? `${currentStep.stepId} (${taskState.currentStepIndex + 1}/${activeTask!.steps.length}) — ${currentStep.description}`
            : "N/A"}
        </div>
        <div>
          <strong>Errors:</strong>{" "}
          <span data-aui-trial-errors>{taskState.errors}</span>
          {taskState.abandonmentReason
            ? ` | Abandoned: ${taskState.abandonmentReason}`
            : ""}
        </div>
      </div>
    </section>
  );
}

export { bootTestbed };
