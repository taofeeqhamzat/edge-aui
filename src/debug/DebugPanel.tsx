/**
 * Development / Researcher Debug Panel & Telemetry Visualiser
 * Implements Stage 10.2 specifications from docs/testbed/prd.md Section 38 & docs/plan/tasks/10.2.md.
 *
 * Adheres strictly to:
 * - Register: product (Scientific research testbed & analytics dashboard)
 * - Creative North Star: "The Instrument Bench" (Persistent Light Theme)
 * - Strict zero border radius (border-radius: 0), crisp 1px borders, high-contrast typography
 * - Predicts observable interaction outcomes (never subjective affective states)
 * - Optimized lifecycle: zero background polling/re-rendering when collapsed
 * - Clarified and distilled technical telemetry layout
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
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
] as const;

const EMPTY_MICRO_TENSOR = Object.freeze(new Array(18).fill(0)) as number[];

/**
 * Whether the researcher panel should be reachable in this build.
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
  if (envFlag === "1" || envFlag === "true") return true;
  try {
    const params = new URLSearchParams(search);
    return params.get("auiDiagnostics") === "1" || params.get("auiDiagnostics") === "true";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Memoized Telemetry Sub-Sections (Optimised & Distilled)
// ---------------------------------------------------------------------------

interface SessionTaskSectionProps {
  session: SessionContext | null;
  taskState: TaskState;
  uiContext: UIContext;
}

const SessionTaskSection = memo(function SessionTaskSection({
  session,
  taskState,
  uiContext,
}: SessionTaskSectionProps) {
  const activeTask = taskState.currentTaskId
    ? EXPERIMENTAL_TASKS[taskState.currentTaskId]
    : null;
  const currentStep = activeTask?.steps[taskState.currentStepIndex];

  return (
    <div className="edge-aui-debug-section">
      <div className="edge-aui-debug-section-title">Session & Task Context</div>
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
          {activeTask ? `${activeTask.id} (${activeTask.name})` : "None (Idle)"}
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
          primaryAction:{uiContext.primaryActionAvailable ? "yes" : "no"} | help:
          {uiContext.helpAvailable ? "yes" : "no"} | expandable:
          {uiContext.expandable ? "yes" : "no"}
        </span>
      </div>
    </div>
  );
});

interface DecisionStateSectionProps {
  liveMetrics: LiveDebugMetrics;
}

const DecisionStateSection = memo(function DecisionStateSection({
  liveMetrics,
}: DecisionStateSectionProps) {
  const policyStateClass =
    liveMetrics.policyState === "POLICY REJECTED" ||
    liveMetrics.policyState === "ACTUATION FAILED"
      ? "warning"
      : liveMetrics.policyState === "ACTUATED"
        ? "success"
        : "dim";

  return (
    <div className="edge-aui-debug-section">
      <div className="edge-aui-debug-section-title">Decision State</div>
      <div className="edge-aui-debug-row">
        <span className="edge-aui-debug-label">State:</span>
        <span
          className={`edge-aui-debug-val ${policyStateClass}`}
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
  );
});

interface InterventionEpisodeSectionProps {
  liveMetrics: LiveDebugMetrics;
}

const InterventionEpisodeSection = memo(function InterventionEpisodeSection({
  liveMetrics,
}: InterventionEpisodeSectionProps) {
  const isEpisodeActive = Boolean(liveMetrics.activeEpisodeId);

  return (
    <div className="edge-aui-debug-section">
      <div className="edge-aui-debug-section-title">Active Intervention Episode</div>
      <div className="edge-aui-debug-row">
        <span className="edge-aui-debug-label">Episode:</span>
        <span className="edge-aui-debug-val" data-testid="aui-active-episode">
          {liveMetrics.activeEpisodeId ?? "none"}
        </span>
      </div>
      <div className="edge-aui-debug-row">
        <span className="edge-aui-debug-label">Actuator Status:</span>
        <span
          className={`edge-aui-debug-val ${isEpisodeActive ? "success" : "dim"}`}
        >
          {isEpisodeActive
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
          {liveMetrics.activeInterventionExpiresInMs !== undefined
            ? ` (rem: ${liveMetrics.activeInterventionExpiresInMs} ms)`
            : ""}
        </span>
      </div>
    </div>
  );
});

interface DualGateSectionProps {
  liveMetrics: LiveDebugMetrics;
}

const DualGateSection = memo(function DualGateSection({
  liveMetrics,
}: DualGateSectionProps) {
  const fastGateMatched = liveMetrics.fastGateStatus?.matched;
  const slowGateCalled = liveMetrics.slowGateStatus?.called;

  return (
    <div className="edge-aui-debug-section">
      <div className="edge-aui-debug-section-title">
        Gate Arbitration & Decisions
      </div>

      {/* Fast Gate */}
      <div className="edge-aui-debug-row">
        <span className="edge-aui-debug-label">Fast Gate:</span>
        <span
          className={`edge-aui-debug-val ${fastGateMatched ? "success" : "dim"}`}
        >
          {fastGateMatched
            ? `MATCH (${liveMetrics.fastGateStatus?.pattern ?? "pattern"})`
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
          className={`edge-aui-debug-val ${slowGateCalled ? "warning" : "dim"}`}
        >
          {slowGateCalled
            ? `${liveMetrics.slowGateStatus?.outcome ?? "CALLED"} (conf: ${(liveMetrics.slowGateStatus?.confidence ?? 0).toFixed(2)})`
            : "skipped"}
        </span>
      </div>
      <div className="edge-aui-debug-row">
        <span className="edge-aui-debug-label">Slow Gate Mode:</span>
        <span className="edge-aui-debug-val dim">
          {liveMetrics.slowGateMode ?? "--"}
        </span>
      </div>

      {/* Prediction Confidence */}
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
          className={`edge-aui-debug-val ${
            liveMetrics.interventionStatus?.type &&
            liveMetrics.interventionStatus.type !== "no_op"
              ? "highlight"
              : "dim"
          }`}
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
  );
});

