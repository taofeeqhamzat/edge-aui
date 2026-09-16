import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionManager,
  generateAnonymousSessionId
} from '../src/telemetry/session';
import {
  ExperimentRecorder,
  ExperimentTrace
} from '../src/telemetry/recorder';
import type {
  BehaviourEvent,
  MicroTensorWindow,
  MacroInteraction,
  OutcomeEvent,
  InterventionEvent
} from '../src/telemetry/events';

describe('telemetry/session', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  it('generates valid anonymous UUID v4 strings without PII', () => {
    const id1 = generateAnonymousSessionId();
    const id2 = generateAnonymousSessionId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('manages session lifecycle: start, get, completeTask, and reset', () => {
    expect(sessionManager.isSessionActive()).toBe(false);
    expect(sessionManager.getActiveSession()).toBeNull();

    const session = sessionManager.startSession('T1');
    expect(sessionManager.isSessionActive()).toBe(true);
    expect(session.taskId).toBe('T1');
    expect(session.sessionId).toBeDefined();
    expect(session.startedAt).toBeGreaterThanOrEqual(0);

    sessionManager.completeTask('T2');
    expect(sessionManager.getActiveSession()?.taskId).toBe('T2');

    sessionManager.resetSession();
    expect(sessionManager.isSessionActive()).toBe(false);
    expect(sessionManager.getActiveSession()).toBeNull();
  });

  it('notifies subscribers on session state transitions', () => {
    const states: (string | null)[] = [];
    sessionManager.onSessionChange((sess) => {
      states.push(sess ? sess.sessionId : null);
    });

    const s = sessionManager.startSession();
    sessionManager.resetSession();

    expect(states.length).toBe(2);
    expect(states[0]).toBe(s.sessionId);
    expect(states[1]).toBeNull();
  });
});

describe('telemetry/recorder', () => {
  let recorder: ExperimentRecorder;

  beforeEach(() => {
    recorder = new ExperimentRecorder({ maxBufferSize: 10 });
    recorder.clear();
  });

  it('records chronological BehaviourEvents, MicroTensors, MacroInteractions, Outcomes, and Interventions', () => {
    const bEvent: BehaviourEvent = {
      timestamp: 100,
      type: 'click',
      x: 0.5,
      y: 0.5,
      componentId: 'btn-apply'
    };
    recorder.recordBehaviourEvent(bEvent);

    const mWindow: MicroTensorWindow = {
      windowStart: 0,
      windowEnd: 500,
      values: new Float32Array(18).fill(0.25)
    };
    recorder.recordMicroTensor(mWindow);

    const macro: MacroInteraction = {
      timestamp: 150,
      symbol: 'APPLY_FILTER',
      componentId: 'btn-apply'
    };
    recorder.recordMacroInteraction(macro);

    const outcome: OutcomeEvent = {
      timestamp: 200,
      outcome: 'CLICK',
      componentId: 'btn-apply'
    };
    recorder.recordOutcome(outcome);

    const intervention: InterventionEvent = {
      timestamp: 250,
      type: 'applied',
      intervention: 'highlight_primary_action',
      source: 'fast'
    };
    recorder.recordIntervention(intervention);

    const counts = recorder.getEventCounts();
    expect(counts.behaviourEvents).toBe(1);
    expect(counts.microTensors).toBe(1);
    expect(counts.macroInteractions).toBe(1);
    expect(counts.outcomes).toBe(1);
    expect(counts.interventions).toBe(1);

    const trace: ExperimentTrace = recorder.export();
    expect(trace.behaviourEvents.length).toBe(1);
    expect(trace.microTensors.length).toBe(1);
    expect(trace.macroInteractions.length).toBe(1);
    expect(trace.outcomes.length).toBe(1);
    expect(trace.interventions.length).toBe(1);
  });

  it('serializes Float32Array values properly in JSON export', () => {
    const mWindow: MicroTensorWindow = {
      windowStart: 100,
      windowEnd: 600,
      values: new Float32Array([1.5, 2.5, 3.5])
    };
    recorder.recordMicroTensor(mWindow);

    const json = recorder.exportJSON();
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed.microTensors)).toBe(true);
    expect(parsed.microTensors[0].values).toEqual([1.5, 2.5, 3.5]);
  });

  it('enforces maximum buffer size via FIFO eviction to bound memory usage', () => {
    for (let i = 0; i < 15; i++) {
      recorder.recordBehaviourEvent({
        timestamp: i,
        type: 'mousemove',
        x: i / 15,
        y: i / 15
      });
    }

    const counts = recorder.getEventCounts();
    expect(counts.behaviourEvents).toBe(10);

    const trace = recorder.export();
    // Oldest 5 events (0..4) should have been evicted; earliest remaining should be timestamp 5
    expect(trace.behaviourEvents[0].timestamp).toBe(5);
    expect(trace.behaviourEvents[9].timestamp).toBe(14);
  });

  it('clears all recorded buffers on clear()', () => {
    recorder.recordBehaviourEvent({ timestamp: 1, type: 'click' });
    recorder.recordOutcome({ timestamp: 2, outcome: 'CLICK' });

    recorder.clear();
    const counts = recorder.getEventCounts();
    expect(counts.behaviourEvents).toBe(0);
    expect(counts.outcomes).toBe(0);
  });
});
