/**
 * Adaptive Runtime Integration
 *
 * This is the test the assessment (§18.3) identified as missing: it assembles the
 * real production composition (observer → rolling window → macro stream → outcome
 * deriver → worker client → policy → actuator → recorder) instead of hand-building
 * collaborators, and asserts that a real interaction produces real telemetry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { experimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { taskManager } from '../src/testbed/tasks/taskManager';
import { debugBus } from '../src/debug/debugBus';

/** Polls until `predicate` holds or the timeout elapses. Avoids fixed sleeps that are
 * flaky when the whole suite competes for CPU. */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 8000, intervalMs = 25, label = 'condition' } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

function renderAnnotatedDom(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-aui-route', 'Analytics');
  root.innerHTML = `
    <button data-aui-component="nav-Analytics" data-aui-role="navigation" data-aui-action="click">Analytics</button>
    <form data-aui-component="filter-drawer" data-aui-role="filter">
      <button type="button" data-aui-component="filter-Region" data-aui-role="accordion" aria-expanded="false">Region</button>
      <select data-aui-component="filter-Region-select" data-aui-role="filter" data-aui-action="change">
        <option>Europe</option>
      </select>
      <button type="submit" data-aui-component="btn-apply-filters" data-aui-role="submit-action" data-aui-action="click">Apply</button>
    </form>
    <button data-aui-component="btn-export" data-aui-role="primary-action" data-aui-action="click">Export</button>
  `;
  document.body.appendChild(root);
  return root;
}

