/**
 * Development Debug Panel & Telemetry Visualizer
 * Implements Stage 10.2 specifications from clipboard.9.md Section 38 & docs/plan/tasks/10.2.md.
 * 
 * Prioritizes:
 * 1. Session ID, Task, Task Step, Current UI Context
 * 2. Fast Gate & Slow Gate Arbitration + Intervention Decision
 * 3. Latency benchmarks (inference, feature generation) & Worker status
 * 4. Macro Sequence (A -> B -> C -> D)
 * 5. 18-D MicroTensor values and modality mask bits
 * 6. Local trace recording stats and zero-backend JSON export trigger
 */

import React, { useState, useEffect } from 'react';
import './DebugPanel.css';
import { sessionManager, SessionContext } from '../telemetry/session';
import { taskManager } from '../testbed/tasks/taskManager';
import { TaskState, EXPERIMENTAL_TASKS } from '../testbed/tasks/taskModel';
import { getActiveUIContext } from '../telemetry/contextProvider';
import { experimentRecorder } from '../telemetry/recorder';
import { UIContext } from '../types/telemetry';
import { debugBus, LiveDebugMetrics } from './debugBus';

export interface DebugPanelProps {
  forceShow?: boolean;
}

const FEATURE_LABELS = [
  'mean_vel',
  'max_vel',
  'mean_accel',
  'hesitation',
  'traj_len',
  'dwell_ms',
  'entropy',
  'scroll_pct',
  'scroll_vel'
];

