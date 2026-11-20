import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import initWasm from '../wasm-vectorizer/pkg/wasm_vectorizer.js';
import {
  PrefixSpanFastGate,
  MinedPattern,
  PatternIntervention,
  PatternMiningRequest
} from '../src/gates/fast/prefixSpanFastGate';
import { minePatternsDirect, wasmPatternMiner } from '../src/gates/fast/prefixSpanMiner';
import { MacroInteraction } from '../src/telemetry/events';
import { TESTBED_FAST_GATE_DECLARATIONS } from '../src/testbed/config/fastGatePatterns';
import { TESTBED_SEMANTIC_VOCABULARY } from '../src/testbed/config/semanticOutcomes';

const seq = (...symbols: string[]): MacroInteraction[] =>
  symbols.map((symbol, i) => ({ timestamp: i * 100, symbol }));

/** Deterministic stand-in for the Rust/WASM miner. */
function fakeMiner(patterns: MinedPattern[]) {
  return async () => patterns;
}

describe('PrefixSpanFastGate (assessment §10.4 / §15)', () => {
  it('matches a frequent pattern and emits the declared intervention', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [['NAV_ANALYTICS', 'OPEN_FILTERS', 'APPLY_FILTER']],
      mine: fakeMiner([
        { pattern: ['NAV_ANALYTICS', 'OPEN_FILTERS', 'APPLY_FILTER'], support: 3, confidence: 0.9 }
      ]),
      resolveIntervention: () => 'highlight_primary_action'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS', 'APPLY_FILTER'));

    expect(decision.matched).toBe(true);
    expect(decision.source).toBe('fast');
    expect(decision.intervention?.type).toBe('highlight_primary_action');
    expect(decision.matchedPattern).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS', 'APPLY_FILTER']);
  });

  it('returns a miss when no pattern is frequent enough', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([]),
      resolveIntervention: () => 'offer_assistance'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.matched).toBe(false);
    expect(decision.intervention).toBeUndefined();
  });

  it('matches a frequent pattern as an in-order subsequence', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([{ pattern: ['NAV_ANALYTICS', 'OPEN_FILTERS'], support: 5, confidence: 1 }]),
      resolveIntervention: () => 'highlight_primary_action'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS', 'TABLE_SORT'));
    expect(decision.matched).toBe(true);
    expect(decision.matchedPattern).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS']);
  });

  it('requires pattern symbols to appear in order', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([{ pattern: ['NAV_ANALYTICS', 'OPEN_FILTERS'], support: 5, confidence: 1 }]),
      resolveIntervention: () => 'highlight_primary_action'
    });

    // Reversed order must not match.
    const decision = await gate.evaluate(seq('OPEN_FILTERS', 'NAV_ANALYTICS'));
    expect(decision.matched).toBe(false);
  });

  it('supports strict suffix matching when configured', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([{ pattern: ['NAV_ANALYTICS', 'OPEN_FILTERS'], support: 5, confidence: 1 }]),
      resolveIntervention: () => 'highlight_primary_action',
      suffixMatchOnly: true
    });

    expect((await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS', 'TABLE_SORT'))).matched).toBe(false);
    expect((await gate.evaluate(seq('TABLE_SORT', 'NAV_ANALYTICS', 'OPEN_FILTERS'))).matched).toBe(true);
  });

  it('does not match a mined pattern that has no declared intervention', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([{ pattern: ['HOVER_KPI'], support: 9, confidence: 1 }]),
      resolveIntervention: () => null
    });

    const decision = await gate.evaluate(seq('HOVER_KPI'));
    expect(decision.matched).toBe(false);
  });

  it('ranks patterns deterministically by support then length', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([
        { pattern: ['NAV_ANALYTICS'], support: 2, confidence: 1 },
        { pattern: ['NAV_ANALYTICS', 'OPEN_FILTERS'], support: 5, confidence: 1 }
      ]),
      resolveIntervention: (key) =>
        key === 'NAV_ANALYTICS' ? 'offer_assistance' : 'simplify_options'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS'));

    // Higher support wins even though the shorter pattern also suffix-matches.
    expect(decision.intervention?.type).toBe('simplify_options');
    expect(decision.matchedPattern).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS']);
  });

  it('honours minConfidence', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([{ pattern: ['NAV_ANALYTICS'], support: 9, confidence: 0.2 }]),
      minConfidence: 0.5,
      resolveIntervention: () => 'offer_assistance'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.matched).toBe(false);
  });

  it('fails safe when the miner throws', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => {
        throw new Error('WASM crash');
      },
      resolveIntervention: () => 'offer_assistance'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.matched).toBe(false);
    expect(decision.source).toBe('fast');
  });

  it('includes the current sequence in the mining corpus', async () => {
    let seenCorpus: string[][] = [];
    const gate = new PrefixSpanFastGate({
      getSequences: () => [['LEGACY']],
      mine: async (request) => {
        seenCorpus = request.sequences;
        return [];
      },
      resolveIntervention: () => null
    });

    await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS'));

    expect(seenCorpus).toHaveLength(2);
    expect(seenCorpus[1]).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS']);
  });

  it('returns a miss for an empty sequence', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: fakeMiner([{ pattern: ['NAV_ANALYTICS'], support: 1, confidence: 1 }]),
      resolveIntervention: () => 'offer_assistance'
    });

    expect((await gate.evaluate([])).matched).toBe(false);
  });
});

