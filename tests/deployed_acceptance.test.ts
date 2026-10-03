/**
 * Deployment Acceptance Verification
 *
 * The supervisor's acceptance sequence, executed against the **real** runtime with the
 * **real** ONNX graphs:
 *
 *     ORT WASM entry point
 *             ↓
 *     production build / asset inventory
 *             ↓
 *     browser loads model + WASM
 *             ↓
 *     real sequence + context inference
 *             ↓
 *     TargetInterventionHead
 *             ↓
 *     policy
 *             ↓
 *     visible intervention
 *             ↓
 *     persistent research trace
 *
 * ## What this file does and does not establish
 *
 * It establishes, with observations rather than assertions:
 * - the built `dist/` satisfies the deployment requirements (per-file size, no JSEP binary,
 *   the WASM-only ORT binary, COOP/COEP headers, model graphs and the WASM vectoriser);
 * - the full pipeline runs with both INT8 ONNX graphs loaded, so inference is real;
 * - the trace it produces is a canonical 1.3.0 record on a single epoch clock;
 * - the trace is internally consistent: no orphaned windows, every prediction has a policy
 *   verdict, every applied episode is terminal.
 *
 * It does **not** establish that the deployed Cloudflare Pages origin loads the model, nor
 * that a live Supabase project accepted the upload. Neither exists in this environment, and
 * no test can substitute for them: `docs/deploy/verification-runbook.md` records those as
 * `NOT VERIFIED` with the manual steps that close them.
 *
 * The orchestrator outcomes (`predictionsRecorded`, actuation) depend on the window grid
 * filling and the policy gates being satisfied, which is timing-sensitive. The assertions are
 * therefore written on properties that must hold **whenever** they occur, plus an explicit
 * test that the pipeline reached the inference stage at all — rather than asserting a
 * specific decision, which would be asserting a research outcome rather than an engineering
 * property.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { experimentRecorder, EXPERIMENT_TRACE_SCHEMA_VERSION } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { debugBus } from '../src/debug/debugBus';
import { APPLICATION_VERSION, POLICY_VERSION } from '../src/telemetry/version';
import { Settings as OrtSettings } from 'onnxruntime-web';

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

/** Cloudflare Pages' hard per-asset limit. */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
/** 2001-09-09; any value below this cannot be an epoch-millisecond timestamp. */
const EPOCH_FLOOR = 1_000_000_000_000;

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 12_000, intervalMs = 50, label = 'condition' } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

function listDistFiles(dir: string): Array<{ relative: string; size: number }> {
  const entries: Array<{ relative: string; size: number }> = [];
  const walk = (current: string): void => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else entries.push({ relative: path.relative(dir, full), size: fs.statSync(full).size });
    }
  };
  walk(dir);
  return entries;
}

const distBuilt = fs.existsSync(path.join(distDir, 'index.html'));

