/**
 * Declared Fast Gate pattern validation (Task 50.2)
 *
 * A pattern declaration is configuration: a sequence, the target it resolves to, and the
 * evidence behind it. These tests pin the rules that keep the declared set honest — a
 * declaration that cannot fire, names an unknown symbol or outcome, or claims more support
 * than was measured must fail loudly rather than become a silent runtime miss.
 *
 * The last group validates the testbed's own participant-derived set, including the
 * exclusion of symbols the macro layer cannot produce (assessment limitation #6, plan §2.8).
 */

import { describe, it, expect } from 'vitest';
import {
  PatternDeclaration,
  PatternDeclarationContext,
  patternKey,
  validatePatternDeclarations
} from '../src/gates/fast/patternDeclaration';
import { MockFastGate } from '../src/gates/fast/mockFastGate';
import { MacroInteraction } from '../src/telemetry/events';
import {
  TESTBED_FAST_GATE_DECLARATIONS,
  TESTBED_FAST_GATE_DECLARATION_LIST,
  TESTBED_FAST_GATE_PATTERNS,
  TESTBED_FAST_GATE_PATTERN_VERSION,
  TESTBED_PATTERN_EVIDENCE_FLOOR
} from '../src/testbed/config/fastGatePatterns';
import { TESTBED_SEMANTIC_VOCABULARY } from '../src/testbed/config/semanticOutcomes';

const VOCABULARY = {
  id: 'test',
  version: 'test/1.0.0',
  outcomes: ['no_op', 'highlight_primary_action', 'select_x', 'apply_x']
} as const;

const context: PatternDeclarationContext = {
  vocabulary: VOCABULARY,
  isKnownSymbol: (symbol) => ['A', 'B', 'C'].includes(symbol),
  minSupport: 3,
  maxPatternLength: 4,
  totalSessions: 20,
  requiredProvenance: 'participant'
};

function declaration(
  sequence: string[],
  overrides: Partial<PatternDeclaration> = {}
): PatternDeclaration {
  return {
    sequence,
    target: { outcomeId: 'select_x' },
    evidence: {
      supportSessions: 5,
      occurrences: 7,
      tasks: ['TD1'],
      provenance: 'participant',
      source: 'fixture'
    },
    ...overrides
  };
}

function expectInvalid(declarations: PatternDeclaration[], message: string): void {
  expect(() => validatePatternDeclarations(declarations, context)).toThrow(message);
}

describe('Pattern declaration validation (Task 50.2)', () => {
  it('returns a patternKey -> target map for a valid set', () => {
    const targets = validatePatternDeclarations([declaration(['A', 'B'])], context);
    expect([...targets.keys()]).toEqual(['A > B']);
    expect(targets.get('A > B')).toEqual({ outcomeId: 'select_x' });
  });

  it('accepts an empty declared set', () => {
    expect(validatePatternDeclarations([], context).size).toBe(0);
  });

  it('rejects an empty sequence', () => {
    expectInvalid([declaration([])], 'non-empty sequence');
  });

  it('rejects a symbol the macro vocabulary cannot produce', () => {
    expectInvalid([declaration(['A', 'NOT_A_SYMBOL'])], "uses symbol 'NOT_A_SYMBOL'");
  });

  it('rejects a pattern longer than the declared maximum', () => {
    expectInvalid([declaration(['A', 'B', 'C' ]), declaration(['A', 'B', 'C', 'A', 'B'])], 'more than the declared maximum 4');
  });

  it('rejects a duplicate pattern', () => {
    expectInvalid(
      [declaration(['A', 'B']), declaration(['A', 'B'])],
      "Pattern 'A > B' is declared more than once"
    );
  });

  it('rejects an outcome outside the gate vocabulary', () => {
    expectInvalid(
      [declaration(['A'], { target: { outcomeId: 'select_neptune' } })],
      "outcome 'select_neptune'"
    );
  });

  it('rejects a confidence outside [0, 1]', () => {
    expectInvalid(
      [declaration(['A'], { target: { outcomeId: 'select_x', confidence: 1.5 } })],
      'outside [0, 1]'
    );
  });

  it('accepts a legacy intervention target for migration readability', () => {
    const targets = validatePatternDeclarations(
      [declaration(['A'], { target: 'highlight_primary_action' })],
      context
    );
    expect(targets.get('A')).toBe('highlight_primary_action');
  });

  it('rejects an unknown legacy intervention target', () => {
    expectInvalid(
      [declaration(['A'], { target: 'make_it_shiny' as never })],
      "unknown intervention 'make_it_shiny'"
    );
  });

  it('rejects evidence weaker than the gate minimum support', () => {
    expectInvalid(
      [
        declaration(['A'], {
          evidence: {
            supportSessions: 2,
            occurrences: 2,
            tasks: ['TD1'],
            provenance: 'participant',
            source: 'fixture'
          }
        })
      ],
      'can never fire'
    );
  });

  it('rejects support above the measured session count', () => {
    expectInvalid(
      [
        declaration(['A'], {
          evidence: {
            supportSessions: 21,
            occurrences: 30,
            tasks: ['TD1'],
            provenance: 'participant',
            source: 'fixture'
          }
        })
      ],
      'more than the 20 measured'
    );
  });

  it('rejects fewer occurrences than supporting sessions', () => {
    expectInvalid(
      [
        declaration(['A'], {
          evidence: {
            supportSessions: 6,
            occurrences: 5,
            tasks: ['TD1'],
            provenance: 'participant',
            source: 'fixture'
          }
        })
      ],
      'at least one occurrence per supporting session'
    );
  });

  it('rejects evidence without task coverage', () => {
    expectInvalid(
      [
        declaration(['A'], {
          evidence: {
            supportSessions: 5,
            occurrences: 7,
            tasks: [],
            provenance: 'participant',
            source: 'fixture'
          }
        })
      ],
      'must name the tasks'
    );
  });

  it('rejects evidence without a source a reader can audit', () => {
    expectInvalid(
      [
        declaration(['A'], {
          evidence: {
            supportSessions: 5,
            occurrences: 7,
            tasks: ['TD1'],
            provenance: 'participant',
            source: ''
          }
        })
      ],
      'where its evidence lives'
    );
  });

  it('rejects scripted evidence when the declared set requires participant evidence', () => {
    expectInvalid(
      [
        declaration(['A'], {
          evidence: {
            supportSessions: 5,
            occurrences: 7,
            tasks: ['TD1'],
            provenance: 'scripted',
            source: 'fixture'
          }
        })
      ],
      "has 'scripted' evidence"
    );
  });
});

