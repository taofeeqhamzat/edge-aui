import { describe, it, expect } from 'vitest';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MacroInteraction } from '../src/telemetry/events';

function makeSequence(symbols: string[]): MacroInteraction[] {
  let t = 1000;
  return symbols.map((symbol) => ({
    timestamp: (t += 100),
    symbol,
    componentId: `comp-${symbol.toLowerCase()}`
  }));
}

describe('FastGate & MockFastGate', () => {
  it('returns matched: false on an empty sequence', async () => {
    const gate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
      }
    });

    const decision = await gate.evaluate([]);
    expect(decision.matched).toBe(false);
    expect(decision.source).toBe('fast');
    expect(decision.intervention).toBeUndefined();
  });

  it('returns matched: false when sequence does not match any pattern', async () => {
    const gate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION': 'highlight_primary_action'
      }
    });

    const seq = makeSequence(['NAV_OVERVIEW', 'HOVER_KPI', 'SELECT_DATE']);
    const decision = await gate.evaluate(seq);

    expect(decision.matched).toBe(false);
    expect(decision.source).toBe('fast');
  });

  it('matches exact sequence and emits candidate InterventionCommand', async () => {
    const gate = new MockFastGate({
      patterns: {
        'NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION': 'highlight_primary_action'
      },
      defaultConfidence: 0.95
    });

    const seq = makeSequence(['NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_REGION']);
    const decision = await gate.evaluate(seq);

    expect(decision.matched).toBe(true);
    expect(decision.source).toBe('fast');
    expect(decision.confidence).toBe(0.95);
    expect(decision.matchedPattern).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_REGION']);
    expect(decision.intervention).toBeDefined();
    expect(decision.intervention?.type).toBe('highlight_primary_action');
    expect(decision.intervention?.source).toBe('fast');
    expect(decision.intervention?.confidence).toBe(0.95);
    expect(typeof decision.intervention?.issuedAt).toBe('number');
  });

  it('matches pattern as suffix of longer interaction sequence', async () => {
    const gate = new MockFastGate({
      patterns: {
        'OPEN_FILTERS > SELECT_REGION': 'simplify_options'
      }
    });

    const seq = makeSequence(['NAV_OVERVIEW', 'NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_REGION']);
    const decision = await gate.evaluate(seq);

    expect(decision.matched).toBe(true);
    expect(decision.intervention?.type).toBe('simplify_options');
  });

  it('enforces exactMatchOnly when configured', async () => {
    const gate = new MockFastGate({
      patterns: {
        'OPEN_FILTERS > SELECT_REGION': 'simplify_options'
      },
      exactMatchOnly: true
    });

    const longSeq = makeSequence(['NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_REGION']);
    const decisionMiss = await gate.evaluate(longSeq);
    expect(decisionMiss.matched).toBe(false);

    const exactSeq = makeSequence(['OPEN_FILTERS', 'SELECT_REGION']);
    const decisionMatch = await gate.evaluate(exactSeq);
    expect(decisionMatch.matched).toBe(true);
  });

  it('supports structured InterventionCommand targets with componentId and reason', async () => {
    const gate = new MockFastGate({
      patterns: {
        'HOVER_HELP > IDLE_DWELL': {
          type: 'expand_tooltip',
          targetComponentId: 'filter-date-help',
          confidence: 0.88,
          reason: 'User paused on date help icon'
        }
      }
    });

    const seq = makeSequence(['HOVER_HELP', 'IDLE_DWELL']);
    const decision = await gate.evaluate(seq);

    expect(decision.matched).toBe(true);
    expect(decision.intervention?.type).toBe('expand_tooltip');
    expect(decision.intervention?.targetComponentId).toBe('filter-date-help');
    expect(decision.intervention?.confidence).toBe(0.88);
    expect(decision.intervention?.reason).toBe('User paused on date help icon');
  });

  it('allows dynamic addition, modification, and removal of patterns', async () => {
    const gate = new MockFastGate();

    // Initially no match
    const seq = makeSequence(['NAV_CUSTOMERS', 'TABLE_PAGE_NEXT']);
    let decision = await gate.evaluate(seq);
    expect(decision.matched).toBe(false);

    // Add pattern
    gate.setPattern(['NAV_CUSTOMERS', 'TABLE_PAGE_NEXT'], 'offer_assistance');
    decision = await gate.evaluate(seq);
    expect(decision.matched).toBe(true);
    expect(decision.intervention?.type).toBe('offer_assistance');

    // Remove pattern
    const removed = gate.removePattern('NAV_CUSTOMERS > TABLE_PAGE_NEXT');
    expect(removed).toBe(true);
    decision = await gate.evaluate(seq);
    expect(decision.matched).toBe(false);

    // Clear patterns
    gate.setPattern('A > B', 'no_op');
    gate.clearPatterns();
    expect(Object.keys(gate.getPatterns()).length).toBe(0);
  });
});
