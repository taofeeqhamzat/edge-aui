/**
 * Macro Mapping Boundary (Task 20.2)
 *
 * A `MacroMapper` is the application-supplied translation from a canonical behaviour event
 * to one token in that application's macro vocabulary. The framework owns the *sequence
 * mechanics* — buffering, ordering, correlation, windowing — and knows no symbol names.
 *
 * Two implementations are expected:
 * - an application's curated mapper (the testbed has one in
 *   `src/testbed/config/macroVocabulary.ts`), which is what a study or product uses;
 * - the generic annotation mapper below, which derives mechanical symbols from the
 *   semantic annotation contract so an unconfigured DOM application still produces a
 *   stream. Its vocabulary is a deterministic convention, not a curated one.
 */

import type { BehaviourEvent, BehaviourEventType } from '../telemetry/events';

export interface MacroMapper {
  /** Identity of the symbol vocabulary, recorded so a changed mapper is visible. */
  readonly vocabularyId: string;
  /** Declared vocabulary, when the application enumerates it. */
  readonly symbols?: readonly string[];
  /** Returns the symbol for an event, or null when the event carries no macro intent. */
  deriveSymbol(event: BehaviourEvent): string | null;
  /**
   * True when the value belongs to this mapper's vocabulary.
   *
   * Optional: a mechanical vocabulary cannot enumerate its symbols.
   */
  isSymbol?(value: string): boolean;
}

export const DEFAULT_MACRO_VOCABULARY_ID = 'annotation-derived/1.0.0';

/**
 * Behavioural transition markers the framework detects itself.
 *
 * These are not application vocabulary: route-level backtracking, rapid scrolling and idle
 * dwell are computed by the framework, so every integration sees the same names.
 */
export const BEHAVIOURAL_MARKER_SYMBOLS = {
  backtrack: 'BACKTRACK',
  rapidScroll: 'RAPID_SCROLL',
  idleDwell: 'IDLE_DWELL'
} as const;

/** Verb used for each deliberate interaction type. */
const VERB_BY_EVENT_TYPE: Partial<Record<BehaviourEventType, string>> = {
  click: 'CLICK',
  change: 'SELECT',
  input: 'SELECT',
  submit: 'SUBMIT',
  focus: 'FOCUS'
};

/** Event types that represent a deliberate navigation act rather than incidental traffic. */
const DELIBERATE_NAVIGATION_TYPES: ReadonlySet<string> = new Set([
  'click',
  'navigation',
  'popstate',
  'hashchange'
]);

const NAVIGATION_VERB = 'NAV';
const EXPAND_VERB = 'EXPAND';
const COLLAPSE_VERB = 'COLLAPSE';

/** Uppercases a label and reduces every run of non-alphanumerics to a single underscore. */
function normalizeToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface AnnotationMacroMapperOptions {
  vocabularyId?: string;
}

/** Uppercases a component label and strips a navigation control's `nav-` presentation prefix. */
function componentToken(componentId?: string): string {
  return normalizeToken((componentId ?? '').replace(/^nav[-_]/i, ''));
}

/** Framework-detected behavioural markers, independent of any component. */
function markerSymbol(action: string): string | null {
  if (action === 'backtrack') return BEHAVIOURAL_MARKER_SYMBOLS.backtrack;
  if (action === 'rapid_scroll') return BEHAVIOURAL_MARKER_SYMBOLS.rapidScroll;
  if (action === 'idle_dwell') return BEHAVIOURAL_MARKER_SYMBOLS.idleDwell;
  return null;
}

/** A click on a disclosure is an expand or a collapse, never a plain click. */
function disclosureSymbol(event: BehaviourEvent, target: string): string | null {
  if (event.type !== 'click' || event.ariaExpanded === undefined || !target) return null;
  return `${event.ariaExpanded ? EXPAND_VERB : COLLAPSE_VERB}_${target}`;
}

/** A deliberate act on a navigation control. Incidental pointer traffic is not navigation. */
function navigationSymbol(event: BehaviourEvent, target: string): string | null {
  const isNavigationControl =
    event.componentRole === 'navigation' || event.type === 'navigation';
  if (!isNavigationControl || !DELIBERATE_NAVIGATION_TYPES.has(event.type)) return null;
  return target ? `${NAVIGATION_VERB}_${target}` : null;
}

/** Any other deliberate interaction, named by its verb and its annotated component. */
function interactionSymbol(event: BehaviourEvent, target: string): string | null {
  const verb = VERB_BY_EVENT_TYPE[event.type];
  if (!verb || !target) return null;
  return `${verb}_${target}`;
}

/**
 * Derives a mechanical symbol from the semantic annotation contract.
 *
 * Order is the contract, and it is the order the curated testbed mapper uses: framework
 * markers first (they are not tied to a component), then observed disclosure state, then
 * deliberate navigation, then the remaining interaction verbs. Anything else — pointer
 * movement, an unannotated node, a task-less click — yields null rather than a guess,
 * because a wrong symbol is mined as a behavioural pattern.
 */
export function deriveAnnotationSymbol(event: BehaviourEvent): string | null {
  const target = componentToken(event.componentId);
  return (
    markerSymbol(event.action?.toLowerCase() ?? '') ??
    disclosureSymbol(event, target) ??
    navigationSymbol(event, target) ??
    interactionSymbol(event, target)
  );
}

/**
 * Builds the generic annotation mapper.
 *
 * It is a deterministic convention for an unconfigured application, not a curated
 * vocabulary: an application that wants meaningful symbols supplies its own `MacroMapper`.
 */
export function createAnnotationMacroMapper(
  options: AnnotationMacroMapperOptions = {}
): MacroMapper {
  return {
    vocabularyId: options.vocabularyId ?? DEFAULT_MACRO_VOCABULARY_ID,
    deriveSymbol: deriveAnnotationSymbol
  };
}