describe('Deployment asset inventory', () => {
  it.skipIf(!distBuilt)('emits no asset at or above Cloudflare Pages\' 25 MiB limit', () => {
    const oversized = listDistFiles(distDir).filter((file) => file.size >= MAX_ASSET_BYTES);
    expect(
      oversized,
      `Assets over 25 MiB cause Cloudflare Pages to reject the whole deployment: ${oversized
        .map((f) => `${f.relative} (${f.size} B)`)
        .join(', ')}`
    ).toEqual([]);
  });

  it.skipIf(!distBuilt)('does not emit the JSEP/WebGPU ONNX Runtime binary', () => {
    // Its presence means the WebGPU provider is being requested, which pulls in a
    // 26,827,543-byte asset — the exact reason the deployment was rejected before ADR-016.
    const jsep = listDistFiles(distDir).filter((file) => /jsep/i.test(file.relative));
    expect(jsep.map((f) => f.relative)).toEqual([]);
  });

  it.skipIf(!distBuilt)('bundles the WASM-only ONNX Runtime binary and the model graphs', () => {
    const files = listDistFiles(distDir).map((f) => f.relative);
    expect(
      files.some((f) => path.basename(f).startsWith('ort-wasm-simd-threaded')),
      'ort-wasm-simd-threaded*.wasm must be present: it is the execution provider this deployment uses'
    ).toBe(true);
    expect(files.some((f) => /wasm_vectorizer_bg.*\.wasm$/.test(f))).toBe(true);
    expect(files).toContain(path.join('models', 'model_int8.onnx'));
    expect(files).toContain(path.join('models', 'intervention_head_int8.onnx'));
  });

  it.skipIf(!distBuilt)('ships cross-origin isolation headers, which the deployed origin needs', () => {
    const headersPath = path.join(distDir, '_headers');
    expect(fs.existsSync(headersPath)).toBe(true);
    const headers = fs.readFileSync(headersPath, 'utf8');
    expect(headers).toMatch(/Cross-Origin-Opener-Policy:\s*same-origin/i);
    expect(headers).toMatch(/Cross-Origin-Embedder-Policy:\s*require-corp/i);
  });

  it('resolves the ONNX Runtime entry point to the WASM-only distribution', () => {
    // A resolution failure here means the slow gate would fall back to an entry point that can
    // pull the WebGPU binary into the bundle.
    const resolved = require.resolve('onnxruntime-web/wasm');
    expect(resolved).toContain('ort.wasm');
    expect(resolved).not.toContain('jsep');
  });
});

