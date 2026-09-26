/**
 * Runtime Stage Instrumentation Contract Tests
 * Implements Task 3.2 specifications from docs/plan/1/tasks/3.2.md.
 *
 * Verifies that:
 * 1. Every stage named in brief §4 A2 emits at least one record under a driven pipeline run.
 * 2. Every emitted record carries one of the 5 permitted side labels ('main', 'worker', 'wasm', 'model', 'transfer').
 * 3. Records with missing or invalid stage/side labels cannot be constructed.
 * 4. Event-capture instrumentation cost stays bounded below one window stride under high-frequency stream.
 * 5. Instrumentation can be cleanly disabled via configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import {
  PERMITTED_STAGES,
  PERMITTED_SIDES,
  StageName,
  ThreadSide,
  createTimingRecord,
  InstrumentationCollector,
  defaultCollector
} from '../src/runtime/instrumentation';
import { experimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { taskManager } from '../src/testbed/tasks/taskManager';

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

function renderTestDom(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-aui-route', 'Analytics');
  root.innerHTML = `
    <button data-aui-component="nav-Analytics" data-aui-role="navigation" data-aui-action="click">Analytics</button>
    <form data-aui-component="filter-drawer" data-aui-role="filter">
      <button type="button" data-aui-component="filter-Region" data-aui-role="accordion" aria-expanded="false">Region</button>
      <button type="submit" data-aui-component="btn-apply-filters" data-aui-role="submit-action" data-aui-action="click">Apply</button>
    </form>
    <button data-aui-component="btn-export" data-aui-role="primary-action" data-aui-action="click">Export</button>
  `;
  document.body.appendChild(root);
  return root;
}

describe('Runtime Stage Instrumentation Contract', () => {
  let runtime: AdaptiveRuntime;

  beforeEach(() => {
    document.body.innerHTML = '';
    experimentRecorder.clear();
    sessionManager.resetSession();
    taskManager.resetTask();
    defaultCollector.clear();
    defaultCollector.setEnabled(true);
  });

  afterEach(() => {
    runtime?.stop();
    document.body.innerHTML = '';
    defaultCollector.clear();
  });

  describe('Contract validation & Construction guards', () => {
    it('creates a valid record with permitted stage and side', () => {
      const rec = createTimingRecord('event capture', 'main', 1.25, 1000, {
        sessionId: 'test_session',
        windowId: 1
      });
      expect(rec.stage).toBe('event capture');
      expect(rec.side).toBe('main');
      expect(rec.durationMs).toBe(1.25);
      expect(rec.timestamp).toBe(1000);
      expect(rec.sessionId).toBe('test_session');
      expect(rec.windowId).toBe(1);
    });

    it('rejects an invalid or unknown stage name', () => {
      expect(() => {
        createTimingRecord('unregistered stage' as StageName, 'main', 1.0, 1000);
      }).toThrow(/Invalid stage name/);
    });

    it('rejects an invalid or unknown thread side', () => {
      expect(() => {
        createTimingRecord('event capture', 'gpu' as ThreadSide, 1.0, 1000);
      }).toThrow(/Invalid thread side/);
    });

    it('rejects a record that lacks a side label', () => {
      expect(() => {
        createTimingRecord('event capture', '' as ThreadSide, 1.0, 1000);
      }).toThrow(/Invalid thread side/);
    });
  });

  describe('Driven pipeline coverage: all 11 stages and permitted sides', () => {
    it('emits timing records for every named stage under a driven run', async () => {
      renderTestDom();

      // Configure runtime with fast gate pattern and in-process worker
      runtime = new AdaptiveRuntime({
        forceInProcessWorker: true,
        enableSlowGate: true,
        minPatternSupport: 1,
        fastGatePatterns: {
          'filter > click': 'highlight_primary_action'
        },
        policyConfig: {
          confidenceThreshold: 0.1,
          requiredConsecutiveWindows: 1,
          cooldownMs: 0
        }
      });
      await runtime.start();

      const btn = document.querySelector('[data-aui-component="filter-Region"]') as HTMLElement;
      const applyBtn = document.querySelector('[data-aui-component="btn-apply-filters"]') as HTMLElement;

      // Simulate pointer movement and clicks
      for (let i = 0; i < 15; i++) {
        window.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 50 + i * 5, clientY: 50 + i * 5 })
        );
      }
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }));

      for (let i = 0; i < 15; i++) {
        window.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 150 + i * 5, clientY: 150 + i * 5 })
        );
      }
      applyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 120 }));

      // Wait for window emissions and evaluations
      await waitFor(() => runtime.getStatus().windowsEmitted >= 2, {
        timeoutMs: 4000,
        label: 'at least 2 windows emitted'
      });

      // Trigger PrefixSpan mining explicitly to ensure wasm miner execution
      const workerClient = runtime.getInternals().workerClient;
      await workerClient.minePatternsInWorker([['filter', 'click'], ['filter', 'click']], 1);

      // Trigger inference evaluation to ensure ONNX inference and worker transfer execution
      const evalResult = await workerClient.evaluate(
        { route: 'Analytics', taskId: 'T1', primaryActionAvailable: true },
        [{ timestamp: Date.now(), symbol: 'filter', componentId: 'filter-Region', action: 'click' }]
      );

      // Trigger policy evaluation
      const candidateIntervention = evalResult.intervention ?? {
        type: 'highlight_primary_action',
        source: 'slow',
        targetComponentId: 'btn-export',
        confidence: 0.9
      };
      runtime.getInternals().policy.accept(candidateIntervention, {
        route: 'Analytics',
        taskId: 'T1',
        primaryActionAvailable: true
      });

      // Trigger actuator directly to guarantee actuation stage execution
      runtime.getInternals().actuator.apply({
        type: 'highlight_primary_action',
        source: 'fast',
        targetComponentId: 'btn-export'
      });

      const records = runtime.getTimingRecords();
      expect(records.length).toBeGreaterThan(0);

      // 1. Verify every record has a permitted side
      for (const rec of records) {
        expect(PERMITTED_SIDES).toContain(rec.side);
        expect(PERMITTED_STAGES).toContain(rec.stage);
        expect(rec.durationMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(rec.durationMs)).toBe(true);
      }

      // 2. Collect unique stages emitted
      const emittedStages = new Set(records.map((r) => r.stage));
      const emittedSides = new Set(records.map((r) => r.side));

      // Assert all 11 stages were emitted
      for (const requiredStage of PERMITTED_STAGES) {
        expect(
          emittedStages.has(requiredStage),
          `Expected stage '${requiredStage}' to be emitted, but was missing. Emitted stages: ${Array.from(emittedStages).join(', ')}`
        ).toBe(true);
      }

      // Assert sides representation
      expect(emittedSides.has('main')).toBe(true);
      expect(emittedSides.has('worker')).toBe(true);
      expect(emittedSides.has('wasm')).toBe(true);
      expect(emittedSides.has('model')).toBe(true);
      expect(emittedSides.has('transfer')).toBe(true);

      // Check summary
      const summary = runtime.getTimingSummary();
      expect(Object.keys(summary).length).toBeGreaterThan(0);
      for (const key of Object.keys(summary)) {
        const item = summary[key];
        expect(item.count).toBeGreaterThan(0);
        expect(item.meanMs).toBeGreaterThanOrEqual(0);
        expect(item.p95Ms).toBeGreaterThanOrEqual(item.p50Ms);
      }
    });

    it('can be disabled by configuration and incurs zero collection', async () => {
      renderTestDom();
      runtime = new AdaptiveRuntime({
        forceInProcessWorker: true,
        enableInstrumentation: false
      });
      await runtime.start();

      const btn = document.querySelector('[data-aui-component="filter-Region"]') as HTMLElement;
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));

      const records = runtime.getTimingRecords();
      expect(records.length).toBe(0);
      expect(runtime.getStatus().instrumentationEnabled).toBe(false);
    });
  });

  describe('Instrumentation overhead bounding', () => {
    it('keeps event-capture instrumentation cost strictly below one window stride under high-rate stream', () => {
      const customCollector = new InstrumentationCollector({ capacity: 5000 });
      const STREAM_SIZE = 1000;
      const windowStrideMs = 250;

      // Measure uninstrumented time
      let sumUninstrumented = 0;
      const t0 = performance.now();
      for (let i = 0; i < STREAM_SIZE; i++) {
        sumUninstrumented += (i * 17) % 100;
      }
      const uninstrumentedElapsedMs = performance.now() - t0;

      // Measure instrumented time
      let sumInstrumented = 0;
      const t1 = performance.now();
      for (let i = 0; i < STREAM_SIZE; i++) {
        customCollector.timeSync('event capture', 'main', () => {
          sumInstrumented += (i * 17) % 100;
        });
      }
      const instrumentedElapsedMs = performance.now() - t1;

      expect(sumInstrumented).toBe(sumUninstrumented);

      const overheadMs = Math.max(0, instrumentedElapsedMs - uninstrumentedElapsedMs);
      const perEventOverheadUs = (overheadMs / STREAM_SIZE) * 1000;

      console.log(
        `[overhead test] 1000 events: uninstrumented=${uninstrumentedElapsedMs.toFixed(3)}ms, ` +
          `instrumented=${instrumentedElapsedMs.toFixed(3)}ms, overhead=${overheadMs.toFixed(3)}ms ` +
          `(${perEventOverheadUs.toFixed(3)} µs/event)`
      );

      // The total overhead across 1000 events must be vastly below one window stride (250 ms)
      expect(overheadMs).toBeLessThan(windowStrideMs);
    });
  });
});
