/**
 * @vitest-environment jsdom
 *
 * Intervention functional verification (Task 60.2)
 *
 * Every assertion here runs against the *rendered* testbed UI (`<App />` on Analytics), not
 * a hand-built fixture. That matters because the acceptance criteria for this task are
 * about the interface a participant meets: the right element changes, the change is
 * visible, focus survives, dismissal works, the page returns to its exact prior state, and
 * a missing target mutates nothing.
 *
 * What this file cannot prove is that the adaptation is visually *noticeable*: jsdom has no
 * layout or paint. The screenshot pass and its report cover that separately, and the report
 * labels each claim accordingly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { App } from '../src/app/App';
import {
  ADAPTATION_ATTRIBUTE,
  ADAPTATION_EPISODE_ATTRIBUTE,
  UIActuator
} from '../src/intervention/actuator';
import type { InterventionEvent } from '../src/intervention/types';
import {
  TESTBED_FILTER_OPTIONS_TARGET,
  TESTBED_PRIMARY_ACTION_TARGET,
  createTestbedTargetResolver
} from '../src/testbed/config/interventionTargets';

function qs(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Expected the rendered testbed to contain '${selector}'`);
  return element as HTMLElement;
}

function component(id: string): HTMLElement {
  return qs(`[data-aui-component="${id}"]`);
}

function renderAnalytics(): void {
  act(() => {
    render(<App />);
  });
  act(() => {
    fireEvent.click(component('nav-Analytics'));
  });
}

function createActuator(events: InterventionEvent[] = []): UIActuator {
  const actuator = new UIActuator({
    root: document.body,
    targetResolver: createTestbedTargetResolver()
  });
  actuator.onInterventionEvent((event) => events.push(event));
  return actuator;
}

describe('Task 60.2: highlight_primary_action on the rendered testbed', () => {
  let actuator: UIActuator;
  let events: InterventionEvent[];

  beforeEach(() => {
    document.body.innerHTML = '';
    renderAnalytics();
    events = [];
    actuator = createActuator(events);
  });

  afterEach(() => {
    actuator.reset();
    document.body.innerHTML = '';
  });

  it('marks the configured primary action, preserves focus and restores the exact class', () => {
    const exportButton = component('btn-export');
    const initialClass = exportButton.getAttribute('class');
    const initialSiblingCount = exportButton.parentElement!.childNodes.length;

    const nav = component('nav-Analytics');
    nav.focus();
    expect(document.activeElement).toBe(nav);

    let applied = false;
    act(() => {
      applied = actuator.apply({
        type: 'highlight_primary_action',
        targetComponentId: TESTBED_PRIMARY_ACTION_TARGET,
        source: 'slow',
        confidence: 0.9,
        issuedAt: Date.now(),
        episodeId: 'ep_highlight'
      });
    });

    expect(applied).toBe(true);
    expect(exportButton.classList.contains('edge-aui-highlight')).toBe(true);
    expect(exportButton.getAttribute(ADAPTATION_ATTRIBUTE)).toBe('highlight');
    expect(exportButton.getAttribute(ADAPTATION_EPISODE_ATTRIBUTE)).toBe('ep_highlight');
    // No node inserted: the highlight is paint-only, so nothing reflows around it.
    expect(exportButton.parentElement!.childNodes.length).toBe(initialSiblingCount);
    // Focus theft would make the participant lose their place; it must not move.
    expect(document.activeElement).toBe(nav);
    expect(events.filter((e) => e.type === 'applied')).toHaveLength(1);

    act(() => {
      actuator.clear();
    });

    expect(exportButton.classList.contains('edge-aui-highlight')).toBe(false);
    expect(exportButton.getAttribute('class')).toBe(initialClass);
    expect(exportButton.hasAttribute(ADAPTATION_ATTRIBUTE)).toBe(false);
    expect(exportButton.hasAttribute(ADAPTATION_EPISODE_ATTRIBUTE)).toBe(false);
    expect(events.filter((e) => e.type === 'reverted')).toHaveLength(1);
  });

  it('re-applying the same type keeps exactly one episode active and one visual marker', () => {
    const command = {
      type: 'highlight_primary_action' as const,
      targetComponentId: TESTBED_PRIMARY_ACTION_TARGET,
      source: 'slow' as const,
      issuedAt: Date.now()
    };

    act(() => {
      actuator.apply({ ...command, episodeId: 'ep_one' });
      actuator.apply({ ...command, episodeId: 'ep_two' });
    });

    expect(actuator.getActiveInterventions()).toHaveLength(1);
    expect(document.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}="highlight"]`)).toHaveLength(1);
    expect(component('btn-export').getAttribute(ADAPTATION_EPISODE_ATTRIBUTE)).toBe('ep_two');
  });

  it('mutates nothing when the primary action is missing', () => {
    component('btn-export').remove();
    const before = document.body.innerHTML;

    let applied = true;
    act(() => {
      applied = actuator.apply({
        type: 'highlight_primary_action',
        targetComponentId: TESTBED_PRIMARY_ACTION_TARGET,
        source: 'slow',
        issuedAt: Date.now()
      });
    });

    expect(applied).toBe(false);
    expect(document.body.innerHTML).toBe(before);
    // The submit button is a different control and must not be picked as a fallback.
    expect(component('btn-apply-filters').classList.contains('edge-aui-highlight')).toBe(false);
    expect(document.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}]`)).toHaveLength(0);
  });
});

describe('Task 60.2: simplify_options on the rendered testbed', () => {
  let actuator: UIActuator;

  beforeEach(() => {
    document.body.innerHTML = '';
    renderAnalytics();
    actuator = createActuator();
    // The drawer starts with every section collapsed; open one so simplification has an
    // observable effect.
    act(() => {
      fireEvent.click(component('filter-section-date-range'));
    });
    expect(component('filter-section-date-range').getAttribute('aria-expanded')).toBe('true');
  });

  afterEach(() => {
    actuator.reset();
    document.body.innerHTML = '';
  });

  it('collapses expanded sections inside the declared surface only, and reverses cleanly', () => {
    const drawer = component('filter-drawer');
    const initialDrawerClass = drawer.getAttribute('class');
    const dateButton = component('filter-section-date-range');

    // Focus outside any filter section, so nothing is protected by the focus rule.
    act(() => {
      component('btn-reset-filters').focus();
    });

    let applied = false;
    act(() => {
      applied = actuator.apply({
        type: 'simplify_options',
        targetComponentId: TESTBED_FILTER_OPTIONS_TARGET,
        source: 'slow',
        confidence: 0.9,
        issuedAt: Date.now(),
        episodeId: 'ep_simplify'
      });
    });

    expect(applied).toBe(true);
    expect(drawer.classList.contains('edge-aui-simplified')).toBe(true);
    expect(dateButton.getAttribute('aria-expanded')).toBe('false');
    // The section control remains: the option can be reopened, so no task step is lost.
    expect(component('filter-section-date-range')).not.toBeNull();
    // The other accordions are untouched (they were already collapsed).
    expect(component('filter-section-region').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(component('btn-reset-filters'));

    act(() => {
      actuator.clear();
    });

    expect(drawer.getAttribute('class')).toBe(initialDrawerClass);
    expect(component('filter-section-date-range').getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it('never collapses the section that contains the participant focus', () => {
    const dateInput = component('filter-date-input');
    act(() => {
      dateInput.focus();
    });
    expect(document.activeElement).toBe(dateInput);

    act(() => {
      actuator.apply({
        type: 'simplify_options',
        targetComponentId: TESTBED_FILTER_OPTIONS_TARGET,
        source: 'slow',
        issuedAt: Date.now()
      });
    });

    // The section the participant is working in stays open and focused.
    expect(component('filter-section-date-range').getAttribute('aria-expanded')).toBe('true');
    expect(component('filter-date-input')).toBe(dateInput);
    expect(document.activeElement).toBe(dateInput);
  });

  it('mutates nothing when the configured simplify surface is missing', () => {
    component('filter-drawer').remove();
    const before = document.body.innerHTML;

    let applied = true;
    act(() => {
      applied = actuator.apply({
        type: 'simplify_options',
        targetComponentId: TESTBED_FILTER_OPTIONS_TARGET,
        source: 'slow',
        issuedAt: Date.now()
      });
    });

    expect(applied).toBe(false);
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.edge-aui-simplified').length).toBe(0);
  });
});

describe('Task 60.2: expand_tooltip on the rendered testbed', () => {
  let actuator: UIActuator;
  let events: InterventionEvent[];

  beforeEach(() => {
    document.body.innerHTML = '';
    renderAnalytics();
    events = [];
    actuator = createActuator(events);
  });

  afterEach(() => {
    actuator.reset();
    document.body.innerHTML = '';
  });

  it('shows the tooltip’s own text, links it with aria-describedby and dismisses on Escape', () => {
    const tooltip = component('tooltip-region');
    expect(tooltip.getAttribute('title')).toBe('Geographical sales region');
    const nav = component('nav-Analytics');
    nav.focus();

    let applied = false;
    act(() => {
      applied = actuator.apply({
        type: 'expand_tooltip',
        targetComponentId: 'tooltip-region',
        source: 'slow',
        confidence: 0.9,
        issuedAt: Date.now(),
        episodeId: 'ep_tooltip'
      });
    });

    expect(applied).toBe(true);
    expect(tooltip.classList.contains('edge-aui-tooltip-expanded')).toBe(true);
    expect(tooltip.getAttribute('aria-expanded')).toBe('true');

    const bubble = document.querySelector('.edge-aui-tooltip-bubble') as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.getAttribute('role')).toBe('tooltip');
    expect(bubble.textContent).toBe('Geographical sales region');
    expect(tooltip.getAttribute('aria-describedby')).toBe(bubble.id);
    // The other tooltip on the page is untouched: no wrong-target expansion.
    expect(component('tooltip-status').classList.contains('edge-aui-tooltip-expanded')).toBe(false);
    expect(document.activeElement).toBe(nav);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.querySelector('.edge-aui-tooltip-bubble')).toBeNull();
    expect(tooltip.classList.contains('edge-aui-tooltip-expanded')).toBe(false);
    expect(tooltip.hasAttribute('aria-describedby')).toBe(false);
    expect(tooltip.getAttribute('title')).toBe('Geographical sales region');
    expect(events.some((e) => e.type === 'dismissed')).toBe(true);
  });

  it('fails safely when the target has no real help text', () => {
    const tooltip = component('tooltip-region');
    tooltip.removeAttribute('title');
    const before = document.body.innerHTML;

    let applied = true;
    act(() => {
      applied = actuator.apply({
        type: 'expand_tooltip',
        targetComponentId: 'tooltip-region',
        source: 'slow',
        issuedAt: Date.now()
      });
    });

    expect(applied).toBe(false);
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.edge-aui-tooltip-bubble')).toHaveLength(0);
  });
});

describe('Task 60.2: offer_assistance on the rendered testbed', () => {
  let actuator: UIActuator;
  let events: InterventionEvent[];

  beforeEach(() => {
    document.body.innerHTML = '';
    renderAnalytics();
    events = [];
    actuator = createActuator(events);
  });

  afterEach(() => {
    actuator.reset();
    document.body.innerHTML = '';
  });

  it('shows a polite, non-modal banner that does not move focus and can be dismissed', () => {
    const nav = component('nav-Analytics');
    nav.focus();

    act(() => {
      actuator.apply({
        type: 'offer_assistance',
        source: 'slow',
        confidence: 0.9,
        issuedAt: Date.now(),
        reason: 'Filter by region, then apply the filters.',
        episodeId: 'ep_assist'
      });
    });

    const banner = document.querySelector('.edge-aui-assistance-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.textContent).toContain('Filter by region, then apply the filters.');
    // Non-modal: the participant keeps their focus and can continue the task.
    expect(document.activeElement).toBe(nav);

    const dismiss = banner.querySelector('.edge-aui-assistance-dismiss') as HTMLButtonElement;
    act(() => {
      dismiss.click();
    });

    expect(document.querySelector('.edge-aui-assistance-banner')).toBeNull();
    expect(events.some((e) => e.type === 'dismissed')).toBe(true);
    expect(component('btn-export')).not.toBeNull();
  });
});

describe('Task 60.2: no_op and adaptation hygiene on the rendered testbed', () => {
  let actuator: UIActuator;

  beforeEach(() => {
    document.body.innerHTML = '';
    renderAnalytics();
    actuator = createActuator();
  });

  afterEach(() => {
    actuator.reset();
    document.body.innerHTML = '';
  });

  it('leaves the rendered page byte-identical for no_op', () => {
    const before = document.body.innerHTML;

    let applied = false;
    act(() => {
      applied = actuator.apply({ type: 'no_op', source: 'rule', issuedAt: Date.now() });
    });

    expect(applied).toBe(true);
    expect(document.body.innerHTML).toBe(before);
    expect(actuator.getActiveInterventions()).toHaveLength(0);
  });

  it('does not leave the accessibility tree damaged after a full reset', () => {
    const elementCountBefore = document.body.querySelectorAll('*').length;
    const textBefore = document.body.textContent;
    const tooltip = component('tooltip-region');

    act(() => {
      actuator.apply({
        type: 'highlight_primary_action',
        targetComponentId: TESTBED_PRIMARY_ACTION_TARGET,
        source: 'slow',
        issuedAt: Date.now()
      });
      actuator.apply({
        type: 'expand_tooltip',
        targetComponentId: 'tooltip-region',
        source: 'slow',
        issuedAt: Date.now()
      });
      actuator.apply({
        type: 'offer_assistance',
        source: 'slow',
        issuedAt: Date.now()
      });
    });

    act(() => {
      actuator.reset();
    });

    // Attribute *order* is not meaningful, so compare structure and text rather than the
    // serialised string: no node added, removed, hidden or rewritten.
    expect(document.body.querySelectorAll('*').length).toBe(elementCountBefore);
    expect(document.body.textContent).toBe(textBefore);
    expect(tooltip.hasAttribute('aria-expanded')).toBe(false);
    expect(tooltip.hasAttribute('aria-describedby')).toBe(false);
    expect(tooltip.getAttribute('title')).toBe('Geographical sales region');
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
    expect(document.querySelectorAll(`[${ADAPTATION_ATTRIBUTE}]`).length).toBe(0);
    expect(document.querySelectorAll('.edge-aui-tooltip-bubble').length).toBe(0);
    expect(document.querySelectorAll('.edge-aui-assistance-banner').length).toBe(0);
    expect(document.querySelectorAll('.edge-aui-highlight').length).toBe(0);
  });
});
