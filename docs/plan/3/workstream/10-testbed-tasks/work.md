# Workstream 10 — Testbed Tasks, UI Fixes and Task Harness

## Objective

Implement the approved TD1–TD4 task set in the testbed with normalized starting states,
state-verified completion, explicit timeout/abandon/failure semantics, the minimum UI changes
(Reset Filters, Reports catalogue, segment removal, stable identifiers) and tests that prove the
canonical paths work under both baseline and adaptive conditions.

The framework receives only generic task snapshots and lifecycle events. Task definitions,
predicates, counts and report names stay in the testbed.

## Current state

- Legacy T1–T3 only; all start on Analytics; T2 is navigation + export; T3's segment step is inert.
- `TaskManager` matches component ID + action only; values are not checked; there is no `Failed`
  state; `taskTimeoutsMs` is unused.
- Starting a task does not normalize page/filters/report/errors; starting another task mid-trial
  does not abandon the first; condition changes are not guarded.
- `App.appliedFilters` and `FilterDrawer` draft state are separate; navigating away resets the
  drawer but leaves the table filtered.
- No Reset Filters control; no Reports catalogue; Customer Segment is dead.
- Filter section IDs contain spaces; no `data-aui-region`; report controls do not exist.
- One participant action can produce multiple task interactions (checkbox click/input/change;
  Apply click/submit), causing spurious errors.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [10.1](tasks/10.1-identifiers-annotations-segment-removal.md) | Stable IDs, region annotations, remove Customer Segment | 00.1 | Medium |
| 2 | [10.2](tasks/10.2-task-model-v2-and-config.md) | TD1–TD4 model, starting pages, version, config keys | 10.1 | Medium |
| 3 | [10.3](tasks/10.3-task-host-filter-state-reset.md) | Controlled filter state, Reset Filters, task-start normalization, lifecycle guards | 10.1, 10.2 | Medium |
| 4 | [10.4](tasks/10.4-reports-catalogue-and-presets.md) | Reports catalogue, deterministic presets, current-report state | 10.3 | Medium |
| 5 | [10.5](tasks/10.5-state-predicates-timeout-failure.md) | UI-state snapshot, TD predicates, timeout/failure, evidence | 10.2, 10.3, 10.4 | Medium |
| 6 | [10.6](tasks/10.6-canonical-actions-and-task-tests.md) | Canonical action pipeline, dedupe, integration/task tests | 10.3, 10.5 | Medium |

## Dependency notes

- 10.1 first: the task model and tests must target stable IDs.
- 10.2 can start once IDs are stable; task definitions may reference the Reports catalogue IDs that
  10.4 will implement, but TD4 is not complete until 10.4 and 10.5 land.
- 10.3 lifts filter state before 10.4's presets; preset synchronization depends on it.
- 10.5 depends on 10.4 for TD4's `visitedReportIds`/`currentReportId`.
- 10.6 last: canonical actions must be tested against the completed task model and predicates.
- The scripted browser driver is in [Workstream 30](../30-collection-validation/work.md); 10.6
  covers component/integration-level tests, not the full browser dry run.

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 10.2 | Stable IDs and TD1–TD4 model compile; component-existence tests pass or TD4 is explicitly pending 10.4 |
| 10.4 | Filter state, Reset Filters and Reports catalogue work; table/drawer/preset consistency tested |
| 10.6 | TD1–TD4 complete under both conditions; timeout/abandon/failure and canonical-action tests pass |

## Exit criteria

- [ ] TD1–TD4 are selectable, start on their declared pages and have a definition version.
- [ ] Every starting page resets filters, sections, report state, errors and timer before
      `task_start`.
- [ ] Completion is state-verified; wrong values/states do not complete.
- [ ] Timeout → `Failed`/`task_fail`; reset/replacement/condition change → explicit abandonment.
- [ ] Reset Filters clears draft and applied state; 50 rows restored.
- [ ] Reports catalogue works; presets sync table/drawer/current report; no row counts shown.
- [ ] Customer Segment is removed from UI and state.
- [ ] One action produces one task interaction; canonical paths have zero `task_error`.
- [ ] Existing framework tests still pass; no framework core file gains a testbed task/report ID.

## Verification

```bash
cd edge-aui-framework
npm test
npm run typecheck
```

Focused test files are named in each task. The full browser dry run is 30.1.

## Risks

| Risk | Mitigation |
| --- | --- |
| Filter-state lift changes many components | One controlled-state change; test navigation, presets, reset and task start |
| Reports catalogue scope creeps | Fixed deterministic list, no counts, no charts, no backend |
| Timeout values are arbitrary | Mark as placeholders; protocol decision in plan §12.2 |
| Task predicates become brittle against DOM changes | Use `data-aui-*` identifiers and a narrow UI-state snapshot, not text parsing |
| Canonicalization changes existing event semantics | Keep raw events; canonicalize at the task/outcome boundary; test both |