/**
 * F-02 correctness and bounds against the real Rust/WASM miner.
 *
 * The gate tests above inject a fake miner, so they cannot catch a miner defect. These
 * fixtures call the committed WASM package directly and pin the four F-02 behaviours:
 * deterministic output, sequence-level support, conditional confidence, and hard bounds.
 * They must run after the module is initialised with the committed binary; that is also
 * what the browser does, through `ensurePrefixSpanWasm`.
 */
describe('PrefixSpan miner correctness and bounds (F-02)', () => {
  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '../wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm');
    await initWasm({ module_or_path: fs.readFileSync(wasmPath) });
  });

  const request = (
    sequences: string[][],
    overrides: Partial<PatternMiningRequest> = {}
  ): PatternMiningRequest => ({
    sequences,
    minSupport: 1,
    maxPatternLength: 4,
    maxPatterns: 32,
    ...overrides
  });

  const mine = async (sequences: string[][], overrides: Partial<PatternMiningRequest> = {}) => {
    const patterns = await minePatternsDirect(request(sequences, overrides));
    expect(patterns).not.toBeNull();
    return (patterns ?? []).map((pattern) => ({
      key: pattern.pattern.join(' > '),
      support: pattern.support,
      confidence: pattern.confidence
    }));
  };

  it('returns nothing for an empty corpus', async () => {
    expect(await mine([])).toEqual([]);
  });

  it('returns nothing when the corpus holds only empty sequences', async () => {
    expect(await mine([[], []])).toEqual([]);
  });

  it('enumerates the frequent subsequences of one sequence', async () => {
    const keys = (await mine([['A', 'B', 'C']])).map((pattern) => pattern.key).sort();
    expect(keys).toEqual(['A', 'A > B', 'A > B > C', 'A > C', 'B', 'B > C', 'C']);
  });

  it('counts support per sequence, not per occurrence', async () => {
    const patterns = await mine([['A', 'A'], ['A']]);
    expect(patterns.find((pattern) => pattern.key === 'A')?.support).toBe(2);
  });

  it('produces the nested patterns of a repeated symbol', async () => {
    const keys = (await mine([['A', 'A', 'A']])).map((pattern) => pattern.key);
    expect(keys).toEqual(['A > A > A', 'A > A', 'A']);
  });

  it('keeps a pattern that only a later overlapping occurrence enables', async () => {
    const patterns = await mine([['A', 'X', 'A', 'C']]);
    expect(patterns.find((pattern) => pattern.key === 'A > A')?.support).toBe(1);
    expect(patterns.find((pattern) => pattern.key === 'A > C')?.support).toBe(1);
  });

  it('drops candidates below the support threshold', async () => {
    const patterns = await mine([['A', 'B'], ['A', 'C'], ['D']], { minSupport: 2 });
    const keys = patterns.map((pattern) => pattern.key);
    expect(keys).toContain('A');
    expect(keys).not.toContain('A > B');
    expect(keys).not.toContain('D');
  });

  it('reports conditional confidence for a continuation and coverage for a single symbol', async () => {
    const corpus = [['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'B', 'C']];
    const patterns = await mine(corpus);
    // 3 of 4 sequences contain A.
    expect(patterns.find((pattern) => pattern.key === 'A')?.confidence).toBe(0.75);
    // 2 of the 3 sequences that contain A continue with B.
    expect(patterns.find((pattern) => pattern.key === 'A > B')?.confidence).toBeCloseTo(2 / 3, 3);
  });

  it('honours maxPatternLength as a hard bound', async () => {
    const patterns = await mine([['A', 'B', 'C', 'D', 'E']], { maxPatternLength: 2 });
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern.key.split(' > ').length).toBeLessThanOrEqual(2);
    }
  });

  it('honours maxPatterns as a hard bound', async () => {
    const corpus = [['A', 'B', 'C', 'D', 'E', 'F']];
    expect(await mine(corpus, { maxPatterns: 5 })).toHaveLength(5);
    expect(await mine(corpus, { maxPatterns: 0 })).toEqual([]);
  });

  it('mines the same pattern set and order on every run', async () => {
    const corpus = [
      ['A', 'B', 'C', 'A', 'B'],
      ['B', 'A', 'C'],
      ['C', 'A', 'B', 'D']
    ];
    const first = await mine(corpus, { maxPatterns: 64 });
    expect(first.length).toBeGreaterThan(8);
    for (let run = 0; run < 20; run++) {
      expect(await mine(corpus, { maxPatterns: 64 })).toEqual(first);
    }
  });

  it('does not count the evaluated sequence twice when the corpus already holds it', async () => {
    // The runtime supplies the corpus and the evaluated sequence from the same macro
    // history. Appending it again gave every pattern in that history support 2, so one
    // occurrence satisfied minSupport: 2 and the gate "matched" itself. This is the
    // corpus/session boundary artifact the workstream must remove.
    const history = [['NAV_ANALYTICS', 'OPEN_FILTERS']];
    let corpusSeen: string[][] = [];

    const gate = new PrefixSpanFastGate({
      getSequences: () => history,
      minSupport: 2,
      mine: async (minerRequest) => {
        corpusSeen = minerRequest.sequences;
        return wasmPatternMiner(minerRequest);
      },
      resolveIntervention: () => 'highlight_primary_action'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS'));

    expect(corpusSeen).toHaveLength(1);
    expect(corpusSeen[0]).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS']);
    expect(decision.matched).toBe(false);
  });

  it('still matches a pattern that genuinely recurs across corpus sequences', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [
        ['NAV_ANALYTICS', 'OPEN_FILTERS'],
        ['NAV_ANALYTICS', 'OPEN_FILTERS']
      ],
      minSupport: 2,
      mine: wasmPatternMiner,
      resolveIntervention: () => 'highlight_primary_action'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS'));

    expect(decision.matched).toBe(true);
    expect(decision.matchedPattern).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS']);
  });

  it('attaches the measured support and the bounded pattern set to the decision', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [['NAV_ANALYTICS', 'OPEN_FILTERS'], ['NAV_ANALYTICS', 'OPEN_FILTERS']],
      minSupport: 2,
      maxPatternLength: 2,
      maxPatterns: 8,
      mine: wasmPatternMiner,
      resolveIntervention: () => 'highlight_primary_action'
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS'));

    expect(decision.matched).toBe(true);
    // 3 sequences contain NAV_ANALYTICS > OPEN_FILTERS: the two corpus ones and the
    // evaluated one. Its confidence is conditional on NAV_ANALYTICS, which all 3 contain.
    expect(decision.confidence).toBeCloseTo(1, 3);
    expect(decision.prediction?.confidence).toBeCloseTo(1, 3);
  });
});

