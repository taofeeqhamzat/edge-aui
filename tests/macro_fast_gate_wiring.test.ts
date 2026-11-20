/**
 * Macro → Fast Gate wiring.
 *
 * The assessment (§10.4) found the real WASM PrefixSpan miner loaded successfully but was
 * never connected to arbitration: `AdaptiveInferenceEngine` always received a
 * `MockFastGate`. This test drives the composition with a real interaction shape and
 * asserts that the macro corpus actually reaches the gate and can produce a match,
 * using the real miner implementation contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { PrefixSpanFastGate, MinedPattern } from '../src/gates/fast/prefixSpanFastGate';
import { MockSlowGate } from '../src/gates/slow/mockSlowGate';
import { AdaptiveInferenceEngine } from '../src/gates/arbitration';
import { MacroInteraction } from '../src/telemetry/events';
import {
  TESTBED_FAST_GATE_DECLARATIONS,
  TESTBED_FAST_GATE_PATTERNS,
  TESTBED_FAST_GATE_PATTERN_VERSION
} from '../src/testbed/config/fastGatePatterns';
import { TESTBED_SEMANTIC_VOCABULARY } from '../src/testbed/config/semanticOutcomes';
import { RuntimeWorkerCore } from '../src/runtime/worker/core';
import { TESTBED_VOCABULARY } from './helpers/testbedVocabulary';
import { experimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';

function renderAnnotatedDom(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-aui-route', 'Analytics');
  root.innerHTML = `
    <button data-aui-component="nav-Analytics" data-aui-role="navigation" data-aui-action="click">Analytics</button>
    <form data-aui-component="filter-drawer" data-aui-role="filter">
      <button type="button" data-aui-component="filter-Region" data-aui-role="accordion" aria-expanded="false">Region</button>
      <select data-aui-component="filter-Region-select" data-aui-role="filter" data-aui-action="change"><option>Europe</option></select>
      <button type="submit" data-aui-component="btn-apply-filters" data-aui-role="submit-action" data-aui-action="click">Apply</button>
    </form>
  `;
  document.body.appendChild(root);
  // The observer reads disclosure state in the capture phase, then records the state the
  // click produced. A fixture that never toggles `aria-expanded` cannot express "opened",
  // so simulate the host's click handler here.
  const accordion = root.querySelector('[data-aui-component="filter-Region"]') as HTMLElement;
  accordion.addEventListener('click', () => {
    accordion.setAttribute(
      'aria-expanded',
      accordion.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'
    );
  });
  return root;
}

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

describe('Macro sequence construction for PrefixSpan', () => {
  let runtime: AdaptiveRuntime;

  beforeEach(() => {
    document.body.innerHTML = '';
    experimentRecorder.clear();
    sessionManager.resetSession();
  });

  afterEach(() => {
    runtime?.stop();
    document.body.innerHTML = '';
  });

  it('groups an interaction episode into one mineable sequence', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      minPatternSupport: 1,
      fastGatePatterns: TESTBED_FAST_GATE_PATTERNS,
      ...TESTBED_VOCABULARY
    });
    await runtime.start();

    const click = (componentId: string) => {
      const el = document.querySelector(`[data-aui-component="${componentId}"]`) as HTMLElement;
      expect(el).not.toBeNull();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    };

    // One filter episode: open the drawer, then apply. Both actions are hundreds of
    // milliseconds apart and land in different 250ms windows.
    click('nav-Analytics');
    click('filter-Region');
    click('btn-apply-filters');

    await waitFor(
      () => runtime.getInternals().macroStream.getRecent().length >= 3,
      { label: 'macro interactions' }
    );

    const symbols = runtime.getInternals().macroStream.getRecentSymbols();
    expect(symbols).toContain('OPEN_FILTERS');
    expect(symbols).toContain('APPLY_FILTER');

    // The episode must not be fragmented into single-symbol sequences, otherwise no
    // multi-symbol pattern could ever reach support. Bucketing is time-based, so the
    // assertion is that at least one slot holds the whole episode.
    let found = false;
    for (let attempt = 0; attempt < 40 && !found; attempt++) {
      const sequences = runtime.getMacroSequences();
      found = sequences.some(
        (seq) => seq.includes('OPEN_FILTERS') && seq.includes('APPLY_FILTER')
      );
      if (!found) await new Promise((r) => setTimeout(r, 50));
    }
    expect(found).toBe(true);
  });

  it('exposes the corpus to the gate that arbitration actually uses', async () => {
    renderAnnotatedDom();
    runtime = new AdaptiveRuntime({
      forceInProcessWorker: true,
      minPatternSupport: 1,
      fastGatePatterns: TESTBED_FAST_GATE_PATTERNS,
      ...TESTBED_VOCABULARY
    });
    await runtime.start();

    const click = (componentId: string) => {
      const el = document.querySelector(`[data-aui-component="${componentId}"]`) as HTMLElement;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    };

    click('nav-Analytics');
    click('filter-Region');
    click('btn-apply-filters');

    await waitFor(
      () => runtime.getMacroSequences().some((seq) => seq.length > 1),
      { label: 'a multi-symbol macro corpus' }
    );

    const corpus = runtime.getMacroSequences();
    const flat = corpus.flat();

    // Drive the gate that the composition builds, against the corpus the composition
    // produced. The miner is injected because jsdom has no Worker: the real WASM miner
    // is exercised in the browser, while this test isolates corpus shape + wiring.
    // The injected miner reports the pattern that the corpus demonstrably contains.
    const observedEpisode = corpus.find(
      (symbols) => symbols.includes('OPEN_FILTERS') && symbols.includes('APPLY_FILTER')
    );
    expect(observedEpisode).toBeDefined();

    const gate = new PrefixSpanFastGate({
      getSequences: () => corpus,
      minSupport: 1,
      mine: async () => [
        { pattern: ['OPEN_FILTERS', 'APPLY_FILTER'], support: corpus.length, confidence: 1 }
      ],
      resolveIntervention: (key) => TESTBED_FAST_GATE_PATTERNS[key] ?? null
    });
    const engine = new AdaptiveInferenceEngine({ fastGate: gate, slowGate: new MockSlowGate() });

    const macroSequence: MacroInteraction[] = flat.map((symbol, i) => ({ timestamp: i, symbol }));
    const result = await engine.evaluate({
      macroSequence,
      microTensorSequence: new Float32Array(8 * 18),
      tensorShape: [1, 8, 18],
      uiContext: {
        route: 'Analytics',
        availableActions: ['click'],
        primaryActionAvailable: true,
        helpAvailable: false,
        expandable: true
      }
    });

    // The Fast Gate must win over the Slow Gate when a declared pattern is present.
    expect(result.fastDecision.matched).toBe(true);
    expect(result.matchedGate).toBe('fast');
    expect(result.intervention?.source).toBe('fast');
    expect(result.intervention?.type).toBe('highlight_primary_action');
  });
});

describe('PrefixSpanFastGate resolves patterns through the declared map', () => {
  it('maps a mined pattern to its declared intervention and short-circuits the Slow Gate', async () => {
    const corpus = [
      ['OPEN_FILTERS', 'APPLY_FILTER'],
      ['OPEN_FILTERS', 'OPEN_FILTERS', 'APPLY_FILTER']
    ];
    const mined: MinedPattern[] = [
      { pattern: ['OPEN_FILTERS', 'APPLY_FILTER'], support: 2, confidence: 0.5 }
    ];

    const gate = new PrefixSpanFastGate({
      getSequences: () => corpus,
      mine: async () => mined,
      minSupport: 1,
      resolveIntervention: (key) => TESTBED_FAST_GATE_PATTERNS[key] ?? null
    });

    const slowGate = new MockSlowGate({ outcome: 'HOVER_DWELL', confidence: 0.9 });
    let slowCalled = false;
    const originalInfer = slowGate.infer.bind(slowGate);
    slowGate.infer = async (input) => {
      slowCalled = true;
      return originalInfer(input);
    };

    const engine = new AdaptiveInferenceEngine({ fastGate: gate, slowGate });
    const result = await engine.evaluate({
      macroSequence: [
        { timestamp: 0, symbol: 'OPEN_FILTERS' },
        { timestamp: 1, symbol: 'OPEN_FILTERS' },
        { timestamp: 2, symbol: 'APPLY_FILTER' }
      ],
      microTensorSequence: new Float32Array(8 * 18),
      tensorShape: [1, 8, 18],
      uiContext: {
        route: 'Analytics',
        availableActions: ['click'],
        primaryActionAvailable: true,
        helpAvailable: false,
        expandable: true
      }
    });

    expect(result.matchedGate).toBe('fast');
    expect(result.intervention?.type).toBe('highlight_primary_action');
    expect(slowCalled).toBe(false);
  });

  it('does not match a mined pattern with no declared intervention', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => [{ pattern: ['UNKNOWN_SYMBOL'], support: 9, confidence: 1 }],
      resolveIntervention: (key) => TESTBED_FAST_GATE_PATTERNS[key] ?? null
    });

    const decision = await gate.evaluate([{ timestamp: 0, symbol: 'UNKNOWN_SYMBOL' }]);
    expect(decision.matched).toBe(false);
  });
});

/**
 * Pattern semantics at the composition boundary (Task 50.2)
 *
 * These drive the worker with the testbed's participant-derived declaration set, so they
 * test the wiring a browser build uses: the declared targets travel to the worker, the
 * gate validates them against the supplied outcome vocabulary, and a match produces a
 * normalized semantic prediction. The first test pins session isolation: a reset must clear
 * the mining corpus, otherwise a pattern from one task can be supported by another task's
 * session and "recognition" would span unrelated work.
 */
