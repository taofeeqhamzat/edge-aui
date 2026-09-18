import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionManager,
  generateAnonymousSessionId
} from '../src/telemetry/session';
import {
  ExperimentRecorder,
  ExperimentTrace,
  validateExperimentTrace
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
    expect(counts.total).toBe(0);
  });

  it('validates serializable traces against ExperimentTrace schema', () => {
    recorder.recordBehaviourEvent({ timestamp: 100, type: 'click', x: 0.2, y: 0.3 });
    recorder.recordMicroTensor({
      windowStart: 0,
      windowEnd: 500,
      values: new Float32Array(18).fill(0.1)
    });

    const serializable = recorder.exportSerializable();
    const validation = validateExperimentTrace(serializable);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(serializable.schemaVersion).toBe('1.0.0');
    expect(serializable.metadata.totalEvents).toBe(2);
  });

  it('flags invalid traces during validation', () => {
    const invalidTrace = {
      schemaVersion: '0.9.0',
      exportedAt: 'invalid-date',
      session: { sessionId: '' },
      microTensors: [{ windowStart: 0, windowEnd: 500, values: [1, 2, 3] }] // wrong length
    };

    const validation = validateExperimentTrace(invalidTrace);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.includes('Invalid schemaVersion'))).toBe(true);
    expect(validation.errors.some((e) => e.includes('18-element numeric array'))).toBe(true);
  });

  it('reconstructs an ordered, chronological replay stream from mixed events', () => {
    recorder.recordIntervention({ timestamp: 300, type: 'applied', intervention: 'no_op', source: 'fast' });
    recorder.recordBehaviourEvent({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });
    recorder.recordOutcome({ timestamp: 400, outcome: 'CLICK' });
    recorder.recordMacroInteraction({ timestamp: 200, symbol: 'NAV_CLICK' });

    const stream = recorder.getReplayStream();
    expect(stream).toHaveLength(4);
    expect(stream.map((s) => s.timestamp)).toEqual([100, 200, 300, 400]);
    expect(stream.map((s) => s.category)).toEqual(['behaviour', 'macro', 'intervention', 'outcome']);
  });

  it('executes downloadTraceAsJSON cleanly in simulated DOM environment', () => {
    let clickCalled = false;
    const origCreateElement = document.createElement.bind(document);
    const origAppendChild = document.body.appendChild.bind(document.body);
    const origRemoveChild = document.body.removeChild.bind(document.body);

    const mockAnchor = origCreateElement('a');
    mockAnchor.click = () => {
      clickCalled = true;
    };

    const createElementSpy = (tagName: string) => {
      if (tagName === 'a') return mockAnchor;
      return origCreateElement(tagName);
    };

    document.createElement = createElementSpy as any;
    global.URL.createObjectURL = () => 'blob:test';
    global.URL.revokeObjectURL = () => {};

    try {
      recorder.recordBehaviourEvent({ timestamp: 50, type: 'click' });
      recorder.downloadTraceAsJSON('test-trace.json');
      expect(clickCalled).toBe(true);
      expect(mockAnchor.download).toBe('test-trace.json');
    } finally {
      document.createElement = origCreateElement;
      document.body.appendChild = origAppendChild;
      document.body.removeChild = origRemoveChild;
    }
  });
});
