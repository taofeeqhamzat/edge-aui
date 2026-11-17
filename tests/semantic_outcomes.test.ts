/**
 * Semantic Outcome Derivation and Canonicalization (Task 20.4)
 *
 * One committed participant act must produce one semantic outcome, from the *canonical*
 * event rather than from substring guesses. The vocabulary and its rules belong to the
 * application (here: the testbed); the framework supplies the canonical-action layer, the
 * rule contract, route-level backtracking and the trace fields.
 *
 * Every approved vocabulary rule has a positive case and at least one negative case here,
 * because the defects this task fixes were all "looks right on the happy path" defects:
 * `btn-export` classified as a form submit, `blur` classified as a backtrack, a region
 * substring classified as a region selection.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalActionFor,
  isCompanionAction,
  isSubmitControl
} from '../src/outcome/canonical';
import { RouteBacktrackingTracker } from '../src/outcome/backtracking';
import { SemanticOutcomeDeriver } from '../src/outcome/semantic';
import {
  TESTBED_SEMANTIC_VOCABULARY,
  createTestbedSemanticRules
} from '../src/testbed/config/semanticOutcomes';
import { OutcomeDeriver, deriveOutcomeForWindow } from '../src/outcome/derive';
import type { BehaviourEvent } from '../src/telemetry/events';

const ROUTE = 'Analytics';

function ev(overrides: Partial<BehaviourEvent> = {}): BehaviourEvent {
  return { timestamp: 1_700_000_000_000, type: 'click', route: ROUTE, ...overrides };
}

function derivedOutcome(overrides: Partial<BehaviourEvent>, startingRoute = 'Overview'): string {
  const deriver = new SemanticOutcomeDeriver({
    vocabulary: TESTBED_SEMANTIC_VOCABULARY,
    rules: createTestbedSemanticRules(),
    startingRoute
  });
  return deriver.observe(ev(overrides)).outcomeId;
}

describe('canonical action layer', () => {
  it('classifies the committed interaction types the observer emits', () => {
    expect(canonicalActionFor(ev({ type: 'click' }))?.kind).toBe('click');
    expect(canonicalActionFor(ev({ type: 'change' }))?.kind).toBe('change');
    expect(canonicalActionFor(ev({ type: 'input' }))?.kind).toBe('input');
    expect(canonicalActionFor(ev({ type: 'submit' }))?.kind).toBe('submit');
    expect(canonicalActionFor(ev({ type: 'blur' }))?.kind).toBe('blur');
    expect(canonicalActionFor(ev({ type: 'focus' }))?.kind).toBe('focus');
    expect(canonicalActionFor(ev({ type: 'mouseover' }))?.kind).toBe('hover');
    expect(canonicalActionFor(ev({ type: 'navigation' }))?.kind).toBe('navigate');
    expect(canonicalActionFor(ev({ type: 'pagehide' }))?.kind).toBe('lifecycle');
  });

  it('ignores motor events that carry no macro intent', () => {
    expect(canonicalActionFor(ev({ type: 'mousemove' }))).toBeNull();
    expect(canonicalActionFor(ev({ type: 'mouseout' }))).toBeNull();
  });

  it('retains the raw event as evidence', () => {
    const event = ev({ type: 'click', componentId: 'anything' });
    expect(canonicalActionFor(event)?.event).toBe(event);
  });

  it('shares the companion rule between the task bridge and derivation', () => {
    // A change step is committed by `change`; its click/input companions are not errors.
    expect(isCompanionAction('change', 'click')).toBe(true);
    expect(isCompanionAction('change', 'input')).toBe(true);
    // A click step on a submit control is committed by `click`; the form submit is its companion.
    expect(isCompanionAction('click', 'submit')).toBe(true);
    // Anything else is a real interaction, and may be a task error.
    expect(isCompanionAction('click', 'click')).toBe(false);
    expect(isCompanionAction('change', 'change')).toBe(false);
  });

  it('identifies a submit control from the annotation role, not from its id', () => {
    expect(
      isSubmitControl(canonicalActionFor(ev({ componentId: 'btn-apply', componentRole: 'submit-action' }))!)
    ).toBe(true);
    expect(
      isSubmitControl(canonicalActionFor(ev({ componentId: 'btn-export', componentRole: 'primary-action' }))!)
    ).toBe(false);
    expect(isSubmitControl(canonicalActionFor(ev({ type: 'submit' }))!)).toBe(true);
  });
});

describe('approved semantic vocabulary rules', () => {
  it('declares the approved vocabulary with a version', () => {
    expect(TESTBED_SEMANTIC_VOCABULARY.version).toBeTruthy();
    for (const id of [
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
    ]) {
      expect(TESTBED_SEMANTIC_VOCABULARY.outcomes).toContain(id);
    }
  });

  it('derives each navigation destination by exact component id', () => {
    expect(derivedOutcome({ type: 'click', componentRole: 'navigation', componentId: 'nav-Overview' })).toBe('navigate_overview');
    expect(derivedOutcome({ type: 'click', componentRole: 'navigation', componentId: 'nav-Analytics' })).toBe('navigate_analytics');
    expect(derivedOutcome({ type: 'click', componentRole: 'navigation', componentId: 'nav-Reports' })).toBe('navigate_reports');
  });

  it('derives a report selection', () => {
    expect(derivedOutcome({ type: 'click', componentId: 'open-report-eu-books' })).toBe('select_report');
  });

  it('derives filter-section disclosure from the observed expanded state', () => {
    expect(
      derivedOutcome({ type: 'click', componentRole: 'accordion', componentId: 'filter-section-region', ariaExpanded: true })
    ).toBe('open_filter_section');
    expect(
      derivedOutcome({ type: 'click', componentRole: 'accordion', componentId: 'filter-section-region', ariaExpanded: false })
    ).toBe('close_filter_section');
  });

  it('derives the committed filter-field selections', () => {
    expect(derivedOutcome({ type: 'change', componentId: 'filter-Region-select' })).toBe('select_region');
    expect(derivedOutcome({ type: 'change', componentId: 'filter-date-input' })).toBe('select_date_range');
    expect(derivedOutcome({ type: 'change', componentId: 'filter-category-books' })).toBe('select_category');
  });

  it('derives apply/reset/export from the declared control, not from a generic click', () => {
    expect(
      derivedOutcome({ type: 'click', componentId: 'btn-apply-filters', componentRole: 'submit-action' })
    ).toBe('apply_filter');
    expect(derivedOutcome({ type: 'click', componentId: 'btn-reset-filters', componentRole: 'secondary-action' })).toBe('reset_filter');
    expect(derivedOutcome({ type: 'click', componentId: 'btn-export', componentRole: 'primary-action' })).toBe('export_report');
  });

  it('derives contextual help for the tooltip affordance', () => {
    expect(derivedOutcome({ type: 'click', componentRole: 'tooltip', componentId: 'tooltip-region' })).toBe('inspect_help');
  });
});

describe('negative cases: exact identity wins', () => {
  it('does not classify export as apply_filter, nor apply as export', () => {
    expect(
      derivedOutcome({ type: 'click', componentId: 'btn-export', componentRole: 'primary-action' })
    ).not.toBe('apply_filter');
    expect(
      derivedOutcome({ type: 'click', componentId: 'btn-apply-filters', componentRole: 'submit-action' })
    ).not.toBe('export_report');
  });

  it('does not classify a report open as a navigation, even on the Analytics route', () => {
    expect(derivedOutcome({ type: 'click', componentId: 'open-report-eu-books', route: 'Analytics' })).toBe(
      'select_report'
    );
    expect(derivedOutcome({ type: 'click', componentId: 'open-report-eu-books', route: 'Analytics' })).not.toBe(
      'navigate_analytics'
    );
  });

  it('classifies a tooltip region as help, not a region selection', () => {
    expect(derivedOutcome({ type: 'click', componentRole: 'tooltip', componentId: 'tooltip-region' })).toBe(
      'inspect_help'
    );
    expect(derivedOutcome({ type: 'click', componentRole: 'tooltip', componentId: 'tooltip-region' })).not.toBe(
      'select_region'
    );
  });

  it('does not turn a row hover into a row selection', () => {
    expect(derivedOutcome({ type: 'mouseover', componentRole: 'table-row', componentId: 'table-row-3' })).toBe(
      'NO_OUTCOME'
    );
  });

  it('does not turn a tooltip hover into contextual help', () => {
    // Hover is inspection intent, not a committed inspect-help act (TD5 is out of scope).
    expect(derivedOutcome({ type: 'mouseover', componentRole: 'tooltip', componentId: 'tooltip-region' })).toBe(
      'NO_OUTCOME'
    );
  });

  it('does not turn blur, accordion collapse or a filter edit into a backtrack', () => {
    expect(derivedOutcome({ type: 'blur', componentId: 'filter-Region-select' })).toBe('NO_OUTCOME');
    expect(
      derivedOutcome({ type: 'click', componentRole: 'accordion', componentId: 'filter-section-region', ariaExpanded: false })
    ).toBe('close_filter_section');
    expect(derivedOutcome({ type: 'change', componentId: 'filter-Region-select' })).toBe('select_region');
  });

  it('does not classify an unannotated click', () => {
    expect(derivedOutcome({ type: 'click', componentId: 'mystery-control' })).toBe('NO_OUTCOME');
  });

  it('excludes a system-initiated action from participant outcomes', () => {
    expect(
      derivedOutcome({
        type: 'click',
        componentId: 'open-report-eu-books',
        systemInitiated: true
      })
    ).toBe('NO_OUTCOME');
  });
});

describe('route-level backtracking', () => {
  it('seeds the visited pages with the starting page', () => {
    const tracker = new RouteBacktrackingTracker('Overview');
    expect(tracker.getVisitedPages()).toEqual(['Overview']);
  });

  it('emits backtrack only for a deliberate move to a previously visited page', () => {
    const deriver = new SemanticOutcomeDeriver({
      vocabulary: TESTBED_SEMANTIC_VOCABULARY,
      rules: createTestbedSemanticRules(),
      startingRoute: 'Overview'
    });

    // Overview -> Analytics is forward.
    expect(
      deriver.observe(ev({ type: 'navigation', route: 'Analytics' })).outcomeId
    ).toBe('NO_OUTCOME');
    // Analytics -> Overview is a reversal.
    expect(
      deriver.observe(ev({ type: 'navigation', route: 'Overview' })).outcomeId
    ).toBe('backtrack');
    expect(deriver.getVisitedPages()).toEqual(['Overview', 'Analytics']);
  });

  it('does not emit backtrack for a same-page click', () => {
    const deriver = new SemanticOutcomeDeriver({
      vocabulary: TESTBED_SEMANTIC_VOCABULARY,
      rules: createTestbedSemanticRules(),
      startingRoute: 'Reports'
    });

    const outcome = deriver.observe(
      ev({ type: 'click', componentRole: 'navigation', componentId: 'nav-Reports', route: 'Reports' })
    );
    expect(outcome.outcomeId).not.toBe('backtrack');
    expect(outcome.outcomeId).toBe('navigate_reports');
  });

  it('does not emit backtrack for blur, disclosure or filter edits', () => {
    const deriver = new SemanticOutcomeDeriver({
      vocabulary: TESTBED_SEMANTIC_VOCABULARY,
      rules: createTestbedSemanticRules(),
      startingRoute: 'Analytics'
    });

    for (const event of [
      ev({ type: 'blur' }),
      ev({ type: 'click', componentRole: 'accordion', componentId: 'filter-section-region', ariaExpanded: false }),
      ev({ type: 'change', componentId: 'filter-Region-select' })
    ]) {
      expect(deriver.observe(event).outcomeId).not.toBe('backtrack');
    }
    expect(deriver.getVisitedPages()).toEqual(['Analytics']);
  });
});

describe('generic outcome derivation uses canonical identity', () => {
  it('classifies a submit control as FORM_SUBMIT and export as CLICK', () => {
    const submit = deriveOutcomeForWindow({
      windowEndMs: 0,
      futureEvents: [ev({ timestamp: 600, type: 'click', componentRole: 'submit-action', componentId: 'btn-apply' })]
    });
    const exportClick = deriveOutcomeForWindow({
      windowEndMs: 0,
      futureEvents: [ev({ timestamp: 600, type: 'click', componentRole: 'primary-action', componentId: 'btn-export' })]
    });

    expect(submit.outcome).toBe('FORM_SUBMIT');
    expect(exportClick.outcome).toBe('CLICK');
  });

  it('does not classify blur as BACKTRACK', () => {
    const result = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [ev({ timestamp: 600, type: 'blur' })] });
    expect(result.outcome).not.toBe('BACKTRACK');
  });

  it('records the semantic outcome alongside the generic outcome', () => {
    const deriver = new OutcomeDeriver({
      semanticOutcomes: new SemanticOutcomeDeriver({
        vocabulary: TESTBED_SEMANTIC_VOCABULARY,
        rules: createTestbedSemanticRules(),
        startingRoute: 'Overview'
      })
    });

    const events = [
      ev({ timestamp: 1000, type: 'click', componentRole: 'submit-action', componentId: 'btn-apply-filters' })
    ];
    for (const event of events) deriver.push(event);

    const outcomeEvent = deriver.deriveForWindow({ windowId: 1, windowEnd: 0 }, {});

    expect(outcomeEvent.outcome).toBe('FORM_SUBMIT');
    expect(outcomeEvent.taskOutcome).toBe('apply_filter');
    expect(outcomeEvent.taskOutcomeVocabularyVersion).toBe(TESTBED_SEMANTIC_VOCABULARY.version);
    expect(outcomeEvent.taskOutcomeSource).toBe('application_rule');
  });

  it('records a backtrack semantic outcome with a generic BACKTRACK', () => {
    const deriver = new OutcomeDeriver({
      semanticOutcomes: new SemanticOutcomeDeriver({
        vocabulary: TESTBED_SEMANTIC_VOCABULARY,
        rules: createTestbedSemanticRules(),
        startingRoute: 'Overview'
      })
    });

    deriver.push(ev({ timestamp: 800, type: 'navigation', route: 'Analytics' }));
    deriver.deriveForWindow({ windowId: 1, windowEnd: 0 }, {});
    deriver.push(ev({ timestamp: 1900, type: 'navigation', route: 'Overview' }));

    const outcomeEvent = deriver.deriveForWindow({ windowId: 2, windowEnd: 1000 }, {});
    expect(outcomeEvent.taskOutcome).toBe('backtrack');
    expect(outcomeEvent.taskOutcomeSource).toBe('backtrack');
    expect(outcomeEvent.outcome).toBe('BACKTRACK');
  });
});
