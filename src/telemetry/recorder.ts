/**
 * In-Memory Experiment Trace Recorder
 * Implements Stage 4.3 & Stage 10.1 specifications from docs/testbed/prd.md Sections 33-34 & docs/plan/tasks/10.1.md.
 * Manages chronological event logs and JSON export without remote telemetry transmission.
 */

import {
  BehaviourEvent,
  MicroTensorWindow,
  MacroInteraction,
  OutcomeEvent,
  PredictionEvent,
  InterventionEvent,
  TaskEvent,
  ExperimentalCondition
} from './events';
import { SessionContext, sessionManager } from './session';
import { TESTBED_UI_VERSION } from '../types/uiContext.js';
import { taskManager } from '../testbed/tasks/taskManager';
import { TaskState } from '../testbed/tasks/taskModel';
import {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  validateExperimentTrace,
  reconstructReplayStream,
  type SerializableMicroTensorWindow,
  type SerializableExperimentTrace,
  type TraceReplayMetadata,
  type TraceValidationResult,
  type ReplayStreamItem
} from './traceSchema';

export {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  validateExperimentTrace,
  reconstructReplayStream
};

export type {
  SerializableMicroTensorWindow,
  SerializableExperimentTrace,
  TraceReplayMetadata,
  TraceValidationResult,
  ReplayStreamItem
};

export interface ExperimentTrace {
  schemaVersion: string;
  session: SessionContext;
  task?: TaskState;
  behaviourEvents: BehaviourEvent[];
  microTensors: MicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  predictions: PredictionEvent[];
  interventions: InterventionEvent[];
  taskEvents: TaskEvent[];
}

export interface ExperimentRecorderOptions {
  maxBufferSize?: number;
}

export class ExperimentRecorder {
  private behaviourEvents: BehaviourEvent[] = [];
  private microTensors: MicroTensorWindow[] = [];
  private macroInteractions: MacroInteraction[] = [];
  private outcomes: OutcomeEvent[] = [];
  private predictions: PredictionEvent[] = [];
  private interventions: InterventionEvent[] = [];
  private taskEvents: TaskEvent[] = [];

  private maxBufferSize: number;

  /**
   * Session snapshot captured when recording begins. Retaining the session at start
   * (rather than reading the live singleton at export time) means an exported trace
   * can never be attributed to a different session than the one that produced it.
   */
  private sessionSnapshot: SessionContext | null = null;

  constructor(options: ExperimentRecorderOptions = {}) {
    // Default 10,000 events preserves memory strictly under the 20MB budget
    this.maxBufferSize = options.maxBufferSize ?? 10000;
  }

  /** Binds the trace to a session, called when a session starts. */
  public bindSession(session: SessionContext): void {
    this.sessionSnapshot = { ...session };
  }

  public getSessionId(): string | undefined {
    return this.sessionSnapshot?.sessionId;
  }

  public getExperimentId(): string | undefined {
    return this.sessionSnapshot?.experimentId;
  }

  public getConditionId(): ExperimentalCondition | undefined {
    return this.sessionSnapshot?.conditionId;
  }

  public recordBehaviourEvent(event: BehaviourEvent): void {
    if (this.behaviourEvents.length >= this.maxBufferSize) {
      this.behaviourEvents.shift();
    }
    this.behaviourEvents.push(event);
  }

  public recordMicroTensor(window: MicroTensorWindow): void {
    if (this.microTensors.length >= this.maxBufferSize) {
      this.microTensors.shift();
    }
    this.microTensors.push(window);
  }

  public recordMacroInteraction(event: MacroInteraction): void {
    if (this.macroInteractions.length >= this.maxBufferSize) {
      this.macroInteractions.shift();
    }
    this.macroInteractions.push(event);
  }

  public recordOutcome(event: OutcomeEvent): void {
    if (this.outcomes.length >= this.maxBufferSize) {
      this.outcomes.shift();
    }
    this.outcomes.push(event);
  }

  public recordPrediction(event: PredictionEvent): void {
    if (this.predictions.length >= this.maxBufferSize) {
      this.predictions.shift();
    }
    this.predictions.push(event);
  }

  public recordIntervention(event: InterventionEvent): void {
    if (this.interventions.length >= this.maxBufferSize) {
      this.interventions.shift();
    }
    this.interventions.push(event);
  }

  public recordTaskEvent(event: TaskEvent): void {
    if (this.taskEvents.length >= this.maxBufferSize) {
      this.taskEvents.shift();
    }
    this.taskEvents.push(event);
  }

  /**
   * Resolves the session to attribute this trace to: the bound snapshot if one exists,
   * otherwise the live active session, otherwise an explicit anonymous fallback.
   */
  private resolveSession(): SessionContext {
    const resolved =
      this.sessionSnapshot ??
      sessionManager.getActiveSession() ?? {
        sessionId: 'anonymous-unassigned',
        startedAt: 0,
        startedAtEpochMs: 0
      };

    // Always surface an explicit condition so a trace can never be ambiguous about
    // whether adaptation was permitted (assessment §17).
    return {
      ...resolved,
      conditionId: resolved.conditionId ?? 'baseline'
    };
  }