export const DebugPanel: React.FC<DebugPanelProps> = ({ forceShow = false }) => {
  // Exclude completely from production builds unless explicitly forced
  const isDev = typeof import.meta !== 'undefined' && import.meta.env ? Boolean(import.meta.env.DEV) : true;
  if (!isDev && !forceShow) {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<SessionContext | null>(sessionManager.getActiveSession());
  const [taskState, setTaskState] = useState<TaskState>(taskManager.getState());
  const [uiContext, setUiContext] = useState<UIContext>(getActiveUIContext());
  const [liveMetrics, setLiveMetrics] = useState<LiveDebugMetrics>(debugBus.getSnapshot());
  const [eventCounts, setEventCounts] = useState(experimentRecorder.getEventCounts());

  useEffect(() => {
    // 1. Session subscription
    const unsubSession = sessionManager.onSessionChange(setSession);

    // 2. Task subscription
    const unsubTask = taskManager.subscribe(setTaskState);

    // 3. Live metrics bus subscription
    const unsubMetrics = debugBus.subscribe(setLiveMetrics);

    // 4. Polling timer for UI context and event recorder counts (250ms interval)
    const interval = setInterval(() => {
      setUiContext(getActiveUIContext());
      setEventCounts(experimentRecorder.getEventCounts());
    }, 250);

    return () => {
      unsubSession();
      unsubTask();
      unsubMetrics();
      clearInterval(interval);
    };
  }, []);

  const handleExportTrace = () => {
    experimentRecorder.downloadTraceAsJSON();
  };

  const handleClearTrace = () => {
    experimentRecorder.clear();
    setEventCounts(experimentRecorder.getEventCounts());
  };

  const handleResetTask = () => {
    taskManager.resetTask();
  };

  // Determine active task details
  const activeTask = taskState.currentTaskId ? EXPERIMENTAL_TASKS[taskState.currentTaskId] : null;
  const currentStep = activeTask?.steps[taskState.currentStepIndex];

  // MicroTensor display slicing
  const microTensorVals = liveMetrics.latestMicroTensor ?? new Array(18).fill(0);
  const featureValues = microTensorVals.slice(0, 9);
  const maskBits = microTensorVals.slice(9, 18).map((v) => (v > 0.5 ? '1' : '0')).join('');

  // Macro sequence
  const macroSequence = liveMetrics.latestMacroSequence ?? [];

  if (!isOpen) {
    return (
      <div className="edge-aui-debug-container" data-testid="edge-aui-debug-container">
        <button
          className="edge-aui-debug-toggle"
          onClick={() => setIsOpen(true)}
          aria-label="Open Edge-AUI Development Debug Panel"
        >
          <span>⚡ AUI Debug</span>
          <span style={{ color: taskState.status === 'In Progress' ? '#4ade80' : '#94a3b8' }}>
            [{taskState.status}]
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="edge-aui-debug-container" data-testid="edge-aui-debug-container">
      <div className="edge-aui-debug-window" role="region" aria-label="Edge-AUI Debug Panel">
        {/* Header */}
        <div className="edge-aui-debug-header">
          <div className="edge-aui-debug-title">
            <span>⚡</span>
            <span>Edge-AUI Pipeline Inspector</span>
          </div>
          <button
            className="edge-aui-debug-close"
            onClick={() => setIsOpen(false)}
            aria-label="Collapse Debug Panel"
          >
            &times;
          </button>
        </div>

        <div className="edge-aui-debug-body">
          {/* Priority 1: Session & Task State */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Session & Task Context</div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Session ID:</span>
              <span className="edge-aui-debug-val">{session?.sessionId ?? 'No Active Session'}</span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Task:</span>
              <span className="edge-aui-debug-val highlight">
                {activeTask ? `${activeTask.id} (${activeTask.name})` : 'None (Idle)'}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Step:</span>
              <span className="edge-aui-debug-val">
                {currentStep ? `${currentStep.stepId}: ${currentStep.description}` : 'N/A'}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Route:</span>
              <span className="edge-aui-debug-val">{uiContext.route}</span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Component Focus:</span>
              <span className="edge-aui-debug-val">
                {uiContext.activeComponentId ? `${uiContext.activeComponentId} (${uiContext.componentRole ?? 'none'})` : 'none'}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Flags:</span>
              <span className="edge-aui-debug-val dim">
                primaryAction:{uiContext.primaryActionAvailable ? 'yes' : 'no'} | help:{uiContext.helpAvailable ? 'yes' : 'no'} | expandable:{uiContext.expandable ? 'yes' : 'no'}
              </span>
            </div>
          </div>

          {/* Priority 2: Dual-Gate Arbitration & Decisions */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Gate Arbitration & Decisions</div>
            
            {/* Fast Gate */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Fast Gate:</span>
              <span className={`edge-aui-debug-val ${liveMetrics.fastGateStatus?.matched ? 'success' : 'dim'}`}>
                {liveMetrics.fastGateStatus?.matched
                  ? `MATCH (${liveMetrics.fastGateStatus.pattern ?? 'pattern'})`
                  : 'no match'}
              </span>
            </div>

            {/* Slow Gate */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Slow Gate:</span>
              <span className={`edge-aui-debug-val ${liveMetrics.slowGateStatus?.called ? 'warning' : 'dim'}`}>
                {liveMetrics.slowGateStatus?.called
                  ? `${liveMetrics.slowGateStatus.outcome ?? 'CALLED'} (conf: ${(liveMetrics.slowGateStatus.confidence ?? 0).toFixed(2)})`
                  : 'skipped'}
              </span>
            </div>

            {/* Candidate Intervention */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Intervention:</span>
              <span className={`edge-aui-debug-val ${liveMetrics.interventionStatus?.type && liveMetrics.interventionStatus.type !== 'no_op' ? 'highlight' : 'dim'}`}>
                {liveMetrics.interventionStatus?.type ?? 'no_op'}
                {liveMetrics.interventionStatus?.source ? ` [${liveMetrics.interventionStatus.source}]` : ''}
              </span>
            </div>

            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Policy State:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.interventionStatus?.state ?? 'idle'}
              </span>
            </div>
          </div>

          {/* Priority 3: Latency & Worker Runtime Status */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Latency & Worker Status</div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Inference Latency:</span>
              <span className="edge-aui-debug-val highlight">
                {liveMetrics.inferenceLatencyMs !== undefined ? `${liveMetrics.inferenceLatencyMs.toFixed(2)} ms` : '--'}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Feature Extr. Latency:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.featureLatencyMs !== undefined ? `${liveMetrics.featureLatencyMs.toFixed(2)} ms` : '--'}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Worker Runtime:</span>
              <span className={`edge-aui-debug-val ${liveMetrics.workerStatus === 'ready' ? 'success' : 'warning'}`}>
                {liveMetrics.workerStatus ?? 'uninitialized'}
              </span>
            </div>
          </div>

          {/* Priority 4: Macro Interaction Sequence */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Macro Sequence</div>
            <div className="edge-aui-debug-sequence">
              {macroSequence.length > 0 ? (
                macroSequence.map((sym, idx) => (
                  <React.Fragment key={`${sym}-${idx}`}>
                    <span className="edge-aui-debug-symbol">{sym}</span>
                    {idx < macroSequence.length - 1 && <span className="edge-aui-debug-arrow">&rarr;</span>}
                  </React.Fragment>
                ))
              ) : (
                <span className="edge-aui-debug-val dim">No macro events recorded</span>
              )}
            </div>
          </div>

          {/* Priority 5: Latest 18-D MicroTensor */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Latest MicroTensor (18-D)</div>
            <div className="edge-aui-debug-tensor-grid">
              {featureValues.map((val, idx) => (
                <div key={FEATURE_LABELS[idx]} className="edge-aui-debug-tensor-item">
                  <span className="edge-aui-debug-tensor-name">{FEATURE_LABELS[idx]}:</span>
                  <span className="edge-aui-debug-tensor-val">{val.toFixed(3)}</span>
                </div>
              ))}
            </div>
            <div className="edge-aui-debug-mask-row">
              <span>Modality Mask:</span>
              <span className="edge-aui-debug-mask-bits">[{maskBits}]</span>
            </div>
          </div>

          {/* Buffer Event Counts */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Recorder Buffers</div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Buffered Events:</span>
              <span className="edge-aui-debug-val">
                {eventCounts.total} (B:{eventCounts.behaviourEvents} M:{eventCounts.macroInteractions} T:{eventCounts.microTensors} O:{eventCounts.outcomes} I:{eventCounts.interventions})
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="edge-aui-debug-actions">
          <button
            className="edge-aui-debug-btn primary"
            onClick={handleExportTrace}
            aria-label="Export Experiment Trace JSON"
          >
            Export Trace (JSON)
          </button>
          <button
            className="edge-aui-debug-btn"
            onClick={handleClearTrace}
            aria-label="Clear Recorded Trace"
          >
            Clear Trace
          </button>
          <button
            className="edge-aui-debug-btn"
            onClick={handleResetTask}
            aria-label="Reset Active Task"
          >
            Reset Task
          </button>
        </div>
      </div>
    </div>
  );
};
