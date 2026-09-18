import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIActuator, createUIActuator } from '../src/intervention/actuator';
import { createInterventionCommand, createNoOpCommand } from '../src/intervention/types';
import { InterventionEvent } from '../src/telemetry/events';

describe('Task 8.3: UIActuator (Non-Destructive & Accessible Adaptation)', () => {
  let container: HTMLDivElement;
  let actuator: UIActuator;
  let emittedEvents: InterventionEvent[];

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <div data-aui-component="filter-drawer">
        <div id="section-date">
          <button data-aui-component="filter-date" data-aui-role="accordion" aria-expanded="true">Date Range</button>
          <input id="date-input" type="date" value="2026-09-17" />
        </div>
        <div id="section-region">
          <button data-aui-component="filter-region" data-aui-role="accordion" aria-expanded="true">Region</button>
          <select id="region-select"><option selected>North America</option></select>
        </div>
        <div id="section-category">
          <button data-aui-component="filter-category" data-aui-role="accordion" aria-expanded="false">Category</button>
        </div>
        <button data-aui-component="btn-apply-filters" data-aui-role="primary-action">Apply Filters</button>
      </div>
      <div data-aui-component="results-table">
        <span data-aui-component="tooltip-region" data-aui-role="tooltip" title="Geographical region info">[?]</span>
      </div>
    `;
    document.body.appendChild(container);

    actuator = createUIActuator({ root: container });
    emittedEvents = [];
    actuator.onInterventionEvent((e) => emittedEvents.push(e));
  });

  afterEach(() => {
    actuator.reset();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('applies highlight_primary_action non-destructively without stealing focus', () => {
    const primaryBtn = container.querySelector('[data-aui-role="primary-action"]') as HTMLElement;
    const otherInput = container.querySelector('#date-input') as HTMLElement;
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);

    const cmd = createInterventionCommand({
      type: 'highlight_primary_action',
      targetComponentId: 'btn-apply-filters',
      source: 'slow',
      confidence: 0.88
    });

    actuator.apply(cmd);

    // Verify class and attribute added
    expect(primaryBtn.classList.contains('edge-aui-highlight')).toBe(true);
    expect(primaryBtn.getAttribute('data-aui-active-adaptation')).toBe('highlight');

    // Focus must NOT have changed (ADR-003: no focus theft)
    expect(document.activeElement).toBe(otherInput);

    // Event emitted
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('applied');
    expect(emittedEvents[0].intervention).toBe('highlight_primary_action');

    // Clear restores button
    actuator.clear(cmd);
    expect(primaryBtn.classList.contains('edge-aui-highlight')).toBe(false);
    expect(primaryBtn.hasAttribute('data-aui-active-adaptation')).toBe(false);

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].type).toBe('reverted');
  });

  it('applies simplify_options by collapsing accordions while preserving focused section', () => {
    const regionBtn = container.querySelector('[data-aui-component="filter-region"]') as HTMLElement;
    const regionSelect = container.querySelector('#region-select') as HTMLElement;

    // Simulate user focusing inside region section
    regionSelect.focus();
    expect(document.activeElement).toBe(regionSelect);

    // Wire simulated click handlers for accordion buttons
    const dateBtn = container.querySelector('[data-aui-component="filter-date"]') as HTMLElement;
    dateBtn.onclick = () => {
      const open = dateBtn.getAttribute('aria-expanded') === 'true';
      dateBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
    };
    regionBtn.onclick = () => {
      const open = regionBtn.getAttribute('aria-expanded') === 'true';
      regionBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
    };

    const cmd = createInterventionCommand({
      type: 'simplify_options',
      source: 'slow',
      confidence: 0.90
    });

    actuator.apply(cmd);

    // Date accordion (unfocused) should be collapsed
    expect(dateBtn.getAttribute('aria-expanded')).toBe('false');

    // Region accordion contains focused select -> must NOT be collapsed!
    expect(regionBtn.getAttribute('aria-expanded')).toBe('true');

    // Clearing restores date accordion
    actuator.clear(cmd);
    expect(dateBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('applies expand_tooltip non-destructively and restores on clear', () => {
    const tooltipTarget = container.querySelector('[data-aui-component="tooltip-region"]') as HTMLElement;
    expect(tooltipTarget.getAttribute('title')).toBe('Geographical region info');

    const cmd = createInterventionCommand({
      type: 'expand_tooltip',
      targetComponentId: 'tooltip-region',
      source: 'fast'
    });

    actuator.apply(cmd);

    expect(tooltipTarget.classList.contains('edge-aui-tooltip-expanded')).toBe(true);
    expect(tooltipTarget.getAttribute('aria-expanded')).toBe('true');

    const bubble = container.querySelector('.edge-aui-tooltip-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toBe('Geographical region info');

    actuator.clear(cmd);

    expect(tooltipTarget.classList.contains('edge-aui-tooltip-expanded')).toBe(false);
    expect(tooltipTarget.getAttribute('title')).toBe('Geographical region info');
    expect(container.querySelector('.edge-aui-tooltip-bubble')).toBeNull();
  });

  it('applies offer_assistance banner, handles dismiss button click and clear', () => {
    const cmd = createInterventionCommand({
      type: 'offer_assistance',
      source: 'slow',
      confidence: 0.92,
      reason: 'It looks like you might need assistance finding the export button.'
    });

    actuator.apply(cmd);

    const banner = document.querySelector('.edge-aui-assistance-banner');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.getAttribute('aria-live')).toBe('polite');
    expect(banner?.textContent).toContain('It looks like you might need assistance');

    // Click dismiss button
    const dismissBtn = banner?.querySelector('.edge-aui-assistance-dismiss') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    dismissBtn.click();

    // Banner should be removed
    expect(document.querySelector('.edge-aui-assistance-banner')).toBeNull();

    // Event should reflect dismissed
    const dismissedEvent = emittedEvents.find((e) => e.type === 'dismissed');
    expect(dismissedEvent).toBeDefined();
    expect(dismissedEvent?.intervention).toBe('offer_assistance');
  });

  it('handles no_op without DOM modification and records applied event', () => {
    const htmlBefore = container.innerHTML;
    const noOp = createNoOpCommand('rule', 'System idle');

    actuator.apply(noOp);

    expect(container.innerHTML).toBe(htmlBefore);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('applied');
    expect(emittedEvents[0].intervention).toBe('no_op');
  });

  it('reset() cleanly reverts multiple concurrent adaptations to exact initial DOM state', () => {
    const htmlBefore = container.innerHTML;

    const highlightCmd = createInterventionCommand({
      type: 'highlight_primary_action',
      targetComponentId: 'btn-apply-filters',
      source: 'fast'
    });
    const tooltipCmd = createInterventionCommand({
      type: 'expand_tooltip',
      targetComponentId: 'tooltip-region',
      source: 'slow'
    });

    actuator.apply(highlightCmd);
    actuator.apply(tooltipCmd);

    expect(actuator.getActiveInterventions()).toHaveLength(2);

    // Call reset()
    actuator.reset();

    expect(actuator.getActiveInterventions()).toHaveLength(0);
    expect(container.innerHTML).toBe(htmlBefore);

    const revertedEvents = emittedEvents.filter((e) => e.type === 'reverted');
    expect(revertedEvents).toHaveLength(2);
  });

  it('supports Escape key dismissal and aria-describedby linkage for expand_tooltip', () => {
    const tooltipTarget = container.querySelector('[data-aui-component="tooltip-region"]') as HTMLElement;
    const cmd = createInterventionCommand({
      type: 'expand_tooltip',
      targetComponentId: 'tooltip-region',
      source: 'slow'
    });

    actuator.apply(cmd);

    const bubble = container.querySelector('.edge-aui-tooltip-bubble') as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.id).toBeTruthy();
    expect(tooltipTarget.getAttribute('aria-describedby')).toBe(bubble.id);

    // Press Escape to dismiss tooltip
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(container.querySelector('.edge-aui-tooltip-bubble')).toBeNull();
    expect(tooltipTarget.classList.contains('edge-aui-tooltip-expanded')).toBe(false);
    expect(tooltipTarget.hasAttribute('aria-describedby')).toBe(false);

    const dismissed = emittedEvents.find((e) => e.type === 'dismissed');
    expect(dismissed).toBeDefined();
    expect(dismissed?.intervention).toBe('expand_tooltip');
  });

  it('supports Escape key dismissal for offer_assistance banner', () => {
    const cmd = createInterventionCommand({
      type: 'offer_assistance',
      source: 'rule',
      reason: 'Tip: Use keyboard shortcuts.'
    });

    actuator.apply(cmd);
    expect(document.querySelector('.edge-aui-assistance-banner')).not.toBeNull();

    // Press Escape to dismiss banner
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('.edge-aui-assistance-banner')).toBeNull();
    const dismissed = emittedEvents.find((e) => e.type === 'dismissed');
    expect(dismissed).toBeDefined();
    expect(dismissed?.intervention).toBe('offer_assistance');
  });
});
