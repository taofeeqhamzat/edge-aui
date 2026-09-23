import { describe, it, expect } from 'vitest';
import { PrefixSpanFastGate, MinedPattern } from '../src/gates/fast/prefixSpanFastGate';
import { MacroInteraction } from '../src/telemetry/events';

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
      mine: async (sequences) => {
        seenCorpus = sequences;
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
