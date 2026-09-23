/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdaptiveInferenceEngine } from '../src/gates/arbitration';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { InterventionPolicy } from '../src/intervention/policy';
import { UIActuator } from '../src/intervention/actuator';
import { ExperimentRecorder, validateExperimentTrace } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { taskManager } from '../src/testbed/tasks/taskManager';
import { UIContext } from '../src/types/uiContext';
import { MacroInteraction, BehaviourEvent } from '../src/telemetry/events';

describe('Task 11.3: End-to-End Simulation & Dual-Gate Arbitration Integration', () => {
  let rootEl: HTMLElement;
  let fastGate: MockFastGate;
  let slowGate: MockSlowGate;
  let engine: AdaptiveInferenceEngine;
  let policy: InterventionPolicy;
  let actuator: UIActuator;
  let recorder: ExperimentRecorder;

  const mockUiContext: UIContext = {
    route: 'Analytics',
    activeComponentId: 'filter-Region',
    componentRole: 'accordion',
    taskId: 'T1',
    taskStepId: 'T1-2',
    availableActions: ['click', 'change'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true
  };

  beforeEach(() => {
    // Setup test DOM container
    document.body.innerHTML = '';
    rootEl = document.createElement('div');
    rootEl.setAttribute('data-aui-route', 'Analytics');
    rootEl.innerHTML = `
      <div data-aui-component="filter-drawer">
        <button data-aui-component="filter-Region" data-aui-role="accordion" aria-expanded="false">
          Region
        </button>
        <button data-aui-component="btn-apply-filters" data-aui-role="primary-action">
          Apply Filters
        </button>
        <span data-aui-component="tooltip-help" data-aui-role="tooltip" title="Region selection help">
          Help
        </span>
      </div>
    `;
    document.body.appendChild(rootEl);

    // Initialize pipeline modules
    sessionManager.resetSession();
    sessionManager.startSession('T1');
    taskManager.resetTask();
    taskManager.startTask('T1');

    fastGate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTER > APPLY_FILTER': {
          type: 'highlight_primary_action',
          targetComponentId: 'btn-apply-filters',
          confidence: 1.0,
          reason: 'User following standard filter application sequence'
        }
      }
    });

    slowGate = new MockSlowGate({
      outcome: 'HOVER_DWELL',
      intervention: {
        type: 'expand_tooltip',
        targetComponentId: 'tooltip-help',
        confidence: 0.88,
        reason: 'Prolonged hesitation detected over region filter'
      },
      confidence: 0.88
    });

    engine = new AdaptiveInferenceEngine({
      fastGate,
      slowGate,
      enableFastGate: true,
      enableSlowGate: true
    });

    policy = new InterventionPolicy({
      confidenceThreshold: 0.75,
      requiredConsecutiveWindows: 2,
      enforceContextEligibility: true
    });

    actuator = new UIActuator({ root: rootEl });
    recorder = new ExperimentRecorder();
    recorder.clear();

    // Wire actuator events to recorder
    actuator.onInterventionEvent((event) => {
      recorder.recordIntervention(event);
    });
  });

  afterEach(() => {
    actuator.reset();
    recorder.clear();
    taskManager.resetTask();
    sessionManager.resetSession();
    document.body.innerHTML = '';
  });

  it('verifies Fast Gate match short-circuits Slow Gate execution (ADR-002)', async () => {
    const slowGateSpy = vi.spyOn(slowGate, 'infer');

    const matchingSequence: MacroInteraction[] = [
      { timestamp: 100, symbol: 'NAV_ANALYTICS' },
      { timestamp: 250, symbol: 'OPEN_FILTER' },
      { timestamp: 400, symbol: 'APPLY_FILTER' }
    ];

    const dummyMicroTensor = new Float32Array(8 * 18).fill(0.1);

    const result = await engine.evaluate({
      macroSequence: matchingSequence,
      microTensorSequence: dummyMicroTensor,
      tensorShape: [1, 8, 18],
      uiContext: mockUiContext
    });

    // 1. Assert Fast Gate matched
    expect(result.matchedGate).toBe('fast');
    expect(result.intervention?.type).toBe('highlight_primary_action');
    expect(result.intervention?.source).toBe('fast');

    // 2. Assert Slow Gate was strictly short-circuited
    expect(slowGateSpy).not.toHaveBeenCalled();

    // 3. Evaluate through consecutive window policy
    const decision1 = policy.accept(result.intervention!, mockUiContext);
    expect(decision1.accepted).toBe(false); // Window 1: transient suppression

    const decision2 = policy.accept(result.intervention!, mockUiContext);
    expect(decision2.accepted).toBe(true); // Window 2: accepted

    // 4. Apply via Actuator
    actuator.apply(decision2.command);
    const primaryBtn = rootEl.querySelector('[data-aui-component="btn-apply-filters"]');
    expect(primaryBtn?.classList.contains('edge-aui-highlight')).toBe(true);
  });

  it('verifies Fast Gate miss invokes Slow Gate with MicroTensor sequence', async () => {
    const slowGateSpy = vi.spyOn(slowGate, 'infer');

    const nonMatchingSequence: MacroInteraction[] = [
      { timestamp: 100, symbol: 'RANDOM_ACTION' },
      { timestamp: 250, symbol: 'UNKNOWN_STEP' }
    ];

    const microTensorSequence = new Float32Array(8 * 18).fill(0.2);

    const result = await engine.evaluate({
      macroSequence: nonMatchingSequence,
      microTensorSequence,
      tensorShape: [1, 8, 18],
      uiContext: mockUiContext
    });

    // 1. Fast Gate returned miss
    expect(result.fastDecision.matched).toBe(false);

    // 2. Slow Gate was invoked
    expect(slowGateSpy).toHaveBeenCalledTimes(1);
    expect(result.matchedGate).toBe('slow');
    expect(result.slowResult?.outcome).toBe('HOVER_DWELL');
    expect(result.intervention?.type).toBe('expand_tooltip');
    expect(result.intervention?.source).toBe('slow');
  });

  it('verifies consecutive window policy suppresses single-window spikes and accepts sustained patterns', () => {
    const candidateIntervention = {
      type: 'offer_assistance' as const,
      source: 'slow' as const,
      confidence: 0.9,
      issuedAt: Date.now(),
      reason: 'Persistent motor hesitation detected'
    };

    // Window 1: Single window spike
    const decision1 = policy.accept(candidateIntervention, mockUiContext);
    expect(decision1.accepted).toBe(false);
    expect(decision1.command.type).toBe('no_op');

    actuator.apply(decision1.command);
    expect(document.querySelector('.edge-aui-assistance-banner')).toBeNull();

    // Window 2: Sustained pattern in next consecutive window
    const decision2 = policy.accept(candidateIntervention, mockUiContext);
    expect(decision2.accepted).toBe(true);
    expect(decision2.command.type).toBe('offer_assistance');

    actuator.apply(decision2.command);
    expect(document.querySelector('.edge-aui-assistance-banner')).not.toBeNull();
  });

  it('verifies UIActuator non-destructive application and complete reversal on task reset', () => {
    const highlightCmd = {
      type: 'highlight_primary_action' as const,
      source: 'fast' as const,
      targetComponentId: 'btn-apply-filters',
      issuedAt: Date.now()
    };
    const assistanceCmd = {
      type: 'offer_assistance' as const,
      source: 'slow' as const,
      reason: 'Need guidance?',
      issuedAt: Date.now()
    };

    actuator.apply(highlightCmd);
    actuator.apply(assistanceCmd);

    const primaryBtn = rootEl.querySelector('[data-aui-component="btn-apply-filters"]');
    expect(primaryBtn?.classList.contains('edge-aui-highlight')).toBe(true);
    expect(document.querySelector('.edge-aui-assistance-banner')).not.toBeNull();

    // Trigger complete reset (e.g. user finishes task or resets)
    actuator.reset();

    expect(primaryBtn?.classList.contains('edge-aui-highlight')).toBe(false);
    expect(document.querySelector('.edge-aui-assistance-banner')).toBeNull();
    expect(actuator.getActiveInterventions()).toHaveLength(0);
  });

  it('records full chronological experiment trace and validates schema compliance for replay', () => {
    // Record chronological events
    recorder.recordBehaviourEvent({ timestamp: 100, type: 'mousemove', x: 0.1, y: 0.1 });
    recorder.recordBehaviourEvent({ timestamp: 200, type: 'click', componentId: 'filter-Region' });
    recorder.recordMicroTensor({
      windowId: 0,
      windowStart: 0,
      windowEnd: 500,
      values: new Float32Array(18).fill(0.15)
    });
    recorder.recordMacroInteraction({ timestamp: 205, symbol: 'OPEN_FILTER', componentId: 'filter-Region' });
    recorder.recordOutcome({ timestamp: 400, outcome: 'HOVER_DWELL', windowId: 0, componentId: 'filter-Region' });
    recorder.recordPrediction({
      timestamp: 300,
      windowId: 0,
      matchedGate: 'slow',
      outcome: 'HOVER_DWELL',
      latencyMs: 1.2,
      bothGatesEvaluated: false
    });
    recorder.recordIntervention({
      timestamp: 450,
      type: 'applied',
      intervention: 'offer_assistance',
      source: 'slow',
      confidence: 0.88
    });

    const counts = recorder.getEventCounts();
    expect(counts.total).toBe(7);

    // Export serializable trace
    const trace = recorder.exportSerializable();

    // Validate schema
    const validation = validateExperimentTrace(trace);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Validate replay stream order
    const replayStream = recorder.getReplayStream();
    expect(replayStream).toHaveLength(6); // 2 behaviour + 1 macro + 1 prediction + 1 outcome + 1 intervention
    expect(replayStream.map((s) => s.timestamp)).toEqual([100, 200, 205, 300, 400, 450]);
  });
});
