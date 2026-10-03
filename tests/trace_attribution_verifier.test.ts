import { describe, it, expect } from 'vitest';
import { verifyTraceCompleteness } from '../src/telemetry/traceAttributionVerifier';
import type { SerializableExperimentTrace } from '../src/telemetry/traceSchema';

function createValidBaseTrace(): SerializableExperimentTrace {
  return {
    schemaVersion: '1.1.0',
    exportedAt: new Date().toISOString(),
    session: {
      sessionId: 'sess-001',
      startedAt: 100,
      startedAtEpochMs: Date.now(),
      experimentId: 'exp-001',
      conditionId: 'baseline',
      taskId: 'T2'
    },
    task: {
      currentTaskId: 'T2',
      status: 'Completed',
      currentStepIndex: 2,
      completedSteps: ['T2-1', 'T2-2'],
      errors: 0
    },
    metadata: {
      durationMs: 5000,
      totalEvents: 4,
      behaviourCount: 2,
      microTensorCount: 1,
      macroCount: 1,
      outcomeCount: 1,
      predictionCount: 1,
      interventionCount: 0,
      taskEventCount: 3,
      finalTaskStatus: 'Completed',
      experimentId: 'exp-001',
      conditionId: 'baseline',
      uiVersion: '1.0.0'
    },
    behaviourEvents: [
      {
        timestamp: 100,
        type: 'click',
        x: 0.5,
        y: 0.5,
        action: 'click',
        route: 'Analytics',
        componentId: 'btn-export'
      }
    ],
    microTensors: [
      {
        windowId: 1,
        windowStart: 100,
        windowEnd: 600,
        values: new Array(18).fill(0.1)
      }
    ],
    macroInteractions: [
      {
        timestamp: 100,
        symbol: 'NAV_ANALYTICS',
        windowId: 1
      }
    ],
    outcomes: [
      {
        timestamp: 600,
        outcome: 'CLICK',
        windowId: 1
      }
    ],
    predictions: [
      {
        timestamp: 600,
        sessionId: 'sess-001',
        experimentId: 'exp-001',
        conditionId: 'baseline',
        windowId: 1,
        matchedGate: 'none',
        bothGatesEvaluated: true
      }
    ],
    interventions: [],
    taskEvents: [
      {
        timestamp: 100,
        type: 'task_start',
        taskId: 'T2',
        status: 'In Progress',
        errors: 0,
        sessionId: 'sess-001',
        experimentId: 'exp-001',
        conditionId: 'baseline'
      },
      {
        timestamp: 200,
        type: 'task_step',
        taskId: 'T2',
        taskStepId: 'T2-1',
        status: 'In Progress',
        errors: 0,
        sessionId: 'sess-001',
        experimentId: 'exp-001',
        conditionId: 'baseline'
      },
      {
        timestamp: 300,
        type: 'task_step',
        taskId: 'T2',
        taskStepId: 'T2-2',
        status: 'In Progress',
        errors: 0,
        sessionId: 'sess-001',
        experimentId: 'exp-001',
        conditionId: 'baseline'
      },
      {
        timestamp: 400,
        type: 'task_complete',
        taskId: 'T2',
        status: 'Completed',
        errors: 0,
        sessionId: 'sess-001',
        experimentId: 'exp-001',
        conditionId: 'baseline'
      }
    ]
  };
}