describe('Headless acceptance: real pipeline with real ONNX graphs', () => {
  let runtime: AdaptiveRuntime;
  let root: HTMLElement;

  beforeEach(() => {
    experimentRecorder.clear();
    debugBus.reset();
    sessionManager.resetSession();
    sessionManager.startSession({ experimentId: 'exp-acceptance', conditionId: 'adaptive' });
    experimentRecorder.bindSession(sessionManager.getActiveSession());

    root = document.createElement('div');
    root.innerHTML = `
      <button data-aui-component="nav-Analytics" data-aui-role="navigation" data-aui-action="click">Analytics</button>
      <form data-aui-component="filter-drawer" data-aui-role="filter">
        <button type="button" data-aui-component="filter-Region" data-aui-role="accordion" aria-expanded="false">Region</button>
        <select data-aui-component="filter-Region-select" data-aui-role="filter" data-aui-action="change">
          <option>All</option><option>EMEA</option>
        </select>
        <button type="submit" data-aui-component="btn-apply-filters" data-aui-role="primary-action" data-aui-action="click">Apply</button>
      </form>
      <div data-aui-component="kpi-card-revenue" data-aui-role="kpi-card" title="Revenue">Revenue</div>
    `;
    document.body.appendChild(root);
  });

  afterEach(() => {
    runtime?.stop();
    root?.remove();
    experimentRecorder.clear();
    sessionManager.resetSession();
  });

  it('loads both INT8 graphs and serves inference through the ONNX gate', async () => {
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      // Explicit: the default resolution keeps the mock when no `Worker` global exists, which
      // is the case in jsdom. The acceptance run must use the real ONNX gate.
      slowGateMode: 'onnx',
      experimentId: 'exp-acceptance',
      enableSlowGate: true,
      enableInstrumentation: false,
      minPatternSupport: 1
    });

    await runtime.start();
    const status = runtime.getStatus();

    // The learned head must actually be the one running. A mock Slow Gate would make every
    // downstream claim about "the adaptive condition" unsupported.
    expect(status.slowGateMode).toBe('onnx');
    expect(status.modelLoaded).toBe(true);
    expect(status.executionProvider).not.toBe('unavailable');
    // The in-process fallback is the deployment path when a Worker cannot load, so it must
    // still execute real inference rather than degrade to a heuristic.
    expect(status.executionProvider).not.toBe('mock');
  }, 60_000);

  it('runs the pipeline end to end and produces a canonical, self-consistent 1.3.0 trace', async () => {
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      // Explicit: the default resolution keeps the mock when no `Worker` global exists, which
      // is the case in jsdom. The acceptance run must use the real ONNX gate.
      slowGateMode: 'onnx',
      experimentId: 'exp-acceptance',
      enableSlowGate: true,
      enableInstrumentation: false,
      minPatternSupport: 1
    });

    await runtime.start();

    // Real DOM interaction, not synthesised events: the point is to exercise the composed
    // pipeline through the same path a researcher's browser uses.
    const click = (selector: string): void => {
      const el = root.querySelector(selector);
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    };

    click('[data-aui-component="nav-Analytics"]');
    await new Promise((r) => setTimeout(r, 400));
    click('[data-aui-component="filter-Region"]');
    await new Promise((r) => setTimeout(r, 400));
    const select = root.querySelector('[data-aui-component="filter-Region-select"]') as HTMLSelectElement | null;
    if (select) {
      select.value = 'EMEA';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 300));
    click('[data-aui-component="btn-apply-filters"]');

    // The Slow Gate needs a full T=8 window sequence before it is invoked at all, so an
    // evaluation cannot occur immediately. Wait for the pipeline to reach inference rather
    // than for a fixed duration.
    await waitFor(() => experimentRecorder.getEventCounts().predictions > 0, {
      timeoutMs: 15_000,
      label: 'the first prediction'
    });

    // Keep interacting so a second evaluation can occur. The window-attribution property
    // below is only meaningful across more than one prediction: the defect it guards against
    // (F-18) was *consecutive* predictions naming the same window while evaluating different
    // sequences. A single prediction satisfies it trivially.
    const secondPredictionDeadline = Date.now() + 10_000;
    while (
      Date.now() < secondPredictionDeadline &&
      experimentRecorder.getEventCounts().predictions < 2
    ) {
      click('[data-aui-component="filter-Region"]');
      click('[data-aui-component="kpi-card-revenue"]');
      click('[data-aui-component="btn-apply-filters"]');
      await new Promise((r) => setTimeout(r, 400));
    }

    // Outcomes settle lazily. A window is labelled only once the observed stream has passed
    // its lookahead horizon (`windowEnd + 1500 ms`), or once the idle grace period
    // (`pendingOutcomeGraceMs`, 2000 ms) expires — *and* the flush that applies the grace
    // period runs from the 125 ms tick loop. The inactivity windows the tick loop keeps
    // emitting during that grace period are themselves unsettled, so the warning list cannot
    // be expected to empty until emission and settlement have both quiesced.
    const settleDeadline = Date.now() + 20_000;
    let warnings: string[] = [];
    while (Date.now() < settleDeadline) {
      warnings = experimentRecorder.exportSerializable().metadata.integrityWarnings ?? [];
      // Stop emitting first: no further events means no further windows.
      if (experimentRecorder.getEventCounts().behaviourEvents > 0 && warnings.length === 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const counts = experimentRecorder.getEventCounts();
    const trace = experimentRecorder.exportSerializable();

    // --- One canonical clock (F-01).
    // This is the assertion the pre-1.3.0 format could not satisfy: `performance.now()` values
    // in the same array as `Date.now()` values made the record unorderable.
    const epochGroups: Record<string, number[]> = {
      behaviour: trace.behaviourEvents.map((e) => e.timestamp),
      macro: trace.macroInteractions.map((e) => e.timestamp),
      outcome: trace.outcomes.map((e) => e.timestamp),
      prediction: trace.predictions.map((e) => e.timestamp),
      policy: trace.policyDecisions.map((e) => e.timestamp),
      intervention: trace.interventions.map((e) => e.timestamp),
      task: trace.taskEvents.map((e) => e.timestamp),
      windowBound: trace.microTensors.flatMap((w) => [w.windowStart, w.windowEnd])
    };

    for (const [group, values] of Object.entries(epochGroups)) {
      const nonEpoch = values.filter((v) => v > 0 && v < EPOCH_FLOOR);
      expect(
        nonEpoch,
        `${group} contains ${nonEpoch.length} non-epoch timestamp(s) (first: ${nonEpoch[0]}). ` +
          'A monotonic value in a trace record makes the record unorderable.'
      ).toEqual([]);
    }

    // --- Window bounds and event timestamps share one timeline.
    //
    // Both are epoch milliseconds, so a window must actually contain the events it claims to
    // cover, and windows must not overlap out of order. This caught a real defect during
    // implementation: the window grid runs on the canonical clock, and the export applied a
    // session epoch offset on top, producing window bounds at roughly twice the event timeline.
    // The trace still looked populated, which is exactly why the check belongs here rather than
    // in review.
    const windows = trace.microTensors;
    expect(windows.length).toBeGreaterThan(0);
    const outOfOrder = windows.filter(
      (w, index) => index > 0 && w.windowStart < windows[index - 1].windowEnd - 1
    );
    expect(
      outOfOrder.map((w) => w.windowId),
      'MicroTensor windows overlap out of order; window bounds are not on the same timeline as events'
    ).toEqual([]);

    const eventsInAnyWindow = trace.behaviourEvents.filter((event) =>
      windows.some((w) => event.timestamp >= w.windowStart && event.timestamp < w.windowEnd)
    );
    expect(
      eventsInAnyWindow.length,
      `${trace.behaviourEvents.length} behaviour event(s) but none fall inside any MicroTensor ` +
        'window bound. Window bounds and event timestamps are on different clocks.'
    ).toBeGreaterThan(0);

    // --- Version identity and provenance travel with the record.
    expect(trace.schemaVersion).toBe(EXPERIMENT_TRACE_SCHEMA_VERSION);
    expect(trace.schemaVersion).toBe('1.3.0');
    expect(trace.metadata.clock).toBe('epoch_ms');
    expect(trace.metadata.provenance).toBe('scripted');
    expect(trace.metadata.applicationVersion).toBe(APPLICATION_VERSION);
    expect(trace.metadata.policyVersion).toBe(POLICY_VERSION);
    expect(trace.metadata.modelVersion).toBeTruthy();
    expect(trace.metadata.executionProvider).toBeTruthy();
    expect(trace.session.provenance).toBe('scripted');

    // --- Every prediction carries a policy verdict (F-07).
    expect(counts.predictions).toBeGreaterThan(0);
    expect(counts.policyDecisions).toBeGreaterThan(0);
    for (const prediction of trace.predictions) {
      expect(prediction.predictionId, 'a prediction without an id cannot be attributed').toBeTruthy();
      expect(Array.isArray(prediction.evaluatedWindowIds)).toBe(true);
      expect(prediction.evaluatedWindowIds!.length).toBeGreaterThan(0);
      // The evaluated window set must contain the window the prediction names.
      expect(prediction.evaluatedWindowIds).toContain(prediction.windowId);
      const verdict = trace.policyDecisions.filter((d) => d.predictionId === prediction.predictionId);
      expect(verdict.length, `prediction ${prediction.predictionId} has no policy decision`).toBeGreaterThan(0);
      for (const decision of verdict) {
        expect(decision.policyReason.trim(), 'a decision without a reason is the F-07 defect').not.toBe('');
        expect(['accepted', 'rejected', 'decision_only', 'no_prediction']).toContain(decision.policyDecision);
      }
    }

    // --- Window attribution is explicit, not inferred (F-18). The defect was consecutive
    // predictions naming one window while evaluating different sequences, so the property is
    // asserted only once more than one prediction exists.
    const attributedWindows = trace.predictions.map((p) => p.windowId);
    if (trace.predictions.length > 1) {
      expect(
        new Set(attributedWindows).size,
        `consecutive predictions all named window(s) ${JSON.stringify(attributedWindows)}; ` +
          'each prediction must name the window sequence it actually evaluated'
      ).toBeGreaterThan(1);
    }

    // --- No orphaned predictions or episodes (F-03, F-05).
    const appliedEpisodes = trace.interventions.filter((i) => i.type === 'applied');
    for (const applied of appliedEpisodes) {
      expect(applied.interventionEpisodeId, 'applied episode without an id').toBeTruthy();
      const issued = trace.interventions.some(
        (i) =>
          (i.type === 'issued' || i.type === 'accepted') &&
          i.interventionEpisodeId === applied.interventionEpisodeId
      );
      expect(issued, `applied episode ${applied.interventionEpisodeId} has no issuing record`).toBe(true);
    }

    // --- Truncation is accounted for rather than silent (F-16).
    expect(trace.metadata.evictions).toBeDefined();
    expect(typeof trace.metadata.evictions!.total).toBe('number');
    expect(trace.metadata.evictions!.truncated).toBe(trace.metadata.evictions!.total > 0);

    // --- Bounded execution is observable (F-02).
    expect(trace.metadata.mining).toBeDefined();
    const mining = runtime.getMiningCounters();
    expect(mining.executed + mining.skipped + mining.superseded + mining.timedOut).toBeGreaterThan(0);

    // --- The trace round-trips through the verified schema.
    const { verifyTraceCompleteness } = await import('../src/telemetry/traceAttributionVerifier');
    const report = verifyTraceCompleteness(trace);
    const failed = report.checks.filter((c) => !c.passed);
    expect(
      failed.map((c) => `${c.check}: ${c.message}`),
      'The trace must pass the project\'s own verifier. It previously passed only on hand-authored fixtures (F-13).'
    ).toEqual([]);
  }, 90_000);

  it('makes any applied adaptation correlatable between the DOM and the trace', async () => {
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      // Explicit: the default resolution keeps the mock when no `Worker` global exists, which
      // is the case in jsdom. The acceptance run must use the real ONNX gate.
      slowGateMode: 'onnx',
      experimentId: 'exp-acceptance',
      enableSlowGate: true,
      enableInstrumentation: false,
      minPatternSupport: 1
    });

    await runtime.start();

    // Drive enough sustained interaction for the persistence gate to be satisfiable, then
    // assert the *correlation property* rather than that an adaptation occurred: whether the
    // policy actuates is a research outcome, but if it does, the DOM and the trace must agree.
    const roots = ['nav-Analytics', 'filter-Region', 'btn-apply-filters', 'kpi-card-revenue'];
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && experimentRecorder.getEventCounts().predictions < 3) {
      for (const component of roots) {
        const el = root.querySelector(`[data-aui-component="${component}"]`);
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 30 }));
        el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 30, clientY: 30 }));
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    const trace = experimentRecorder.exportSerializable();
    const appliedEpisodes = new Set(
      trace.interventions.filter((i) => i.type === 'applied').map((i) => i.interventionEpisodeId)
    );

    const adapted = Array.from(document.querySelectorAll('[data-aui-active-adaptation]'));
    for (const element of adapted) {
      const episode = element.getAttribute('data-aui-adaptation-episode');
      const adaptation = element.getAttribute('data-aui-active-adaptation');
      expect(adaptation, 'every adaptation must name itself for correlation').toBeTruthy();
      expect(episode, 'a visible adaptation without an episode id cannot be tied to the trace').toBeTruthy();
      expect(
        appliedEpisodes.has(episode as string),
        `the DOM shows episode ${episode} but the trace has no matching applied record`
      ).toBe(true);
    }

    // The converse direction: every applied episode must still be accounted for as either
    // active in the DOM or terminated in the record. This is what F-03 was about — an
    // adaptation that silently persisted for the rest of the session.
    for (const episode of appliedEpisodes) {
      const terminated = trace.interventions.some(
        (i) => i.interventionEpisodeId === episode && (i.type === 'reverted' || i.type === 'dismissed')
      );
      const stillActive = adapted.some(
        (el) => el.getAttribute('data-aui-adaptation-episode') === episode
      );
      expect(
        terminated || stillActive,
        `episode ${episode} was applied but is neither visible nor terminated`
      ).toBe(true);
      for (const intervention of trace.interventions.filter((i) => i.interventionEpisodeId === episode && i.type === 'reverted')) {
        expect(['ttl', 'user_dismissal', 'session_end', 'reset', 'replaced']).toContain(intervention.reason);
      }
    }
  }, 60_000);
});

