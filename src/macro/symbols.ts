/**
 * Semantic Macro Interaction Symbol Vocabulary & Event Derivation
 * Implements Stage 6.1 specifications from clipboard.9.md Sections 16 & 17.
 * Maps high-level intentional user actions to discrete symbolic tokens for the Fast Gate PrefixSpan engine.
 */

import { BehaviourEvent } from '../telemetry/events';

export const MACRO_SYMBOLS = [
  // Navigation
  'NAV_OVERVIEW',
  'NAV_ANALYTICS',
  'NAV_REPORTS',
  'NAV_CUSTOMERS',
  'NAV_SETTINGS',
  'NAV_GENERAL',

  // Filter Drawer & Accordions
  'OPEN_FILTERS',
  'CLOSE_FILTERS',
  'SELECT_DATE',
  'SELECT_REGION',
  'SELECT_CATEGORY',
  'SELECT_SEGMENT',
  'APPLY_FILTER',
  'RESET_FILTERS',

  // Reports & Primary Actions
  'OPEN_REPORT',
  'EXPORT_REPORT',

  // Table Interactions
  'TABLE_PAGE_NEXT',
  'TABLE_PAGE_PREV',
  'TABLE_SORT',
  'TABLE_ROW_SELECT',

  // Contextual Help & Inspection
  'HOVER_KPI',
  'HOVER_HELP',
  'EXPAND_TOOLTIP',

  // Behavioral Transitions
  'BACKTRACK',
  'IDLE_DWELL',
  'RAPID_SCROLL'
] as const;

export type MacroSymbol = typeof MACRO_SYMBOLS[number];

export function isMacroSymbol(val: string): val is MacroSymbol {
  return (MACRO_SYMBOLS as readonly string[]).includes(val);
}

/**
 * Derives a semantic MacroSymbol from an observed canonical BehaviourEvent.
 * Returns null if the event is a micro-interaction (e.g. raw mousemove) without semantic intent.
 */
export function deriveMacroSymbol(event: BehaviourEvent): MacroSymbol | null {
  const componentId = event.componentId?.toLowerCase() ?? '';
  const componentRole = event.componentRole?.toLowerCase() ?? '';
  const action = event.action?.toLowerCase() ?? '';
  const type = event.type;

  // 1. Navigation Actions
  if (componentRole === 'navigation' || type === 'navigation' || componentId.startsWith('nav-')) {
    if (componentId.includes('overview') || event.route?.toLowerCase().includes('overview')) return 'NAV_OVERVIEW';
    if (componentId.includes('analytics') || event.route?.toLowerCase().includes('analytics')) return 'NAV_ANALYTICS';
    if (componentId.includes('reports') || event.route?.toLowerCase().includes('reports')) return 'NAV_REPORTS';
    if (componentId.includes('customers') || event.route?.toLowerCase().includes('customers')) return 'NAV_CUSTOMERS';
    if (componentId.includes('settings') || event.route?.toLowerCase().includes('settings')) return 'NAV_SETTINGS';
    return 'NAV_GENERAL';
  }

  // 2. Primary Button Actions
  if (componentId === 'btn-apply-filters' || componentId.includes('apply-filter')) {
    return 'APPLY_FILTER';
  }
  if (componentId === 'btn-reset-filters' || componentId.includes('reset-filter')) {
    return 'RESET_FILTERS';
  }
  if (componentId === 'btn-export' || componentId.includes('export')) {
    return 'EXPORT_REPORT';
  }
  if (componentId.includes('open-report')) {
    return 'OPEN_REPORT';
  }

  // 3. Filter Drawer Accordions & Form Controls
  if (componentRole === 'accordion' || componentId === 'filter-drawer') {
    if (action === 'click' || type === 'click') {
      return action.includes('close') ? 'CLOSE_FILTERS' : 'OPEN_FILTERS';
    }
  }

  if (componentId.includes('date')) {
    return 'SELECT_DATE';
  }
  if (componentId.includes('region')) {
    return 'SELECT_REGION';
  }
  if (componentId.includes('category')) {
    return 'SELECT_CATEGORY';
  }
  if (componentId.includes('segment')) {
    return 'SELECT_SEGMENT';
  }

  // 4. Table Operations
  if (componentId.includes('pagination-next')) {
    return 'TABLE_PAGE_NEXT';
  }
  if (componentId.includes('pagination-prev')) {
    return 'TABLE_PAGE_PREV';
  }
  if (componentId.startsWith('table-sort') || action === 'sort') {
    return 'TABLE_SORT';
  }
  if (componentId.startsWith('table-row') || componentRole === 'table-row') {
    return 'TABLE_ROW_SELECT';
  }

  // 5. Contextual Inspection & Help
  if (componentRole === 'kpi-card' || componentId.startsWith('kpi-card')) {
    if (type === 'mouseover' || type === 'click') {
      return 'HOVER_KPI';
    }
  }
  if (componentRole === 'tooltip' || componentId.includes('tooltip') || componentId.includes('help')) {
    return 'HOVER_HELP';
  }

  // 6. Behavioral Markers
  if (action === 'backtrack' || event.action === 'BACKTRACK') {
    return 'BACKTRACK';
  }
  if (action === 'rapid_scroll' || event.action === 'RAPID_SCROLL') {
    return 'RAPID_SCROLL';
  }
  if (action === 'idle_dwell' || event.action === 'IDLE_DWELL') {
    return 'IDLE_DWELL';
  }

  return null;
}
