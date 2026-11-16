/**
 * Testbed Semantic Outcome Rules (Task 20.4)
 *
 * The approved testbed semantic vocabulary and the rules that derive it from a classified
 * canonical action. These are application vocabulary and application rules: framework core
 * imports none of these strings.
 *
 * Rule order is the contract. Exact component identity is checked before any prefix or role
 * rule, because the defects this replaces came from loose matching:
 * - `tooltip-region` contains "region" and was classified as a region selection;
 * - `open-report-*` on the Analytics route was classified as navigation;
 * - any id containing "btn" was classified as a form submit.
 *
 * Rules only match committed acts (`click`, `change`, or a form `submit`). A hover is
 * inspection intent, not a selection, and is never a semantic outcome: TD5 hover work is out
 * of scope for this milestone.
 */

import type { CanonicalAction } from '../../outcome/canonical';
import { isSubmitControl } from '../../outcome/canonical';
import type {
  SemanticOutcomeRule,
  SemanticOutcomeVocabulary
} from '../../outcome/semantic';

export const TESTBED_SEMANTIC_VOCABULARY_ID = 'testbed-semantic';
export const TESTBED_SEMANTIC_VOCABULARY_VERSION = 'testbed-semantic/1.0.0';

export const TESTBED_SEMANTIC_VOCABULARY: SemanticOutcomeVocabulary = {
  id: TESTBED_SEMANTIC_VOCABULARY_ID,
  version: TESTBED_SEMANTIC_VOCABULARY_VERSION,
  outcomes: [
    'navigate_overview',
    'navigate_analytics',
    'navigate_reports',
    'select_report',
    'inspect_help',
    'open_filter_section',
    'close_filter_section',
    'select_region',
    'select_date_range',
    'select_category',
    'apply_filter',
    'reset_filter',
    'export_report',
    'backtrack',
    'NO_OUTCOME'
  ],
  backtrackOutcomeId: 'backtrack',
  noOutcomeId: 'NO_OUTCOME'
};

/** Matches only the committed act, never a hover or a focus change. */
function isCommittedClick(action: CanonicalAction): boolean {
  return action.kind === 'click' || action.kind === 'submit';
}

function isCommittedChange(action: CanonicalAction): boolean {
  return action.kind === 'change';
}

function hasId(action: CanonicalAction, id: string): boolean {
  return action.componentId === id;
}

function hasIdPrefix(action: CanonicalAction, prefix: string): boolean {
  return action.componentId?.startsWith(prefix) === true;
}

function hasRole(action: CanonicalAction, role: string): boolean {
  return action.componentRole === role;
}

/** `nav-*` controls name their destination in the annotation. */
function isNavigationControl(action: CanonicalAction): boolean {
  return hasRole(action, 'navigation');
}

const NAVIGATION_DESTINATIONS: ReadonlyArray<{ componentId: string; outcomeId: string }> = [
  { componentId: 'nav-Overview', outcomeId: 'navigate_overview' },
  { componentId: 'nav-Analytics', outcomeId: 'navigate_analytics' },
  { componentId: 'nav-Reports', outcomeId: 'navigate_reports' }
];

/**
 * Ordered rules.
 *
 * Exact identity rules are listed before prefix/role rules; within a rule the predicate is a
 * single equality so a new control cannot be captured by an accidental substring.
 */
export function createTestbedSemanticRules(): SemanticOutcomeRule[] {
  return [
    // ---- exact primary controls -------------------------------------------------
    {
      id: 'export_report',
      match: (action) =>
        isCommittedClick(action) && hasId(action, 'btn-export')
          ? { outcomeId: 'export_report' }
          : null
    },
    {
      id: 'reset_filter',
      match: (action) =>
        isCommittedClick(action) && hasId(action, 'btn-reset-filters')
          ? { outcomeId: 'reset_filter' }
          : null
    },
    {
      id: 'apply_filter',
      // A form submission, identified by the annotation that declares the control a submit
      // action — not by an id fragment, and not by any generic primary button.
      match: (action) =>
        isCommittedClick(action) && isSubmitControl(action) ? { outcomeId: 'apply_filter' } : null
    },

    // ---- report catalogue -------------------------------------------------------
    {
      id: 'select_report',
      match: (action) =>
        isCommittedClick(action) && hasIdPrefix(action, 'open-report-')
          ? { outcomeId: 'select_report' }
          : null
    },

    // ---- contextual help (exact affordance, before any region rule) --------------
    {
      id: 'inspect_help',
      match: (action) =>
        isCommittedClick(action) && (hasId(action, 'tooltip-region') || hasRole(action, 'tooltip'))
          ? { outcomeId: 'inspect_help' }
          : null
    },

    // ---- filter disclosure ------------------------------------------------------
    {
      id: 'open_filter_section',
      match: (action) =>
        isCommittedClick(action) && hasRole(action, 'accordion') && action.ariaExpanded === true
          ? { outcomeId: 'open_filter_section' }
          : null
    },
    {
      id: 'close_filter_section',
      match: (action) =>
        isCommittedClick(action) && hasRole(action, 'accordion') && action.ariaExpanded === false
          ? { outcomeId: 'close_filter_section' }
          : null
    },

    // ---- filter fields: committed change only ------------------------------------
    {
      id: 'select_region',
      match: (action) =>
        isCommittedChange(action) && hasId(action, 'filter-Region-select')
          ? { outcomeId: 'select_region' }
          : null
    },
    {
      id: 'select_date_range',
      match: (action) =>
        isCommittedChange(action) && hasId(action, 'filter-date-input')
          ? { outcomeId: 'select_date_range' }
          : null
    },
    {
      id: 'select_category',
      match: (action) =>
        isCommittedChange(action) && hasIdPrefix(action, 'filter-category-')
          ? { outcomeId: 'select_category' }
          : null
    },

    // ---- navigation destinations ------------------------------------------------
    ...NAVIGATION_DESTINATIONS.map(({ componentId, outcomeId }): SemanticOutcomeRule => ({
      id: outcomeId,
      match: (action) =>
        isCommittedClick(action) && isNavigationControl(action) && hasId(action, componentId)
          ? { outcomeId }
          : null
    }))
  ];
}
