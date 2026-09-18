/**
 * ExperimentTrace Schema & Validation Contract
 * Implements Stage 10.1 specifications from clipboard.9.md Sections 33-34 & docs/plan/tasks/10.1.md.
 * 
 * Provides:
 * 1. Strict schema definition for offline experiment evaluation and replay.
 * 2. In-memory validation function verifying structural integrity without external libraries.
 * 3. Replay event chronological reconstruction stream.
 */

import {
  BehaviourEvent,
  MacroInteraction,
  OutcomeEvent,
  InterventionEvent
} from './events';
import { SessionContext } from './session';
import { TaskState } from '../testbed/tasks/taskModel';

export const EXPERIMENT_TRACE_SCHEMA_VERSION = '1.0.0';

export interface SerializableMicroTensorWindow {
  windowStart: number;
  windowEnd: number;
  values: number[]; // Serialized 18-element array
}

export interface TraceReplayMetadata {
  durationMs: number;
  totalEvents: number;
  behaviourCount: number;
  microTensorCount: number;
  macroCount: number;
  outcomeCount: number;
  interventionCount: number;
  finalTaskStatus?: string;
}

export interface SerializableExperimentTrace {
  schemaVersion: string;
  exportedAt: string; // ISO 8601 string
  session: SessionContext;
  task?: TaskState;
  metadata: TraceReplayMetadata;
  behaviourEvents: BehaviourEvent[];
  microTensors: SerializableMicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  interventions: InterventionEvent[];
}

export interface TraceValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates whether an unknown object conforms to the SerializableExperimentTrace contract.
 */
export function validateExperimentTrace(data: unknown): TraceValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Trace must be a non-null object'] };
  }

  const trace = data as Partial<SerializableExperimentTrace>;

  if (trace.schemaVersion !== EXPERIMENT_TRACE_SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion: expected '${EXPERIMENT_TRACE_SCHEMA_VERSION}', received '${trace.schemaVersion}'`);
  }

  if (typeof trace.exportedAt !== 'string' || Number.isNaN(Date.parse(trace.exportedAt))) {
    errors.push('Invalid exportedAt: must be a valid ISO date string');
  }

  // Session validation
  if (!trace.session || typeof trace.session !== 'object') {
    errors.push('Missing or invalid session object');
  } else {
    if (typeof trace.session.sessionId !== 'string' || trace.session.sessionId.trim() === '') {
      errors.push('session.sessionId must be a non-empty string');
    }
    if (typeof trace.session.startedAt !== 'number') {
      errors.push('session.startedAt must be a numeric timestamp');
    }
  }

  // Array validations
  const validateArrayField = (field: keyof SerializableExperimentTrace, name: string) => {
    if (!Array.isArray(trace[field])) {
      errors.push(`${name} must be an array`);
    }
  };

  validateArrayField('behaviourEvents', 'behaviourEvents');
  validateArrayField('microTensors', 'microTensors');
  validateArrayField('macroInteractions', 'macroInteractions');
  validateArrayField('outcomes', 'outcomes');
  validateArrayField('interventions', 'interventions');

  // Validate MicroTensor window format
  if (Array.isArray(trace.microTensors)) {
    for (let i = 0; i < trace.microTensors.length; i++) {
      const mt = trace.microTensors[i];
      if (!mt || typeof mt !== 'object') {
        errors.push(`microTensors[${i}] must be an object`);
        break;
      }
      if (typeof mt.windowStart !== 'number' || typeof mt.windowEnd !== 'number') {
        errors.push(`microTensors[${i}] has invalid windowStart/windowEnd timestamps`);
        break;
      }
      if (!Array.isArray(mt.values) || mt.values.length !== 18) {
        errors.push(`microTensors[${i}].values must be an 18-element numeric array, found length ${mt.values?.length}`);
        break;
      }
    }
  }

  // Validate metadata
  if (!trace.metadata || typeof trace.metadata !== 'object') {
    errors.push('Missing or invalid metadata object');
  } else {
    if (typeof trace.metadata.totalEvents !== 'number') {
      errors.push('metadata.totalEvents must be a number');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export type ReplayEventCategory =
  | 'behaviour'
  | 'macro'
  | 'outcome'
  | 'intervention';

export interface ReplayStreamItem {
  timestamp: number;
  category: ReplayEventCategory;
  event: BehaviourEvent | MacroInteraction | OutcomeEvent | InterventionEvent;
}

/**
 * Reconstructs a flat, strictly chronological stream of interactions and decisions
 * for offline simulation and model evaluation replay (Section 34).
 */
export function reconstructReplayStream(trace: SerializableExperimentTrace): ReplayStreamItem[] {
  const stream: ReplayStreamItem[] = [];

  for (const ev of trace.behaviourEvents) {
    stream.push({ timestamp: ev.timestamp, category: 'behaviour', event: ev });
  }
  for (const ev of trace.macroInteractions) {
    stream.push({ timestamp: ev.timestamp, category: 'macro', event: ev });
  }
  for (const ev of trace.outcomes) {
    stream.push({ timestamp: ev.timestamp, category: 'outcome', event: ev });
  }
  for (const ev of trace.interventions) {
    stream.push({ timestamp: ev.timestamp, category: 'intervention', event: ev });
  }

  // Sort strictly monotonically by timestamp
  return stream.sort((a, b) => a.timestamp - b.timestamp);
}
