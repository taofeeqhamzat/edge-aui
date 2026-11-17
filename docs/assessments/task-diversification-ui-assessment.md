# UI Assessment for Task Diversification — Edge-AUI

- **Date:** 2026-11-14
- **Scope:** Step 1 of the task-diversification sequence ([`task-diversif-assess.md`](task-diversif-assess.md))
- **Target UI:** `https://edge-aui.hamzattao.workers.dev`
- **Source inspected:** `edge-aui-framework` working tree at commit `25033a8`
- **Status:** Assessment complete — no UI, task, telemetry, model, or PrefixSpan changes were implemented

**Evidence labels used in this report**

| Label   | Meaning                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| **[V]** | Verified against the deployed application, the current source, or an executing test |
| **[S]** | Verified by source inspection only; not exercised end to end                        |
| **[P]** | Proposed change; not implemented                                                    |

The deployed bundle inspected on 2026-11-14 (`/assets/index-CgPFpT7Z.js`) differs from the
local `dist` bundle (`/assets/index-CWp0LfA-.js`). The deployed controls and behaviour matched
the working tree for every path inspected below, but exact build parity was not proven. No
participant traces were collected for this assessment. No participant, latency, memory, or accuracy
measurement is claimed; the row counts in Appendix A are deterministic properties of the stimulus
generator, not empirical measurements.

---

## 1. Executive Summary

### A. Overall assessment

**The existing UI can support meaningful task diversification, but only a small amount without
modification.** It is not a rich analytics product. It is a five-page shell in which exactly one
page (`Analytics`) contains an operable workflow: a collapsed filter drawer, four KPI cards, a
50-row results table, and an export button. `Overview`, `Reports`, `Customers`, and `Settings`
render only `This is the <page> view.` **[V]**

Without additional UI, the only genuinely available goals are variations of "filter the table
and export or verify it." That is not enough. The legacy task set (T1–T3) confirms the problem:
all three tasks start with `nav-Analytics`; T1 and T3 share an `Apply Filters` ending; T2 is only
`nav-Analytics → Export`; and T3's Customer Segment step changes a control that has **no effect
on the results table** because `applyFilters()` never reads `filters.segment`. **[V]**

The most important limitations are:

1. **One functional page.** No report catalogue, report detail, customer view, settings, search,
   sorting, pagination, or row selection exists. The pages that would naturally diversify starting
   points are empty placeholders. **[V]**
2. **Filter state is inconsistent across navigation.** The applied filter set lives in `App`;
   the drawer's draft state lives in `FilterDrawer`. Navigating away unmounts the drawer, so its
   controls reset, while the table remains filtered. In the deployed app: Europe + Books → 6 rows;
   go to Reports and back → still 6 rows, but the drawer shows default values and all sections
   collapsed. Applying a new filter then silently replaces the old applied set. **[V]**
3. **Task success is not goal-verified.** `TaskManager` completes a step when component id and
   action match. It does not check the selected value, the date, the report, or the result count.
   A `change` event on the Region select satisfies T1's "Select Region" step even when the value
   is still the default `All regions`. **[V]**
4. **One participant action can emit several task interactions.** Clicking a checkbox emits
   `click` and `change`/`input`; clicking Apply emits a button `click` and a form `submit`. The
   bridge does not deduplicate, so a multi-step task can accrue spurious `task_error` events. **[S]**
5. **Outcome labels are click-centric.** `OutcomeDeriver` considers clicks, lifecycle events,
   scroll, and hover, but never `change`, `input`, or `submit`; filter selection and the form
   submission itself are therefore invisible to the target head. Its `isFormSubmitTarget()` treats a component id/role containing
   `btn`/`button`/`input`/`form`/`primary-action` as a form submit, so `btn-export` is labelled
   `FORM_SUBMIT`. `blur` is labelled `BACKTRACK`. **[S]**
6. **Several macro symbols are misleading or unreachable.** `tooltip-region` matches the
   `SELECT_REGION` substring rule before the tooltip rule, so hovering the Region help icon emits
   `SELECT_REGION`. `TABLE_ROW_SELECT` is emitted on row hover even though rows are not selectable.
   `RESET_FILTERS`, `OPEN_REPORT`, `TABLE_PAGE_*`, and `TABLE_SORT` have no control in the shipped
   UI; `EXPAND_TOOLTIP` is reachable by clicking a tooltip `<span>` but produces no visible
   expansion; and the `BACKTRACK`/`IDLE_DWELL`/`RAPID_SCROLL` macro symbols have no producer. **[V]**
7. **There is no task-start normalisation, no timeout, and no failure state.** Starting a task
   does not reset the page or filters; starting another task mid-trial does not record an
   abandonment for the first; `taskTimeoutsMs` is configured but unused; `TaskStatus` has no
   `Failed`. **[V]**

**Is UI modification necessary?** Yes, but not redesign. The minimum is a task harness that makes
starting state reproducible and completion state-verified, one small Reset Filters control, contract
hygiene for identifiers, and one moderate addition — a Reports catalogue — if starting-point and
report-selection diversity are required. No major reorganisation is justified. The recommended set
is three core tasks, one recommended addition, and one optional task; only the recommended addition
needs a moderate UI addition.

### B. Recommended task set

New ids are used deliberately: `TD1`–`TD5` replace the legacy `T1`–`T3` so that new traces cannot
be conflated with old trace files. If numeric continuity is preferred, reuse `T1`–`T5` only after
adding a `taskDefinitionVersion` to task events.

| Priority | Task                                                    | Starting point | Main action sequence                                                                                | Completion condition                                            | UI change required                                                    |
| -------- | ------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| **P1**   | **TD1 — Regional sales export**                         | Overview       | Analytics → open Region → select Europe → Apply → Export                                            | Analytics; region = Europe; 18 visible rows; export click       | **None**                                                              |
| **P1**   | **TD2 — Date and category filter**                      | Analytics      | open Date Range → 2025-06-01 → open Product Category → check Books → Apply                          | dateFrom = 2025-06-01; categories = [Books]; 5 visible rows     | **None**                                                              |
| **P1**   | **TD3 — Empty-result recovery**                         | Analytics      | Region Europe → Category Books → date 2025-09-01 → Apply (0 rows) → Reset Filters → confirm 50 rows | empty state observed; reset clears filters; 50 visible rows     | **Minor** — add Reset Filters; state predicate                        |
| **P2**   | **TD4 — Report comparison and export**                  | Reports        | open Europe Electronics (3 rows) → return to Reports → open Europe Books (6 rows) → Export          | both reports visited; Europe Books active; 6 rows; export click | **Moderate** — Reports catalogue + current-report state + preset sync |
| **P3**   | **TD5 — Definition inspection and export** _(optional)_ | Analytics      | hover Total Revenue KPI → hover Region column help → Export                                         | both dwell events recorded; export click                        | **Minor** — hover task action; focusable/titled tooltips              |

Task priority: **P1** = core, implement first; **P2** = recommended; **P3** = optional. Counts are
for the deterministic 50-row dataset (`seed = 20250921`). They are recomputed in Appendix A and must
be updated if the stimulus data changes.

### C. Recommended outcome vocabulary

A single semantic layer, additive to the existing seven-class taxonomy until the Slow Gate is
retrained. Full definitions are in Section 4.

- **Navigation:** `navigate_overview`, `navigate_analytics`, `navigate_reports`
- **Report selection:** `select_report`
- **Filter disclosure:** `open_filter_section`, `close_filter_section`
- **Filter selection:** `select_region`, `select_date_range`, `select_category`
- **Filter commitment:** `apply_filter`, `reset_filter`
- **Output:** `export_report`
- **Inspection:** `inspect_kpi`, `inspect_help`
- **Recovery / lifecycle:** `backtrack`, `task_complete`, `task_abandon`
- **Fallback:** `NO_OUTCOME`

**Outcomes requiring special rules**

- `backtrack` is **not** any backward event. It is a deliberate return to a page already visited
  in the same task after at least one different page. Closing an accordion, changing a filter, or
  blurring a control is not backtracking.
- `inspect_kpi` and `inspect_help` require a dwell threshold, not a transient pointer crossing.
- `task_complete` and `task_abandon` are task-lifecycle labels. They are evaluation ground truth,
  not Slow Gate prediction targets; using them as model inputs would leak the task definition.
- `apply_filter` is canonicalised to one form submit. The preceding button click must not produce
  a second interaction, and `export_report` must not be labelled `FORM_SUBMIT`.

**Conditional outcomes not in the core vocabulary:** `select_segment` only if the Customer Segment
filter is made functional; `scroll_results` only if scroll is attributed to a UI region;
`select_row` is rejected because rows are not selectable; `navigate_customers` and
`navigate_settings` are omitted because those pages have no task-supporting content.

### D. Essential UI changes

Some items below are task-harness or instrumentation changes rather than visual changes. They are
listed together because they must land with the UI contract; separating them would leave the task
set unimplementable.

**Necessary before task implementation**

1. **Task-start normalisation** — set the task's `startingPage`, clear applied and draft filters,
   collapse accordions, clear any current report, and clear errors before `task_start`. **[P]**
2. **State-based completion predicates** — evaluate page, applied filters, visible row count,
   empty state, current report, and visited reports against an explicit UI-state snapshot. Keep
   step matching for diagnostics only. **[P]**
3. **Action canonicalisation and de-duplication** — one participant action → one task interaction
   and one outcome. Suppress the duplicate click when a form submits; collapse checkbox
   `click`/`input`/`change` into one committed change. **[P]**
4. **Stable filter-section identifiers** — replace space-containing ids (`filter-Product Category`,
   `filter-Date Range`, `filter-Advanced Options`) with snake_case ids and update the task model,
   tests, and macro mapping. **[P]**
5. **Reset Filters control** (`btn-reset-filters`) — clears both draft and applied state
   immediately. Required for TD3 and for clean task preconditions. **[P]**
6. **Reports catalogue** — add the Reports list, Open controls, current-report indicator, and
   preset-filter synchronisation. Required only for TD4; this is the one moderate addition. **[P]**
7. **Task ids and configuration** — add `TD1`–`TD5` to `TaskId`, `TASK_STEP_COUNTS`,
   `experiment.trialOrder`, and `taskTimeoutsMs`; retire the legacy ids from the participant UI. **[P]**

**Necessary before trace collection (may follow task implementation)**

1. **Semantic outcome recording** — add a `taskOutcome` field (or equivalent) derivable from the
   canonical event/macro stream, while retaining the existing `outcome` field. Do **not** replace
   the seven-class taxonomy or retrain the Slow Gate in this step. **[P]**

**Optional improvements**

- **Customer Segment decision** — either make the segment filter functional (data field +
  `applyFilters` + optional visible column) or remove it. Not required for TD1–TD5, but required if
  any segment task is retained, and leaving a dead control in a participant interface is a validity
  problem. **[P]**
- Hover/focus task-action support with a dwell threshold, and keyboard-focusable tooltip triggers
  with `data-tooltip`/`title` on KPI cards — required only for TD5 and `expand_tooltip` targets. **[P]**
- `data-aui-region` on the major regions listed in Section 5.2, for region-level analysis and
  future interventions. **[P]**
- Export confirmation or current-report name in the download filename. **[P]**
- A date-to filter — not required for this set; defer until a period-based report is needed. **[P]**

### E. Immediate next steps

1. **Decide TD4.** Approve or reject the Reports catalogue. It is the only moderate change and the
   only way to add a second non-Analytics starting point and a report-selection goal without
   inventing unrelated features.
2. **Normalise the id contract.** Rename filter-section ids to snake_case and update
   `taskModel.ts`, `tests/task_wiring.test.tsx`, `tests/semantic_dom_annotations.test.tsx`, and
   macro mapping in the same change. Add `data-aui-region` (C8) before region-level analysis.
3. **Canonicalise interactions.** Make one action produce one interaction; add tests that a
   checkbox toggle, date change, Apply submission, and Export click each produce exactly one
   task-observable action and no spurious `task_error`.
4. **Implement task-start normalisation.** Add `startingPage` and a host-level reset in
   `TrialControls.handleStart()` before `taskManager.startTask()`.
5. **Add the UI-state snapshot and completion predicates.** Cover page, filters, row count, empty
   state, current report, and visited reports. Convert TD1–TD4 to state-verified completion.
6. **Add Reset Filters; resolve the segment control if it is retained.** Reset must clear both draft
   and applied state. Segment must work or disappear before participant use; it is not required for
   TD1–TD5.
7. **Implement TD4's Reports catalogue** (if approved) with deterministic entries, preset filters,
   `open-report-*` ids, and a visible current-report label.
8. **Implement TD1–TD5 definitions** with value/state assertions and tests. Do not reuse legacy
   task semantics without a definition version.
9. **Add the semantic outcome layer** alongside the generic outcome. Update the Fast Gate declared
   patterns later, in Step 4; do not optimise PrefixSpan here.
