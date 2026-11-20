/**
 * Testbed Declared Fast Gate Patterns (Task 50.2)
 *
 * ## Where this set comes from
 *
 * The previous table was five scripted-canonical sequences with an intervention per entry.
 * It was never validated against participant behaviour, and two of its entries could not be
 * produced by the macro layer at all. This table is derived from the participant-derived
 * candidate report instead:
 *
 *   model-preparation/docs/experiments/participant-patterns/
 *
 * Every declaration below was measured in that report: 35 participant sessions, contiguous
 * 2–4 symbol n-grams, support = number of sessions containing the pattern, minimum support
 * 3, and symbols that the macro mapper cannot produce already excluded. The recorded
 * support, occurrence count and task coverage are copied from the report, not estimated.
 *
 * Patterns containing `SELECT_REGION` are **not** declared. The report flags them because
 * the macro mapper still classifies the `tooltip-region` tooltip as a region selection
 * (assessment limitation #6, plan §2.8), so their support cannot be trusted yet. Excluding
 * them is the honest option; the macro fix is tracked separately.
 *
 * ## What a declaration means
 *
 * The declared outcome is the semantic outcome of the pattern's **final** symbol: the
 * episode is recognised as resolved by that act. The gate therefore reports what the
 * interaction episode resolved to, not a forecast of the next act — the last symbol has
 * already happened by the time the pattern is matched.
 *
 * The adaptation is *not* declared here. `outcomeId` is a semantic outcome, and
 * `testbed/config/policyAdapter.ts` decides which outcome warrants which adaptation, so the
 * pattern set and the adaptation policy stay separate decisions.
 *
 * ## Validation
 *
 * The set is validated at import time. A declaration that names an unknown symbol, an
 * outcome outside the semantic vocabulary, weaker evidence than the 3-session evidence
 * floor, or scripted provenance fails loudly instead of silently never firing.
 */

import type { InterventionType } from '../../intervention/types';
import {
  PatternDeclaration,
  validatePatternDeclarations
} from '../../gates/fast/patternDeclaration';
import { isMacroSymbol } from './macroVocabulary';
import { TESTBED_SEMANTIC_VOCABULARY } from './semanticOutcomes';

export const TESTBED_FAST_GATE_PATTERN_VERSION = 'testbed-patterns/2.0.0';

/**
 * The evidence file every declaration cites. One constant, so a moved report breaks one
 * string rather than twelve.
 */
export const TESTBED_PATTERN_EVIDENCE_SOURCE =
  'model-preparation/docs/experiments/participant-patterns/' +
  'participant-pattern-candidates.json (35 participant sessions; min support 3; 2–4 symbols)';

/** Minimum participant sessions a pattern must have before it may be declared. */
export const TESTBED_PATTERN_EVIDENCE_FLOOR = 3;

/** Sessions in the evidence report; a support claim above this is impossible. */
const EVIDENCE_SESSION_COUNT = 35;

/**
 * Semantic outcome a macro symbol resolves to.
 *
 * Only symbols that can end a declared pattern need an entry. A hover symbol has no
 * committed semantic outcome, so a pattern ending in one is not declared.
 */
const OUTCOME_OF_SYMBOL: Readonly<Record<string, string>> = {
  OPEN_FILTERS: 'open_filter_section',
  CLOSE_FILTERS: 'close_filter_section',
  SELECT_DATE: 'select_date_range',
  SELECT_CATEGORY: 'select_category',
  APPLY_FILTER: 'apply_filter',
  RESET_FILTERS: 'reset_filter',
  EXPORT_REPORT: 'export_report',
  OPEN_REPORT: 'select_report'
};

function declaration(
  sequence: readonly string[],
  evidence: Omit<PatternDeclaration['evidence'], 'provenance' | 'source'>
): PatternDeclaration {
  const finalSymbol = sequence[sequence.length - 1];
  const outcomeId = OUTCOME_OF_SYMBOL[finalSymbol];
  if (!outcomeId) {
    throw new Error(
      `[fastGatePatterns] Pattern '${sequence.join(' > ')}' ends in '${finalSymbol}', which has ` +
        'no committed semantic outcome and therefore cannot be declared.'
    );
  }
  return {
    sequence,
    target: { outcomeId },
    evidence: {
      ...evidence,
      provenance: 'participant',
      source: TESTBED_PATTERN_EVIDENCE_SOURCE
    }
  };
}

