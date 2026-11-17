/**
 * Testbed Declared Fast Gate Patterns (Task 20.2)
 *
 * Each key is a macro-symbol sequence from the testbed vocabulary; each value is the
 * declared system adaptation for it. These are the testbed's candidate deterministic
 * patterns for the Fast Gate, not framework defaults: the framework's own default map is
 * empty, and this table is injected at the composition root.
 *
 * The last entry is also the task TD1 completion path, so the task's own success sequence
 * is a pattern the Fast Gate can recognise deterministically.
 *
 * Versioned so a prediction can be attributed to a pattern set rather than to "the
 * patterns", which changed between runs.
 *
 * Task 20.3 extends each entry with the semantic outcome it maps to; the intervention value
 * stays supported during the migration.
 */

import type { InterventionType } from '../../intervention/types';

export const TESTBED_FAST_GATE_PATTERN_VERSION = 'testbed-patterns/1.0.0';

export const TESTBED_FAST_GATE_PATTERNS: Record<string, InterventionType> = {
  'OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'NAV_ANALYTICS > OPEN_FILTERS': 'simplify_options',
  'NAV_ANALYTICS > OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
  'SELECT_DATE > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER': 'highlight_primary_action',
  'HOVER_KPI > HOVER_KPI': 'expand_tooltip'
};