10. **Run a scripted dry run of every task under both conditions.** Verify canonical completion,
    zero errors on the canonical path, expected outcomes, and no duplicate events. Only then
    collect participant traces.

### F. Outstanding decisions

1. **Reports catalogue or not?** Approve the moderate TD4 addition, or accept a set without a
   report-selection outcome. A compact report-selector on Analytics is a lower-scope fallback, but
   it does not diversify starting points.
2. **Fix or remove Customer Segment?** Keeping it inert invalidates the legacy T3 and any
   segment-based claim. Fixing it requires a deterministic segment field and a visible way to
   verify the filtered set.
3. **Task id continuity.** Use new ids (`TD1`–`TD5`) to protect old traces, or reuse `T1`–`T5` with
   a recorded `taskDefinitionVersion`. This report recommends new ids.
4. **Success semantics.** Should `task_complete` mean "canonical controls touched in order" or
   "required UI state achieved"? This report recommends state-verified completion. This is a
   methodology decision, not only an implementation detail.
5. **Timeout and failure.** Should an incomplete trial time out and become `task_abandon`? The
   configuration exists; no code path uses it. This is a protocol decision.
6. **When to change the Slow Gate taxonomy.** This report recommends additive semantic recording
   now and retraining in Step 3, so the current model and `config.yaml` remain valid during trace
   collection.
7. **Is TD5 in scope?** Hover/dwell is a distinct modality, but the task is weaker than TD1–TD4
   and requires instrumentation changes. Implement it only if hover/help coverage is a study goal.

---

#### Researcher's Decisions:

1. approve
2. remove
3. new ids
4. state verified completion
5. yes
6. additive semantic recording first, then target intervention head retraining in a later step.
7. no

---

## 2. Existing UI Assessment

### 2.1 What was inspected

- The deployed testbed was opened in Chromium (1280×633 viewport) and all five pages, the filter
  drawer, expanded accordions, task controls, the results table, and the export action were
  exercised. Screenshots were taken during inspection but are not committed.
- The current source and the task/telemetry tests were inspected. The deployed UI matched the
  working tree for the controls and behaviours listed here.
- Filtered row counts were recomputed from the deterministic generator in
  [`tableData.ts`](../../src/testbed/mock-data/tableData.ts). They were not inferred from a
  participant trace.

### 2.2 Pages, routes, and regions

The application is a state-only SPA. `App` holds `currentPage` in React state and renders
`Navigation` plus one page body; there is no URL router. `data-aui-route` on the app container is
the only route signal. Reloading returns to `Overview` with empty filters. **[V]**

| Page          | Rendered content                                  | Major regions                             | Interactive controls                                                                                | Task relevance                                     |
| ------------- | ------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Overview**  | `This is the Overview view.`                      | App shell, trial controls, debug launcher | None beyond navigation/trial controls                                                               | Default landing page; a reproducible start for TD1 |
| **Analytics** | Filter drawer, four KPI cards, results table      | Filters, KPIs, results                    | Accordions, date input, region select, category checkboxes, segment select, Apply, Export, tooltips | The only functional task page                      |
| **Reports**   | `This is the Reports view.`                       | App shell, trial controls                 | None                                                                                                | Placeholder; proposed home of TD4's catalogue      |
| **Customers** | `This is the Customers view.`                     | App shell, trial controls                 | None                                                                                                | No meaningful task                                 |
| **Settings**  | `This is the Settings view.`                      | App shell, trial controls                 | None                                                                                                | No meaningful task                                 |
| **App shell** | Sidebar, page header, trial controls, debug panel | Navigation, trial, debug                  | Five nav buttons, condition buttons, task start/reset, debug toggle                                 | Cross-cutting; not a task goal                     |

Relevant source: [`App.tsx`](../../src/app/App.tsx) lines 16–63,
[`Navigation.tsx`](../../src/app/Navigation.tsx) lines 1–43.

### 2.3 Functional inventory by region

#### Navigation sidebar

Five buttons: `Overview`, `Analytics`, `Reports`, `Customers`, `Settings`. Each carries
`data-aui-component="nav-<Page>"`, `data-aui-role="navigation"`, and `data-aui-action="click"`.
Clicking changes React state; it does not change the URL, does not push browser history, and does
not emit a `navigation` event. **[V]**

Consequence: `popstate`/`hashchange` never fire for in-app navigation, so browser Back is not a
usable backtracking behaviour. A backtracking rule must be defined over deliberate nav clicks and
page visits.

#### Experimental trial controls

The panel shows the session id, the `baseline`/`adaptive` condition, Start buttons for T1–T3,
Reset Trial, and a live status row (status, current step, error count). Start calls
`runtime.resetTrial()` and then `taskManager.startTask(taskId)`. It does **not** change the page,
reset the filter drawer, clear applied filters, or clear a current report. **[V]**

Consequences:

- Starting TD1 on Overview versus Analytics produces different first actions; without
  normalisation the starting point is whatever page the previous activity left behind.
- Starting another task mid-trial overwrites the in-progress state without emitting
  `task_abandon` for the previous trial. **[S]**
- Switching condition while a task is in progress rebuilds the runtime but leaves the task state
  intact; the trial can continue under a different condition. **[S]**

Source: [`TrialControls.tsx`](../../src/testbed/components/TrialControls.tsx) lines 37–72,
118–169; [`adaptiveRuntime.ts`](../../src/runtime/adaptiveRuntime.ts) lines 541–579.

#### Filter drawer

The drawer is a real `<form data-aui-component="filter-drawer" data-aui-role="filter">` with four
accordion sections, all collapsed initially: `Date Range`, `Region`, `Product Category`, and
`Advanced Options`. A control inside a collapsed section is not in the DOM. **This progressive
disclosure is intentional and is part of the current task design.** **[V]**

| Section          | Control                     | Component id                                                                       | Action         | Effect                                                              |
| ---------------- | --------------------------- | ---------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| Date Range       | `<input type="date">`       | `filter-date-input`                                                                | change         | Sets `dateFrom`; filters rows with `row.date < dateFrom` out        |
| Region           | `<select>`                  | `filter-Region-select`                                                             | change         | Filters exact region; `All` means no region constraint              |
| Product Category | Three checkboxes            | `filter-category-electronics`, `filter-category-clothing`, `filter-category-books` | change         | OR within categories; no category selected means no constraint      |
| Advanced Options | Customer Segment `<select>` | `filter-segment-select`                                                            | change         | **No effect on the table** — `applyFilters()` never reads `segment` |
| —                | Apply Filters               | `btn-apply-filters`                                                                | click / submit | Copies the drawer's draft state into `App.appliedFilters`           |

Source: [`FilterDrawer.tsx`](../../src/testbed/components/FilterDrawer.tsx) lines 27–195;
[`ResultsTable.tsx`](../../src/testbed/components/ResultsTable.tsx) lines 15–36.

**Draft vs applied state.** `FilterDrawer` owns a local `filters` object; `App` owns
`appliedFilters`. Nothing updates the table until Apply. The drawer's local state is lost when the
component unmounts (navigating away from Analytics), while `appliedFilters` survives in `App`.
Returning to Analytics therefore shows a table filtered by values the drawer no longer displays.
This was verified in the deployed app: after Europe + Books (6 rows), navigating to Reports and
back left 6 rows with the Region select reading `All regions` and every category unchecked. **[V]**

**No reset control exists.** Reset Trial clears task/runtime state but leaves both applied filters
and the filtered table untouched. Verified live: Reset Trial left the 6-row result set in place. **[V]**

**Segment is inert.** Verified live: selecting `Returning` and applying left the result count
unchanged (6 rows). This makes the legacy T3's central step a control press with no observable
consequence. **[V]**

#### KPI cards

Four static cards: Total Revenue, Active Users, Conversion Rate, Average Order Value. Each has a
generated component id (`kpi-card-total-revenue`, etc.), `data-aui-role="kpi-card"`, and
`data-aui-action="hover"`. They are not buttons, not focusable, have no click handler, and carry no
help text. Hovering them produces macro `HOVER_KPI` and, if the lookahead contains enough
mouseovers, generic `HOVER_DWELL`. **[V]**

They are useful as inspection/intervention surfaces, but they do not support a goal beyond
"look at a number." They cannot be a standalone task without a weak completion rule.

#### Results table

- `Results (50)` is a live count derived from the filtered set.
- The table renders 50 rows initially. Rows have hover-only annotation
  (`data-aui-role="table-row"`, `data-aui-action="hover"`); rows are **not selectable**, have no
  click handler, and do not open a detail view.
- The table body is an internal scroll container: at 1280×633 the visible area was 420 px high
  against 2113 px of scroll height. There is also page-level scroll at smaller viewports.
- Two header tooltips, `tooltip-region` and `tooltip-status`, use native `title` attributes. They
  are `<span>` elements, not focusable, and have no click handler. **[V]**
- The empty state is a single row: `No rows match the active filters.` with
  `data-aui-component="results-empty"`. **[V]**
- Export calls `downloadRows(visibleRows)`, which creates a client-side JSON `Blob` and clicks a
  temporary anchor. In the deployed app, clicking Export produced
  `report-export-<timestamp>.json` containing `rowCount: 50` and the rendered rows. There is no
  visible confirmation in the page. **[V]**

Source: [`ResultsTable.tsx`](../../src/testbed/components/ResultsTable.tsx) lines 38–193;
[`style.css`](../../src/style.css) lines 439–443.

#### Debug panel

A floating `⚡ Debug` launcher opens a researcher-oriented panel with trace export, clear, and
reset-task controls. It is not a participant task surface and is not annotated as a task region.
It is always present and overlaps the lower-right area of the table at small viewports. **[V]**

### 2.4 Existing task definitions

The current definitions live in [`taskModel.ts`](../../src/testbed/tasks/taskModel.ts) lines 38–70.

| Task                               | Steps                                                          | Start     | Ending | Problem                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------- | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1 — Filter Analytics**          | nav-Analytics → open Region → select Region → Apply            | Analytics | Apply  | First step repeats in all tasks; no region value check; a `change` event at the default `All` completes the step                                   |
| **T2 — Export Report**             | nav-Analytics → Export                                         | Analytics | Export | Only two steps; shares T1's first step; no filtering or intermediate decision                                                                      |
| **T3 — Configure Advanced Filter** | nav-Analytics → open Product Category → change Segment → Apply | Analytics | Apply  | Segment step is inert; the segment control is inside a different accordion (`Advanced Options`) than the one the task asks the participant to open |

All three begin with `nav-Analytics`. T1 and T3 end on the same control. T1 and T3 differ mainly in
which accordion is opened. T2 shares T1's navigation step but adds only Export; it has no filtering
or intermediate decision. **[V]**

### 2.5 Task state machine and its limitations

`TaskManager` is a strict, ordered step machine. It matches `expectedComponentId` and
`expectedAction` against the **current** step only. A click/change/submit that does not match the
current step increments `errors` and emits `task_error`; it does not advance. The comment above
`recordInteraction()` claims interactions are also evaluated against the immediate next step, but
the implementation contains no such look-ahead. **[V]**

Out-of-order behaviour was exercised in the deployed app with T3: performing a later step before
its predecessor produced errors and left the task `In Progress`. **[V]**

Other verified characteristics:

- A step is satisfied by component id + action only. No value, checked state, date, result count,
  or report identity is validated. The existing quality assessment records the same defect
  (F-15) and a live case where a `change` left the Region select at `All` and T1 still completed. **[V]**
- `TaskStatus` has no `Failed` state. Non-matching actions only increment `errors`. **[V]**
- `abandonTask('timeout')` exists but has no caller. `experiment.taskTimeoutsMs` is configured in
  [`runtimeConfig.ts`](../../src/config/runtimeConfig.ts) lines 262–266 and never read. **[V]**
- `task_abandon` is emitted by Reset Trial (reason `reset`) and by an explicit `abandonTask()`
  call, which only the adapter exposes. In-app navigation does not abandon: the runtime listens for
  a `navigation` event, but no code dispatches one. **[V]**
- Starting a new task mid-trial calls `startTask()` directly; it does not first abandon the active
  task. **[S]**
- The observer bridge maps `click`, `submit`, `change`, and `input` to task actions. It has no
  mapping for `mouseover`, `focus`, or `scroll`, so hover and scroll can never satisfy a task
  step. **[S]**

### 2.6 Action duplication and spurious errors

This is a structural issue that must be fixed before multi-step tasks are added. **[S]**

- Clicking a checkbox fires `click`, then `input`, then `change`. The task bridge maps by **event
  type**, so it sees actions `click`, `input`, `change`. A step expecting `change` sees a
  mismatching `click` first (which increments `errors`), an ignored `input`, and then the matching
  `change`. If the checkbox is toggled after its step has already advanced, the extra events become
  errors against the next step.