/**
 * Declared patterns, strongest evidence first.
 *
 * Ordered by measured support so the file reads as the evidence does; the gate ranks by
 * support itself, so this order is documentation rather than behaviour.
 */
const PARTICIPANT_DECLARATIONS: readonly PatternDeclaration[] = [
  declaration(['CLOSE_FILTERS', 'OPEN_FILTERS'], {
    supportSessions: 27,
    occurrences: 56,
    tasks: ['TD1', 'TD2', 'TD3']
  }),
  declaration(['SELECT_DATE', 'CLOSE_FILTERS'], {
    supportSessions: 17,
    occurrences: 22,
    tasks: ['TD1', 'TD2', 'TD3']
  }),
  declaration(['SELECT_CATEGORY', 'CLOSE_FILTERS'], {
    supportSessions: 16,
    occurrences: 25,
    tasks: ['TD2', 'TD3']
  }),
  declaration(['OPEN_FILTERS', 'SELECT_DATE'], {
    supportSessions: 16,
    occurrences: 20,
    tasks: ['TD2', 'TD3']
  }),
  declaration(['SELECT_CATEGORY', 'CLOSE_FILTERS', 'OPEN_FILTERS'], {
    supportSessions: 16,
    occurrences: 16,
    tasks: ['TD2', 'TD3']
  }),
  declaration(['APPLY_FILTER', 'RESET_FILTERS'], {
    supportSessions: 15,
    occurrences: 25,
    tasks: ['TD2', 'TD3']
  }),
  declaration(['OPEN_FILTERS', 'SELECT_CATEGORY'], {
    supportSessions: 15,
    occurrences: 19,
    tasks: ['TD2', 'TD3']
  }),
  declaration(['APPLY_FILTER', 'EXPORT_REPORT'], {
    supportSessions: 11,
    occurrences: 18,
    tasks: ['TD1']
  }),
  declaration(['HOVER_KPI', 'CLOSE_FILTERS'], {
    supportSessions: 11,
    occurrences: 12,
    tasks: ['TD1', 'TD2', 'TD3']
  }),
  declaration(['NAV_ANALYTICS', 'CLOSE_FILTERS'], {
    supportSessions: 10,
    occurrences: 10,
    tasks: ['TD1']
  }),
  declaration(['OPEN_FILTERS', 'APPLY_FILTER'], {
    supportSessions: 8,
    occurrences: 8,
    tasks: ['TD2', 'TD3']
  }),
  declaration(['NAV_REPORTS', 'OPEN_REPORT'], {
    supportSessions: 8,
    occurrences: 8,
    tasks: ['TD4']
  })
];

/**
 * The validated `patternKey -> target` map the Fast Gate consumes.
 *
 * A plain object, not a `Map`, because it crosses the worker boundary: the runtime sends it
 * to the worker as structured data and the worker resolves a matched pattern by key. Every
 * entry resolves to a semantic outcome, so a match produces a normalized prediction rather
 * than only a command.
 */
export const TESTBED_FAST_GATE_DECLARATIONS: Readonly<
  Record<string, PatternDeclaration['target']>
> = Object.fromEntries(
  validatePatternDeclarations(PARTICIPANT_DECLARATIONS, {
    vocabulary: TESTBED_SEMANTIC_VOCABULARY,
    isKnownSymbol: isMacroSymbol,
    minSupport: TESTBED_PATTERN_EVIDENCE_FLOOR,
    maxPatternLength: 4,
    totalSessions: EVIDENCE_SESSION_COUNT,
    requiredProvenance: 'participant'
  })
);

/** The declarations as data, so a test or reviewer can audit the evidence. */
export const TESTBED_FAST_GATE_DECLARATION_LIST: readonly PatternDeclaration[] =
  PARTICIPANT_DECLARATIONS;

/**
 * @deprecated Legacy `patternKey -> intervention` form, retained so existing
 * intervention-valued configuration keeps working during the migration (Task 50.2). The
 * runtime uses `TESTBED_FAST_GATE_DECLARATIONS`; this map exists to prove the legacy form is
 * still readable, not to drive behaviour.
 */
export const TESTBED_FAST_GATE_PATTERNS: Record<string, InterventionType> = {
  'OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'CLOSE_FILTERS > OPEN_FILTERS': 'simplify_options'
};
