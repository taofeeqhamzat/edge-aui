/**
 * Canonical Action Layer (Task 20.4)
 *
 * One participant act can arrive as several browser events: a checkbox produces
 * `click` + `input` + `change`, a form submission produces `click` + `submit`, a date field
 * produces `input` + `change`. The framework needs one *classified* action per event so
 * that the task bridge and semantic derivation agree about which of those events is the
 * committed act.
 *
 * This layer classifies; it never deletes. The raw `BehaviourEvent` stays in the trace and
 * is carried on the action as evidence.
 *
 * The classification is deliberately annotation-based. The previous implementation guessed
 * from substrings — any component id containing "btn" was a form submit, so an export
 * button was labelled `FORM_SUBMIT` — which is why exact identity now decides: an annotation
 * says what a control is, and the id is an identity, not a bag of words.
 */

import type { BehaviourEvent, BehaviourEventType } from '../telemetry/events';

export type CanonicalActionKind =
  | 'click'
  | 'change'
  | 'input'
  | 'submit'
  | 'focus'
  | 'blur'
  | 'hover'
  | 'scroll'
  | 'navigate'
  | 'lifecycle';

/** How the action was resolved, recorded for auditability. */
export type CanonicalBasis = 'event_type' | 'component_role' | 'component_id' | 'route';

export interface CanonicalAction {
  kind: CanonicalActionKind;
  timestamp: number;
  componentId?: string;
  componentRole?: string;
  /** Destination route for a navigation action; the current route otherwise. */
  route?: string;
  taskId?: string;
  taskStepId?: string;
  /** Observed disclosure state, when the annotation declares one. */
  ariaExpanded?: boolean;
  /** True when the framework performed the act, so it is not participant behaviour. */
  systemInitiated: boolean;
  basis: CanonicalBasis;
  /** The canonical event this action was classified from. Never removed from the trace. */
  event: BehaviourEvent;
}

/** Event type → action kind. Types absent from this map carry no macro intent. */
const KIND_BY_EVENT_TYPE: Partial<Record<BehaviourEventType, CanonicalActionKind>> = {
  click: 'click',
  change: 'change',
  input: 'input',
  submit: 'submit',
  focus: 'focus',
  blur: 'blur',
  mouseover: 'hover',
  scroll: 'scroll',
  wheel: 'scroll',
  navigation: 'navigate',
  popstate: 'navigate',
  hashchange: 'navigate',
  pagehide: 'lifecycle',
  beforeunload: 'lifecycle',
  unload: 'lifecycle'
};

/**
 * Companion actions.
 *
 * A committed step is satisfied by one action; the browser events that accompany it are
 * companions, not separate interactions and not task errors. This is the single rule the
 * task bridge and semantic derivation both use, so a checkbox cannot be one selection for
 * the deriver and three interactions for the task.
 */
const COMPANIONS: Partial<Record<CanonicalActionKind, readonly CanonicalActionKind[]>> = {
  change: ['click', 'input'],
  click: ['submit']
};

export function isCompanionAction(
  committedKind: CanonicalActionKind,
  candidateKind: CanonicalActionKind
): boolean {
  return (COMPANIONS[committedKind] ?? []).includes(candidateKind);
}

/** True when the annotation names a submit control, or the event *is* a form submission. */
export function isSubmitControl(action: CanonicalAction): boolean {
  if (action.kind === 'submit') return true;
  if (action.kind !== 'click') return false;
  return /submit/i.test(action.componentRole ?? '');
}

/** Classifies a canonical event. Returns null when the event carries no macro intent. */
export function canonicalActionFor(event: BehaviourEvent): CanonicalAction | null {
  const kind = KIND_BY_EVENT_TYPE[event.type];
  if (!kind) return null;

  const hasRole = Boolean(event.componentRole);
  return {
    kind,
    timestamp: event.timestamp,
    componentId: event.componentId,
    componentRole: event.componentRole,
    route: event.route,
    taskId: event.taskId,
    taskStepId: event.taskStepId,
    ariaExpanded: event.ariaExpanded,
    systemInitiated: event.systemInitiated === true,
    basis: hasRole ? 'component_role' : event.componentId ? 'component_id' : 'event_type',
    event
  };
}