- Clicking Apply fires a button `click` with `componentId="btn-apply-filters"` (task action
  `click`) and a form `submit` with `componentId="filter-drawer"` (task action `submit`). A step
  that expects the button click completes, then the submit event can mismatch the following step
  (for example, Export in TD1).
- Typing or picking a date can emit `input` and `change` events. A step expecting one `change`
  sees an ignored `input` first; repeated `change` events can still duplicate the interaction.

The observer itself is faithful — it records what happened. The defect is that the task bridge
does not canonicalise one participant action into one semantic interaction. The same duplication
also feeds outcome derivation: the Apply button click yields a `FORM_SUBMIT` candidate, while the
actual `submit` event is not considered by `OutcomeDeriver()` at all. **[S]**

### 2.7 Existing semantic annotations

The current contract is `data-aui-component`, `data-aui-role`, `data-aui-action`, and
`data-aui-task-role`, defined in [`uiContext.ts`](../../src/types/uiContext.ts) lines 16–49.
Coverage is good on the controls:

- 5 nav buttons, trial controls, condition buttons, task start/reset buttons.
- Filter drawer form, four accordions, date input, region select, three category checkboxes,
  segment select, Apply.
- KPI grid and four KPI cards.
- Results table, results count, Export, two tooltips, and every table row (`table-row-REP-1000` …).
- `data-aui-route` on the app container and `data-aui-component="page-<page>"` for the current page.

Gaps and inconsistencies:

1. **No `data-aui-region`.** There is no stable way to refer to "the filters region," "the KPI
   region," or "the results region" as an intervention or analysis target.
2. **Space-containing ids.** `filter-Date Range`, `filter-Product Category`, and
   `filter-Advanced Options` are valid attribute values but brittle as identifiers; they are
   already embedded in task steps and tests.
3. **`data-aui-role` is not a region taxonomy.** `AuiComponentRole` has no `region` member. Region
   identity needs a separate attribute rather than overloading `role`.
4. **Tooltips are hover-only `<span title>` elements.** They are not keyboard focusable and have no
   click state. A click on the span can produce the `EXPAND_TOOLTIP` macro symbol, but nothing
   expands; the symbol is not a real expansion action.
5. **KPI cards have no help text.** `expand_tooltip` on a KPI target falls back to generic text
   unless a `title`/`data-tooltip` is added.
6. **Values and checked state are not in `BehaviourEvent`.** `componentId`, `action`,
   `ariaExpanded`, geometry, and route are present; the selected value is not. Completion
   verification should therefore read a narrow UI-state snapshot rather than adding raw values to
   telemetry.

### 2.8 Macro-symbol and outcome-label defects relevant to task design

These are not complaints about the algorithms' concept; they are reasons the semantic outcome layer
must use exact ids and committed events. **[S]**

| Issue                                                                                                                                | Evidence                                                                                                                                  | Consequence                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tooltip-region` is classified as `SELECT_REGION`                                                                                    | `deriveMacroSymbol()` checks `componentId.includes('region')` before the tooltip branch                                                   | Hovering the Region help icon is labelled a region selection; `inspect_help` must check role/id before substring rules                              |
| Hovering a filter control can emit a selection symbol                                                                                | Region/category/segment rules are not gated to change events; the annotation's `data-aui-action="change"` makes `mouseover` "change-like" | Macro stream and semantic outcomes must require a committed value change                                                                            |
| A click on a button-like target can be `FORM_SUBMIT`                                                                                 | `isFormSubmitTarget()` checks for `btn`/`button`/`input`/`form`/`primary-action` in component id/role                                     | `btn-export`, `btn-start-T1`, and other buttons are labelled `FORM_SUBMIT`; semantic `export_report` must override                                  |
| `blur` is a `BACKTRACK` outcome                                                                                                      | `derive.ts` maps `blur` to `BACKTRACK`                                                                                                    | Leaving any field can be labelled backtracking; semantic backtracking needs the route-return rule                                                   |
| `TABLE_ROW_SELECT` on hover                                                                                                          | `componentId.startsWith('table-row')` in the macro rule                                                                                   | Rows are not selectable; do not use this symbol as a semantic selection outcome                                                                     |
| `RESET_FILTERS`, `OPEN_REPORT`, `TABLE_PAGE_*`, `TABLE_SORT`, `BACKTRACK`, `IDLE_DWELL`, `RAPID_SCROLL`; `EXPAND_TOOLTIP` is special | No control/producer for the first group; `EXPAND_TOOLTIP` is macro-reachable by clicking a tooltip span, but no expansion state exists    | Adding Reset and Reports makes some reachable; do not claim the others until the UI supports them; do not treat a tooltip click as a real expansion |
| `change`/`input`/`submit` ignored by `OutcomeDeriver`                                                                                | Candidate loop only handles click, lifecycle, blur/popstate/hashchange, scroll/wheel, mouseover                                           | Filter selection and the form submit are invisible to the target head; the strongest argument for a semantic outcome layer                          |

The current macro vocabulary is used by the Fast Gate; changes to it belong to Step 4, not this
assessment. The semantic layer can be added without changing macro symbols.

### 2.9 What the UI does well

- Deterministic, stable mock data with a fixed seed.
- Collapsed accordions provide genuine progressive disclosure.
- Every important control has a stable component id; the Actuator can target it.
- The results count and empty state are explicit and observable.
- The form submit semantics are real (`<form>` + submit button), so a genuine `submit` event
  exists; the semantic `apply_filter` can use it even though `OutcomeDeriver` currently ignores it.
- Export is entirely client-side and produces a machine-readable JSON file.
- The table is internally scrollable, so visual scanning and scrolling are possible.
- The trial controls expose start/reset/condition, and task lifecycle events exist.
- The UI is lightweight and does not require a backend.

---

## 3. Task-Diversification Opportunities

### 3.1 Selection criteria

A candidate task was accepted only if it met all of the following:

1. **A meaningful goal** that a real analytics/operations user could have.
2. **A distinct path**: different start page, controls, order, or completion mode from the other
   tasks — not merely a renamed copy.
3. **Observable completion** from the UI state or a task lifecycle event.
4. **Participant-appropriate** length and cognitive load.
5. **No major reorganisation**; at most a limited addition where the research value is clear.
6. **At least one new interaction or behavioural opportunity** not covered by the existing set.

Tasks that only permute filter values, or that require pages with no content, were rejected.

### 3.2 Recommended set at a glance

| ID                   | Name                             | Start     | Main controls                                          | Ending        | Change   |
| -------------------- | -------------------------------- | --------- | ------------------------------------------------------ | ------------- | -------- |
| **TD1**              | Regional sales export            | Overview  | Nav, region accordion/select, Apply, Export            | Export        | None     |
| **TD2**              | Date and category filter         | Analytics | Date input, category checkboxes, two accordions, Apply | Apply + count | None     |
| **TD3**              | Empty-result recovery            | Analytics | Region, category, date, Apply, Reset                   | Reset + count | Minor    |
| **TD4**              | Report comparison and export     | Reports   | Report list/Open, nav, Export                          | Export        | Moderate |
| **TD5** _(optional)_ | Definition inspection and export | Analytics | KPI hover, tooltip hover, Export                       | Export        | Minor    |

The set is deliberately three core tasks (TD1–TD3), one recommended addition (TD4), and one
optional task (TD5). Together they exercise navigation, disclosure, three selection modalities,
application, reset, export, report selection, route backtracking, empty-state recovery, and
(optionally) hover inspection.

### 3.3 Task details

Component ids below are the **current** ids. Section 7 C4 renames the filter-section ids
(`filter-Date Range` → `filter-section-date-range`, etc.); the task definitions must use the
renamed ids after that change.

#### TD1 — Regional sales export

| Field                        | Detail                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task ID**                  | `TD1`                                                                                                                                                                                                                                           |
| **Task name**                | Regional sales export                                                                                                                                                                                                                           |
| **Participant instruction**  | "Open Analytics. Filter the report to the Europe region and apply the filter. Then export the filtered report."                                                                                                                                 |
| **Starting point**           | Overview (the default landing page)                                                                                                                                                                                                             |
| **Expected action sequence** | 1. Click `nav-Analytics`. 2. Click accordion `filter-Region`. 3. Change `filter-Region-select` to `Europe`. 4. Submit `btn-apply-filters`. 5. Click `btn-export`.                                                                               |
| **Completion condition**     | Page = Analytics; applied region = Europe; all visible rows are Europe; visible count = 18; export click recorded. The completion predicate must verify the filter value and count, not just the clicks.                                        |
| **Target UI elements**       | `nav-Analytics`, `filter-Region`, `filter-Region-select`, `btn-apply-filters`, `results-count`, `results-table`, `btn-export`                                                                                                                   |
| **Candidate outcomes**       | `navigate_analytics`, `open_filter_section`, `select_region`, `apply_filter`, `export_report`, `task_complete`                                                                                                                                  |
| **Behavioral opportunities** | Navigation choice, accordion disclosure, dropdown selection, apply/verify, export; hesitation between opening Region and choosing a value; a wrong region selection can be corrected, and completion remains incomplete until Europe is applied |
| **Existing UI support**      | Every control exists. Legacy T1 covers steps 1–4; legacy T2 covers export. This task composes them with a value check.                                                                                                                          |
| **Required UI changes**      | **None** to the UI. Requires task-start normalisation, action canonicalisation, and state-based completion.                                                                                                                                     |
| **Implementation notes**     | The export is a client-side download. Completion is the click plus the verified row state; do not require the browser to write a file. If the participant exports before applying, the task must remain incomplete (state predicate).           |

#### TD2 — Date and category filter

| Field                        | Detail                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task ID**                  | `TD2`                                                                                                                                                                                                                                                                                                   |
| **Task name**                | Date and category filter                                                                                                                                                                                                                                                                                |
| **Participant instruction**  | "Show only Books sold on or after 1 June 2025, apply the filters, and confirm the number of matching rows."                                                                                                                                                                                             |
| **Starting point**           | Analytics (task start navigates there and resets filters)                                                                                                                                                                                                                                               |
| **Expected action sequence** | 1. Click accordion `filter-Date Range`. 2. Change `filter-date-input` to `2025-06-01`. 3. Click accordion `filter-Product Category`. 4. Check `filter-category-books`. 5. Submit `btn-apply-filters`. 6. Read `results-count`.                                                                          |
| **Completion condition**     | Page = Analytics; applied `dateFrom = 2025-06-01`; `categories = ["Books"]`; visible count = 5. Apply is required even if the state already matches.                                                                                                                                                    |
| **Target UI elements**       | `filter-Date Range`, `filter-date-input`, `filter-Product Category`, `filter-category-books`, `btn-apply-filters`, `results-count`, `results-table`                                                                                                                                                     |
| **Candidate outcomes**       | `open_filter_section` (×2), `select_date_range`, `select_category`, `apply_filter`, `task_complete`                                                                                                                                                                                                     |
| **Behavioral opportunities** | Native date entry/calendar, checkbox selection, two-section disclosure, order choice, verification of a count; potential date-format hesitation and correction                                                                                                                                          |
| **Existing UI support**      | All controls exist. No legacy task requires a date or a category checkbox as a goal (T3 opens Product Category but then targets the segment).                                                                                                                                                           |
| **Required UI changes**      | **None** to the UI. Requires checkbox/date action canonicalisation and state-based completion.                                                                                                                                                                                                          |
| **Implementation notes**     | The date input is browser-native; its internal presentation differs across browsers. Record only the committed ISO value, not intermediate keystrokes. Unchecking is a selection action, not a reset. The task deliberately ends on Apply/verify rather than Export so it does not repeat TD1's ending. |

#### TD3 — Empty-result recovery

| Field                        | Detail                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task ID**                  | `TD3`                                                                                                                                                                                                                                                                                                           |
| **Task name**                | Empty-result recovery                                                                                                                                                                                                                                                                                           |
| **Participant instruction**  | "Set the filters to Books in Europe with a start date of 1 September 2025 and apply. When no rows match, clear the filters so the full report is shown again."                                                                                                                                                  |
| **Starting point**           | Analytics, with a clean filter state (task-start reset)                                                                                                                                                                                                                                                         |
| **Expected action sequence** | 1. Open Region → `Europe`. 2. Open Product Category → check `Books`. 3. Open Date Range → `2025-09-01`. 4. Apply. 5. Observe the empty state. 6. Click `btn-reset-filters`. 7. Confirm `Results (50)`.                                                                                                          |
| **Completion condition**     | An `apply_filter` was observed with filter state `{region: Europe, categories: [Books], dateFrom: 2025-09-01}` and 0 visible rows; the empty state was present; a subsequent clear-all action (Reset Filters or equivalent) produced 50 visible rows and no empty state.                                        |
| **Target UI elements**       | `filter-Region`, `filter-Region-select`, `filter-Product Category`, `filter-category-books`, `filter-Date Range`, `filter-date-input`, `btn-apply-filters`, `results-empty`, `btn-reset-filters`, `results-count`                                                                                               |
| **Candidate outcomes**       | `open_filter_section` (×3), `select_region`, `select_category`, `select_date_range`, `apply_filter`, `reset_filter`, `task_complete`; `backtrack` only if the participant navigates away and returns                                                                                                            |
| **Behavioral opportunities** | Over-filtering, empty-state recognition, uncertainty, correction, reset, recovery; a genuinely different failure mode from TD1/TD2                                                                                                                                                                              |
| **Existing UI support**      | The filters and the empty-state row exist. **No reset control exists.** The task model cannot currently detect "empty then non-empty."                                                                                                                                                                          |
| **Required UI changes**      | **Minor**: add `btn-reset-filters` (type `button`) that clears both draft and applied filters immediately; add a completion predicate/fact (`sawEmptyResult`) and state verification.                                                                                                                           |
| **Implementation notes**     | The reset must clear the applied filters and the drawer, not just the draft. Alternative ways to clear all filters are valid, but completion requires the full 50-row state; clearing only the date (6 rows) does not complete the task. If the UI keeps the form-submit model, Reset must not submit the form. |

#### TD4 — Report comparison and export

| Field                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task ID**                  | `TD4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Task name**                | Report comparison and export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Participant instruction**  | "Compare the Europe Electronics and Europe Books reports. Open the one with more matching rows and export it."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Starting point**           | Reports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Expected action sequence** | 1. Click `open-report-eu-electronics`. 2. Analytics opens with the report preset (Europe, Electronics) and shows 3 rows. 3. Click `nav-Reports` (or the report-list return control). 4. Click `open-report-eu-books`. 5. Analytics shows 6 rows. 6. Click `btn-export`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Completion condition**     | Both report ids were visited in this task; current report = `eu-books`; preset filters region = Europe, category = Books; visible count = 6; export click recorded. The task is incomplete if the participant exports `eu-electronics`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Target UI elements**       | `report-list`, `open-report-eu-electronics`, `open-report-eu-books`, `current-report`, `nav-Reports`, `results-count`, `btn-export`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Candidate outcomes**       | `select_report` (×2), `navigate_analytics` (only if the participant uses the sidebar rather than the report Open control), `navigate_reports`, `backtrack`, `export_report`, `task_complete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Behavioral opportunities** | Visual search in a report list, comparison of result counts, memory of the first report, returning to Reports, recovery from a wrong selection, export decision. This is the only recommended task that requires a genuine cross-page backtrack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Existing UI support**      | **None.** Reports is a placeholder. The filter drawer cannot accept preset filters from a report, and there is no current-report state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Required UI changes**      | **Moderate**: a deterministic report catalogue on Reports, `open-report-*` controls, a current-report label on Analytics, and preset-filter synchronisation between report selection, `App.appliedFilters`, and the drawer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Implementation notes**     | Do not use a date-based report name unless a date-to filter exists; the current filter has only `dateFrom`. Use region/category presets. The catalogue should include distractors with similar names (Europe Clothing, North America Clothing, Asia Pacific Electronics) so selection is a real search. Do not display matching row counts in the catalogue; the task depends on opening each report to compare them, and a visible count would let the participant skip the first report and the required return. Opening a report must not emit a user `apply_filter`; the preset is system context, not a participant action. Returning to Reports must be a deliberate nav click; browser Back is not supported by the state-only router. |

#### TD5 — Definition inspection and export (optional)

| Field                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task ID**                  | `TD5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Task name**                | Definition inspection and export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Participant instruction**  | "Check what the Region column means and review the Total Revenue figure, then export the report."                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Starting point**           | Analytics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Expected action sequence** | 1. Hover/enter `tooltip-region` for the dwell threshold. 2. Hover/enter `kpi-card-total-revenue` for the dwell threshold. 3. Click `btn-export`.                                                                                                                                                                                                                                                                                                                                                                            |
| **Completion condition**     | `inspect_help` on the Region tooltip and `inspect_kpi` on the Total Revenue card are recorded with dwell (order-independent); export click recorded; page = Analytics.                                                                                                                                                                                                                                                                                                                                                      |
| **Target UI elements**       | `kpi-card-total-revenue`, `tooltip-region`, `btn-export`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Candidate outcomes**       | `inspect_help`, `inspect_kpi`, `export_report`, `task_complete`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Behavioral opportunities** | Hover dwell, tooltip consultation, visual inspection, help-seeking; a modality no legacy task requires                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Existing UI support**      | KPI cards and tooltips exist, but the task bridge ignores `mouseover`/`focus`; tooltips are not keyboard focusable; KPI cards have no help text.                                                                                                                                                                                                                                                                                                                                                                            |
| **Required UI changes**      | **Minor**: map hover/focus to a task action with a dwell threshold; make tooltip triggers focusable; add `data-tooltip` or `title` to KPI cards if they are intervention targets.                                                                                                                                                                                                                                                                                                                                           |
| **Implementation notes**     | Hover is noisy: moving across children can generate several `mouseover` events. Use pointer containment plus a 300 ms threshold (or a documented two-event proxy), and do not complete on a transient crossing. If completion is state-based, the two dwells may be completed in either order; if strict step matching is retained, the listed order is canonical. If this instrumentation is not worth the effort, drop TD5; `inspect_kpi`/`inspect_help` remain in the vocabulary for future tasks but are not exercised. |