/**
 * No-match reasons (Task 50.2)
 *
 * A miss is a result. "Nothing was frequent enough", "a frequent pattern matched but no
 * declaration covers it" and "mining timed out" call for different responses, and a bare
 * `matched: false` cannot tell them apart.
 */
describe('Fast Gate no-match reasons (Task 50.2)', () => {
  it('reports an empty sequence', async () => {
    const gate = new PrefixSpanFastGate({ getSequences: () => [], mine: async () => [] });
    const decision = await gate.evaluate([]);
    expect(decision.matched).toBe(false);
    expect(decision.reason).toBe('empty_sequence');
  });

  it('reports that nothing met the support threshold', async () => {
    const gate = new PrefixSpanFastGate({ getSequences: () => [], mine: async () => [] });
    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.reason).toBe('no_frequent_pattern');
  });

  it('reports that no mined pattern is a subsequence of the observed sequence', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => [{ pattern: ['OPEN_FILTERS', 'APPLY_FILTER'], support: 4, confidence: 1 }],
      resolveIntervention: () => 'highlight_primary_action'
    });
    const decision = await gate.evaluate(seq('NAV_ANALYTICS', 'EXPORT_REPORT'));
    expect(decision.matched).toBe(false);
    expect(decision.reason).toBe('no_matching_pattern');
  });

  it('distinguishes a match with no declared target from no match at all', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => [{ pattern: ['OPEN_FILTERS', 'APPLY_FILTER'], support: 4, confidence: 1 }],
      resolveIntervention: () => null
    });
    const decision = await gate.evaluate(seq('OPEN_FILTERS', 'APPLY_FILTER'));
    expect(decision.matched).toBe(false);
    expect(decision.intervention).toBeUndefined();
    expect(decision.prediction).toBeUndefined();
    expect(decision.reason).toBe('no_declared_target');
  });

  it('reports that every mined pattern was filtered out as not actionable', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      maxPatternLength: 2,
      mine: async () => [{ pattern: ['A', 'B', 'C'], support: 9, confidence: 1 }],
      resolveIntervention: () => 'highlight_primary_action'
    });
    const decision = await gate.evaluate(seq('A', 'B', 'C'));
    expect(decision.reason).toBe('no_actionable_pattern');
  });

  it('reports a mining timeout as a bounded failure, not a silent miss', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      miningTimeoutMs: 20,
      mine: () => new Promise<MinedPattern[]>(() => undefined)
    });
    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.reason).toBe('mining_timeout');
  });

  it('reports a miner failure rather than fabricating a prediction', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => {
        throw new Error('miner exploded');
      }
    });
    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.reason).toBe('mining_failed');
    expect(decision.prediction).toBeUndefined();
  });
});