  /**
   * Returns a snapshot of the full chronological experiment trace with in-memory Float32Array microtensors.
   */
  public export(): ExperimentTrace {
    return {
      schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      session: this.resolveSession(),
      task: taskManager.getState(),
      behaviourEvents: [...this.behaviourEvents],
      microTensors: [...this.microTensors],
      macroInteractions: [...this.macroInteractions],
      outcomes: [...this.outcomes],
      predictions: [...this.predictions],
      interventions: [...this.interventions],
      taskEvents: [...this.taskEvents]
    };
  }

  /**
   * Produces a fully serializable, schema-compliant experiment trace object.
   */
  public exportSerializable(): SerializableExperimentTrace {
    const activeSession = this.resolveSession();
    const taskState = taskManager.getState();
    // durationMs is derived from epoch clocks only. Subtracting the monotonic
    // `startedAt` from `Date.now()` produced a meaningless value (assessment §16.4).
    const now = Date.now();
    const startedAtEpochMs = activeSession.startedAtEpochMs ?? 0;
    const durationMs = startedAtEpochMs > 0 ? Math.max(0, now - startedAtEpochMs) : 0;

    const totalEvents =
      this.behaviourEvents.length +
      this.microTensors.length +
      this.macroInteractions.length +
      this.outcomes.length +
      this.predictions.length +
      this.interventions.length +
      this.taskEvents.length;

    const metadata: TraceReplayMetadata = {
      durationMs,
      totalEvents,
      behaviourCount: this.behaviourEvents.length,
      microTensorCount: this.microTensors.length,
      macroCount: this.macroInteractions.length,
      outcomeCount: this.outcomes.length,
      predictionCount: this.predictions.length,
      interventionCount: this.interventions.length,
      taskEventCount: this.taskEvents.length,
      finalTaskStatus: taskState.status,
      experimentId: activeSession.experimentId,
      conditionId: activeSession.conditionId,
      uiVersion: TESTBED_UI_VERSION
    };

    return {
      schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      session: activeSession,
      task: taskState,
      metadata,
      behaviourEvents: [...this.behaviourEvents],
      microTensors: this.microTensors.map((m) => ({
        windowId: m.windowId,
        windowStart: m.windowStart,
        windowEnd: m.windowEnd,
        values: Array.from(m.values),
        eventCount: m.eventCount,
        inactive: m.inactive
      })),
      macroInteractions: [...this.macroInteractions],
      outcomes: [...this.outcomes],
      predictions: [...this.predictions],
      interventions: [...this.interventions],
      taskEvents: [...this.taskEvents]
    };
  }

  /**
   * Produces a JSON string of the trace adhering strictly to SerializableExperimentTrace.
   */
  public exportJSON(pretty = false): string {
    const serializable = this.exportSerializable();
    return pretty ? JSON.stringify(serializable, null, 2) : JSON.stringify(serializable);
  }

  /**
   * Triggers an in-browser direct file download of the recorded trace as JSON.
   * Runs entirely client-side without any server or external telemetry dependency.
   */
  public downloadTraceAsJSON(filename?: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      console.warn('[ExperimentRecorder] downloadTraceAsJSON is only available in browser environments.');
      return;
    }

    const json = this.exportJSON(true);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const activeSession = sessionManager.getActiveSession();
    const sessionId = activeSession?.sessionId ?? 'unknown-session';
    const resolvedFilename = filename ?? `experiment-trace-${sessionId}-${Date.now()}.json`;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = resolvedFilename;
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Reconstructs an ordered replay stream from the current recorder buffer.
   */
  public getReplayStream(): ReplayStreamItem[] {
    return reconstructReplayStream(this.exportSerializable());
  }

  /**
   * Clears all recorded buffers. The session binding is retained so a cleared trace
   * is still attributable to the session it belongs to.
   */
  public clear(): void {
    this.behaviourEvents = [];
    this.microTensors = [];
    this.macroInteractions = [];
    this.outcomes = [];
    this.predictions = [];
    this.interventions = [];
    this.taskEvents = [];
  }

  /**
   * Returns counts of events currently buffered in memory.
   */
  public getEventCounts(): {
    behaviourEvents: number;
    microTensors: number;
    macroInteractions: number;
    outcomes: number;
    predictions: number;
    interventions: number;
    taskEvents: number;
    total: number;
  } {
    const counts = {
      behaviourEvents: this.behaviourEvents.length,
      microTensors: this.microTensors.length,
      macroInteractions: this.macroInteractions.length,
      outcomes: this.outcomes.length,
      predictions: this.predictions.length,
      interventions: this.interventions.length,
      taskEvents: this.taskEvents.length
    };
    return {
      ...counts,
      total:
        counts.behaviourEvents +
        counts.microTensors +
        counts.macroInteractions +
        counts.outcomes +
        counts.predictions +
        counts.interventions +
        counts.taskEvents
    };
  }
}

/**
 * Singleton shared experiment trace recorder.
 */
export const experimentRecorder = new ExperimentRecorder();