### 3.4 Coverage compared with the legacy set

| Dimension                       | Legacy T1       | Legacy T2       | Legacy T3       | TD1                  | TD2             | TD3                      | TD4                       | TD5          |
| ------------------------------- | --------------- | --------------- | --------------- | -------------------- | --------------- | ------------------------ | ------------------------- | ------------ |
| Distinct starting page          | Analytics (nav) | Analytics (nav) | Analytics (nav) | Overview → Analytics | Analytics       | Analytics                | Reports                   | Analytics    |
| Page transition                 | Yes             | Yes             | Yes             | Yes                  | No              | No                       | Yes (Reports ↔ Analytics) | No           |
| Accordion disclosure            | 1               | 0               | 1               | 1                    | 2               | 3                        | 0                         | 0            |
| Selection modality              | Select          | None            | Select          | Select               | Date + checkbox | Date + checkbox + select | Report button             | Hover        |
| Application                     | Apply           | None            | Apply           | Apply                | Apply           | Apply                    | None (presets)            | None         |
| Output                          | None            | Export          | None            | Export               | None            | None                     | Export                    | Export       |
| Reset                           | None            | None            | None            | None                 | None            | Reset                    | None                      | None         |
| Backtracking                    | No              | No              | No              | No                   | No              | Optional                 | **Required**              | No           |
| Empty-state recovery            | No              | No              | No              | No                   | No              | **Required**             | No                        | No           |
| Hover/help                      | No              | No              | No              | No                   | No              | No                       | No                        | **Required** |
| Value/state-verified completion | No              | No              | No              | **Yes**              | **Yes**         | **Yes**                  | **Yes**                   | Dwell-based  |
| UI change                       | None            | None            | None            | None                 | None            | Minor                    | Moderate                  | Minor        |

TD1 and TD2 both end with Apply or Export after filtering; this is inherent to filter tasks and is
mitigated by different controls, different starting states, and different endings. If export
repetition is judged excessive, TD5 is already optional; alternatively end TD1 at Apply + count and
keep TD4 as the core export task.

### 3.5 Repeated steps, shared sequences, and alternatives

| Overlap                     | Legacy set                              | Recommended set                                                                                                      | Mitigation                                                                               |
| --------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Same first step             | T1, T2, T3 all `nav-Analytics`          | Only TD1 navigates from Overview; TD2/TD3/TD5 start on Analytics via task-start normalisation; TD4 starts on Reports | Remove the mandatory nav step from tasks that start on Analytics; enforce `startingPage` |
| Same final control          | T1 and T3 both Apply                    | TD1 Export; TD2 Apply; TD3 Reset; TD4 Export; TD5 Export                                                             | Vary endings; TD3's ending is recovery, not application                                  |
| Same disclosure sequence    | T1/T3 open one accordion then a control | TD1 region; TD2 date + category; TD3 all three; TD4 none; TD5 none                                                   | Different sections and control types                                                     |
| Same select-control pattern | T1 region; T3 segment                   | TD1 region; TD2 date/checkbox; TD3 all; TD4 report button; TD5 hover                                                 | Distinct modalities                                                                      |
| No recovery                 | None                                    | TD3 empty → reset                                                                                                    | TD3 is the explicit recovery task                                                        |
| No backtracking             | None                                    | TD4 must return to Reports                                                                                           | TD4 is the explicit cross-page task                                                      |
| No help/inspection          | None                                    | TD5 (optional)                                                                                                       | Add only if hover coverage matters                                                       |

### 3.6 Rejected candidates

| Candidate                                                  | Why rejected                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tasks on Customers or Settings                             | Both pages are placeholders; a meaningful goal would require new content, which is disproportionate                                                                                  |
| Sorting, pagination, row-selection, or report-detail tasks | Not implemented; would require moderate-to-major table changes and new telemetry                                                                                                     |
| A standalone Customer Segment task                         | The segment filter is inert; the task would have no observable result                                                                                                                |
| A dashboard navigation tour (visit all five pages)         | No meaningful user goal; it would measure clicking, not work                                                                                                                         |
| KPI-only analysis ("read the revenue")                     | KPI values are static, with no drill-down or data relationship; completion would be a weak hover                                                                                     |
| More region/date/category permutations                     | Superficial variations of TD1/TD2; they do not add new behaviour                                                                                                                     |
| Search or filtering by text                                | No search control exists                                                                                                                                                             |
| Charts or trend analysis                                   | No charts exist                                                                                                                                                                      |
| Login, settings, or admin tasks                            | Out of scope for the testbed and the brief                                                                                                                                           |
| A "no-intervention" control task                           | Useful for the study, but it is a protocol/condition design decision, not a task-diversification candidate. It can be satisfied by a baseline-condition run of any recommended task. |

### 3.7 Why this set is better than the legacy set

- **More than one entry point.** Overview, Analytics, and Reports replace three tasks that all began
  on Analytics.
- **More than one ending.** Export, Apply + count, and Reset + count replace the
  Apply/Export repetition.
- **All four selection modalities.** Dropdown, date input, checkbox, and report-button selection.
- **Recovery and backtracking are required, not incidental.** TD3 requires empty-state recovery;
  TD4 requires a return to Reports and a comparison.
- **Values are verified.** Every core task has an objective result state, not only a control-touch
  sequence.
- **The dead control is removed from the critical path.** No recommended task depends on the inert
  segment filter.
- **The UI change is bounded.** Two of five tasks require no UI change; one requires a moderate
  catalogue; two require minor additions. The remaining requirements are harness, instrumentation,
  and annotation changes, not interface reorganisation.

---

## 4. Proposed Shared Outcome Vocabulary

### 4.1 Relationship to the existing vocabularies

The codebase currently has three related but distinct vocabularies:

1. **Macro symbols** — 26 semantic interaction tokens used by the Fast Gate
   ([`symbols.ts`](../../src/macro/symbols.ts) lines 9–47).
2. **Generic outcomes** — `NO_OUTCOME | CLICK | FORM_SUBMIT | BACKTRACK | RAPID_SCROLL |
HOVER_DWELL | ABANDON`, used by the Slow Gate and `OutcomeDeriver`
   ([`events.ts`](../../src/telemetry/events.ts) lines 139–146;
   [`derive.ts`](../../src/outcome/derive.ts) lines 28–62).
3. **Task lifecycle events** — `task_start`, `task_step`, `task_complete`, `task_error`,
   `task_reset`, `task_abandon`.

The proposed semantic layer sits above these. It is **additive**: the trace keeps the existing
generic `outcome` and the task events, and adds a semantic task outcome derived deterministically
from the canonical event/macro stream. This avoids invalidating the current model,
`model-preparation/src/config.yaml`, or existing analyses during trace collection.

**Migration path**

| Phase            | Action                                                                                  | Model impact                                   |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A — now          | Record `taskOutcome` alongside `outcome`; use it for analysis and policy targeting      | None; no retraining                            |
| B — after traces | Retrain the Slow Gate to predict the semantic outcome; keep generic as auxiliary/legacy | Requires config taxonomy change and retraining |
| C — later        | Both gates emit the semantic vocabulary; policy targets semantic outcomes               | Full taxonomy migration                        |

Do **not** replace the seven-class taxonomy in Step 2. Do **not** hand-edit
`src/config/pipelineConfig.json`; `model-preparation/src/config.yaml` is the source of truth for
the taxonomy, and `npm run sync-config` propagates it.

Adding `taskOutcome` is a trace-schema addition, not a silent extension of the current
`1.3.0` schema. Bump `EXPERIMENT_TRACE_SCHEMA_VERSION`, update the schema index in
`docs/data_schemas.md`, and keep the new field optional so older traces still validate.

### 4.2 Vocabulary