interface RuntimeStatusSectionProps {
  liveMetrics: LiveDebugMetrics;
}

const RuntimeStatusSection = memo(function RuntimeStatusSection({
  liveMetrics,
}: RuntimeStatusSectionProps) {
  const isWorkerReady = liveMetrics.workerStatus === "ready";

  return (
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
        <span className="edge-aui-debug-label">Evaluate+Act Cycle:</span>
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
          className={`edge-aui-debug-val ${isWorkerReady ? "success" : "warning"}`}
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
      {liveMetrics.stageTimings &&
        Object.keys(liveMetrics.stageTimings).length > 0 && (
          <div className="edge-aui-debug-timings-container">
            <div className="edge-aui-debug-timings-header">
              <span>Stage Timings (Mean / p95):</span>
            </div>
            {Object.values(liveMetrics.stageTimings).map((stat) => (
              <div
                key={`${stat.stage}:${stat.side}`}
                className="edge-aui-debug-row edge-aui-debug-timing-row"
              >
                <span className="edge-aui-debug-label edge-aui-debug-stage-label">
                  {stat.stage} [{stat.side}]:
                </span>
                <span className="edge-aui-debug-val">
                  {stat.meanMs.toFixed(3)} ms / {stat.p95Ms.toFixed(3)} ms (
                  {stat.count})
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
});

interface MacroSequenceSectionProps {
  macroSequence: string[];
}

const MacroSequenceSection = memo(function MacroSequenceSection({
  macroSequence,
}: MacroSequenceSectionProps) {
  return (
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
  );
});

interface MicroTensorSectionProps {
  featureValues: number[];
  maskBits: string;
  windowIsInactive: boolean;
  latestWindowEventCount?: number;
}

const MicroTensorSection = memo(function MicroTensorSection({
  featureValues,
  maskBits,
  windowIsInactive,
  latestWindowEventCount,
}: MicroTensorSectionProps) {
  return (
    <div className="edge-aui-debug-section">
      <div className="edge-aui-debug-section-title">
        Latest MicroTensor (18-D)
        {windowIsInactive && (
          <span
            className="edge-aui-debug-val dim"
            data-testid="aui-window-inactive"
          >
            {" "}
            — INACTIVITY WINDOW (zero values are expected)
          </span>
        )}
      </div>
      <div className="edge-aui-debug-tensor-grid">
        {featureValues.map((val, idx) => (
          <div key={FEATURE_LABELS[idx]} className="edge-aui-debug-tensor-item">
            <span className="edge-aui-debug-tensor-name">
              {FEATURE_LABELS[idx]}:
            </span>
            <span className="edge-aui-debug-tensor-val">{val.toFixed(3)}</span>
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
          {latestWindowEventCount !== undefined
            ? latestWindowEventCount
            : "--"}
        </span>
      </div>
    </div>
  );
});

interface RecorderBuffersSectionProps {
  eventCounts: ReturnType<typeof experimentRecorder.getEventCounts>;
  evictionCounters: ReturnType<typeof experimentRecorder.getEvictionCounters>;
  collectionState: string;
  collectionDetail?: LiveDebugMetrics["collectionDetail"];
}

const RecorderBuffersSection = memo(function RecorderBuffersSection({
  eventCounts,
  evictionCounters,
  collectionState,
  collectionDetail,
}: RecorderBuffersSectionProps) {
  const isTruncated = evictionCounters.truncated;

  return (
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
      <div className="edge-aui-debug-legend">
        <span>B: Behaviour</span>
        <span>M: Macro</span>
        <span>T: MicroTensor</span>
        <span>O: Outcome</span>
        <span>I: Intervention</span>
        <span>P: Policy</span>
        <span>K: Task</span>
      </div>
      <div className="edge-aui-debug-row">
        <span className="edge-aui-debug-label">Evicted Records:</span>
        <span
          className={`edge-aui-debug-val ${isTruncated ? "warning" : "dim"}`}
          data-testid="aui-evictions"
        >
          {evictionCounters.total}
          {isTruncated ? " (TRACE TRUNCATED)" : ""}
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
      {collectionDetail && (
        <div className="edge-aui-debug-row">
          <span className="edge-aui-debug-label">Collection Detail:</span>
          <span className="edge-aui-debug-val dim">
            {collectionDetail.mode} | uploads: {collectionDetail.uploadAttempts}
            {collectionDetail.lastError
              ? ` (${collectionDetail.lastError})`
              : ""}
          </span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

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
  const [session, setSession] = useState<SessionContext | null>(() =>
    sessionManager.getActiveSession()
  );
  const [taskState, setTaskState] = useState<TaskState>(() =>
    taskManager.getState()
  );
  const [uiContext, setUiContext] = useState<UIContext>(() =>
    getActiveUIContext()
  );
  const [liveMetrics, setLiveMetrics] = useState<LiveDebugMetrics>(() =>
    debugBus.getSnapshot()
  );
  const [eventCounts, setEventCounts] = useState(() =>
    experimentRecorder.getEventCounts()
  );

  // Background subscriptions required for toggle status & session
  useEffect(() => {
    const unsubSession = sessionManager.onSessionChange(setSession);
    const unsubTask = taskManager.subscribe(setTaskState);
    return () => {
      unsubSession();
      unsubTask();
    };
  }, []);

  // Performance optimisation: Only poll UI context, recorder counts and listen to
  // high-frequency liveMetrics bus updates when the panel is expanded.
  useEffect(() => {
    if (!isOpen) return;

    // Immediately synchronize snapshot on expansion
    setLiveMetrics(debugBus.getSnapshot());
    setUiContext(getActiveUIContext());
    setEventCounts(experimentRecorder.getEventCounts());

    const unsubMetrics = debugBus.subscribe(setLiveMetrics);

    const interval = setInterval(() => {
      setUiContext(getActiveUIContext());
      setEventCounts(experimentRecorder.getEventCounts());
    }, 250);

    return () => {
      unsubMetrics();
      clearInterval(interval);
    };
  }, [isOpen]);

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

  const handleOpenPanel = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  // MicroTensor calculations (memoized to prevent render-time allocations)
  const { featureValues, maskBits } = useMemo(() => {
    const tensor = liveMetrics.latestMicroTensor ?? EMPTY_MICRO_TENSOR;
    const fVals = tensor.slice(0, 9);
    const mBits = tensor
      .slice(9, 18)
      .map((v) => (v > 0.5 ? "1" : "0"))
      .join("");
    return { featureValues: fVals, maskBits: mBits };
  }, [liveMetrics.latestMicroTensor]);

  const windowIsInactive = Boolean(liveMetrics.latestWindowInactive);
  const macroSequence = useMemo(
    () => liveMetrics.latestMacroSequence ?? [],
    [liveMetrics.latestMacroSequence]
  );

  const evictionCounters = useMemo(
    () => experimentRecorder.getEvictionCounters(),
    [eventCounts.total]
  );

  const collectionState = liveMetrics.collectionState ?? "not configured";

  if (!isDiagnosticsVisible(forceShow, isDev, search, envFlag)) {
    return null;
  }

  if (!isOpen) {
    const isTaskRunning = taskState.status === "In Progress";
    return (
      <div
        className="edge-aui-debug-container"
        data-testid="edge-aui-debug-container"
      >
        <button
          className="edge-aui-debug-toggle"
          onClick={handleOpenPanel}
          aria-label="Open Edge-AUI Development Debug Panel"
        >
          <span className="edge-aui-debug-toggle-icon">⚡ AUI Debug</span>
          <span
            className={`edge-aui-debug-toggle-status ${
              isTaskRunning ? "status-in-progress" : "status-idle"
            }`}
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
            <span aria-hidden="true">⚡</span>
            <span>Edge-AUI Pipeline Inspector</span>
          </div>
          <button
            className="edge-aui-debug-close"
            onClick={handleClosePanel}
            aria-label="Collapse Debug Panel"
            title="Collapse panel"
          >
            &times;
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="edge-aui-debug-body">
          {/* Priority 1: Session & Task Context */}
          <SessionTaskSection
            session={session}
            taskState={taskState}
            uiContext={uiContext}
          />

          {/* Priority 2: Decision State */}
          <DecisionStateSection liveMetrics={liveMetrics} />

          {/* Priority 3: Active Intervention Episode */}
          <InterventionEpisodeSection liveMetrics={liveMetrics} />

          {/* Priority 4: Dual-Gate Arbitration & Decisions */}
          <DualGateSection liveMetrics={liveMetrics} />

          {/* Priority 5: Latency, Model & Worker Runtime Status */}
          <RuntimeStatusSection liveMetrics={liveMetrics} />

          {/* Priority 6: Macro Interaction Sequence */}
          <MacroSequenceSection macroSequence={macroSequence} />

          {/* Priority 7: Latest 18-D MicroTensor */}
          <MicroTensorSection
            featureValues={featureValues}
            maskBits={maskBits}
            windowIsInactive={windowIsInactive}
            latestWindowEventCount={liveMetrics.latestWindowEventCount}
          />

          {/* Priority 8: Trace Recording, Eviction & Collection */}
          <RecorderBuffersSection
            eventCounts={eventCounts}
            evictionCounters={evictionCounters}
            collectionState={collectionState}
            collectionDetail={liveMetrics.collectionDetail}
          />
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
