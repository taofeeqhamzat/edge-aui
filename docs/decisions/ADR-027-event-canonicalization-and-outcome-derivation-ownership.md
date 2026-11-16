# ADR-027: Event Canonicalization and Semantic Outcome Derivation Ownership

- **Status:** Proposed
- **Date:** 2026-11-16
- **Related:** ADR-011, ADR-017, ADR-025, ADR-026, ADR-028, ADR-029

## 1. Context

The runtime currently produces canonical `BehaviourEvent`s from the DOM, then:

- derives generic outcomes in `src/outcome/derive.ts`;
- derives macro symbols in `src/macro/symbols.ts`;
- emits task events from a separate testbed bridge.

The semantic outcome layer needs to represent meaningful task actions (`select_region`,
`apply_filter`, `select_report`, `export_report`, `reset_filter`, `backtrack`) rather than the
current generic click/scroll/hover classes.

Current defects:

- `OutcomeDeriver` ignores `change`, `input` and `submit`; filter selection cannot become an outcome.
- `isFormSubmitTarget()` labels any component id/role containing `btn`/`button`/`input`/`form`/
  `primary-action` as `FORM_SUBMIT`, so Export is mislabelled.
- `blur` is treated as `BACKTRACK`.
- Macro rules are substring-based and testbed-specific; `tooltip-region` matches the `region` rule
  before the tooltip rule; row hover becomes `TABLE_ROW_SELECT`; several symbols have no producer.
- One participant action can produce multiple events (checkbox `click`/`input`/`change`; Apply
  `click`/`submit`).
- The macro vocabulary and testbed IDs live in framework core, so a second UI would require core
  edits.

## 2. Problem

Which layer owns event canonicalization, macro mapping and semantic outcome derivation, and how is
the framework kept application-agnostic while still recording reliable labels?

## 3. Options considered

| Option | Description | Problem |
| --- | --- | --- |
| A. Framework owns all semantic rules | Core knows testbed components/outcomes | Violates ADR-011; second UI requires core edits |
| B. Testbed owns all event processing | Testbed implements its own dedupe/derivation | Duplicate logic; different apps drift; framework cannot provide reusable mechanics |
| **C. Split generic mechanics from application rules** | Framework canonicalizes/dedupes and exposes a derivation contract; testbed supplies IDs/rules/backtrack page identity | Requires a small extension contract; best fit with ADR-011 and the milestone requirement |

## 4. Evidence available

**Verified**

- `src/telemetry/observer.ts` emits one raw event per DOM event; it does not dedupe click/submit or
  click/input/change.
- `src/outcome/derive.ts` handles click, lifecycle, blur/popstate, scroll and mouseover only.
- `src/macro/symbols.ts` contains testbed IDs (`btn-export`, `filter-Region`, `tooltip-region`).
- The task-diversification assessment reproduces the macro misclassification and derivation gaps.
- The testbed task bridge maps event types to task actions and also lacks dedupe.
- A second mock adapter test is feasible and is the boundary proof required by ADR-011.

**Not measured**

- The exact dwell/commit semantics for every browser; the generic canonicalizer must stay
  implementation-neutral.
- Whether future tasks need scroll-region attribution; not required for TD1–TD4.

## 5. Decision required

The ownership of canonicalization/dedupe, macro mapping, semantic outcome rules, and backtracking.

## 6. Decision

**Adopt Option C.**

The framework core owns generic mechanics:

- committed `change` only when the value actually changed;
- one checkbox interaction → one committed selection;
- one form submission → one Apply (suppress the submit button's duplicate click);
- one date commit → one date outcome;
- exact ID/role checks before substring checks;
- system/programmatic actions excluded from user outcomes;
- a stable derivation-context shape and vocabulary/version fields;
- a route-level backtracking tracker seeded from the task's starting page.

The testbed owns application rules:

- macro symbol vocabulary and event→symbol mapping;
- which component/role/action maps to which semantic outcome ID;
- report/filter/section identity;
- the vocabulary and its version;
- the current-page identity supplied to the backtrack tracker.

The generic seven-class `OutcomeDeriver` remains available. The semantic layer is additive.

Backtracking rule:

```text
visitedPages = [startingPage]
on deliberate page change to P:
    if P != currentPage and P in visitedPages:
        emit backtrack
    append P
```

Same-page clicks, blur, accordion collapse, filter edits and browser Back (no URL router) do not
count. A report open changes page but its primary outcome is `select_report`; the page visit still
updates the tracker. Returning to Reports later emits `navigate_reports` plus `backtrack`.

## 7. Consequences

- The framework remains reusable; a second app supplies its own mapper/rules.
- One participant action produces one primary semantic outcome, plus optional derived/lifecycle
  labels (`backtrack`, `task_complete`).
- `tooltip-region` can no longer be a filter selection.
- The raw event remains for evidence; canonicalization is a derived view.
- Test fixtures must cover committed changes, duplicate events, exact-ID precedence, report
  selection and backtrack negatives.
- Model-preparation must mirror these rules on shared fixtures (Workstream 40.2).

## 8. What is being deferred

> **Decision:** Region-attributed scroll and a `scroll_results` semantic outcome.
> **Deferred until:** A task explicitly requires table-scanning/scroll behaviour.
> **Reason:** Scroll events currently carry no component/region identity; adding attribution
> without a task need would expand telemetry for no defined analysis.
> **Current workaround:** `RAPID_SCROLL` remains a generic outcome; region annotations are planned
> but not used for scroll attribution yet.
> **Risk:** Low — scroll behaviour can be studied later without changing the semantic vocabulary.
> **Evidence required to revisit:** A task design that depends on scroll/scanning or a supervisor
> request for scroll analysis.

## 9. Conditions that would force this decision to be revisited

- A second application needs different canonicalization/dedupe semantics that cannot be configured.
- The generic canonicalizer cannot represent a required browser interaction without app-specific
  code.
- The backtrack rule produces misleading labels under a real task path.
- A study requires scroll-region outcomes.