The table below is the minimum useful set for the recommended tasks and near-term policy
decisions. Fields follow the assessment brief; the Notes column adds implementation signals where
they affect label correctness.

| Outcome ID             | Meaning                                            | Trigger condition                                                                                                                      | Target UI element                     | Applicable tasks                                              | Label type                               | Notes                                                                                                                |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `navigate_overview`    | Deliberate navigation to Overview                  | `click` on `nav-Overview` when the current page is not Overview                                                                        | `nav-Overview`                        | No core task requires it; available for recovery/backtracking | Directly observed action                 | Do not emit for task-start routing; do not emit on a same-page click.                                                |
| `navigate_analytics`   | Deliberate navigation to Analytics via the sidebar | `click` on `nav-Analytics` when the current page is not Analytics                                                                      | `nav-Analytics`                       | TD1; TD4 fallback                                             | Directly observed action                 | Suppress when the page change comes from `open-report-*`; that is `select_report`.                                   |
| `navigate_reports`     | Deliberate navigation to Reports                   | `click` on `nav-Reports` when the current page is not Reports                                                                          | `nav-Reports`                         | TD4                                                           | Directly observed action                 | Used by the backtrack rule; not every click is a backtrack.                                                          |
| `select_report`        | Choose a report from the catalogue and open it     | `click` on `open-report-<id>`; exactly one per click                                                                                   | `open-report-<id>`                    | TD4                                                           | Directly observed action                 | Payload: `reportId`. Opening navigates to Analytics; suppress `navigate_analytics` for this click.                   |
| `open_filter_section`  | Expand a filter accordion                          | `click` on a filter accordion; post-action `aria-expanded === true`                                                                    | `filter-section-*`                    | TD1, TD2, TD3                                                 | Directly observed action                 | One per disclosure transition; not on programmatic expansion caused by an intervention.                              |
| `close_filter_section` | Collapse a filter accordion                        | `click` on a filter accordion; post-action `aria-expanded === false`                                                                   | `filter-section-*`                    | TD3 (optional)                                                | Directly observed action                 | A single collapse is **not** `backtrack`.                                                                            |
| `select_region`        | Choose a region filter value                       | Committed `change` on `filter-Region-select`; value differs from the previous value                                                    | `filter-Region-select`                | TD1, TD3                                                      | Directly observed action                 | Payload: region value. Ignore hover/click; require the committed value change.                                       |
| `select_date_range`    | Set or clear the start-date filter                 | Committed `change` on `filter-date-input`; one per distinct value                                                                      | `filter-date-input`                   | TD2, TD3                                                      | Directly observed action                 | Payload: ISO date or `null` for cleared. Ignore intermediate keystrokes; native date widgets vary.                   |
| `select_category`      | Check or uncheck a product category                | Committed `change` on `filter-category-*`; one per checkbox transition                                                                 | `filter-category-<name>`              | TD2, TD3                                                      | Directly observed action                 | Payload: category + checked. Unchecking is still a selection, not a reset.                                           |
| `apply_filter`         | Apply the current filter draft                     | Canonical form `submit` on `filter-drawer`, or the submit button click if no submit event is produced; exactly one per submission      | `btn-apply-filters` / `filter-drawer` | TD1, TD2, TD3                                                 | Directly observed action                 | Payload: filter fingerprint + visible row count + empty flag. Deduplicate the click/submit pair.                     |
| `reset_filter`         | Clear all filters to the default state             | `click` on `btn-reset-filters`; clears both draft and applied state immediately                                                        | `btn-reset-filters`                   | TD3                                                           | Directly observed action                 | Do not infer from manually clearing fields; that is a sequence of selection actions. Reset must not submit the form. |
| `export_report`        | Export the visible result set                      | `click` on `btn-export`; exactly one per click                                                                                         | `btn-export`                          | TD1, TD4, TD5                                                 | Directly observed action                 | Payload: visible row count + current report id. This is not `FORM_SUBMIT`; the download itself is not asserted.      |
| `inspect_kpi`          | Inspect a KPI card                                 | Pointer enters `kpi-card-*` and remains for the dwell threshold (≥300 ms or a documented two-event proxy)                              | `kpi-card-<name>`                     | TD5                                                           | Rule-derived sequence outcome            | Do not emit on transient pointer crossing; do not emit for an intervention's own highlight.                          |
| `inspect_help`         | Consult contextual help                            | Pointer enters/focuses a `tooltip-*` trigger and remains for the dwell threshold                                                       | `tooltip-region`, `tooltip-status`    | TD5                                                           | Rule-derived sequence outcome            | Must be checked before the `region` substring rule; system-triggered `expand_tooltip` is not a user outcome.         |
| `backtrack`            | Return to a page already visited in this task      | Deliberate page change to P where P appears earlier in the task's visited-page list, after at least one different page; one per return | Current page / nav control            | TD4                                                           | Rule-derived sequence outcome            | Not `blur`; not browser Back (no router); not closing an accordion; not filter reversion.                            |
| `task_complete`        | The task's completion predicate passed             | `task_complete` lifecycle event, emitted once when the predicate passes                                                                | Task/current page                     | All tasks                                                     | Task-lifecycle outcome                   | Means "required UI state achieved", not "last control clicked". Evaluation ground truth; not a prediction target.    |
| `task_abandon`         | The task ended without completion                  | `task_abandon` lifecycle event (reset, timeout, or explicit navigation abandonment)                                                    | Reset / task controls                 | All tasks                                                     | Task-lifecycle outcome                   | Currently only reset; timeout is configured but unused; in-app nav does not abandon. Do not predict from behaviour.  |
| `NO_OUTCOME`           | No semantic task action in the lookahead           | No qualifying action within the outcome horizon                                                                                        | —                                     | All tasks                                                     | Rule-derived sequence outcome (fallback) | Retain the existing class; do not force an outcome where there is none.                                              |

### 4.3 Derivation rules

**Precedence and de-duplication**

1. One committed participant action produces at most one **primary** semantic outcome. Rule-derived
   labels (`backtrack`, `task_complete`, `task_abandon`) may be recorded alongside the direct action
   label; they are not alternatives to it. For example, a return to Reports is
   `navigate_reports` (direct) plus `backtrack` (derived).
2. **Report open beats navigation.** A click on `open-report-*` is `select_report`, not
   `navigate_analytics`, even though it changes the page.
3. **Submit beats click for Apply.** The form `submit` is the canonical `apply_filter`; suppress the
   submit button's `click`. If no submit event is available in the environment, use the button
   click as the fallback.
4. **Exact ids beat substrings.** `componentRole === "tooltip"` is checked before any `region`,
   `category`, or `segment` substring rule. `tooltip-region` must not be `select_region`.
5. **Committed change beats pointer/hover.** Selection outcomes require `change` (or a committed
   input) with a changed value; a `mouseover` carrying `data-aui-action="change"` is not a
   selection.
6. **User action beats system adaptation.** Programmatic preset application, `simplify_options`
   collapsing an accordion, and `expand_tooltip` creating a bubble are intervention events, not
   user outcomes.

**Navigation**

- Emit only on a deliberate click on `nav-*` where the target page differs from the current page.
- No `navigate_*` for task-start routing, report presets, or same-page clicks.
- No `navigate_*` for `popstate`/`hashchange`; the app has no URL router.

**Selection**

- `select_region`: one per committed region value change. `All` is a valid value; choosing it is
  not `reset_filter`.
- `select_date_range`: one per committed date value. An empty value is a cleared date, still
  `select_date_range`, not `reset_filter`.
- `select_category`: one per checkbox transition, with `checked` in the payload. Checking two
  categories produces two outcomes.
- Do not emit selection from `mouseover`, `focus`, or a click that does not change the value.

**Disclosure**

- `open_filter_section` / `close_filter_section` come from the observed post-action
  `aria-expanded`, which the observer already captures.
- Programmatic expansion/collapse from an intervention is not a user outcome.

**Commitment and output**

- `apply_filter`: canonical form submit; payload includes the applied filter fingerprint, the
  visible row count, and whether the result is empty.
- `reset_filter`: only the reset control; it clears draft + applied state immediately.
- `export_report`: click, one per click; payload includes visible row count and current report id.
  Do not require a downloaded file to exist.

**Inspection**

- `inspect_kpi` / `inspect_help`: dwell threshold, not a single `mouseover`. A 300 ms continuous
  pointer presence is preferred. If a timer is impractical, use a documented two-`mouseover`
  proxy and treat it as a proxy, not a physical dwell measurement.
- `inspect_help` must be evaluated before any substring rule that could match a tooltip id.

**Backtracking**

Deterministic algorithm:

```text
visitedPages <- [startingPage]          # per task
on deliberate page change to P:         # nav click or report open
    if P != currentPage:
        if P in visitedPages and len(visitedPages) > 1:
            emit backtrack
        append P to visitedPages
```

Rules and exclusions:

- A return to a page visited earlier in the same task counts, even if the task's canonical path
  expects that return (TD4). The starting page is seeded into the visited list; a report open that
  changes page is a page visit even though its primary outcome is `select_report`.
- A same-page nav click does not count.
- Closing an accordion, changing a filter, blurring a control, or scrolling does not count.
- Browser Back does not count because the app does not change the URL; no `popstate`/`hashchange`
  is produced.
- Reset the visited-page list on task start and completion.
- This is a route-level rule. A stricter state-fingerprint rule (page + applied filters + open
  sections) can be added later, but it must not label filter edits as backtracking.

**Task lifecycle**

- `task_complete`: emitted only when the task's completion predicate passes. The predicate is
  evaluated against a UI-state snapshot (page, applied filters, visible count, empty flag, current
  report, visited reports). It is not emitted merely because the last step matched.
- `task_abandon`: emitted on explicit reset, timeout, or an explicit navigation abandonment. The
  current code only reaches reset; do not claim timeout behaviour until it is implemented.
- `task_complete` and `task_abandon` are evaluation labels. They must not be used as Slow Gate
  inputs or prediction targets; task id/progress as model context is a separate methodological
  question.

### 4.4 Ambiguities and resolutions

| Ambiguity                                             | Resolution                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select_report` vs `navigate_analytics`               | Report open wins; suppress the nav outcome. Sidebar navigation remains `navigate_analytics`.                                                                           |
| `apply_filter` vs `export_report`                     | Distinguish by component/role, not by a generic "button" rule. Export is not `FORM_SUBMIT`.                                                                            |
| `select_region` vs `inspect_help` on `tooltip-region` | Exact role/id precedence: tooltip role wins. Never use a bare `includes("region")` check for selection.                                                                |
| `open_filter_section` vs `backtrack`                  | Disclosure is not navigation. Only page returns are backtracking.                                                                                                      |
| `inspect_help` vs `expand_tooltip` intervention       | User hover/focus is `inspect_help`; system-created tooltip is an `InterventionEvent`, not an outcome.                                                                  |
| `reset_filter` vs clearing fields manually            | Only the reset control is `reset_filter`. Manual clearing is a sequence of `select_*` actions; optionally add `clear_filter` later if evidence requires it.            |
| `task_complete` vs the final action                   | Both are recorded, but they are different label types. Completion requires the state predicate.                                                                        |
| `NO_OUTCOME` vs `task_abandon`                        | Inactivity is not abandonment. Abandonment requires an explicit lifecycle event.                                                                                       |
| Multiple date `change` events                         | One outcome per committed distinct date; ignore duplicate events from the same interaction.                                                                            |
| Checkbox uncheck                                      | `select_category` with `checked=false`; not a reset.                                                                                                                   |
| Click on a report row vs its Open button              | Annotate the Open button as the action target and the row as a hover/scan surface. Emit one `select_report` from the button click; do not double-count row and button. |

### 4.5 Conditional and future outcomes

| Outcome                                   | Status           | Requirement                                                                                                                                                            |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select_segment`                          | **Conditional**  | Add a deterministic segment field and make `applyFilters()` honour `filters.segment`; otherwise the control remains inert and the outcome would encode a no-op.        |
| `scroll_results`                          | **Deferred**     | Scroll events carry no component/region attribution. Add `data-aui-region` and region attribution in the observer; otherwise `RAPID_SCROLL` is the only scroll signal. |
| `select_row`                              | **Rejected**     | Rows are hover-only; there is no selection state or detail view. Do not label row hover as selection.                                                                  |
| `navigate_customers`, `navigate_settings` | **Deferred**     | Pages are placeholders with no task-supporting content.                                                                                                                |
| `open_report`                             | **Merged**       | Use `select_report` for the single action that selects and opens a report.                                                                                             |
| `clear_filter`                            | **Not proposed** | Manual clearing is a sequence of selection actions; `reset_filter` covers the explicit control.                                                                        |

### 4.6 Implications for the two gates

**Fast Gate.** The semantic outcome can be mapped from the terminal macro symbol of a matched
pattern:

| Macro symbol                                        | Semantic outcome                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NAV_OVERVIEW` / `NAV_ANALYTICS` / `NAV_REPORTS`    | `navigate_*`                                                                                                                 |
| `OPEN_FILTERS` / `CLOSE_FILTERS`                    | `open_filter_section` / `close_filter_section`                                                                               |
| `SELECT_REGION` / `SELECT_DATE` / `SELECT_CATEGORY` | `select_region` / `select_date_range` / `select_category`                                                                    |
| `APPLY_FILTER` / `RESET_FILTERS`                    | `apply_filter` / `reset_filter`                                                                                              |
| `EXPORT_REPORT` / `OPEN_REPORT`                     | `export_report` / `select_report`                                                                                            |
| `HOVER_KPI` / `HOVER_HELP`                          | `inspect_kpi` / `inspect_help`                                                                                               |
| `TABLE_ROW_SELECT`                                  | No semantic outcome; rows are not selectable                                                                                 |
| `EXPAND_TOOLTIP`                                    | `inspect_help` only if tooltips become click/focus expandable; a click currently produces the macro but no visible expansion |
| `BACKTRACK` (macro)                                 | Use the route-return rule, not the unreachable macro symbol                                                                  |

The current declared Fast Gate patterns in [`boot.ts`](../../src/runtime/boot.ts) lines 38–45 do
not align with the proposed task paths. For example, no declared pattern covers
`NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER > EXPORT_REPORT` (TD1), and
`HOVER_KPI > HOVER_KPI` does not match TD5's KPI → help sequence. Aligning the pattern set is a
Step 4 activity; do not optimise PrefixSpan or change algorithm behaviour here.

**Slow Gate.** The current target is the seven-class generic taxonomy. Retraining it on the
semantic vocabulary is the Step 3 activity. Until then, record the semantic outcome additively and
use it for analysis; do not change the ONNX model or the config taxonomy in Step 2.

**Leakage warning.** `taskId`, `taskStepId`, and `taskProgress` are available in UI context. A model
that predicts `task_complete` from task progress is learning the experimenter's script, not user
behaviour. Keep lifecycle labels out of the prediction target and evaluate completion separately.

### 4.7 Smallest useful subset

If the team wants the smallest possible vocabulary for the first implementation, the following
twelve action outcomes cover TD1–TD4 without hover:

`navigate_analytics`, `navigate_reports`, `select_report`, `open_filter_section`,
`select_region`, `select_date_range`, `select_category`, `apply_filter`, `reset_filter`,
`export_report`, `backtrack`, `task_complete`.

Keep `NO_OUTCOME` as the inactivity fallback even in this subset; a classifier without it would
have to force an action label onto a quiet window. Add `close_filter_section`, `inspect_kpi`,
`inspect_help`, `task_abandon`, and `navigate_overview` when TD5 or recovery analysis requires
them. This keeps the first trace schema small while preserving the full proposed vocabulary as the
target.

---

## 5. DOM Annotation and Intervention Targets

### 5.1 Existing contract

The stable identifier today is `data-aui-component`. It is used by:

- `TaskManager` step matching (`expectedComponentId`);
- the observer (`componentId` on every event);
- `getActiveUIContext()` (`activeComponentId`);
- the actuator's target selector (`[data-aui-component="<id>"]`);
- tests and task definitions.

Adding a parallel `data-aui-id` would create two sources of truth. **Recommendation:** keep
`data-aui-component` as the canonical id and document it as such. If the supervisor requires the
`data-aui-id` naming from the brief, add it as an alias on the same elements and migrate consumers
in one change; do not let the two drift.

`data-aui-role` and `data-aui-action` already provide semantic role/action. `data-aui-task-role`
exists on Apply, Region, Segment, and Export, but it is static and therefore ambiguous across
tasks; derive task-specific relevance from the task model rather than adding more static
`required` flags.

### 5.2 Minimum annotation additions

#### Regions

Add `data-aui-region` to the major regions. This is the missing attribute that makes
region-level analysis and intervention possible.

| Region                 | Element                                         | Suggested value |
| ---------------------- | ----------------------------------------------- | --------------- |
| Sidebar                | `<nav class="dashboard-nav">`                   | `navigation`    |
| Trial panel            | `<section data-aui-component="trial-controls">` | `trial`         |
| Page header/body       | `.page-header` / `.page-body`                   | `page`          |
| Filter drawer          | `<form data-aui-component="filter-drawer">`     | `filters`       |
| KPI cards              | `<div data-aui-component="kpi-cards">`          | `kpis`          |
| Results table          | `<div data-aui-component="results-table">`      | `results`       |
| Debug panel            | Debug root                                      | `debug`         |
| Report list (proposed) | Reports list container                          | `reports`       |

Region annotations are not required for TD1–TD4 completion, but they are required for future
region-level interventions and for any scroll/scanning analysis.

#### Filter-section ids

Normalise the space-containing ids before adding tasks:

| Current id                | Proposed id                       |
| ------------------------- | --------------------------------- |
| `filter-Date Range`       | `filter-section-date-range`       |
| `filter-Region`           | `filter-section-region`           |
| `filter-Product Category` | `filter-section-product-category` |
| `filter-Advanced Options` | `filter-section-advanced-options` |

Update `taskModel.ts`, `tests/task_wiring.test.tsx`, `tests/semantic_dom_annotations.test.tsx`,
and any macro mapping that uses these strings. This is a low-scope change now and a high-cost change
after traces are collected.

#### Tooltips and KPI help

- Make `tooltip-region` and `tooltip-status` focusable (`tabIndex={0}`) and/or buttons, so keyboard
  users can consult them and `inspect_help` is not pointer-only.
- Add `data-tooltip` or `title` to KPI cards if `expand_tooltip` should be able to target them;
  otherwise the actuator falls back to generic text.
- Do not add a click handler solely to make `EXPAND_TOOLTIP` reachable unless the intervention
  design requires it; a clickable "help" affordance is a UI change with accessibility implications.

#### Reports catalogue (proposed)

| Element                                                             | Annotation                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Report list container                                               | `data-aui-component="report-list"`, `data-aui-region="reports"`                                        |
| Report row                                                          | `data-aui-component="report-row-<id>"`, `data-aui-role="report-row"`, `data-aui-action="hover"`        |
| Open control                                                        | `data-aui-component="open-report-<id>"`, `data-aui-role="secondary-action"`, `data-aui-action="click"` |
| Report name                                                         | `data-aui-component="report-name-<id>"`                                                                |
| Report metadata (region/category/period; **no matching row count**) | `data-aui-component="report-meta-<id>"`                                                                |
| Current report label                                                | `data-aui-component="current-report"`, `data-aui-role="status"`                                        |

Use `open-report-<id>` rather than `report-open-<id>` so the existing macro rule
(`componentId.includes("open-report")`) produces `OPEN_REPORT` without a macro change. If the ids
are changed to `report-open-*`, update the macro rule in the same change.

A new `report-row` role must be added to `AuiComponentRole` if it is used; alternatively use
`data-aui-role="table-row"` and accept the misleading `TABLE_ROW_SELECT` macro symbol. The explicit
role is cleaner.

Proposed deterministic catalogue (counts are for implementation/verification; do **not** render
them in the list, because TD4 requires opening each report to compare):

| Report id          | Display name             | Preset region | Preset category | Matching rows |
| ------------------ | ------------------------ | ------------- | --------------- | ------------- |
| `eu-electronics`   | Europe Electronics       | Europe        | Electronics     | 3             |
| `eu-books`         | Europe Books             | Europe        | Books           | 6             |
| `eu-clothing`      | Europe Clothing          | Europe        | Clothing        | 9             |
| `na-clothing`      | North America Clothing   | North America | Clothing        | 7             |
| `apac-electronics` | Asia Pacific Electronics | Asia Pacific  | Electronics     | 8             |

Presets set `dateFrom = ""`, `segment = "All"`, the listed region, and a single category. Selecting
a report must populate `App.appliedFilters` and the drawer's visible values together; otherwise the
participant sees a filtered table with an apparently empty filter drawer — the inconsistency
already present when navigating away from Analytics.

### 5.3 Intervention target matrix

The actuator targets a component id with `[data-aui-component="<id>"]` for
`highlight_primary_action` and `expand_tooltip`; `simplify_options` operates on the filter drawer
and accordions; `offer_assistance` appends a global, dismissible banner rather than anchoring to the
target. The target column below names the element the outcome refers to, not necessarily where an
assistance banner is placed. The table maps outcomes to plausible targets; it does not design the
policy.

| Outcome                | Primary target                   | Suitable adaptations                                                                                                                       | Notes                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate_analytics`   | `nav-Analytics`                  | `offer_assistance`; `highlight_primary_action` only if a primary action exists on the page                                                 | `highlight_primary_action` eligibility checks `primaryActionAvailable`; Overview has no primary action                                                                                                                                      |
| `navigate_reports`     | `nav-Reports`                    | `offer_assistance`                                                                                                                         | Same eligibility caveat                                                                                                                                                                                                                     |
| `select_report`        | `open-report-<id>` or report row | `offer_assistance`, `expand_tooltip` with report description; `highlight_primary_action` only if the Reports page exposes a primary action | A Reports page with only `secondary-action` Open buttons makes `highlight_primary_action` ineligible; do not assume it will fire. Validate the report id before actuation; a missing target falls back to the first tooltip/primary action. |
| `open_filter_section`  | `filter-section-*`               | `highlight_primary_action` (target the accordion), `offer_assistance`                                                                      | `simplify_options` would collapse, not open; do not use it here unless the intent is to reduce options                                                                                                                                      |
| `close_filter_section` | `filter-section-*`               | `no_op` or `offer_assistance`                                                                                                              | Usually no intervention                                                                                                                                                                                                                     |
| `select_region`        | `filter-Region-select`           | `expand_tooltip` (if a title/data-tooltip exists), `highlight_primary_action` (target the select)                                          | `simplify_options` may hide the control; avoid unless the policy intends that                                                                                                                                                               |
| `select_date_range`    | `filter-date-input`              | `expand_tooltip`, `offer_assistance`                                                                                                       | Date format guidance is a natural tooltip target, but the input has no title/data-tooltip; add one before relying on `expand_tooltip`                                                                                                       |
| `select_category`      | `filter-category-*`              | `highlight_primary_action`, `simplify_options`                                                                                             | `simplify_options` can reduce the option set; ensure it does not make the task impossible                                                                                                                                                   |
| `apply_filter`         | `btn-apply-filters`              | `highlight_primary_action`                                                                                                                 | The natural "primary action" even though the button's role is `submit-action`                                                                                                                                                               |
| `reset_filter`         | `btn-reset-filters`              | `highlight_primary_action`, `offer_assistance`                                                                                             | Only after the control is added                                                                                                                                                                                                             |
| `export_report`        | `btn-export`                     | `highlight_primary_action`                                                                                                                 | The export button is the only `primary-action` in Analytics                                                                                                                                                                                 |
| `inspect_kpi`          | `kpi-card-*`                     | `expand_tooltip` (add data-tooltip/title), `offer_assistance`                                                                              | KPI cards are not focusable; tooltip insertion should not displace layout                                                                                                                                                                   |
| `inspect_help`         | `tooltip-*`                      | `expand_tooltip`                                                                                                                           | The tooltip already has a title; the actuator can expand it                                                                                                                                                                                 |
| `backtrack`            | `nav-*` / current page           | `offer_assistance`, `highlight_primary_action`                                                                                             | Assistance is more appropriate than highlighting a return control                                                                                                                                                                           |
| `task_complete`        | —                                | `no_op`                                                                                                                                    | Do not interrupt a completed task                                                                                                                                                                                                           |
| `task_abandon`         | —                                | `no_op` or `offer_assistance`                                                                                                              | Do not nag; an assistance offer may be appropriate only if the participant requests it                                                                                                                                                      |

**Target-resolution risks**

- `highlight_primary_action` with a missing target falls back to the first
  `[data-aui-role="primary-action"]`; on Analytics that is Export, which may be wrong for a filter
  outcome.
- `expand_tooltip` with a missing target falls back to the first `[data-aui-role="tooltip"]`.
  A policy that predicts `inspect_help` for the Status tooltip could expand the Region tooltip.
- The policy does not validate that `targetComponentId` exists before accepting a command.
  Add a target-existence check before expanding the outcome-to-intervention vocabulary.
- System adaptations must remain non-destructive and reversible; the existing actuator and TTL
  machinery already aim for this. Do not create a new intervention target by wrapping a control in
  a new element without re-testing focus and the accessibility tree.

---

## 6. Data-Collection Considerations

### 6.1 Will the tasks exercise sufficiently different paths?

Yes, if TD1–TD4 are implemented as specified.

