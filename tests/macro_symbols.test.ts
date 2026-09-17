import { describe, it, expect } from 'vitest';
import {
  MACRO_SYMBOLS,
  deriveMacroSymbol,
  isMacroSymbol
} from '../src/macro/symbols';
import { BehaviourEvent } from '../src/telemetry/events';

describe('Macro Symbol Vocabulary & Derivation (Task 6.1)', () => {
  it('defines comprehensive vocabulary of high-level macro symbols', () => {
    expect(MACRO_SYMBOLS.length).toBeGreaterThan(15);
    expect(isMacroSymbol('NAV_ANALYTICS')).toBe(true);
    expect(isMacroSymbol('APPLY_FILTER')).toBe(true);
    expect(isMacroSymbol('EXPORT_REPORT')).toBe(true);
    expect(isMacroSymbol('BACKTRACK')).toBe(true);
    expect(isMacroSymbol('RANDOM_SYMBOL')).toBe(false);
  });

  it('maps navigation events cleanly to NAV_* macro symbols', () => {
    const navAnalyticsEv: BehaviourEvent = {
      timestamp: 100,
      type: 'click',
      componentId: 'nav-Analytics',
      componentRole: 'navigation',
      action: 'click'
    };
    expect(deriveMacroSymbol(navAnalyticsEv)).toBe('NAV_ANALYTICS');

    const navOverviewEv: BehaviourEvent = {
      timestamp: 200,
      type: 'click',
      componentId: 'nav-Overview',
      componentRole: 'navigation'
    };
    expect(deriveMacroSymbol(navOverviewEv)).toBe('NAV_OVERVIEW');

    const navReportsEv: BehaviourEvent = {
      timestamp: 300,
      type: 'navigation',
      route: '/reports'
    };
    expect(deriveMacroSymbol(navReportsEv)).toBe('NAV_REPORTS');
  });

  it('maps primary button interactions accurately', () => {
    const applyEv: BehaviourEvent = {
      timestamp: 500,
      type: 'click',
      componentId: 'btn-apply-filters',
      componentRole: 'primary-action',
      action: 'click'
    };
    expect(deriveMacroSymbol(applyEv)).toBe('APPLY_FILTER');

    const exportEv: BehaviourEvent = {
      timestamp: 600,
      type: 'click',
      componentId: 'btn-export',
      componentRole: 'primary-action',
      action: 'click'
    };
    expect(deriveMacroSymbol(exportEv)).toBe('EXPORT_REPORT');
  });

  it('maps filter drawer inputs and accordion toggles', () => {
    const regionEv: BehaviourEvent = {
      timestamp: 700,
      type: 'change',
      componentId: 'filter-Region-select',
      componentRole: 'filter',
      action: 'change'
    };
    expect(deriveMacroSymbol(regionEv)).toBe('SELECT_REGION');

    const dateEv: BehaviourEvent = {
      timestamp: 750,
      type: 'change',
      componentId: 'filter-date-input',
      componentRole: 'form-field'
    };
    expect(deriveMacroSymbol(dateEv)).toBe('SELECT_DATE');

    const accordionOpenEv: BehaviourEvent = {
      timestamp: 800,
      type: 'click',
      componentId: 'filter-Region',
      componentRole: 'accordion',
      action: 'click'
    };
    expect(deriveMacroSymbol(accordionOpenEv)).toBe('OPEN_FILTERS');
  });

  it('maps table interactions including pagination and sorting', () => {
    const nextEv: BehaviourEvent = {
      timestamp: 900,
      type: 'click',
      componentId: 'table-pagination-next'
    };
    expect(deriveMacroSymbol(nextEv)).toBe('TABLE_PAGE_NEXT');

    const sortEv: BehaviourEvent = {
      timestamp: 950,
      type: 'click',
      componentId: 'table-sort-revenue',
      action: 'sort'
    };
    expect(deriveMacroSymbol(sortEv)).toBe('TABLE_SORT');
  });

  it('maps inspection, help, and behavioral backtrack events', () => {
    const kpiEv: BehaviourEvent = {
      timestamp: 1000,
      type: 'mouseover',
      componentId: 'kpi-card-revenue',
      componentRole: 'kpi-card'
    };
    expect(deriveMacroSymbol(kpiEv)).toBe('HOVER_KPI');

    const tooltipEv: BehaviourEvent = {
      timestamp: 1100,
      type: 'mouseover',
      componentId: 'tooltip-conversion-rate',
      componentRole: 'tooltip'
    };
    expect(deriveMacroSymbol(tooltipEv)).toBe('HOVER_HELP');

    const backtrackEv: BehaviourEvent = {
      timestamp: 1200,
      type: 'click',
      action: 'backtrack'
    };
    expect(deriveMacroSymbol(backtrackEv)).toBe('BACKTRACK');
  });

  it('returns null for raw pointer movement events lacking semantic annotation', () => {
    const rawMove: BehaviourEvent = {
      timestamp: 1300,
      type: 'mousemove',
      x: 0.45,
      y: 0.55
    };
    expect(deriveMacroSymbol(rawMove)).toBeNull();
  });
});
