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
| Full suite | `npm test -- --reporter=dot` | **428 passed, 1 skipped, 56 files** |
| Typecheck | `npm run typecheck` | **Pass** |
| TD1 UI path | `tests/task_wiring.test.tsx` | Completed, 18 rows, errors 0 |
| TD2 UI path | `tests/task_wiring.test.tsx` | Completed, 5 rows, errors 0 |
| TD3 UI path | `tests/task_wiring.test.tsx` | 0 rows → 50 rows, completed, errors 0 |
| TD4 UI path | `tests/task_wiring.test.tsx` | 3 → 6 rows, Europe Books active, completed |
| Timeout | `tests/task_diversification.test.tsx` | `task_fail`/`Failed`; reset clears timer |
| Replacement/wrong action | `tests/task_diversification.test.tsx` | Replaced trial abandons; wrong required-control action counts an error |
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


## WS10 hardening pass

A second review pass used the installed quality tools:

- **crapper (complexity):** split `evaluateCompletion` into named predicates, split
  `recordInteraction`/evidence/step lookup helpers, extracted the filter-draft hook and filter
  field components, and extracted trial-action/status components. The worst remaining function in
  the WS10 source is CC 9 (under the CRAP 10 target).
- **dryer:** no duplicate candidates above the 0.8 threshold remain in the WS10 source.
- **mutator:** completion predicates reached **42/42 mutants killed**; task-manager mutants reached
  **56/74 killed** (75.7%), with the remaining survivors in timeout/no-op guards that do not change
  observable behaviour. Removing the redundant `hasCompletedStep` path reduced the survivor set.
- **subtract:** removed the redundant completed-step lookup; its condition could not change the
  observable outcome.

Additional tests added for: form-submit-only Apply, non-Apply evidence, submit companions on click
targets, empty-before-Apply TD3 evidence, completion duration/terminal step, reset-after-completed,
replacement and wrong-action errors.

The full suite after hardening is **428 passed, 1 skipped**; typecheck and `build:ci` pass.
