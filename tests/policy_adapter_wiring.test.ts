/**
 * Application Candidate Resolution Wiring (Task 20.1)
 *
 * Proves the boundary in both directions:
 * - the testbed policy adapter maps a predicted outcome to a declared adaptation, and
 *   refuses outcomes it does not know;
 * - the runtime hands the normalized prediction to the policy, so an adaptation is applied
 *   because of a *predicted outcome*, not because a gate emitted a command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { experimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { taskManager } from '../src/testbed/tasks/taskManager';
import { debugBus } from '../src/debug/debugBus';
import {
  createTestbedCandidateResolver,
  TESTBED_OUTCOME_INTERVENTIONS
} from '../src/testbed/config/policyAdapter';
import { PREDICTION_CONTRACT_VERSION, type PredictionResult } from '../src/gates/contracts';
import type { UIContext } from '../src/types/uiContext';
import { setTrackedUIElement } from '../src/telemetry/contextProvider';

const UI_CONTEXT: UIContext = {
  route: 'Analytics',
  activeComponentId: 'filter-drawer',
  availableActions: ['click'],
  primaryActionAvailable: true,
  helpAvailable: true,
  expandable: true
};

function prediction(overrides: Partial<PredictionResult> = {}): PredictionResult {
  return {
    predictionId: 'pred_testbed',
    outcomeId: 'HOVER_DWELL',
    vocabularyVersion: 'foundation-7-class/1.0.0',
    confidence: 0.9,
    matched: true,
    source: 'slow',
    timestamp: 1700000000000,
    contractVersion: PREDICTION_CONTRACT_VERSION,
    target: { componentId: 'filter-drawer', route: 'Analytics' },
    ...overrides
  };
}

describe('testbed candidate resolver', () => {
  it('maps a declared foundation outcome to its adaptation', () => {
    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(prediction(), UI_CONTEXT);

    expect(TESTBED_OUTCOME_INTERVENTIONS.HOVER_DWELL).toBe('expand_tooltip');
    expect(command?.type).toBe('expand_tooltip');
    expect(command?.targetComponentId).toBe('filter-drawer');
    expect(command?.confidence).toBeCloseTo(0.9);
    expect(command?.reason).toContain('HOVER_DWELL');
  });

  it('keeps the intervention vocabulary resolvable as an outcome vocabulary', () => {
    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(
      prediction({ outcomeId: 'highlight_primary_action', source: 'fast' }),
      UI_CONTEXT
    );
    expect(command?.type).toBe('highlight_primary_action');
    expect(command?.source).toBe('fast');
  });

  it('refuses an outcome it has no mapping for instead of guessing', () => {
    const resolver = createTestbedCandidateResolver();
    expect(resolver.resolve(prediction({ outcomeId: 'select_region' }), UI_CONTEXT)).toBeNull();
  });
});

describe('runtime actuation through the prediction contract', () => {
  let runtime: AdaptiveRuntime;

  async function waitFor(
    predicate: () => boolean,
    { timeoutMs = 15000, intervalMs = 25, label = 'condition' } = {}
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
  }

  function renderAnnotatedDom(): void {
    const root = document.createElement('div');
    root.setAttribute('data-aui-route', 'Analytics');
    root.innerHTML = `
      <button data-aui-component="nav-Analytics" data-aui-role="navigation" data-aui-action="click">Analytics</button>
      <button data-aui-component="btn-export" data-aui-role="primary-action" data-aui-action="click">Export</button>
      <div data-aui-component="tooltip-region" data-aui-role="tooltip" data-aui-action="hover" title="Geographical sales region">Region help</div>
    `;
    document.body.appendChild(root);
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    experimentRecorder.clear();
    sessionManager.resetSession();
    taskManager.resetTask();
    debugBus.reset();
  });

  afterEach(() => {
    runtime?.stop();
    document.body.innerHTML = '';
  });

  it('applies an adaptation produced by resolving the predicted outcome', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      conditionId: 'adaptive',
      // One window of persistence keeps the test fast; the policy rules themselves are
      // covered by tests/intervention_policy.test.ts.
      policyConfig: { requiredConsecutiveWindows: 1, confidenceThreshold: 0.5, cooldownMs: 0 },
      // Exactly what src/testbed/config/policyAdapter.ts supplies to the composition root.
      candidateResolver: createTestbedCandidateResolver()
    });
    await runtime.start();

    // The prediction that reaches the policy must name the element the adaptation acts on.
    // `HOVER_DWELL` maps to `expand_tooltip`, whose target is the inspected tooltip, so the
    // tracker has to see the tooltip before the evaluation window closes.
    const tooltip = document.querySelector('[data-aui-component="tooltip-region"]')!;
    setTrackedUIElement(tooltip);

    const started = Date.now();
    while (Date.now() - started < 3000) {
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 80 })
      );
      await new Promise((r) => setTimeout(r, 40));
    }

    await waitFor(() => runtime.getStatus().predictionsRecorded > 0, {
      label: 'a recorded prediction'
    });
    await waitFor(() => runtime.getStatus().interventionsApplied > 0, {
      label: 'an applied adaptation'
    });

    const trace = experimentRecorder.export();
    const applied = trace.interventions.filter((event) => event.type === 'applied');
    expect(applied.length).toBeGreaterThan(0);
    // The applied adaptation is attributable to the prediction that caused it.
    const policyDecision = trace.policyDecisions.find((d) => d.accepted);
    expect(policyDecision?.predictionId).toBeTruthy();
    expect(trace.predictions.some((p) => p.predictionId === policyDecision!.predictionId)).toBe(true);
  }, 30000);

  it('records a decision, and opens no episode, when the outcome has no mapped adaptation', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      conditionId: 'adaptive',
      policyConfig: { requiredConsecutiveWindows: 1, confidenceThreshold: 0.5, cooldownMs: 0 },
      // Every predicted outcome is refused, which is the "predicted, no adaptation
      // warranted" case. Nothing may be applied, and nothing may claim to be.
      candidateResolver: { resolve: () => null }
    });
    await runtime.start();

    const started = Date.now();
    while (Date.now() - started < 3000) {
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 80 })
      );
      await new Promise((r) => setTimeout(r, 40));
    }

    await waitFor(() => experimentRecorder.getEventCounts().policyDecisions > 0, {
      label: 'a recorded policy decision'
    });

    const trace = experimentRecorder.export();
    expect(runtime.getStatus().interventionsApplied).toBe(0);
    expect(trace.interventions.filter((event) => event.type === 'applied')).toHaveLength(0);
    const decisions = trace.policyDecisions.filter((d) => d.policyDecision === 'decision_only');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0].accepted).toBe(true);
    expect(decisions[0].policyReason).toContain('no adaptation engaged');
  }, 30000);

  it('decides but never applies an adaptation in the baseline condition', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      conditionId: 'baseline',
      policyConfig: { requiredConsecutiveWindows: 1, confidenceThreshold: 0.5, cooldownMs: 0 },
      candidateResolver: createTestbedCandidateResolver()
    });
    await runtime.start();

    const tooltip = document.querySelector('[data-aui-component="tooltip-region"]')!;
    setTrackedUIElement(tooltip);

    const started = Date.now();
    while (Date.now() - started < 3000) {
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 80 })
      );
      await new Promise((r) => setTimeout(r, 40));
    }

    await waitFor(
      () =>
        experimentRecorder
          .export()
          .policyDecisions.some((d) => d.rejectionCategory === 'baseline_condition'),
      { label: 'a baseline decision-only policy record' }
    );

    const trace = experimentRecorder.export();
    const decided = trace.policyDecisions.filter(
      (d) => d.rejectionCategory === 'baseline_condition'
    );
    expect(decided.length).toBeGreaterThan(0);
    expect(decided[0].accepted).toBe(true);
    expect(decided[0].policyReason).toContain('baseline condition');
    // The decision named a candidate; the interface never changed.
    expect(decided[0].candidate).toBe('expand_tooltip');
    expect(runtime.getStatus().interventionsApplied).toBe(0);
    expect(trace.interventions.filter((event) => event.type === 'applied')).toHaveLength(0);
    expect(document.querySelectorAll('[data-aui-active-adaptation]').length).toBe(0);
  }, 30000);
});
