/**
 * Trial Controls
 *
 * Makes the experimental task model and the experimental condition reachable from the
 * UI. The assessment (§6, §17) found no UI affordance could start, complete or reset a
 * task, and no condition switch existed, which made both dataset construction and the
 * baseline/adaptive comparison impossible.
 */

import { useEffect, useState } from 'react';
import { taskManager } from '../tasks/taskManager';
import { EXPERIMENTAL_TASKS, TaskId, TaskState } from '../tasks/taskModel';
import { bootTestbed, getRuntime, switchCondition } from '../../runtime/boot';
import { ExperimentalCondition } from '../../telemetry/events';
import { sessionManager } from '../../telemetry/session';

export interface TrialControlsProps {
  /** Initial condition. */
  initialCondition?: ExperimentalCondition;
}

export function TrialControls({ initialCondition = 'adaptive' }: TrialControlsProps) {
  const [taskState, setTaskState] = useState<TaskState>(taskManager.getState());
  const [condition, setCondition] = useState<ExperimentalCondition>(initialCondition);
  const [busy, setBusy] = useState(false);

  useEffect(() => taskManager.subscribe(setTaskState), []);

  const activeTask = taskState.currentTaskId ? EXPERIMENTAL_TASKS[taskState.currentTaskId] : null;
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
      style={{
        border: '1px solid #ccc',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '24px',
        background: '#fff'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ display: 'block', marginBottom: 4 }}>Experimental Trial</strong>
          <span style={{ fontSize: 12, color: '#666' }}>
            Session: {sessionManager.getActiveSession()?.sessionId ?? 'starting…'}
          </span>
        </div>

        <div
          role="radiogroup"
          aria-label="Experimental condition"
          data-aui-component="condition-selector"
          data-aui-role="condition-selector"
          style={{ display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <span style={{ fontSize: 12, color: '#666' }}>Condition:</span>
          {(['baseline', 'adaptive'] as ExperimentalCondition[]).map((candidate) => (
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
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #ccc',
                background: condition === candidate ? '#e0f7fa' : '#fff',
                fontWeight: condition === candidate ? 'bold' : 'normal',
                cursor: busy ? 'wait' : 'pointer'
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {(Object.keys(EXPERIMENTAL_TASKS) as TaskId[]).map((taskId) => (
          <button
            key={taskId}
            type="button"
            data-aui-component={`btn-start-${taskId}`}
            data-aui-role="secondary-action"
            data-aui-action="click"
            disabled={busy}
            onClick={() => handleStart(taskId)}
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #006064',
              background: '#fff',
              color: '#006064',
              cursor: busy ? 'wait' : 'pointer'
            }}
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
          style={{
            padding: '8px 12px',
            borderRadius: 4,
            border: '1px solid #b71c1c',
            background: '#fff',
            color: '#b71c1c',
            cursor: busy ? 'wait' : 'pointer'
          }}
        >
          Reset Trial
        </button>
      </div>

      <div style={{ marginTop: 12, fontSize: 13 }} data-aui-component="trial-status" data-aui-role="status">
        <div>
          <strong>Status:</strong>{' '}
          <span data-aui-trial-status>{taskState.status}</span>
          {activeTask ? ` — ${activeTask.id}: ${activeTask.name}` : ''}
        </div>
        <div>
          <strong>Step:</strong>{' '}
          {currentStep
            ? `${currentStep.stepId} (${taskState.currentStepIndex + 1}/${activeTask!.steps.length}) — ${currentStep.description}`
            : 'N/A'}
        </div>
        <div>
          <strong>Errors:</strong> <span data-aui-trial-errors>{taskState.errors}</span>
          {taskState.abandonmentReason ? ` | Abandoned: ${taskState.abandonmentReason}` : ''}
        </div>
      </div>
    </section>
  );
}

export { bootTestbed };