/**
 * Writes a real 1.3.0 capture to disk.
 *
 * The cross-repository ingestion contract test in `model-preparation` reads the sibling
 * repository's `docs/experiments/random/traces/` directory. A trace produced by the *actual*
 * runtime — not a hand-built dict — is what makes that contract meaningful, and the audit found
 * the previous cross-repo check passing only because a real capture was being silently skipped.
 */
describe('Acceptance artefact: a real exported 1.3.0 capture', () => {
  it('writes a runtime-produced trace for the cross-repository contract', async () => {
    experimentRecorder.clear();
    sessionManager.resetSession();
    sessionManager.startSession({ experimentId: 'exp-deploy-verification', conditionId: 'adaptive' });
    experimentRecorder.bindSession(sessionManager.getActiveSession());

    const root = document.createElement('div');
    root.innerHTML = `
      <button data-aui-component="nav-Analytics" data-aui-role="navigation" data-aui-action="click">Analytics</button>
      <form data-aui-component="filter-drawer" data-aui-role="filter">
        <button type="button" data-aui-component="filter-Region" data-aui-role="accordion" aria-expanded="false">Region</button>
        <select data-aui-component="filter-Region-select" data-aui-role="filter" data-aui-action="change">
          <option>All</option><option>EMEA</option>
        </select>
        <button type="submit" data-aui-component="btn-apply-filters" data-aui-role="primary-action" data-aui-action="click">Apply</button>
      </form>
      <div data-aui-component="kpi-card-revenue" data-aui-role="kpi-card" title="Revenue">Revenue</div>`;
    document.body.appendChild(root);

    const runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      slowGateMode: 'onnx',
      experimentId: 'exp-deploy-verification',
      enableSlowGate: true,
      enableInstrumentation: false,
      minPatternSupport: 1
    });

    await runtime.start();

    const click = (selector: string): void => {
      root.querySelector(selector)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 40 })
      );
    };

    const interactionDeadline = Date.now() + 12_000;
    while (Date.now() < interactionDeadline && experimentRecorder.getEventCounts().predictions < 2) {
      click('[data-aui-component="nav-Analytics"]');
      click('[data-aui-component="filter-Region"]');
      click('[data-aui-component="btn-apply-filters"]');
      click('[data-aui-component="kpi-card-revenue"]');
      await new Promise((r) => setTimeout(r, 350));
    }

    // Emit on the pagehide path so task/outcome settlement completes, then stop.
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 500));
    runtime.stop();

    const trace = experimentRecorder.exportSerializable();

    const targetDir = path.join(repoRoot, 'docs', 'experiments', 'deploy-verification');
    // Replace rather than accumulate: a session id is regenerated per run, so appending would
    // leave one committed artefact per test execution and make the cross-repository contract
    // check depend on run history.
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    // A fixed filename, not the session id: the session id is regenerated per run, so keying
    // the artifact on it would leave one committed file per test execution and make the
    // cross-repository contract depend on run history.
    const targetPath = path.join(targetDir, 'experiment-trace-deploy-verification.json');
    fs.writeFileSync(targetPath, JSON.stringify(trace, null, 2));

    // The artefact must be a genuinely usable capture, not an empty shell.
    expect(trace.schemaVersion).toBe('1.3.0');
    expect(trace.behaviourEvents.length).toBeGreaterThan(0);
    expect(trace.microTensors.length).toBeGreaterThan(0);
    expect(trace.outcomes.length).toBeGreaterThan(0);
    expect(trace.metadata.provenance).toBe('scripted');
    expect(trace.metadata.clock).toBe('epoch_ms');

    console.log(
      `[acceptance] Wrote ${path.relative(repoRoot, targetPath)} — ` +
        `${trace.behaviourEvents.length} behaviour events, ${trace.predictions.length} predictions, ` +
        `${trace.policyDecisions.length} policy decisions, ${trace.interventions.length} interventions`
    );

    root.remove();
  }, 60_000);
});