| Path dimension   | Coverage                                                              |
| ---------------- | --------------------------------------------------------------------- |
| Start page       | Overview (TD1), Analytics (TD2/TD3), Reports (TD4)                    |
| Page transition  | TD1 and TD4; TD2/TD3 stay on Analytics                                |
| Filter sections  | Region (TD1), Date + Category (TD2), all three (TD3)                  |
| Control modality | Dropdown, date input, checkboxes, report button, Apply, Reset, Export |
| Ending           | Export (TD1, TD4), Apply + count (TD2), Reset + count (TD3)           |
| Recovery         | Empty → reset (TD3)                                                   |
| Backtracking     | Reports → Analytics → Reports (TD4)                                   |
| Help/inspection  | Optional TD5                                                          |

The remaining overlap is Apply/Export as terminal actions. This is inherent to a filter-and-export
instrument. It is acceptable if the _goal_, _controls_, and _state_ differ; it is not acceptable if
two tasks differ only in the selected value.

### 6.2 Can outcomes be observed and labelled consistently?

**Not with the current outcome deriver.** The generic taxonomy ignores `change`/`input`/`submit`,
labels button clicks as `FORM_SUBMIT`, and treats `blur` as `BACKTRACK`. The semantic layer fixes this if
it is implemented with exact ids, committed events, and de-duplication. Until then, the trace will
under-represent filter selections and over-represent `FORM_SUBMIT`, which biases any target-head
comparison.

Recommended labelling invariants:

1. One committed action → one task interaction → one primary semantic outcome; rule-derived and
   lifecycle labels may be recorded alongside it.
2. Selection outcomes require a changed value, not a hover.
3. `apply_filter` is one event per submission, not one per click+submit.
4. `export_report` is not `FORM_SUBMIT`.
5. `inspect_*` requires dwell.
6. `backtrack` is a route return, not a blur or a disclosure.
7. `task_complete` requires the completion predicate, not the last step.

### 6.3 Is task completion objectively detectable?

With the proposed completion predicates, yes:

| Task | Objective evidence                                                                            |
| ---- | --------------------------------------------------------------------------------------------- |
| TD1  | Page, applied region, all visible rows Europe, count 18, export click                         |
| TD2  | Applied dateFrom, categories, count 5                                                         |
| TD3  | Empty state after the over-filter, then reset and count 50                                    |
| TD4  | Both report ids visited, current report = Europe Books, preset filters, count 6, export click |
| TD5  | Dwell events on the two targets, export click                                                 |

Without predicates, completion is only "the participant touched the expected controls in order."
That is insufficient for a task-diversity study because a participant can select the wrong region
or export the wrong report and still be marked complete. This is the single most important
methodology change in this report.

### 6.4 Are there opportunities to observe meaningful behaviour?

Yes:

- **Hesitation:** TD1's region choice, TD2's date entry, TD4's report comparison.
- **Backtracking:** TD4's required return to Reports.
- **Recovery:** TD3's empty-state correction.
- **Exploration:** TD4's catalogue scanning; TD2's accordion ordering; TD5's hover (optional).
- **Scrolling:** the results table is internally scrollable (420 px visible vs 2113 px content);
  verifying TD1/TD2 row sets may require scanning. TD4's comparison is primarily a report-list
  scan. Note that scroll is not yet region-attributed.
- **Help-seeking:** TD5, and optionally a help step in TD1.
- **Error/recovery:** wrong report, wrong date, over-filtering.

The legacy set produces almost none of these as _required_ behaviour; they were incidental.

### 6.5 Are important outcomes likely to be too rare?

Potentially. `reset_filter` appears once in TD3; `select_report` appears twice in TD4; `backtrack`
appears once in TD4; `inspect_*` only in optional TD5. That is acceptable for a first diversified
set, but if the Slow Gate needs balanced classes, later task design may need to repeat these
actions or add tasks. Do not infer a dataset size from this; the immediate question is whether each
outcome is producible and distinguishable, and it is.

`task_complete` appears once per trial. `export_report` appears in TD1/TD4/TD5, but only once per
trial. If export is a key policy target, that is enough to observe, not enough to balance a large
training set; that is a Step 3 concern.

### 6.6 UI state and element identity

The following must be annotated or captured before traces are useful:

- Applied filter state (region, date, categories) at apply time.
- Visible row count and empty flag.
- Current report id and visited report ids.
- The page/route (already `data-aui-route`).
- The task id and step id (already in context/events).
- The component id of every target (already `data-aui-component`).
- Region identity for future region-level analysis (`data-aui-region`, proposed).
- Dwell/inspection state (not currently in `BehaviourEvent`; derive or add semantic event).

A narrow **UI-state snapshot** is preferable to adding raw field values to `BehaviourEvent`:

```ts
interface TaskUiState {
  page: Page;
  appliedFilters: FilterState;
  visibleRowCount: number;
  empty: boolean;
  currentReportId: string | null;
  visitedReportIds: string[];
}
```

This keeps telemetry free of arbitrary typed text and gives completion predicates exactly the
state they need. All filter values are enumerated or dates, so the snapshot itself is non-PII.

### 6.7 Shared UI state and preconditions

This is the largest contamination risk.

- The drawer's draft state resets on navigation; the applied state does not.
- Reset Trial does not clear filters.
- Starting a task does not clear filters, page, or current report.
- Starting another task mid-trial discards the previous trial without `task_abandon`.
- Reloading resets the page to Overview and the filters to empty, but the session/recorder may
  persist.

Without task-start normalisation, a participant's TD2 trace may begin with TD1's filters still
applied, producing a different initial state and a different set of outcomes. Implement the reset
before collecting any participant traces.

### 6.8 Event-integrity risks

| Risk                                  | Effect                                                | Mitigation                                                              |
| ------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Click + submit for Apply              | Duplicate task interactions/outcomes; spurious errors | Canonicalise; one `apply_filter` per submission                         |
| Click + input + change for checkboxes | Duplicate selection/errors                            | Canonicalise on committed change                                        |
| Multiple date events                  | Duplicate `select_date_range`                         | Debounce/one per committed value                                        |
| Hover on a filter control             | False selection macro symbol                          | Require committed change; exact role precedence                         |
| `tooltip-region` substring            | False `SELECT_REGION`                                 | Exact id/role precedence                                                |
| `blur` as `BACKTRACK`                 | False backtracking                                    | Use the route-return rule                                               |
| Button clicks as `FORM_SUBMIT`        | Wrong target labels                                   | Fix `isFormSubmitTarget` or override semantically                       |
| System preset as user `apply_filter`  | Contaminated action labels                            | Mark programmatic changes; do not emit user outcomes                    |
| Export click assumed download         | False completion if download blocked                  | Complete on verified state + click; treat the file as optional evidence |

### 6.9 Provenance and task-definition versioning

- New tasks must not be pooled with legacy T1–T3 traces. Use new ids (`TD1`–`TD5`) or record a
  `taskDefinitionVersion` on `task_start` and every task event.
- Keep the existing `provenance` distinction. Scripted dry runs must remain `scripted`; participant
  traces must remain `participant`. Do not describe scripted traces as participant evidence.
- Record the task definition version in the trace or session metadata so a later reader can tell
  which task set produced the trace.
- The study protocol (counterbalancing, order effects, Latin square) is out of scope (ADR-014 D7);
  this assessment only recommends that the _task definitions_ be versioned and reproducible.

### 6.10 Suitability for target-head training

The recommended set gives the Slow Gate more distinguishable sequences and outcomes than the
legacy set, but it does not by itself guarantee a good training set. The immediate conditions are:

- The semantic outcome is recorded consistently.
- Completion is state-verified, so labels are not produced by wrong actions.
- Task starts are normalised, so initial states are comparable.
- The same UI state is not reused across tasks without a reset.
- Lifecycle labels are kept out of the prediction target.

The current generic taxonomy remains the model target until Step 3. Do not claim that the semantic
vocabulary improves accuracy; that is a later measurement.

---

## 7. Recommended Changes and Implementation Priorities

### 7.1 Change list

Priority: **P0** = required before any task implementation; **P1** = required before the relevant
task; **P2** = optional/nice-to-have; **Reject** = disproportionate at this stage.

Classification against the brief's UI-change categories: C1–C5, C8–C10, and C13–C16 are **minor
adjustments**; C6, C7, and C17 are **moderate adjustments** (C17 is deferred); C18–C20 are **major
reorganizations or out of scope** and are rejected. C11 and C12 are instrumentation changes rather
than UI changes and carry medium implementation scope. No accepted proposal requires major UI
reorganization.

| ID      | Change                                                                                           | Priority | Rationale                                                                                | Scope      | Dependencies                                               | Required before task implementation?                         |
| ------- | ------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| **C1**  | Canonicalise/de-duplicate observed actions (Apply, checkbox, date, report)                       | P0       | One participant action currently produces multiple task interactions and spurious errors | Low        | Observer/adapter/task manager                              | Yes                                                          |
| **C2**  | Task-start normalisation (`startingPage`, reset filters, collapse sections, clear report/errors) | P0       | Reproducible starting state; prevents cross-task contamination                           | Low        | `TrialControls`, `App`, `FilterDrawer`, `taskModel`        | Yes                                                          |
| **C3**  | UI-state snapshot + completion predicates (page, filters, count, empty, report, visited reports) | P0       | Objective, value-verified completion; required for TD1–TD4                               | Medium     | `App`, `TaskManager`, `taskModel`                          | Yes                                                          |
| **C4**  | Normalise filter-section ids                                                                     | P0       | Stable contract; avoids brittle space ids                                                | Low        | `FilterDrawer`, `App`, tests, macro mapping                | Yes                                                          |
| **C5**  | Add Reset Filters (`btn-reset-filters`)                                                          | P1       | Enables TD3 recovery and clean preconditions                                             | Low        | `FilterDrawer`, `App`, macro rule                          | TD3                                                          |
| **C6**  | Fix or remove Customer Segment                                                                   | P2       | Inert control invalidates any segment task and misleads participants                     | Low–medium | `tableData`, `ResultsTable`, `FilterDrawer`, tests         | Recommended before participant use; not required for TD1–TD5 |
| **C7**  | Reports catalogue + current report + preset sync                                                 | P1       | Enables TD4, a Reports start, `select_report`, required backtracking                     | Medium     | `App`, `Navigation`, new component/data, filter state      | TD4 (optional overall)                                       |
| **C8**  | Add `data-aui-region` to the regions in Section 5.2                                              | P1       | Region-level analysis/interventions; future scroll attribution                           | Low        | Components                                                 | Recommended, not strictly required for TD1–TD4               |
| **C9**  | Focusable tooltips + KPI `data-tooltip`/`title`                                                  | P2       | Enables TD5 and `expand_tooltip` targets; keyboard access                                | Low        | `ResultsTable`, `KPICards`                                 | TD5                                                          |
| **C10** | Hover/focus task action mapping with dwell                                                       | P2       | Enables TD5 inspection steps                                                             | Low        | Observer/integration/task manager                          | TD5                                                          |
| **C11** | Additive semantic `taskOutcome` derivation                                                       | P1       | Shared vocabulary; consistent labels; both gates                                         | Medium     | `outcome/derive`, `events`, analysis                       | No — before trace collection                                 |
| **C12** | Fix generic outcome deriver (`change`/`input`/`submit`, `FORM_SUBMIT` heuristic, `BACKTRACK`)    | P1       | Current labels are wrong for selection/export/backtrack; biases training                 | Medium     | `outcome/derive`                                           | No — before trace collection                                 |
| **C13** | Task ids/config updates (`TD1`–`TD5`, `TASK_STEP_COUNTS`, `trialOrder`, `taskTimeoutsMs`, docs)  | P0       | Prevents stale keys and trace conflation                                                 | Low        | `taskModel`, `contextVector`, `runtimeConfig`, tests, docs | Yes                                                          |
| **C14** | Abandon active task before starting another; guard condition switch during a task                | P1       | Prevents silent loss/contamination of trials                                             | Low        | `TrialControls`, `TaskManager`                             | Recommended                                                  |
| **C15** | Timeout-driven abandonment using `taskTimeoutsMs`                                                | P2       | Prevents indefinite `In Progress` trials                                                 | Low–medium | `TaskManager`, `runtimeConfig`                             | Protocol decision                                            |
| **C16** | Export confirmation / current report in filename                                                 | P2       | Stronger completion evidence; no functional change                                       | Low        | `ResultsTable`                                             | Optional                                                     |
| **C17** | Date-to filter                                                                                   | P2       | Only if period-based report presets are required                                         | Medium     | `FilterDrawer`, `ResultsTable`                             | Defer; not needed for this set                               |
| **C18** | Pagination, sorting, row selection                                                               | Reject   | Not needed for the proposed tasks; major table change                                    | High       | `ResultsTable`                                             | No                                                           |
| **C19** | Customers/Settings content                                                                       | Reject   | Disproportionate; no research value for this stage                                       | High       | New pages                                                  | No                                                           |
| **C20** | General visual polish / UX enhancement                                                           | Reject   | The brief forbids unrelated polish                                                       | —          | —                                                          | No                                                           |

