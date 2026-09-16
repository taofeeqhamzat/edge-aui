/**
 * In-Memory Experiment Trace Recorder
 * Implements Stage 4.3 specifications from clipboard.9.md Section 33 & docs/plan/tasks/4.3.md.
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

export interface ExperimentTrace {
  session: SessionContext;
  task?: TaskState;
  behaviourEvents: BehaviourEvent[];
  microTensors: MicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  interventions: InterventionEvent[];
}

export interface SerializableMicroTensorWindow {
  windowStart: number;
  windowEnd: number;
  values: number[];
}

export interface SerializableExperimentTrace {
  session: SessionContext;
  task?: TaskState;
  behaviourEvents: BehaviourEvent[];
  microTensors: SerializableMicroTensorWindow[];
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
   * Returns a snapshot of the full chronological experiment trace.
   */
  public export(): ExperimentTrace {
    const activeSession = sessionManager.getActiveSession() ?? {
      sessionId: 'anonymous-unassigned',
      startedAt: 0
    };

    return {
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
   * Produces a JSON string of the trace, converting Float32Array microtensor values to standard numbers.
   */
  public exportJSON(pretty = false): string {
    const trace = this.export();
    const serializable: SerializableExperimentTrace = {
      ...trace,
      microTensors: trace.microTensors.map((m) => ({
        windowStart: m.windowStart,
        windowEnd: m.windowEnd,
        values: Array.from(m.values)
      }))
    };

    return pretty ? JSON.stringify(serializable, null, 2) : JSON.stringify(serializable);
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
  } {
    return {
      behaviourEvents: this.behaviourEvents.length,
      microTensors: this.microTensors.length,
      macroInteractions: this.macroInteractions.length,
      outcomes: this.outcomes.length,
      interventions: this.interventions.length
    };
  }
}

/**
 * Singleton shared experiment trace recorder.
 */
export const experimentRecorder = new ExperimentRecorder();
