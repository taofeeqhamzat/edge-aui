/**
 * Testbed intervention policy and target resolution (Task 60.1)
 *
 * These tests pin the boundary Workstream 60 exists to close:
 *
 * - the *application* decides which semantic outcome warrants which adaptation, and which
 *   element that adaptation is declared to act on (`src/testbed/config`);
 * - the generic policy still applies every safety gate to that candidate;
 * - a target the application cannot resolve is a recorded actuation failure, never a
 *   fallback to whichever control happens to be near the top of the page.
 *
 * The fixtures render the same annotations the real testbed emits, so the resolver is
 * exercised against the markup it will meet in the browser rather than a stand-in shape.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InterventionPolicy } from '../src/intervention/policy';
import { UIActuator } from '../src/intervention/actuator';
import { ADAPTATION_ATTRIBUTE } from '../src/intervention/actuator';
import {
  createTestbedCandidateResolver,
  TESTBED_SEMANTIC_OUTCOME_INTERVENTIONS
} from '../src/testbed/config/policyAdapter';
import {
  TESTBED_FILTER_OPTIONS_TARGET,
  TESTBED_INTERVENTION_TARGETS,
  TESTBED_PRIMARY_ACTION_TARGET,
  createTestbedTargetResolver
} from '../src/testbed/config/interventionTargets';
import { PREDICTION_CONTRACT_VERSION, type PredictionResult } from '../src/gates/contracts';
import type { UIContext } from '../src/types/uiContext';

const UI_CONTEXT: UIContext = {
  route: 'Analytics',
  activeComponentId: 'results-table',
  availableActions: ['click'],
  primaryActionAvailable: true,
  helpAvailable: true,
  expandable: true,
  taskId: 'TD1',
  taskStepId: 'TD1-3'
};

function prediction(overrides: Partial<PredictionResult> = {}): PredictionResult {
  return {
    predictionId: 'pred_semantic',
    outcomeId: 'apply_filter',
    vocabularyId: 'testbed-semantic',
    vocabularyVersion: 'testbed-semantic/1.0.0',
    confidence: 0.9,
    matched: true,
    source: 'slow',
    timestamp: 1_700_000_000_000,
    contractVersion: PREDICTION_CONTRACT_VERSION,
    target: { componentId: 'results-table', route: 'Analytics' },
    ...overrides
  };
}

/** The annotations the Analytics page actually renders (`FilterDrawer`, `ResultsTable`). */
function renderAnalyticsDom(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-aui-route', 'Analytics');
  root.innerHTML = `
    <div data-aui-component="filter-drawer" data-aui-role="filter">
      <div class="filter-section">
        <button data-aui-component="filter-section-date" data-aui-role="accordion" aria-expanded="false">Date Range</button>
      </div>
      <div class="filter-section">
        <button data-aui-component="filter-section-category" data-aui-role="accordion" aria-expanded="true">Product Category</button>
      </div>
      <button data-aui-component="btn-apply-filters" data-aui-role="submit-action">Apply Filters</button>
    </div>
    <div data-aui-component="results-table">
      <button data-aui-component="btn-export" data-aui-role="primary-action">Export Report</button>
      <span data-aui-component="tooltip-region" data-aui-role="tooltip" title="Geographical sales region">[?]</span>
      <span data-aui-component="tooltip-no-text" data-aui-role="tooltip">[?]</span>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

describe('testbed outcome -> adaptation mapping (Task 60.1)', () => {
  it('declares simplify_options through configuration, not framework core', () => {
    // The framework's actuator knows no application name. The testbed names the surface it
    // wants simplified, and the resolver turns that declaration into an element.
    expect(TESTBED_INTERVENTION_TARGETS.simplify_options).toBe(TESTBED_FILTER_OPTIONS_TARGET);

    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(prediction({ outcomeId: 'select_date_range' }), UI_CONTEXT);

    expect(command?.type).toBe('simplify_options');
    expect(command?.targetComponentId).toBe(TESTBED_FILTER_OPTIONS_TARGET);
    expect(command?.reason).toContain('select_date_range');
  });

  it('maps filter-committing outcomes to the configured primary action', () => {
    const resolver = createTestbedCandidateResolver();
    for (const outcomeId of ['apply_filter', 'export_report']) {
      const command = resolver.resolve(prediction({ outcomeId }), UI_CONTEXT);
      expect(command?.type).toBe('highlight_primary_action');
      expect(command?.targetComponentId).toBe(TESTBED_PRIMARY_ACTION_TARGET);
    }
  });

  it('maps select_report to expand_tooltip targeting reports-header-action', () => {
    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(prediction({ outcomeId: 'select_report' }), UI_CONTEXT);
    expect(command?.type).toBe('expand_tooltip');
    expect(command?.targetComponentId).toBe('reports-header-action');
  });

  it('expands the tooltip the prediction names, never another tooltip', () => {
    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(
      prediction({ outcomeId: 'inspect_help', target: { componentId: 'tooltip-region' } }),
      UI_CONTEXT
    );

    expect(command?.type).toBe('expand_tooltip');
    expect(command?.targetComponentId).toBe('tooltip-region');
  });

  it('declares no candidate when a per-prediction target is absent', () => {
    const resolver = createTestbedCandidateResolver();
    // `inspect_help` is the only mapped outcome whose element must come from the
    // prediction. Without a target there is no honest element to expand.
    expect(
      resolver.resolve(prediction({ outcomeId: 'inspect_help', target: undefined }), UI_CONTEXT)
    ).toBeNull();
  });

  it('does not leak an internal mapping sentence into the assistance banner', () => {
    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(prediction({ outcomeId: 'BACKTRACK' }), UI_CONTEXT);

    expect(command?.type).toBe('offer_assistance');
    // The banner renders `reason` to the participant, so the adapter leaves it unset and
    // the actuator shows its configured assistance text.
    expect(command?.reason).toBeUndefined();
  });

  it('does not target the active component when the outcome has a configured target', () => {
    const resolver = createTestbedCandidateResolver();
    const command = resolver.resolve(
      prediction({
        outcomeId: 'apply_filter',
        target: { componentId: 'results-table', route: 'Analytics' }
      }),
      { ...UI_CONTEXT, activeComponentId: 'filter-date-input' }
    );

    expect(command?.targetComponentId).toBe(TESTBED_PRIMARY_ACTION_TARGET);
    expect(command?.targetComponentId).not.toBe('results-table');
    expect(command?.targetComponentId).not.toBe('filter-date-input');
  });

  it('keeps unmapped and ambiguous outcomes at no_op through the policy', () => {
    const resolver = createTestbedCandidateResolver();
    for (const outcomeId of ['close_filter_section']) {
      expect(resolver.resolve(prediction({ outcomeId }), UI_CONTEXT)).toBeNull();
      expect(TESTBED_SEMANTIC_OUTCOME_INTERVENTIONS[outcomeId]).toBeUndefined();
    }

    const policy = new InterventionPolicy(
      { requiredConsecutiveWindows: 1, confidenceThreshold: 0.5 },
      { resolveCandidate: resolver }
    );

    for (const outcomeId of ['close_filter_section', 'NO_OUTCOME']) {
      const decision = policy.acceptPrediction(prediction({ outcomeId }), UI_CONTEXT);
      expect(decision.accepted).toBe(true);
      expect(decision.command.type).toBe('no_op');
    }

    // An unmapped outcome is a decision-only verdict the trace can explain.
    const unmapped = policy.acceptPrediction(prediction({ outcomeId: 'close_filter_section' }), UI_CONTEXT);
    expect(unmapped.reason).toContain('no intervention mapping');
  });
});

describe('policy safety gates over semantic predictions (Task 60.1)', () => {
  function createPolicy(): InterventionPolicy {
    return new InterventionPolicy(
      {
        confidenceThreshold: 0.75,
        requiredConsecutiveWindows: 2,
        enforceContextEligibility: true,
        cooldownMs: 5000,
        dismissalCooldownMs: 15000
      },
      { resolveCandidate: createTestbedCandidateResolver() }
    );
  }

  it('suppresses the transient first window and actuates once when the prediction persists', () => {
    const policy = createPolicy();
    const predicted = prediction({ outcomeId: 'select_category' });

    const first = policy.acceptPrediction(predicted, UI_CONTEXT);
    expect(first.accepted).toBe(false);
    expect(first.rejectionCategory).toBe('pending_persistence');
    expect(first.command.type).toBe('no_op');

    const second = policy.acceptPrediction(predicted, UI_CONTEXT);
    expect(second.accepted).toBe(true);
    expect(second.command.type).toBe('simplify_options');
    expect(second.ttlMs).toBeGreaterThan(0);
  });

  it('does not repeat an intervention on further identical predictions', () => {
    const policy = createPolicy();
    const predicted = prediction({ outcomeId: 'select_category' });

    policy.acceptPrediction(predicted, UI_CONTEXT);
    expect(policy.acceptPrediction(predicted, UI_CONTEXT).accepted).toBe(true);

    for (let i = 0; i < 3; i++) {
      const suppressed = policy.acceptPrediction(predicted, UI_CONTEXT);
      expect(suppressed.accepted).toBe(false);
      expect(suppressed.rejectionCategory).toBe('cooldown');
      expect(suppressed.command.type).toBe('no_op');
    }
  });

  it('rejects a low-confidence semantic prediction without opening a candidate', () => {
    const policy = createPolicy();
    const decision = policy.acceptPrediction(
      prediction({ outcomeId: 'apply_filter', confidence: 0.4 }),
      UI_CONTEXT
    );

    expect(decision.accepted).toBe(false);
    expect(decision.rejectionCategory).toBe('below_threshold');
    expect(decision.command.type).toBe('no_op');
  });
});

describe('testbed target resolver (Task 60.1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves the declared primary action', () => {
    const root = renderAnalyticsDom();
    const resolver = createTestbedTargetResolver();

    const element = resolver(TESTBED_PRIMARY_ACTION_TARGET, { root, command: primaryCommand() });

    expect(element).toBe(root.querySelector('[data-aui-component="btn-export"]'));
  });

  it('resolves the configured simplify surface', () => {
    const root = renderAnalyticsDom();
    const resolver = createTestbedTargetResolver();

    const element = resolver(TESTBED_FILTER_OPTIONS_TARGET, { root, command: simplifyCommand() });

    expect(element).toBe(root.querySelector('[data-aui-component="filter-drawer"]'));
  });

  it('resolves a component-id target and requires real tooltip text', () => {
    const root = renderAnalyticsDom();
    const resolver = createTestbedTargetResolver();
    const command = tooltipCommand('tooltip-region');

    expect(resolver('tooltip-region', { root, command })).toBe(
      root.querySelector('[data-aui-component="tooltip-region"]')
    );
    // A tooltip affordance without title/data-tooltip text has nothing to expand.
    expect(resolver('tooltip-no-text', { root, command: tooltipCommand('tooltip-no-text') })).toBeNull();
  });

  it('refuses a target the element cannot accept', () => {
    const root = renderAnalyticsDom();
    const resolver = createTestbedTargetResolver();

    // A table is not an action to highlight.
    expect(resolver('results-table', { root, command: primaryCommand() })).toBeNull();
    // A heading is not a surface with options to simplify.
    expect(resolver('tooltip-region', { root, command: simplifyCommand() })).toBeNull();
    // An unknown target id resolves to nothing.
    expect(resolver('does-not-exist', { root, command: primaryCommand() })).toBeNull();
  });

  it('returns nothing when no DOM root is available', () => {
    const resolver = createTestbedTargetResolver();
    expect(resolver(TESTBED_PRIMARY_ACTION_TARGET, { root: null, command: primaryCommand() })).toBeNull();
  });
});

describe('missing target fails safely (Task 60.1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function applyWithTestbedResolver(command: ReturnType<typeof primaryCommand>): boolean {
    const actuator = new UIActuator({ root: document.body, targetResolver: createTestbedTargetResolver() });
    return actuator.apply(command);
  }

  it('mutates nothing when the primary action is absent', () => {
    renderAnalyticsDom();
    document.querySelector('[data-aui-component="btn-export"]')!.remove();
    const before = document.body.innerHTML;

    expect(applyWithTestbedResolver(primaryCommand())).toBe(false);

    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}]`).length).toBe(0);
  });

  it('mutates nothing when the simplify surface is absent', () => {
    renderAnalyticsDom();
    document.querySelector('[data-aui-component="filter-drawer"]')!.remove();
    const before = document.body.innerHTML;

    expect(applyWithTestbedResolver(simplifyCommand())).toBe(false);

    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.edge-aui-simplified').length).toBe(0);
  });

  it('mutates nothing when the tooltip has no real text', () => {
    renderAnalyticsDom();
    const before = document.body.innerHTML;

    expect(applyWithTestbedResolver(tooltipCommand('tooltip-no-text'))).toBe(false);

    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.edge-aui-tooltip-bubble').length).toBe(0);
  });

  it('refuses an actionable command that declares no target', () => {
    renderAnalyticsDom();
    const before = document.body.innerHTML;
    const actuator = new UIActuator({ root: document.body, targetResolver: createTestbedTargetResolver() });

    // No declared target means "nothing was asked for", not "adapt the first button".
    expect(
      actuator.apply({ type: 'highlight_primary_action', source: 'slow', issuedAt: 1 })
    ).toBe(false);
    expect(document.body.innerHTML).toBe(before);
  });
});

function primaryCommand() {
  return {
    type: 'highlight_primary_action' as const,
    targetComponentId: TESTBED_PRIMARY_ACTION_TARGET,
    source: 'slow' as const,
    issuedAt: 1
  };
}

function simplifyCommand() {
  return {
    type: 'simplify_options' as const,
    targetComponentId: TESTBED_FILTER_OPTIONS_TARGET,
    source: 'slow' as const,
    issuedAt: 1
  };
}

function tooltipCommand(targetComponentId: string) {
  return {
    type: 'expand_tooltip' as const,
    targetComponentId,
    source: 'slow' as const,
    issuedAt: 1
  };
}