describe('Testbed participant-derived pattern set (Task 50.2)', () => {
  const excludedSymbols = [
    'BACKTRACK',
    'IDLE_DWELL',
    'RAPID_SCROLL',
    'SELECT_SEGMENT',
    'SELECT_REGION',
    'TABLE_PAGE_NEXT',
    'TABLE_PAGE_PREV',
    'TABLE_ROW_SELECT',
    'TABLE_SORT'
  ];

  it('is validated and versioned', () => {
    expect(TESTBED_FAST_GATE_PATTERN_VERSION).toBe('testbed-patterns/2.0.0');
    expect(TESTBED_FAST_GATE_DECLARATION_LIST.length).toBeGreaterThan(10);
    expect(Object.keys(TESTBED_FAST_GATE_DECLARATIONS)).toHaveLength(
      TESTBED_FAST_GATE_DECLARATION_LIST.length
    );
  });

  it('declares only participant evidence at or above the evidence floor', () => {
    for (const pattern of TESTBED_FAST_GATE_DECLARATION_LIST) {
      expect(pattern.evidence.provenance).toBe('participant');
      expect(pattern.evidence.supportSessions).toBeGreaterThanOrEqual(
        TESTBED_PATTERN_EVIDENCE_FLOOR
      );
      expect(pattern.evidence.tasks.length).toBeGreaterThan(0);
      expect(pattern.evidence.source).toContain('participant-patterns');
    }
  });

  it('maps every pattern to a semantic outcome in the testbed vocabulary', () => {
    for (const target of Object.values(TESTBED_FAST_GATE_DECLARATIONS)) {
      expect(typeof target).toBe('object');
      expect('outcomeId' in target).toBe(true);
      const outcomeId = (target as { outcomeId: string }).outcomeId;
      expect(TESTBED_SEMANTIC_VOCABULARY.outcomes).toContain(outcomeId);
    }
  });

  it('never declares a symbol the macro layer cannot produce or misclassifies', () => {
    for (const pattern of TESTBED_FAST_GATE_DECLARATION_LIST) {
      for (const symbol of pattern.sequence) {
        expect(excludedSymbols).not.toContain(symbol);
      }
    }
  });

  it('does not declare the scripted-only sequences the old table used', () => {
    // `NAV_ANALYTICS > OPEN_FILTERS`, `SELECT_DATE > OPEN_FILTERS > SELECT_REGION >
    // APPLY_FILTER` and `HOVER_KPI > HOVER_KPI` came from canonical scripted paths, not
    // participant behaviour. Declaring them would treat a scripted trace as evidence.
    expect(TESTBED_FAST_GATE_DECLARATIONS).not.toHaveProperty('NAV_ANALYTICS > OPEN_FILTERS');
    expect(TESTBED_FAST_GATE_DECLARATIONS).not.toHaveProperty('HOVER_KPI > HOVER_KPI');
    expect(TESTBED_FAST_GATE_DECLARATIONS).not.toHaveProperty(
      'SELECT_DATE > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER'
    );
  });

  it('keeps the legacy intervention form readable during migration', async () => {
    const gate = new MockFastGate({ patterns: TESTBED_FAST_GATE_PATTERNS });
    const sequence: MacroInteraction[] = [
      { timestamp: 0, symbol: 'OPEN_FILTERS' },
      { timestamp: 100, symbol: 'APPLY_FILTER' }
    ];
    const decision = await gate.evaluate(sequence);
    expect(decision.matched).toBe(true);
    expect(decision.intervention?.type).toBe('highlight_primary_action');
  });

  it('keys every declaration with the shared pattern key format', () => {
    for (const pattern of TESTBED_FAST_GATE_DECLARATION_LIST) {
      expect(TESTBED_FAST_GATE_DECLARATIONS).toHaveProperty(patternKey(pattern.sequence));
    }
  });
});