describe('Trace Attribution and Completeness Verifier', () => {
  it('validates a complete and correctly attributed trace (schema 1.1.0)', () => {
    const trace = createValidBaseTrace();
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('validates a complete and correctly attributed trace (schema 1.2.0 with mappingSource)', () => {
    const trace = createValidBaseTrace();
    trace.schemaVersion = '1.2.0';
    trace.session.conditionId = 'adaptive';
    trace.metadata.conditionId = 'adaptive';
    trace.predictions = [
      {
        timestamp: 600,
        sessionId: 'sess-001',
        experimentId: 'exp-001',
        conditionId: 'adaptive',
        windowId: 1,
        matchedGate: 'slow',
        interventionType: 'offer_assistance',
        mappingSource: 'learned_head',
        modelVersion: 'TargetInterventionHead-v1.0.0-int8',
        contextEncodingVersion: 'R6-v1.0.0',
        bothGatesEvaluated: false
      }
    ];
    trace.interventions = [
      {
        timestamp: 650,
        type: 'applied',
        intervention: 'offer_assistance',
        source: 'slow',
        mappingSource: 'learned_head',
        interventionEpisodeId: 'ep-001',
        sessionId: 'sess-001',
        conditionId: 'adaptive'
      },
      {
        timestamp: 900,
        type: 'reverted',
        intervention: 'offer_assistance',
        source: 'slow',
        mappingSource: 'learned_head',
        interventionEpisodeId: 'ep-001',
        sessionId: 'sess-001',
        conditionId: 'adaptive'
      }
    ];
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails on schema version mismatch', () => {
    const trace = createValidBaseTrace();
    trace.schemaVersion = '1.0.0';
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(false);
    const check = result.checks.find((c) => c.check === 'schema_version');
    expect(check?.passed).toBe(false);
  });

  it('fails when correlation IDs are missing on predictions or session', () => {
    const trace = createValidBaseTrace();
    trace.session.experimentId = '';
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(false);
    const check = result.checks.find((c) => c.check === 'correlation_identifiers');
    expect(check?.passed).toBe(false);
  });

  it('fails when completed task lacks intermediate step events', () => {
    const trace = createValidBaseTrace();
    // Remove step T2-2
    trace.taskEvents = trace.taskEvents.filter((e) => e.taskStepId !== 'T2-2');
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(false);
    const check = result.checks.find((c) => c.check === 'task_lifecycle_completeness');
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain('T2-2');
  });

  it('fails when a microTensor window outlives its settlement allowance with no outcome record', () => {
    const trace = createValidBaseTrace();
    // Window 1 ends at 600 and is labelled. This window is 5 s further back, which is past the
    // verifier's settlement allowance for a window to be labelled — `lookahead (1500) + grace
    // (2000) + tolerance (500)` = 4000 ms, measured from the newest window in the trace.
    // Windows still inside that allowance are in flight, not missing; counting them as
    // failures is what made the verifier reject every real capture (F-13).
    trace.microTensors.push({
      windowId: 0,
      windowStart: -5000,
      windowEnd: -4400,
      values: new Array(18).fill(0.2)
    });
    // outcomes only has windowId 1
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(false);
    const check = result.checks.find((c) => c.check === 'window_outcome_completeness');
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain('windowId');
  });

  it('accepts a window still inside its settlement allowance as in flight, not orphaned', () => {
    const trace = createValidBaseTrace();
    // 500 ms behind the newest window: within the allowance, so it is legitimately awaiting
    // its outcome rather than missing. Every live session has windows in this state.
    trace.microTensors.push({
      windowId: 2,
      windowStart: 600,
      windowEnd: 1100,
      values: new Array(18).fill(0.2)
    });

    const result = verifyTraceCompleteness(trace);
    const check = result.checks.find((c) => c.check === 'window_outcome_completeness');
    expect(check?.passed).toBe(true);
    expect(check?.message).toContain('settlement allowance');
  });

  it('fails when intervention episode is applied without terminal state', () => {
    const trace = createValidBaseTrace();
    trace.session.conditionId = 'adaptive';
    trace.metadata.conditionId = 'adaptive';
    trace.interventions = [
      {
        timestamp: 200,
        type: 'applied',
        intervention: 'expand_tooltip',
        source: 'slow',
        interventionEpisodeId: 'ep-001',
        sessionId: 'sess-001',
        conditionId: 'adaptive'
      }
    ];
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(false);
    const check = result.checks.find((c) => c.check === 'intervention_terminal_states');
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain('ep-001');
  });

  it('fails when baseline condition contains applied intervention events', () => {
    const trace = createValidBaseTrace();
    trace.session.conditionId = 'baseline';
    trace.metadata.conditionId = 'baseline';
    trace.interventions = [
      {
        timestamp: 200,
        type: 'applied',
        intervention: 'expand_tooltip',
        source: 'slow',
        interventionEpisodeId: 'ep-001',
        sessionId: 'sess-001',
        conditionId: 'baseline'
      },
      {
        timestamp: 500,
        type: 'reverted',
        intervention: 'expand_tooltip',
        source: 'slow',
        interventionEpisodeId: 'ep-001',
        sessionId: 'sess-001',
        conditionId: 'baseline'
      }
    ];
    const result = verifyTraceCompleteness(trace);
    expect(result.valid).toBe(false);
    const check = result.checks.find((c) => c.check === 'baseline_zero_mutations');
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain('actuator mutations forbidden in baseline');
  });
});
