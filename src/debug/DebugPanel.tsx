/**
 * Development / Researcher Debug Panel & Telemetry Visualiser
 * Implements Stage 10.2 specifications from docs/testbed/prd.md Section 38 & docs/plan/tasks/10.2.md.
 *
 * Prioritises, in the order a researcher needs them while watching a session:
 * 1. Session, Task, Task Step, Current UI Context, provenance
 * 2. The explicit decision state, so "why did nothing happen?" never requires guesswork
 * 3. Fast Gate / Slow Gate arbitration, prediction and policy reason
 * 4. Active intervention episode, actuator status and expiry
 * 5. Latency, model/provider provenance and worker status
 * 6. Macro Sequence (A -> B -> C -> D)
 * 7. 18-D MicroTensor values and modality mask bits, labelled active or inactive
 * 8. Trace recording, eviction and collection state, plus zero-backend JSON export
 *
 * Availability: shown in development, and in a production build behind `?auiDiagnostics=1`
 * or `VITE_AUI_DIAGNOSTICS=1`. The panel used to be excluded from production entirely with
 * no way in, which meant a packaged build had no live observability at all (F-22).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./DebugPanel.css";
import { sessionManager, SessionContext } from "../telemetry/session";
import { taskManager } from "../testbed/tasks/taskManager";
import { TaskState, EXPERIMENTAL_TASKS } from "../testbed/tasks/taskModel";
import { getActiveUIContext } from "../telemetry/contextProvider";
import { experimentRecorder } from "../telemetry/recorder";
import { UIContext } from "../types/uiContext.js";
import { debugBus, LiveDebugMetrics } from "./debugBus";

export interface DebugPanelProps {
  forceShow?: boolean;
}

const FEATURE_LABELS = [
  "mean_vel",
  "max_vel",
  "mean_accel",
  "hesitation",
  "traj_len",
  "dwell_ms",
  "entropy",
  "scroll_pct",
  "scroll_vel",
];

/**
 * Whether the researcher panel should be reachable in this build.
 *
 * Exported so it can be tested without rendering, and so the decision is in one place.
 */