/**
 * Canonical task paths must not produce false matches (Task 50.2 checkpoint)
 *
 * The declared set comes from participant behaviour, so a canonical task path is a *sample
 * the gate was not fitted to*. Two properties matter:
 *
 * - the gate reports only a declared pattern the path actually contains — no loose match;
 * - a path that contains a declared sequence resolves to that sequence's semantic outcome.
 *
 * `SELECT_REGION` paths are included because the macro mapper still misclassifies the
 * `tooltip-region` tooltip; no declared pattern may contain that symbol, so no match may
 * name it.
 */
describe('Canonical task paths and the declared participant set (Task 50.2)', () => {
  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '../wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm');
    await initWasm({ module_or_path: fs.readFileSync(wasmPath) });
  });

  const CANONICAL_PATHS: Record<string, string[]> = {
    TD1: [
      'NAV_ANALYTICS',
      'OPEN_FILTERS',
      'SELECT_DATE',
      'SELECT_REGION',
      'APPLY_FILTER',
      'EXPORT_REPORT'
    ],
    TD2: ['NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_CATEGORY', 'APPLY_FILTER'],
    TD3: ['NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_DATE', 'APPLY_FILTER', 'RESET_FILTERS'],
    TD4: ['NAV_REPORTS', 'OPEN_REPORT', 'EXPORT_REPORT']
  };

  const containsInOrder = (sequence: string[], pattern: string[]): boolean => {
    let cursor = 0;
    for (const symbol of sequence) {
      if (symbol === pattern[cursor]) cursor++;
      if (cursor === pattern.length) return true;
    }
    return pattern.length === 0;
  };

  function gateFor(path: string[], patternMap: Record<string, PatternIntervention>) {
    return new PrefixSpanFastGate({
      getSequences: () => [path],
      minSupport: 1,
      maxPatternLength: 4,
      maxPatterns: 32,
      mine: wasmPatternMiner,
      resolveIntervention: (key) => patternMap[key] ?? null,
      outcomeVocabulary: TESTBED_SEMANTIC_VOCABULARY
    });
  }

  it('only reports a declared pattern the canonical path contains', async () => {
    for (const [taskId, path] of Object.entries(CANONICAL_PATHS)) {
      const decision = await gateFor(path, TESTBED_FAST_GATE_DECLARATIONS).evaluate(seq(...path));
      if (!decision.matched) continue;

      expect(decision.matchedPattern, taskId).toBeDefined();
      expect(containsInOrder(path, decision.matchedPattern!), taskId).toBe(true);
      // And the reported pattern must be a declared one.
      expect(TESTBED_FAST_GATE_DECLARATIONS).toHaveProperty(
        decision.matchedPattern!.join(' > ')
      );
    }
  });

  it('resolves the TD4 report path to select_report', async () => {
    const path = CANONICAL_PATHS.TD4;
    const decision = await gateFor(path, TESTBED_FAST_GATE_DECLARATIONS).evaluate(seq(...path));

    expect(decision.matched).toBe(true);
    expect(decision.matchedPattern).toEqual(['NAV_REPORTS', 'OPEN_REPORT']);
    expect(decision.prediction?.outcomeId).toBe('select_report');
    expect(decision.prediction?.vocabularyId).toBe('testbed-semantic');
  });

  it('never reports a SELECT_REGION pattern, even on a path that contains it', async () => {
    const path = CANONICAL_PATHS.TD1;
    expect(path).toContain('SELECT_REGION');
    const decision = await gateFor(path, TESTBED_FAST_GATE_DECLARATIONS).evaluate(seq(...path));

    expect(decision.matchedPattern ?? []).not.toContain('SELECT_REGION');
    for (const key of Object.keys(TESTBED_FAST_GATE_DECLARATIONS)) {
      expect(key.split(' > ')).not.toContain('SELECT_REGION');
    }
  });
});
