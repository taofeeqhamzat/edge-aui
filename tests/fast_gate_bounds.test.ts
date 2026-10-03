/**
 * Bounded Fast Gate Execution (supervisor-ready deployment §13 / assessment F-02)
 *
 * The pre-1.3.0 Fast Gate had no bound on corpus size, pattern length or pattern count, and
 * the miner ran inside a strictly serial worker loop. Measured live: p95 2 943 ms / max
 * 3 149 ms on a corpus of at most nine sequences, with `Worker request … timed out after
 * 5000ms` and windows dropped mid-trial.
 *
 * These tests pin the behaviour that replaces it:
 * - the corpus sent to the miner is capped;
 * - over-long and excess patterns are discarded before matching;
 * - a mining call that exceeds its deadline is reported as `timed_out`, not as a silent miss;
 * - every evaluation reports how it ended, so "nothing happened" is never ambiguous.
 */

import { describe, it, expect, vi } from 'vitest';
import { PrefixSpanFastGate, MinedPattern } from '../src/gates/fast/prefixSpanFastGate';
import { MacroInteraction } from '../src/telemetry/events';

const seq = (...symbols: string[]): MacroInteraction[] =>
  symbols.map((symbol, i) => ({ timestamp: (i + 1) * 100, symbol }));

describe('Bounded Fast Gate execution (F-02)', () => {
  it('caps the corpus it sends to the miner and keeps the current session in it', async () => {
    const longHistory = Array.from({ length: 500 }, (_, i) => [`OLD_${i}`]);
    let corpusSeen: string[][] = [];

    const gate = new PrefixSpanFastGate({
      getSequences: () => longHistory,
      maxCorpusSequences: 10,
      mine: async (sequences) => {
        corpusSeen = sequences;
        return [];
      }
    });

    await gate.evaluate(seq('NAV_ANALYTICS', 'OPEN_FILTERS'));

    // 10 most recent history entries plus the current session's own symbols.
    expect(corpusSeen).toHaveLength(11);
    expect(corpusSeen[corpusSeen.length - 1]).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS']);
    // The retained history must be the most recent, not the oldest.
    expect(corpusSeen[0]).toEqual(['OLD_490']);
    expect(corpusSeen.some((s) => s[0] === 'OLD_0')).toBe(false);
  });

  it('discards patterns longer than maxPatternLength before matching', async () => {
    const overLong: MinedPattern = {
      pattern: ['A', 'B', 'C', 'D', 'E', 'F'],
      support: 99,
      confidence: 1.0
    };
    const acceptable: MinedPattern = {
      pattern: ['OPEN_FILTERS', 'APPLY_FILTER'],
      support: 2,
      confidence: 0.9
    };

    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      maxPatternLength: 4,
      // The over-long pattern has far higher support, so only the length filter can stop it.
      mine: async () => [overLong, acceptable],
      resolveIntervention: (key) => (key === 'OPEN_FILTERS > APPLY_FILTER' ? 'highlight_primary_action' : null)
    });

    const decision = await gate.evaluate(seq('OPEN_FILTERS', 'APPLY_FILTER'));

    expect(decision.matched).toBe(true);
    expect(decision.matchedPattern).toEqual(['OPEN_FILTERS', 'APPLY_FILTER']);
  });

  it('reports a timed-out mining call as `timed_out` rather than a silent miss', async () => {
    const outcomes: string[] = [];

    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      miningTimeoutMs: 30,
      onEvaluationOutcome: (outcome) => outcomes.push(outcome),
      // Never resolves: simulates the multi-second WASM mine that blocked the worker.
      mine: () => new Promise<MinedPattern[]>(() => undefined)
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));

    expect(decision.matched).toBe(false);
    expect(decision.intervention).toBeUndefined();
    expect(outcomes).toEqual(['timed_out']);
  });

  it('reports a miner failure as `failed` and still returns a safe miss', async () => {
    const outcomes: string[] = [];

    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      onEvaluationOutcome: (outcome) => outcomes.push(outcome),
      mine: async () => {
        throw new Error('miner exploded');
      }
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));

    expect(decision.matched).toBe(false);
    expect(outcomes).toEqual(['failed']);
  });

  it('reports `executed` for a normal evaluation, matched or not', async () => {
    const outcomes: string[] = [];
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => [],
      onEvaluationOutcome: (outcome) => outcomes.push(outcome)
    });

    await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(outcomes).toEqual(['executed']);
  });

  it('limits how many patterns it considers per evaluation', async () => {
    const patterns: MinedPattern[] = Array.from({ length: 50 }, (_, i) => ({
      pattern: [`SYM_${i}`],
      support: 50 - i,
      confidence: 1.0
    }));
    const resolver = vi.fn(() => 'offer_assistance' as const);

    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      maxPatterns: 3,
      mine: async () => patterns,
      resolveIntervention: resolver
    });

    // No pattern is a subsequence of this session, so the gate exhausts its candidate budget.
    await gate.evaluate(seq('SOMETHING_ELSE'));

    expect(resolver.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('does not let a listener failure break the gate', async () => {
    const gate = new PrefixSpanFastGate({
      getSequences: () => [],
      mine: async () => [],
      onEvaluationOutcome: () => {
        throw new Error('listener exploded');
      }
    });

    const decision = await gate.evaluate(seq('NAV_ANALYTICS'));
    expect(decision.matched).toBe(false);
  });

  it('returns a miss without calling the miner when the sequence is empty', async () => {
    const mine = vi.fn(async () => []);
    const gate = new PrefixSpanFastGate({ getSequences: () => [], mine });

    const decision = await gate.evaluate([]);
    expect(decision.matched).toBe(false);
    expect(mine).not.toHaveBeenCalled();
  });
});