export function isDiagnosticsVisible(
  forceShow: boolean,
  isDev: boolean,
  search: string,
  envFlag?: string
): boolean {
  if (forceShow) return true;
  if (isDev) return true;
  if (envFlag === '1' || envFlag === 'true') return true;
  try {
    const params = new URLSearchParams(search);
    return params.get('auiDiagnostics') === '1' || params.get('auiDiagnostics') === 'true';
  } catch {
    return false;
  }
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  forceShow = false,
}) => {
  const isDev =
    typeof import.meta !== "undefined" && import.meta.env
      ? Boolean(import.meta.env.DEV)
      : true;
  const envFlag =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.VITE_AUI_DIAGNOSTICS as string | undefined)
      : undefined;
  const search = typeof window !== "undefined" ? window.location.search : "";

  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<SessionContext | null>(
    sessionManager.getActiveSession(),
  );
  const [taskState, setTaskState] = useState<TaskState>(taskManager.getState());
  const [uiContext, setUiContext] = useState<UIContext>(getActiveUIContext());
  const [liveMetrics, setLiveMetrics] = useState<LiveDebugMetrics>(
    debugBus.getSnapshot(),
  );
  const [eventCounts, setEventCounts] = useState(
    experimentRecorder.getEventCounts(),
  );

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

  const handleExportTrace = useCallback(() => {
    experimentRecorder.downloadTraceAsJSON();
  }, []);

  const handleClearTrace = useCallback(() => {
    experimentRecorder.clear();
    setEventCounts(experimentRecorder.getEventCounts());
  }, []);

  const handleResetTask = useCallback(() => {
    taskManager.resetTask();
  }, []);

  // Determine active task details
  const activeTask = taskState.currentTaskId
    ? EXPERIMENTAL_TASKS[taskState.currentTaskId]
    : null;
  const currentStep = activeTask?.steps[taskState.currentStepIndex];

  // MicroTensor display slicing
  const microTensorVals =
    liveMetrics.latestMicroTensor ?? new Array(18).fill(0);
  const featureValues = microTensorVals.slice(0, 9);
  const maskBits = microTensorVals
    .slice(9, 18)
    .map((v) => (v > 0.5 ? "1" : "0"))
    .join("");
  const windowIsInactive = Boolean(liveMetrics.latestWindowInactive);

  // Macro sequence
  const macroSequence = liveMetrics.latestMacroSequence ?? [];

  const evictionCounters = useMemo(
    () => experimentRecorder.getEvictionCounters(),
    [eventCounts.total],
  );

  const collectionState = liveMetrics.collectionState ?? "not configured";

  if (!isDiagnosticsVisible(forceShow, isDev, search, envFlag)) {
    return null;
  }

  if (!isOpen) {
    return (
      <div
        className="edge-aui-debug-container"
        data-testid="edge-aui-debug-container"
      >
        <button
          className="edge-aui-debug-toggle"
          onClick={() => setIsOpen(true)}
          aria-label="Open Edge-AUI Development Debug Panel"
        >
          <span>⚡ AUI Debug</span>
          <span
            style={{
              color: taskState.status === "In Progress" ? "#4ade80" : "#94a3b8",
            }}
          >
            [{taskState.status}]
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="edge-aui-debug-container"
      data-testid="edge-aui-debug-container"
    >
      <div
        className="edge-aui-debug-window"
        role="region"
        aria-label="Edge-AUI Debug Panel"
      >
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
            <div className="edge-aui-debug-section-title">
              Session & Task Context
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Session ID:</span>
              <span className="edge-aui-debug-val">
                {session?.sessionId ?? "No Active Session"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Condition:</span>
              <span className="edge-aui-debug-val highlight">
                {session?.conditionId ?? "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Provenance:</span>
              <span className="edge-aui-debug-val dim">
                {session?.provenance ?? "scripted"}
                {session?.participantId ? ` (${session.participantId})` : ""}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Task:</span>
              <span className="edge-aui-debug-val highlight">
                {activeTask
                  ? `${activeTask.id} (${activeTask.name})`
                  : "None (Idle)"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Step:</span>
              <span className="edge-aui-debug-val">
                {currentStep
                  ? `${currentStep.stepId}: ${currentStep.description}`
                  : "N/A"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Route:</span>
              <span className="edge-aui-debug-val">{uiContext.route}</span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Component Focus:</span>
              <span className="edge-aui-debug-val">
                {uiContext.activeComponentId
                  ? `${uiContext.activeComponentId} (${uiContext.componentRole ?? "none"})`
                  : "none"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Flags:</span>
              <span className="edge-aui-debug-val dim">
                primaryAction:{uiContext.primaryActionAvailable ? "yes" : "no"}{" "}
                | help:{uiContext.helpAvailable ? "yes" : "no"} | expandable:
                {uiContext.expandable ? "yes" : "no"}
              </span>
            </div>
          </div>

          {/* Priority 2: Decision State — the answer to "did it intervene, and why?" */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">
              Decision State
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">State:</span>
              <span
                className={`edge-aui-debug-val ${
                  liveMetrics.policyState === "POLICY REJECTED" ||
                  liveMetrics.policyState === "ACTUATION FAILED"
                    ? "warning"
                    : liveMetrics.policyState === "ACTUATED"
                      ? "success"
                      : "dim"
                }`}
                data-testid="aui-policy-state"
              >
                {liveMetrics.policyState ?? "NO PREDICTION"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Policy Reason:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.policyReason ??
                  liveMetrics.interventionStatus?.state ??
                  "idle"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Current Window:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.latestWindowId !== undefined
                  ? `#${liveMetrics.latestWindowId}`
                  : "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Prediction ID:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.latestPredictionId ?? "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Matched Gate:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.matchedGate ?? "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Mapping Source:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.mappingSource ?? "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Candidate Lines:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.candidateCount !== undefined
                  ? liveMetrics.candidateCount
                  : "--"}
                {" | cooldown: "}
                {liveMetrics.policyCooldownRemainingMs !== undefined
                  ? `${liveMetrics.policyCooldownRemainingMs} ms`
                  : "--"}
              </span>
            </div>
          </div>

          {/* Priority 3: Active Intervention Episode */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">
              Active Intervention Episode
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Episode:</span>
              <span className="edge-aui-debug-val" data-testid="aui-active-episode">
                {liveMetrics.activeEpisodeId ?? "none"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Actuator Status:</span>
              <span
                className={`edge-aui-debug-val ${
                  liveMetrics.activeEpisodeId ? "success" : "dim"
                }`}
              >
                {liveMetrics.activeEpisodeId
                  ? `ACTIVE (${liveMetrics.activeIntervention ?? "unknown"})`
                  : liveMetrics.policyState === "EXPIRED"
                    ? "EXPIRED"
                    : liveMetrics.policyState === "DISMISSED"
                      ? "DISMISSED"
                      : "idle"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">TTL:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.activeInterventionTtlMs !== undefined
                  ? `${liveMetrics.activeInterventionTtlMs} ms`
                  : "--"}
              </span>
            </div>
          </div>

          {/* Priority 4: Dual-Gate Arbitration */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">
              Gate Arbitration & Decisions
            </div>

            {/* Fast Gate */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Fast Gate:</span>
              <span
                className={`edge-aui-debug-val ${liveMetrics.fastGateStatus?.matched ? "success" : "dim"}`}
              >
                {liveMetrics.fastGateStatus?.matched
                  ? `MATCH (${liveMetrics.fastGateStatus.pattern ?? "pattern"})`
                  : "no match"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Fast Corpus:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.fastGateCorpusSize ?? "--"}
              </span>
            </div>

            {/* Slow Gate */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Slow Gate:</span>
              <span
                className={`edge-aui-debug-val ${liveMetrics.slowGateStatus?.called ? "warning" : "dim"}`}
              >
                {liveMetrics.slowGateStatus?.called
                  ? `${liveMetrics.slowGateStatus.outcome ?? "CALLED"} (conf: ${(liveMetrics.slowGateStatus.confidence ?? 0).toFixed(2)})`
                  : "skipped"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Slow Gate Mode:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.slowGateMode ?? "--"}
              </span>
            </div>

            {/* Prediction confidence */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Confidence:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.interventionStatus?.confidence !== undefined
                  ? liveMetrics.interventionStatus.confidence.toFixed(3)
                  : "--"}
              </span>
            </div>

            {/* Candidate Intervention */}
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Intervention:</span>
              <span
                className={`edge-aui-debug-val ${liveMetrics.interventionStatus?.type && liveMetrics.interventionStatus.type !== "no_op" ? "highlight" : "dim"}`}
              >
                {liveMetrics.interventionStatus?.type ?? "no_op"}
                {liveMetrics.interventionStatus?.source
                  ? ` [${liveMetrics.interventionStatus.source}]`
                  : ""}
              </span>
            </div>

            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Policy State:</span>
              <span className="edge-aui-debug-val">
                {liveMetrics.interventionStatus?.state ?? "idle"}
              </span>
            </div>
          </div>

          {/* Priority 5: Latency, Model & Worker Runtime Status */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">
              Latency, Model & Worker Status
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Inference Latency:</span>
              <span className="edge-aui-debug-val highlight">
                {liveMetrics.inferenceLatencyMs !== undefined
                  ? `${liveMetrics.inferenceLatencyMs.toFixed(2)} ms`
                  : "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">
                Evaluate+Act Cycle:
              </span>
              <span className="edge-aui-debug-val">
                {liveMetrics.evaluationCycleLatencyMs !== undefined
                  ? `${liveMetrics.evaluationCycleLatencyMs.toFixed(2)} ms`
                  : "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Model:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.modelLoaded ? "loaded" : "not loaded"}
                {liveMetrics.executionProvider
                  ? ` [${liveMetrics.executionProvider}]`
                  : ""}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Model Version:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.modelVersion ?? "--"}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Worker Runtime:</span>
              <span
                className={`edge-aui-debug-val ${liveMetrics.workerStatus === "ready" ? "success" : "warning"}`}
              >
                {liveMetrics.workerStatus ?? "uninitialized"}
              </span>
            </div>
            {liveMetrics.miningCounters && (
              <div className="edge-aui-debug-row">
                <span className="edge-aui-debug-label">Mining:</span>
                <span className="edge-aui-debug-val dim">
                  executed:{liveMetrics.miningCounters.executed} skipped:
                  {liveMetrics.miningCounters.skipped} superseded:
                  {liveMetrics.miningCounters.superseded} timedOut:
                  {liveMetrics.miningCounters.timedOut} dropped:
                  {liveMetrics.miningCounters.droppedWindows}
                </span>
              </div>
            )}
            {liveMetrics.stageTimings && Object.keys(liveMetrics.stageTimings).length > 0 && (
              <div style={{ marginTop: '8px', borderTop: '1px solid #334155', paddingTop: '6px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                  Stage Timings (Mean / p95):
                </div>
                {Object.values(liveMetrics.stageTimings).map((stat) => (
                  <div key={`${stat.stage}:${stat.side}`} className="edge-aui-debug-row" style={{ fontSize: '11px' }}>
                    <span className="edge-aui-debug-label" style={{ minWidth: '160px' }}>
                      {stat.stage} [{stat.side}]:
                    </span>
                    <span className="edge-aui-debug-val">
                      {stat.meanMs.toFixed(3)} ms / {stat.p95Ms.toFixed(3)} ms ({stat.count})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Priority 6: Macro Interaction Sequence */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Macro Sequence</div>
            <div className="edge-aui-debug-sequence">
              {macroSequence.length > 0 ? (
                macroSequence.map((sym, idx) => (
                  <React.Fragment key={`${sym}-${idx}`}>
                    <span className="edge-aui-debug-symbol">{sym}</span>
                    {idx < macroSequence.length - 1 && (
                      <span className="edge-aui-debug-arrow">&rarr;</span>
                    )}
                  </React.Fragment>
                ))
              ) : (
                <span className="edge-aui-debug-val dim">
                  No macro events recorded
                </span>
              )}
            </div>
          </div>

          {/* Priority 7: Latest 18-D MicroTensor */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">
              Latest MicroTensor (18-D)
              {windowIsInactive && (
                <span className="edge-aui-debug-val dim" data-testid="aui-window-inactive">
                  {" "}
                  — INACTIVITY WINDOW (zero values are expected)
                </span>
              )}
            </div>
            <div className="edge-aui-debug-tensor-grid">
              {featureValues.map((val, idx) => (
                <div
                  key={FEATURE_LABELS[idx]}
                  className="edge-aui-debug-tensor-item"
                >
                  <span className="edge-aui-debug-tensor-name">
                    {FEATURE_LABELS[idx]}:
                  </span>
                  <span className="edge-aui-debug-tensor-val">
                    {val.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
            <div className="edge-aui-debug-mask-row">
              <span>Modality Mask:</span>
              <span className="edge-aui-debug-mask-bits">[{maskBits}]</span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Window Events:</span>
              <span className="edge-aui-debug-val dim">
                {liveMetrics.latestWindowEventCount ?? "--"}
              </span>
            </div>
          </div>

          {/* Trace Recording, Truncation and Collection State */}
          <div className="edge-aui-debug-section">
            <div className="edge-aui-debug-section-title">Recorder Buffers</div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Buffered Events:</span>
              <span className="edge-aui-debug-val">
                {eventCounts.total} (B:{eventCounts.behaviourEvents} M:
                {eventCounts.macroInteractions} T:{eventCounts.microTensors} O:
                {eventCounts.outcomes} I:{eventCounts.interventions} P:
                {eventCounts.policyDecisions} K:{eventCounts.taskEvents})
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Evicted Records:</span>
              <span
                className={`edge-aui-debug-val ${
                  evictionCounters.truncated ? "warning" : "dim"
                }`}
                data-testid="aui-evictions"
              >
                {evictionCounters.total}
                {evictionCounters.truncated ? " (TRACE TRUNCATED)" : ""}
              </span>
            </div>
            <div className="edge-aui-debug-row">
              <span className="edge-aui-debug-label">Collection:</span>
              <span
                className={`edge-aui-debug-val ${
                  collectionState === "uploaded"
                    ? "success"
                    : collectionState === "failed"
                      ? "warning"
                      : "dim"
                }`}
                data-testid="aui-collection-state"
              >
                {collectionState}
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