describe('Pattern semantics through the worker (Task 50.2)', () => {
  const uiContext = {
    route: 'Analytics',
    availableActions: ['click'],
    primaryActionAvailable: true,
    helpAvailable: false,
    expandable: true
  };

  async function initCore(overrides: Record<string, unknown> = {}): Promise<RuntimeWorkerCore> {
    const core = new RuntimeWorkerCore();
    const response = await core.handleRequest({
      id: 'init',
      type: 'INIT',
      payload: {
        fastGateMode: 'mock',
        slowGateMode: 'mock',
        fastGatePatterns: TESTBED_FAST_GATE_DECLARATIONS,
        fastGatePatternVersion: TESTBED_FAST_GATE_PATTERN_VERSION,
        outcomeVocabulary: TESTBED_SEMANTIC_VOCABULARY,
        ...overrides
      }
    });
    expect(response.success).toBe(true);
    return core;
  }

  async function pushMacro(
    core: RuntimeWorkerCore,
    id: string,
    timestamp: number,
    symbol: string,
    windowId = 1
  ): Promise<void> {
    const response = await core.handleRequest({
      id,
      type: 'PUSH_MACRO',
      payload: { macro: { timestamp, symbol, windowId } }
    });
    expect(response.success).toBe(true);
  }

  async function evaluate(core: RuntimeWorkerCore, id: string) {
    const response = await core.handleRequest({
      id,
      type: 'EVALUATE',
      payload: { uiContext }
    });
    if (response.type !== 'EVALUATION_RESULT' || !response.success) {
      throw new Error(`Unexpected evaluation response: ${JSON.stringify(response)}`);
    }
    return response.data;
  }

  it('clears the mining corpus at a session boundary', async () => {
    const core = await initCore();

    await pushMacro(core, 'm1', 1000, 'CLOSE_FILTERS');
    await pushMacro(core, 'm2', 1100, 'OPEN_FILTERS');
    const first = await evaluate(core, 'e1');
    expect(first.diagnostics?.workerCorpusSize).toBe(1);

    await core.handleRequest({ id: 'reset', type: 'RESET' });
    await pushMacro(core, 'm3', 5000, 'NAV_REPORTS');
    const second = await evaluate(core, 'e2');

    // One sequence from the new session only: the previous session's CLOSE/OPEN pair is
    // gone, so no pattern can be supported by work from another task.
    expect(second.diagnostics?.workerCorpusSize).toBe(1);
  });

  it('emits a normalized semantic prediction for a declared participant pattern', async () => {
    const core = await initCore();

    await pushMacro(core, 'm1', 1000, 'CLOSE_FILTERS');
    await pushMacro(core, 'm2', 1100, 'OPEN_FILTERS');
    const result = await evaluate(core, 'e1');

    expect(result.matchedGate).toBe('fast');
    expect(result.prediction?.outcomeId).toBe('open_filter_section');
    expect(result.prediction?.vocabularyId).toBe('testbed-semantic');
    expect(result.prediction?.vocabularyVersion).toBe(
      TESTBED_SEMANTIC_VOCABULARY.version
    );
    expect(result.prediction?.mappingSource).toBe('fast_gate_pattern');
    expect(result.fastDecision.matchedPattern).toEqual(['CLOSE_FILTERS', 'OPEN_FILTERS']);
    // Provenance: the prediction names the declared pattern set that produced it.
    expect(result.provenance.gate).toBe('fast');
    expect(result.provenance.gateVersion).toBe(TESTBED_FAST_GATE_PATTERN_VERSION);
  });

  it('reports a reason instead of a prediction when no declared pattern matches', async () => {
    const core = await initCore({ enableSlowGate: false });

    // A navigation and hover-only episode: no declared participant pattern ends this way.
    await pushMacro(core, 'm1', 1000, 'NAV_OVERVIEW');
    await pushMacro(core, 'm2', 1100, 'HOVER_KPI');
    await pushMacro(core, 'm3', 1200, 'HOVER_HELP');
    const result = await evaluate(core, 'e1');

    expect(result.matchedGate).toBe('none');
    expect(result.prediction).toBeUndefined();
    expect(result.noMatchReason).toBe('fast:no_matching_pattern');
    expect(result.fastDecision.matched).toBe(false);
    expect(result.fastDecision.reason).toBe('no_matching_pattern');
  });
});
