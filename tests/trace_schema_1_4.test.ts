/**
 * Trace Schema 1.4 and Actuator Target Resolution (Task 20.5)
 *
 * 1.4.0 records what the semantic layer produced: the semantic outcome on an `OutcomeEvent`,
 * the task-definition version on a `TaskEvent`, the normalized prediction on a
 * `PredictionEvent`, and the vocabulary/contract versions in `metadata`. The change is
 * additive: a 1.3.0 capture still validates and still exports.
 *
 * The actuator no longer guesses where an adaptation goes. A configured target resolver is
 * authoritative: a declared target that cannot be resolved is a recorded actuation failure,
 * not a silent fallback to some other element.
 */

import { describe, it, expect } from 'vitest';
import {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS,
  validateExperimentTrace,
  type SerializableExperimentTrace
} from '../src/telemetry/traceSchema';
import { UIActuator, ADAPTATION_ATTRIBUTE } from '../src/intervention/actuator';
import { createInterventionCommand } from '../src/intervention/types';

const BASE_SESSION = {
  sessionId: 'sess-1',
  startedAt: 1_700_000_000_000,
  provenance: 'scripted' as const
};

function makeTrace(
  overrides: Partial<SerializableExperimentTrace> = {}
): SerializableExperimentTrace {
  const trace = {
    schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    session: BASE_SESSION,
    metadata: {
      durationMs: 1000,
      totalEvents: 0,
      behaviourCount: 0,
      microTensorCount: 0,
      macroCount: 0,
      outcomeCount: 0,
      predictionCount: 0,
      interventionCount: 0,
      policyDecisionCount: 0,
      taskEventCount: 0,
      conditionId: 'adaptive',
      clock: 'epoch_ms',
      provenance: 'scripted',
      applicationVersion: 'test-1.0.0',
      policyVersion: 'policy-1.0.0'
    },
    behaviourEvents: [],
    microTensors: [],
    macroInteractions: [],
    outcomes: [],
    predictions: [],
    interventions: [],
    policyDecisions: [],
    taskEvents: []
  } as unknown as SerializableExperimentTrace;

  return { ...trace, ...overrides } as SerializableExperimentTrace;
}

describe('trace schema 1.4', () => {
  it('declares 1.4.0 and keeps 1.3.0 readable', () => {
    expect(EXPERIMENT_TRACE_SCHEMA_VERSION).toBe('1.4.0');
    expect(SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS).toContain('1.4.0');
    expect(SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS).toContain('1.3.0');
  });

  it('validates a 1.4.0 trace through a JSON round trip', () => {
    const trace = makeTrace({
      outcomes: [
        {
          timestamp: 1000,
          windowId: 1,
          outcome: 'FORM_SUBMIT',
          taskOutcome: 'apply_filter',
          taskOutcomeVocabularyVersion: 'testbed-semantic/1.0.0',
          taskOutcomeSource: 'application_rule'
        }
      ],
      taskEvents: [
        {
          timestamp: 1000,
          type: 'task_step',
          taskId: 'TD1',
          taskStepId: 'TD1-4',
          status: 'In Progress',
          errors: 0,
          taskDefinitionVersion: 'TD-v2'
        }
      ],
      metadata: {
        ...makeTrace().metadata,
        semanticOutcomeVocabularyVersion: 'testbed-semantic/1.0.0',
        taskDefinitionVersion: 'TD-v2'
      }
    } as never);

    const roundTripped = JSON.parse(JSON.stringify(trace)) as SerializableExperimentTrace;
    const result = validateExperimentTrace(roundTripped);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('still validates a 1.3.0 capture', () => {
    const legacy = makeTrace({ schemaVersion: '1.3.0' } as never);
    const result = validateExperimentTrace(JSON.parse(JSON.stringify(legacy)));

    expect(result.valid).toBe(true);
    expect(result.isLegacyVersion).toBe(true);
  });

  it('rejects an unknown schema version', () => {
    const result = validateExperimentTrace(
      JSON.parse(JSON.stringify(makeTrace({ schemaVersion: '9.9.9' } as never)))
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('9.9.9');
  });

  it('rejects a semantic outcome without its vocabulary version', () => {
    const trace = makeTrace({
      outcomes: [{ timestamp: 1, windowId: 1, outcome: 'CLICK', taskOutcome: 'select_report' }]
    } as never);

    const result = validateExperimentTrace(trace);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/taskOutcomeVocabularyVersion/);
  });

  it('rejects a semantic derivation source without a semantic outcome', () => {
    const trace = makeTrace({
      outcomes: [{ timestamp: 1, windowId: 1, outcome: 'CLICK', taskOutcomeSource: 'application_rule' }]
    } as never);

    const result = validateExperimentTrace(trace);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/taskOutcome/);
  });

  it('requires the task-definition version on a 1.4.0 task event', () => {
    const trace = makeTrace({
      taskEvents: [
        { timestamp: 1, type: 'task_start', taskId: 'TD1', status: 'In Progress', errors: 0 }
      ]
    } as never);

    const result = validateExperimentTrace(trace);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/taskDefinitionVersion/);
  });

  it('accepts task_fail with a failure reason', () => {
    const trace = makeTrace({
      taskEvents: [
        {
          timestamp: 1,
          type: 'task_fail',
          taskId: 'TD3',
          status: 'Failed',
          errors: 1,
          reason: 'state_mismatch',
          taskDefinitionVersion: 'TD-v2'
        }
      ],
      metadata: { ...makeTrace().metadata, taskDefinitionVersion: 'TD-v2' }
    } as never);

    expect(validateExperimentTrace(trace).valid).toBe(true);
  });

  it('records the normalized prediction and requires its contract version', () => {
    const valid = makeTrace({
      predictions: [
        {
          timestamp: 1,
          predictionId: 'pred_1',
          matchedGate: 'slow',
          predictedOutcome: 'apply_filter',
          predictionContractVersion: '1.0.0',
          targetContext: { route: 'Analytics', taskId: 'TD1', taskStepId: 'TD1-4' }
        }
      ],
      metadata: {
        ...makeTrace().metadata,
        predictionContractVersion: '1.0.0'
      }
    } as never);
    expect(validateExperimentTrace(valid).errors).toEqual([]);

    const missingContract = makeTrace({
      predictions: [
        { timestamp: 1, predictionId: 'pred_1', matchedGate: 'slow', predictedOutcome: 'apply_filter' }
      ]
    } as never);
    const result = validateExperimentTrace(missingContract);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/predictionContractVersion/);
  });

  it('requires the semantic vocabulary version in metadata when outcomes carry one', () => {
    const trace = makeTrace({
      outcomes: [
        {
          timestamp: 1,
          windowId: 1,
          outcome: 'CLICK',
          taskOutcome: 'select_report',
          taskOutcomeVocabularyVersion: 'testbed-semantic/1.0.0',
          taskOutcomeSource: 'application_rule'
        }
      ]
    } as never);

    const result = validateExperimentTrace(trace);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/semanticOutcomeVocabularyVersion/);
  });
});

