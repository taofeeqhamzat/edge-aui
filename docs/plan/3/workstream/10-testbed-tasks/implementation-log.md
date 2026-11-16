# WS10 Implementation Log

- **Date:** 2026-11-16
- **Scope:** WS00 baseline and WS10 tasks 10.1–10.6
- **Baseline commit:** `56ff332`
- **Status:** Implemented and verified locally

## Actions and reasons

1. **Baseline lock (00.1).** Ran `npm test -- --reporter=dot` and `npm run typecheck` before
   editing. Recorded 409 passed / 1 skipped and verified the deterministic task counts. This
   established the starting state required by WS00.
2. **Task model v2 (10.2).** Replaced T1–T3 with TD1–TD4, added `startingPage`, `TD-v2`,
   per-task timeout, completion IDs and canonical step guides. Updated `TASK_STEP_COUNTS` and
   `experiment.trialOrder`/`taskTimeoutsMs` so the context vector and config use the same IDs.
3. **Stable identifiers and annotations (10.1).** Normalized filter-section IDs to
   `filter-section-*`, removed the inert Customer Segment control/state, and added `data-aui-region`
   to the app, page, navigation, trial, filter, KPI, results, reports and debug regions.
4. **Task host and filter state (10.3).** Lifted filter state into `App`; made `FilterDrawer`
   controlled (with a standalone fallback); added `btn-reset-filters`; added task-start
   normalization; disabled Start and condition changes while a trial is in progress; reset clears
   filters/report/visited-report state.
5. **Reports catalogue (10.4).** Added deterministic report data and `ReportsCatalogue`; report
   selection sets `currentReportId`, visited reports, preset filters and navigates to Analytics.
   The catalogue intentionally shows no matching row counts.
6. **State predicates and timeout (10.5).** Added `completion.ts` with TD1–TD4 predicates over a
   narrow UI-state snapshot and action evidence. Started recording `task_fail`/`Failed` for timeout;
   added abandonment reasons for reset/replaced/condition-change/interrupted.
7. **Canonical actions (10.6).** TaskManager now ignores checkbox click/input companions to a
   committed change and the form submit companion to the Apply click, does not error on valid
   out-of-order steps, and ignores duplicate actions on already-completed steps.
8. **Tests.** Updated legacy task tests to TD1–TD4 and added `tests/task_diversification.test.tsx`
   for predicates, timeout, empty recovery, companion events and reset. Added integration coverage
   for TD1–TD4 through the real React testbed.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Full suite | `npm test -- --reporter=dot` | **419 passed, 1 skipped, 56 files** |
| Typecheck | `npm run typecheck` | **Pass** |
| TD1 UI path | `tests/task_wiring.test.tsx` | Completed, 18 rows, errors 0 |
| TD2 UI path | `tests/task_wiring.test.tsx` | Completed, 5 rows, errors 0 |
| TD3 UI path | `tests/task_wiring.test.tsx` | 0 rows → 50 rows, completed, errors 0 |
| TD4 UI path | `tests/task_wiring.test.tsx` | 3 → 6 rows, Europe Books active, completed |
| Timeout | `tests/task_diversification.test.tsx` | `task_fail`/`Failed`; reset clears timer |
| Reports/reset/consistency | `tests/task_wiring.test.tsx` | Presets sync; 50 rows restored; drawer/table agree |

## Deliberate follow-ups (not WS10)

- The framework-level canonicalizer, semantic outcome vocabulary and trace schema 1.4.0 remain
  WS20 tasks. WS10 uses a testbed-level companion-event rule to keep task paths clean.
- The scripted TD1–TD4 browser driver and cross-repository trace verification remain WS30.
- Semantic target generation/retraining remains WS40 and is blocked on participant traces for
  4B.
- The trace still records schema 1.3.0 fields; `task_fail` is typed but the 1.4.0 semantic/task
  version fields are WS20/40 work.

## Claim boundary

All verification above is engineering/automated-test evidence. No participant, usability,
model-performance or deployment measurement is claimed from WS10.