### 7.2 Recommended implementation order

1. **C4 — id contract.** Rename sections and update tests. Do this first so later task definitions
   target stable ids; add `data-aui-region` (C8) before region-level analysis or interventions.
2. **C1 — action canonicalisation.** Add tests for one-action-one-interaction on Apply, checkbox,
   date, report, and export.
3. **C2 + C3 — task harness.** Add `startingPage`, reset on start, UI-state snapshot, completion
   predicates.
4. **C5 + C6 — reset and segment.** Add Reset Filters; make segment functional or remove it.
5. **C7 — Reports catalogue** (if approved). Add the list, `open-report-*` ids, current-report
   label, and preset synchronisation.
6. **C13 — task definitions and config.** Add TD1–TD5, update `TASK_STEP_COUNTS`,
   `trialOrder`, `taskTimeoutsMs`, and tests.
7. **C11 + C12 — semantic outcomes.** Add the additive layer and correct the generic defects.
8. **C8 + C9 + C10 — annotations and optional TD5.**
9. **C14 + C15 — trial integrity guards** (recommended).
10. **Scripted dry run.** Execute each task under both conditions, verify canonical completion,
    zero canonical-path errors, expected outcomes, no duplicate events. Then collect participant
    traces.

### 7.3 What not to do

- Do not reorganise the Analytics layout or add charts.
- Do not add pagination/sorting/row selection merely to create task variety.
- Do not fill Customers/Settings with unrelated content.
- Do not replace the seven-class outcome taxonomy or retrain the Slow Gate in Step 2.
- Do not change PrefixSpan or the Fast Gate implementation in Step 2; pattern alignment is Step 4.
- Do not treat scripted traces as participant evidence.
- Do not claim completion from a control click alone once state predicates exist.

---

## 8. Limitations and Open Questions

### 8.1 Limitations of this assessment

1. **Deployed build parity.** The deployed bundle hash differs from the local `dist` bundle.
   Core pages, controls, filter behavior, empty state, task errors, and export were exercised in
   the deployed app; exact build parity with the working tree was not proven. Source citations
   describe the working tree.
2. **One browser.** Inspection used Chromium on macOS. Firefox and Safari are not validated; native
   date input behaviour and tooltip rendering may differ. No cross-browser claim is made.
3. **No participant data.** No participant traces were collected. All counts are from the
   deterministic stimulus dataset, not from participants.
4. **No performance measurement.** No latency, memory, TBT, or model-accuracy measurement was
   performed for this assessment, and none is claimed.
5. **Export evidence.** The deployed export produced a JSON file with `rowCount: 50`; the
   assessment did not test filtered export files in every browser or download-blocked scenarios.
   Task completion should not depend on the file being written.
6. **Reports catalogue counts.** TD4's 3-row and 6-row presets are proposed over the current
   deterministic data. The catalogue does not exist yet; the counts are derived, not observed in
   the UI.
7. **Hover dwell.** The 300 ms threshold is a proposal, not a measured perceptual threshold. The
   existing `HOVER_DWELL` uses a two-event proxy; that is not a physical dwell measurement
   (ADR-014 D5).
8. **Segment decision.** Until the segment filter is fixed or removed, any segment-related task
   claim is invalid. The report does not assume a fix.
9. **Report-selection task.** TD4 depends on a moderate UI addition that may be rejected. If it is
   rejected, the recommended set loses its report-selection start, `select_report`, and required
   backtracking. TD1 still provides an Overview → Analytics start.

### 8.2 Open questions

| #   | Question                                                    | Why it needs a human decision                                                                                          | Recommended default                                                                                                              |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Approve the Reports catalogue?                              | It is the only moderate UI change; it determines whether `select_report` and a second non-Analytics start are in scope | Approve for starting-point diversity; a compact Analytics-only selector is a lower-scope fallback but does not add a second page |
| 2   | Fix or remove Customer Segment?                             | It is a UI/data change with a validity consequence                                                                     | Fix it if segment-based tasks are wanted; otherwise remove the control                                                           |
| 3   | Use new task ids or reuse T1–T5?                            | Old and new traces must not be conflated                                                                               | New ids `TD1`–`TD5`; add a definition version if numeric continuity is required                                                  |
| 4   | Is task success state-based?                                | This changes the meaning of completion/error metrics                                                                   | State-based, with step matching as diagnostics                                                                                   |
| 5   | Is a timeout required?                                      | It changes abandonment semantics and trial length                                                                      | Add a timeout in the study protocol; the config already exists                                                                   |
| 6   | Is TD5 in scope?                                            | Hover coverage vs instrumentation effort                                                                               | Optional; implement after TD1–TD4                                                                                                |
| 7   | When does the Slow Gate taxonomy change?                    | Retraining invalidates the current model; trace collection needs a stable target                                       | Additive semantic recording now; retrain in Step 3                                                                               |
| 8   | Should the Fast Gate patterns be updated now?               | Pattern alignment affects gate hits but is Step 4 work                                                                 | Do it in Step 4; do not tune PrefixSpan here                                                                                     |
| 9   | Should the scenario include a no-intervention control task? | It is a protocol/condition design, not a task-diversity requirement                                                    | Use a baseline-condition run of any task; decide in the study protocol                                                           |
| 10  | Do we need scroll/scanning outcomes?                        | The table is scrollable but scroll has no region attribution                                                           | Defer until a scanning task is designed; add region attribution then                                                             |

### 8.3 Assumptions

- The deterministic dataset remains the 50-row set with seed `20250921` for the next phase. If it
  changes, all expected counts in this report must be recomputed.
- The existing `provenance` and collection rules remain in force; this report does not propose a new
  egress path.
- The Actuator's non-destructive, TTL-bounded behavior remains unchanged; this report only
  identifies targets.
- The seven-class generic outcome taxonomy remains the model target until Step 3.
- The Reports page can be implemented with existing styles and no backend; this is assumed, not
  built.

---

## Appendix A — Deterministic filter counts

Generated from [`tableData.ts`](../../src/testbed/mock-data/tableData.ts) with `seed = 20250921`,
50 rows. These are the counts used in the task completion conditions.

| Filter state                                               | Visible rows |
| ---------------------------------------------------------- | ------------ |
| No filters                                                 | 50           |
| Region = Europe                                            | 18           |
| Region = Europe + Category = Books                         | 6            |
| Category = Books + dateFrom = 2025-06-01                   | 5            |
| Region = Europe + Category = Books + dateFrom = 2025-06-01 | 3            |
| Region = Europe + Category = Books + dateFrom = 2025-09-01 | 0            |
| Region = Europe + Category = Electronics                   | 3            |
| Region = North America + Category = Clothing               | 7            |
| Region = Asia Pacific + Category = Electronics             | 8            |
| Region = Europe + Category = Clothing                      | 9            |
| dateFrom = 2025-06-01 (region/category reset)              | 21           |

The maximum row date is 2025-08-25, which is why `2025-09-01` reliably produces the empty state
for TD3 regardless of region/category.

## Appendix B — Source reference index

| Area                                           | File                                                                                                 | Relevant lines   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| App shell, page switching, placeholders        | [`src/app/App.tsx`](../../src/app/App.tsx)                                                           | 16–63            |
| Navigation pages and ids                       | [`src/app/Navigation.tsx`](../../src/app/Navigation.tsx)                                             | 1–43             |
| Filter drawer, accordions, controls            | [`src/testbed/components/FilterDrawer.tsx`](../../src/testbed/components/FilterDrawer.tsx)           | 27–195           |
| Filter application, table, export, empty state | [`src/testbed/components/ResultsTable.tsx`](../../src/testbed/components/ResultsTable.tsx)           | 15–193           |
| KPI cards                                      | [`src/testbed/components/KPICards.tsx`](../../src/testbed/components/KPICards.tsx)                   | 1–31             |
| Trial controls, start/reset                    | [`src/testbed/components/TrialControls.tsx`](../../src/testbed/components/TrialControls.tsx)         | 37–169           |
| Task definitions                               | [`src/testbed/tasks/taskModel.ts`](../../src/testbed/tasks/taskModel.ts)                             | 1–80             |
| Task state machine, errors, abandonment        | [`src/testbed/tasks/taskManager.ts`](../../src/testbed/tasks/taskManager.ts)                         | 76–231           |
| Observer, metadata extraction, event types     | [`src/telemetry/observer.ts`](../../src/telemetry/observer.ts)                                       | 240–445          |
| UI context and annotation roles                | [`src/types/uiContext.ts`](../../src/types/uiContext.ts)                                             | 9–98             |
| Macro symbols and derivation                   | [`src/macro/symbols.ts`](../../src/macro/symbols.ts)                                                 | 9–190            |
| Generic outcome taxonomy                       | [`src/telemetry/events.ts`](../../src/telemetry/events.ts)                                           | 139–146          |
| Trace schema version                           | [`src/telemetry/traceSchema.ts`](../../src/telemetry/traceSchema.ts)                                 | 47–48            |
| Outcome derivation                             | [`src/outcome/derive.ts`](../../src/outcome/derive.ts)                                               | 28–237           |
| Task→action bridge                             | [`src/runtime/adaptiveRuntime.ts`](../../src/runtime/adaptiveRuntime.ts)                             | 384–460          |
| Default task action map                        | [`src/integration/index.ts`](../../src/integration/index.ts)                                         | 17–22            |
| Context vector and task step counts            | [`src/types/contextVector.ts`](../../src/types/contextVector.ts)                                     | 36–49            |
| Trial order and timeouts                       | [`src/config/runtimeConfig.ts`](../../src/config/runtimeConfig.ts)                                   | 149–153, 259–266 |
| Fast Gate declared patterns                    | [`src/runtime/boot.ts`](../../src/runtime/boot.ts)                                                   | 38–45            |
| Intervention types                             | [`src/intervention/types.ts`](../../src/intervention/types.ts)                                       | 13–25            |
| Actuator target resolution                     | [`src/intervention/actuator.ts`](../../src/intervention/actuator.ts)                                 | 62–63, 332–535   |
| Deterministic stimulus data                    | [`src/testbed/mock-data/tableData.ts`](../../src/testbed/mock-data/tableData.ts)                     | 1–59             |
| Task/DOM wiring tests                          | [`tests/task_wiring.test.tsx`](../../tests/task_wiring.test.tsx)                                     | 44–252           |
| Annotation tests                               | [`tests/semantic_dom_annotations.test.tsx`](../../tests/semantic_dom_annotations.test.tsx)           | 10–118           |
| Outcome taxonomy source of truth               | [`model-preparation/src/config.yaml`](../../../model-preparation/src/config.yaml)                    | 57–72            |
| Prior task/outcome findings                    | [`target-testbed-quality-assessment-2-findings.md`](target-testbed-quality-assessment-2-findings.md) | F-15, F.1–F.3    |

## Appendix C — Verification summary

| Check                              | Method                        | Result                                                                             |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| Five pages and placeholders        | Deployed app, all nav buttons | Overview/Analytics/Reports/Customers/Settings; only Analytics has content **[V]**  |
| Filter drawer collapsed by default | Deployed app                  | All four sections `aria-expanded=false` **[V]**                                    |
| Region filter                      | Deployed app                  | Europe → 18 rows **[V]**                                                           |
| Category filter                    | Deployed app                  | Europe + Books → 6 rows **[V]**                                                    |
| Date filter                        | Deployed app                  | dateFrom 2025-06-01 → 21 rows (with region/category reset) **[V]**                 |
| Segment filter                     | Deployed app                  | Selecting `Returning` did not change the 6-row result **[V]**                      |
| Navigation state inconsistency     | Deployed app                  | Reports → Analytics left 6 rows but reset drawer/collapsed sections **[V]**        |
| Reset Trial                        | Deployed app                  | Left the 6-row filtered table unchanged **[V]**                                    |
| Empty state                        | Source + deterministic counts | `results-empty` renders for 0 rows; 2025-09-01 yields 0 **[V]/[S]**                |
| Export                             | Deployed app                  | Produced `report-export-*.json` with `rowCount: 50` **[V]**                        |
| Out-of-order task steps            | Deployed app                  | Later steps produced errors and did not complete the task **[V]**                  |
| Duplicate event risk               | Source                        | Click+submit and click+input+change paths identified **[S]**                       |
| Outcome deriver gaps               | Source                        | `change`/`input`/`submit` ignored; `btn`→`FORM_SUBMIT`; `blur`→`BACKTRACK` **[S]** |
| Macro symbol misclassification     | Source                        | `tooltip-region`→`SELECT_REGION`; row hover→`TABLE_ROW_SELECT` **[S]**             |
| Task timeout                       | Source                        | `taskTimeoutsMs` configured but unused **[S]**                                     |
| Task start normalization           | Source + deployed             | No page/filter/reset on start **[V]**                                              |

---

_This assessment intentionally stops at recommendations. No UI, task, telemetry, model, or
PrefixSpan change was implemented._
