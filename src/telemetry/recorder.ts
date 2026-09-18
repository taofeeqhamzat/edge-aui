/**
 * In-Memory Experiment Trace Recorder
 * Implements Stage 4.3 & Stage 10.1 specifications from clipboard.9.md Sections 33-34 & docs/plan/tasks/10.1.md.
 * Manages chronological event logs and JSON export without remote telemetry transmission.
 */

import {
  BehaviourEvent,
  MicroTensorWindow,
  MacroInteraction,
  OutcomeEvent,
  InterventionEvent
} from './events';
import { SessionContext, sessionManager } from './session';
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
  interventions: InterventionEvent[];
}

export interface ExperimentRecorderOptions {
  maxBufferSize?: number;
}

export class ExperimentRecorder {
  private behaviourEvents: BehaviourEvent[] = [];
  private microTensors: MicroTensorWindow[] = [];
  private macroInteractions: MacroInteraction[] = [];
  private outcomes: OutcomeEvent[] = [];
  private interventions: InterventionEvent[] = [];

  private maxBufferSize: number;

  constructor(options: ExperimentRecorderOptions = {}) {
    // Default 10,000 events preserves memory strictly under the 20MB budget
    this.maxBufferSize = options.maxBufferSize ?? 10000;
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

  public recordIntervention(event: InterventionEvent): void {
    if (this.interventions.length >= this.maxBufferSize) {
      this.interventions.shift();
    }
    this.interventions.push(event);
  }

  /**
   * Returns a snapshot of the full chronological experiment trace with in-memory Float32Array microtensors.
   */
  public export(): ExperimentTrace {
    const activeSession = sessionManager.getActiveSession() ?? {
      sessionId: 'anonymous-unassigned',
      startedAt: 0
    };

    return {
      schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      session: activeSession,
      task: taskManager.getState(),
      behaviourEvents: [...this.behaviourEvents],
      microTensors: [...this.microTensors],
      macroInteractions: [...this.macroInteractions],
      outcomes: [...this.outcomes],
      interventions: [...this.interventions]
    };
  }

  /**
   * Produces a fully serializable, schema-compliant experiment trace object.
   */
  public exportSerializable(): SerializableExperimentTrace {
    const activeSession = sessionManager.getActiveSession() ?? {
      sessionId: 'anonymous-unassigned',
      startedAt: 0
    };
    const taskState = taskManager.getState();
    const now = Date.now();
    const durationMs = activeSession.startedAt > 0 ? Math.max(0, now - activeSession.startedAt) : 0;

    const totalEvents =
      this.behaviourEvents.length +
      this.microTensors.length +
      this.macroInteractions.length +
      this.outcomes.length +
      this.interventions.length;

    const metadata: TraceReplayMetadata = {
      durationMs,
      totalEvents,
      behaviourCount: this.behaviourEvents.length,
      microTensorCount: this.microTensors.length,
      macroCount: this.macroInteractions.length,
      outcomeCount: this.outcomes.length,
      interventionCount: this.interventions.length,
      finalTaskStatus: taskState.status
    };

    return {
      schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      session: activeSession,
      task: taskState,
      metadata,
      behaviourEvents: [...this.behaviourEvents],
      microTensors: this.microTensors.map((m) => ({
        windowStart: m.windowStart,
        windowEnd: m.windowEnd,
        values: Array.from(m.values)
      })),
      macroInteractions: [...this.macroInteractions],
      outcomes: [...this.outcomes],
      interventions: [...this.interventions]
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
   * Clears all recorded buffers.
   */
  public clear(): void {
    this.behaviourEvents = [];
    this.microTensors = [];
    this.macroInteractions = [];
    this.outcomes = [];
    this.interventions = [];
  }

  /**
   * Returns counts of events currently buffered in memory.
   */
  public getEventCounts(): {
    behaviourEvents: number;
    microTensors: number;
    macroInteractions: number;
    outcomes: number;
    interventions: number;
    total: number;
  } {
    const counts = {
      behaviourEvents: this.behaviourEvents.length,
      microTensors: this.microTensors.length,
      macroInteractions: this.macroInteractions.length,
      outcomes: this.outcomes.length,
      interventions: this.interventions.length
    };
    return {
      ...counts,
      total:
        counts.behaviourEvents +
        counts.microTensors +
        counts.macroInteractions +
        counts.outcomes +
        counts.interventions
    };
  }
}

/**
 * Singleton shared experiment trace recorder.
 */
export const experimentRecorder = new ExperimentRecorder();