describe('actuator target resolver', () => {
  function buildDom(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = `
      <section data-aui-component="filter-drawer">
        <button data-aui-component="filter-section-region" data-aui-role="accordion" aria-expanded="true">Region</button>
      </section>
      <section data-aui-component="other-panel">
        <button data-aui-role="accordion" aria-expanded="true">Other</button>
      </section>
    `;
    document.body.appendChild(root);
    return root;
  }

  it('applies simplify_options to the configured target', () => {
    const root = buildDom();
    const actuator = new UIActuator({
      root,
      targetResolver: (targetId) =>
        targetId === 'filter-drawer'
          ? root.querySelector('[data-aui-component="filter-drawer"]')
          : null
    });

    const applied = actuator.apply(
      createInterventionCommand({
        type: 'simplify_options',
        targetComponentId: 'filter-drawer',
        source: 'rule'
      })
    );

    expect(applied).toBe(true);
    const target = root.querySelector('[data-aui-component="filter-drawer"]')!;
    expect(target.classList.contains('edge-aui-simplified')).toBe(true);
    // The correlation stamp lands on the accordion inside the resolved surface.
    expect(target.querySelector(`[${ADAPTATION_ATTRIBUTE}]`)).toBeTruthy();
    // The other panel is untouched: the adaptation went where it was told.
    const other = root.querySelector('[data-aui-component="other-panel"]')!;
    expect(other.classList.contains('edge-aui-simplified')).toBe(false);
    expect(other.querySelector(`[${ADAPTATION_ATTRIBUTE}]`)).toBeNull();
  });

  it('fails safely, with no fallback, when the configured target is missing', () => {
    const root = buildDom();
    const actuator = new UIActuator({
      root,
      targetResolver: () => null
    });

    const applied = actuator.apply(
      createInterventionCommand({
        type: 'simplify_options',
        targetComponentId: 'filter-drawer',
        source: 'rule'
      })
    );

    expect(applied).toBe(false);
    expect(root.querySelectorAll('.edge-aui-simplified').length).toBe(0);
    expect(root.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}]`).length).toBe(0);
  });

  it('keeps the framework default behaviour when no resolver is configured', () => {
    const root = buildDom();
    const actuator = new UIActuator({ root });

    const applied = actuator.apply(
      createInterventionCommand({ type: 'simplify_options', source: 'rule' })
    );

    expect(applied).toBe(true);
    expect(root.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}]`).length).toBeGreaterThan(0);
  });
});
