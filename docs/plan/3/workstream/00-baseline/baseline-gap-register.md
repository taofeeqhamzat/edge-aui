# Baseline Gap Register — Plan 3

- **Date:** 2026-11-16
- **Baseline framework commit:** `56ff332` (`feat/refinement`)
- **Baseline model-preparation commit:** `cbab411`
- **Status:** Baseline recorded before WS10 implementation

## 1. Executable baseline

| Check | Command | Result |
| --- | --- | --- |
| Framework tests | `npm test -- --reporter=dot` | **409 passed, 1 skipped, 55 files** |
| TypeScript | `npm run typecheck` | **Pass** |
| Deterministic total rows | generator seed `20250921` | **50** |
| Europe rows | region filter | **18** |
| Books + dateFrom 2025-06-01 | category + date filter | **5** |
| Europe + Books + dateFrom 2025-09-01 | region + category + date filter | **0** |
| Model artifact | `models/bundles/v1.0.0/bundle.json` | five-class intervention head; test Macro-F1 `0.5524`, accuracy `0.767` (historical, not semantic-head performance) |

The baseline run was executed before source changes in this workstream. Post-WS10 results are in
[`../10-testbed-tasks/implementation-log.md`](../10-testbed-tasks/implementation-log.md).

## 2. Gap register

| Gap | Owning task | Baseline state |
| --- | --- | --- |
| Legacy T1–T3 only; no TD1–TD4 | 10.2 | Open at baseline |
| Task completion matches component/action only | 10.5 | Open at baseline |
| No timeout/failure lifecycle | 10.5 | Open at baseline; `taskTimeoutsMs` unused |
| No task-start normalization | 10.3 | Open at baseline |
| Filter draft/applied state diverges on navigation | 10.3 | Open at baseline |
| No Reset Filters control | 10.3 | Open at baseline |
| Reports page is a placeholder | 10.4 | Open at baseline |
| Customer Segment control is inert | 10.1 | Open at baseline |
| Space-containing filter-section IDs | 10.1 | Open at baseline |
| No `data-aui-region` annotations | 10.1 | Open at baseline |
| Companion click/input/change and click/submit events | 10.6 | Open at baseline |
| Task replacement/condition change not guarded | 10.3 | Open at baseline |
| Framework core still owns testbed macro/context/gate vocabulary | WS20 | Deferred by plan |
| Trace schema lacks semantic outcomes/task version | WS20 | Deferred by plan |
| Model-preparation target head is five-class intervention | WS40 | Deferred by plan |

## 3. Notes

- Counts are deterministic properties of the stimulus generator, not participant measurements.
- The baseline did not include a production build or deployed-origin run; those are WS70 checks.
- No model training, dataset build or deployment change was made for this baseline.
