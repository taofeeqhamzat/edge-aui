/**
 * Testbed Intervention Targets (Task 60.1)
 *
 * The framework's actuator knows *how* to adapt an element; it must not know *which*
 * element an application means. This module is the testbed's answer to that question, and
 * it is the only place the testbed's UI identity appears in the adaptation path:
 *
 * - each adaptation type declares a target id (configuration, not framework core);
 * - an outcome that names an element (an inspected tooltip) uses the target the prediction
 *   carries instead, because "a tooltip was inspected" does not say *which* one;
 * - the resolver turns a target id into an element and refuses an element that cannot
 *   accept the adaptation.
 *
 * Refusing is the point. The previous behaviour fell back to the first primary action, the
 * first tooltip or the first accordion, so a prediction about the Status tooltip could
 * expand the Region tooltip (assessment §5.3). A declared target that does not resolve, or
 * that resolves to an element which cannot accept the adaptation, is now an actuation
 * failure with no DOM mutation.
 */

import type { ActuationTargetResolver } from '../../intervention/actuator';
import type { InterventionType } from '../../intervention/types';

/**
 * Logical target for the application's primary action.
 *
 * A role-based target rather than a component id, because the primary action is a different
 * control on each page (`btn-export` on Analytics, none on Reports) while the policy's
 * intent — emphasise the page's primary action — is the same.
 */
export const TESTBED_PRIMARY_ACTION_TARGET = 'primary-action';

/** Logical target for the filter drawer surface whose options may be simplified. */
export const TESTBED_FILTER_OPTIONS_TARGET = 'filter-options';

/** Logical fallback target for contextual tooltips. */
export const TESTBED_TOOLTIP_TARGET = 'tooltip-context';

/**
 * Target each adaptation type declares when the outcome does not name an element.
 *
 * `expand_tooltip` is deliberately absent: it acts on the tooltip the prediction refers to,
 * so the target comes from the prediction (falling back to TESTBED_TOOLTIP_TARGET).
 * `offer_assistance` is deliberately absent: the banner is global and anchors to no control.
 */
export const TESTBED_INTERVENTION_TARGETS: Readonly<Partial<Record<InterventionType, string>>> = {
  highlight_primary_action: TESTBED_PRIMARY_ACTION_TARGET,
  simplify_options: TESTBED_FILTER_OPTIONS_TARGET
};

/**
 * Selectors for the logical target ids.
 *
 * An id that is not listed here is read as a component annotation id, which is how a
 * prediction names a specific element (for example `tooltip-region` or `btn-apply-filters`).
 */
const LOGICAL_TARGET_SELECTORS: Readonly<Record<string, string>> = {
  [TESTBED_PRIMARY_ACTION_TARGET]:
    '[data-aui-role="primary-action"]:not([disabled]):not([aria-disabled="true"]), [data-aui-component^="open-report-"]:not([disabled])',
  [TESTBED_FILTER_OPTIONS_TARGET]: '[data-aui-component="filter-drawer"]',
  [TESTBED_TOOLTIP_TARGET]:
    '[data-aui-component="tooltip-region"], [data-aui-role="tooltip"][title], [data-aui-role="tooltip"][data-tooltip]'
};

const ACTIONABLE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);

/** Escapes a value for safe interpolation into a CSS attribute selector. */
function escapeAttributeValue(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

function findElement(root: Element | Document, targetId: string): Element | null {
  const selector =
    LOGICAL_TARGET_SELECTORS[targetId] ??
    `[data-aui-component="${escapeAttributeValue(targetId)}"]`;
  return root.querySelector(selector);
}

/** True when the element is a control the interface can point at. */
function isActionable(element: Element): boolean {
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return ACTIONABLE_TAGS.has(element.tagName) || element.getAttribute('role') === 'button';
}

/** True when the element carries the text an expanded tooltip would show. */
function hasTooltipText(element: Element): boolean {
  const text = element.getAttribute('title') ?? element.getAttribute('data-tooltip');
  return typeof text === 'string' && text.trim().length > 0;
}

/** True when the element is a surface that actually contains collapsible options. */
function hasOptionsToSimplify(element: Element): boolean {
  return element.querySelector('[data-aui-role="accordion"]') !== null;
}

/**
 * Resolves a declared target reference to the element the adaptation will act on.
 *
 * Validation is per adaptation type because "the element exists" is not the same as "the
 * element can accept this adaptation". A tooltip with no title has nothing to expand; a
 * table is not an action to highlight; a heading is not a surface with options to simplify.
 */
export function createTestbedTargetResolver(): ActuationTargetResolver {
  return (targetId, { root, command }) => {
    if (!root) return null;

    let element = findElement(root, targetId);
    if (!element && command.type === 'expand_tooltip') {
      element = findElement(root, TESTBED_TOOLTIP_TARGET);
    }
    if (!element) return null;

    switch (command.type) {
      case 'highlight_primary_action':
        return isActionable(element) ? element : null;
      case 'simplify_options':
        return hasOptionsToSimplify(element) ? element : null;
      case 'expand_tooltip':
        return hasTooltipText(element) ? element : null;
      default:
        return element;
    }
  };
}
