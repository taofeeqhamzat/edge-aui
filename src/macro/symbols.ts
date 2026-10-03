/**
 * Semantic Macro Interaction Symbol Vocabulary & Event Derivation
 * Implements Stage 6.1 specifications from docs/testbed/prd.md Sections 16 & 17.
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
 *
 * Two rules here exist specifically to stop the macro stream from being dominated by
 * repetition artefacts rather than interaction episodes (assessment F-06):
 *
 * 1. Navigation symbols require a *deliberate* navigation act (a click on a navigation
 *    control, or a real navigation event). They used to also be derived from
 *    `event.route` alone, and because every event on a page carries the page's route, a
 *    `mouseover` on the page root produced one `NAV_OVERVIEW` per hover — 18 per short trial
 *    in the audit — which the Fast Gate then "recognised" as a pattern.
 * 2. Accordion open/close is derived from the observed `aria-expanded` state, not from an
 *    `action` substring. No producer ever emitted an action containing "close", so
 *    `CLOSE_FILTERS` was unreachable while every accordion interaction became
 *    `OPEN_FILTERS`.
 */
export function deriveMacroSymbol(event: BehaviourEvent): MacroSymbol | null {
  const componentId = event.componentId?.toLowerCase() ?? '';
  const componentRole = event.componentRole?.toLowerCase() ?? '';
  const action = event.action?.toLowerCase() ?? '';
  const type = event.type;

  // 1. Navigation Actions — only deliberate navigation.
  const isNavigationControl =
    componentRole === 'navigation' || componentId.startsWith('nav-') || type === 'navigation';
  const isDeliberateNavigationAct =
    type === 'click' || type === 'navigation' || type === 'popstate' || type === 'hashchange';

  if (isNavigationControl && isDeliberateNavigationAct) {
    if (componentId.includes('overview')) return 'NAV_OVERVIEW';
    if (componentId.includes('analytics')) return 'NAV_ANALYTICS';
    if (componentId.includes('reports')) return 'NAV_REPORTS';
    if (componentId.includes('customers')) return 'NAV_CUSTOMERS';
    if (componentId.includes('settings')) return 'NAV_SETTINGS';
    // A navigation control whose destination the annotation does not name, plus real
    // navigation events, are attributed from the route. The route fallback is confined to
    // this deliberate-act branch so it cannot fire on incidental pointer traffic.
    const route = event.route?.toLowerCase() ?? '';
    if (route.includes('overview')) return 'NAV_OVERVIEW';
    if (route.includes('analytics')) return 'NAV_ANALYTICS';
    if (route.includes('reports')) return 'NAV_REPORTS';
    if (route.includes('customers')) return 'NAV_CUSTOMERS';
    if (route.includes('settings')) return 'NAV_SETTINGS';
    // An unnamed destination on a real navigation event is not a navigation episode: it is
    // the current page reporting itself. Returning NAV_GENERAL there produced one generic
    // symbol per navigation event, which is the noise this rule removes.
    return type === 'click' ? 'NAV_GENERAL' : null;
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
  //
  // Open vs close comes from the observed disclosure state. When the state is unavailable
  // the event is *not* guessed into `OPEN_FILTERS`: an unclassifiable accordion interaction
  // produces no symbol rather than a wrong one, because a wrong symbol is mined as a
  // behavioural pattern.
  const isAccordionInteraction = componentRole === 'accordion' || componentId === 'filter-drawer';
  if (isAccordionInteraction && (action === 'click' || type === 'click')) {
    if (event.ariaExpanded === true) return 'OPEN_FILTERS';
    if (event.ariaExpanded === false) return 'CLOSE_FILTERS';
    return null;
  }

  // Generic filter-control actions fire on change/input rather than on pointer events.
  const isChangeLike = type === 'change' || type === 'input' || action === 'change' || action === 'select';
  if (isChangeLike || componentId.includes('date')) {
    if (componentId.includes('date')) return 'SELECT_DATE';
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

  // 4b. Tooltip expansion is an explicit user action on a tooltip affordance.
  if (
    (componentRole === 'tooltip' || componentId.includes('tooltip')) &&
    (type === 'click' || action === 'expand' || action === 'expand_tooltip')
  ) {
    return 'EXPAND_TOOLTIP';
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