describe('AdaptiveRuntime composition', () => {
  let runtime: AdaptiveRuntime;

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

  it('starts, establishes a session, and reports running status', async () => {
    runtime = new AdaptiveRuntime({ experimentId: 'exp_test', conditionId: 'adaptive' });
    await runtime.start();

    const status = runtime.getStatus();
    expect(status.running).toBe(true);
    expect(status.sessionId).toBeTruthy();
    expect(status.experimentId).toBe('exp_test');
    expect(status.conditionId).toBe('adaptive');

    // The recorder is bound to the session that produced the trace.
    expect(experimentRecorder.getSessionId()).toBe(status.sessionId);
    expect(experimentRecorder.getExperimentId()).toBe('exp_test');
    expect(experimentRecorder.getConditionId()).toBe('adaptive');
  });

  it('records raw behaviour events from real DOM interaction', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({ forceInProcessWorker: true });
    await runtime.start();

    const regionAccordion = document.querySelector('[data-aui-component="filter-Region"]') as HTMLElement;
    regionAccordion.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
    regionAccordion.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 30 }));

    const counts = experimentRecorder.getEventCounts();
    expect(counts.behaviourEvents).toBeGreaterThan(0);

    // Geometry is captured on the event so extraction never needs a constant fallback.
    const trace = experimentRecorder.export();
    const pointerEvent = trace.behaviourEvents.find((e) => e.type === 'mousemove');
    expect(pointerEvent?.viewport).toBeDefined();
    expect(pointerEvent?.document).toBeDefined();
  });

  it('produces MicroTensor windows, macro interactions, and outcomes from a live stream', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({ forceInProcessWorker: true });
    await runtime.start();

    // Simulate ~2.5s of interaction: pointer activity, an accordion open, a change,
    // a click, and scrolling.
    const start = performance.now();
    for (let i = 0; i < 60; i++) {
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 100 + i * 3, clientY: 100 + (i % 7) * 5 })
      );
      if (i % 10 === 0) {
        window.dispatchEvent(new Event('scroll'));
      }
      await new Promise((r) => setTimeout(r, 40));
    }

    const regionAccordion = document.querySelector('[data-aui-component="filter-Region"]') as HTMLElement;
    regionAccordion.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 30, clientY: 30 }));
    regionAccordion.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 30 }));

    const regionSelect = document.querySelector('[data-aui-component="filter-Region-select"]') as HTMLSelectElement;
    regionSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Allow the monotonic tick loop to close windows.
    await waitFor(
      () => {
        const c = experimentRecorder.getEventCounts();
        return c.microTensors > 0 && c.outcomes > 0 && c.macroInteractions > 0;
      },
      { label: 'windows, outcomes and macro interactions' }
    );

    const counts = experimentRecorder.getEventCounts();
    expect(counts.behaviourEvents).toBeGreaterThan(10);
    expect(counts.microTensors).toBeGreaterThan(0);
    expect(counts.outcomes).toBeGreaterThan(0);
    expect(counts.macroInteractions).toBeGreaterThan(0);

    // Every window carries a correlation id and an 18-element tensor.
    const trace = experimentRecorder.export();
    for (const window of trace.microTensors) {
      expect(typeof window.windowId).toBe('number');
      expect(window.values.length).toBe(18);
    }

    // Every outcome is attributable to a window.
    for (const outcome of trace.outcomes) {
      expect(typeof outcome.windowId).toBe('number');
    }

    // Macro interactions are stamped with session and window context.
    const macro = trace.macroInteractions[0];
    expect(macro.sessionId).toBeTruthy();
    expect(macro.windowId).toBeDefined();

    // Elapsed time should be plausible (guards the performance.now/Date.now clock fix).
    const exported = experimentRecorder.exportSerializable();
    expect(exported.metadata.durationMs).toBeGreaterThan(0);
    expect(exported.metadata.durationMs).toBeLessThan(60_000);
    expect(performance.now() - start).toBeGreaterThan(0);
  });

  it('runs the baseline condition with telemetry intact and no DOM adaptation', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({
      conditionId: 'baseline',
      forceInProcessWorker: true,
      // A pattern that would fire the Fast Gate if adaptation were permitted.
      fastGatePatterns: { 'NAV_ANALYTICS': 'highlight_primary_action' }
    });
    await runtime.start();

    const root = document.querySelector('div[data-aui-route]') as HTMLElement;

    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 50 + i * 4, clientY: 60 })
      );
      await new Promise((r) => setTimeout(r, 40));
    }
    const nav = document.querySelector('[data-aui-component="nav-Analytics"]') as HTMLElement;
    nav.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }));
    nav.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));

    await waitFor(
      () => experimentRecorder.getEventCounts().microTensors > 0,
      { label: 'baseline telemetry' }
    );

    // Telemetry still collected in the baseline condition...
    const counts = experimentRecorder.getEventCounts();
    expect(counts.behaviourEvents).toBeGreaterThan(0);
    expect(counts.microTensors).toBeGreaterThan(0);

    // ...but the DOM was never adapted.
    expect(runtime.getStatus().interventionsApplied).toBe(0);
    expect(root.querySelectorAll('.edge-aui-highlight, .edge-aui-assistance-banner').length).toBe(0);
  });

  it('resets per-trial state without tearing down the session', async () => {
    runtime = new AdaptiveRuntime({ forceInProcessWorker: true, experimentId: 'exp_reset' });
    await runtime.start();

    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10 + i, clientY: 10 }));
      await new Promise((r) => setTimeout(r, 40));
    }
    await waitFor(() => runtime.getStatus().windowsEmitted > 0, { label: 'windows before reset' });

    const sessionBefore = runtime.getStatus().sessionId;
    await runtime.resetTrial();

    const status = runtime.getStatus();
    expect(status.windowsEmitted).toBe(0);
    expect(status.macroInteractions).toBe(0);
    expect(status.sessionId).toBe(sessionBefore);
  });

  it('stops cleanly and detaches all listeners', async () => {
    runtime = new AdaptiveRuntime({ forceInProcessWorker: true });
    await runtime.start();
    expect(runtime.isRunning()).toBe(true);

    runtime.stop();
    expect(runtime.isRunning()).toBe(false);

    // After stop, further DOM activity must not be recorded.
    experimentRecorder.clear();
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 200 }));
    expect(experimentRecorder.getEventCounts().behaviourEvents).toBe(0);
  });
});
