# ADR-025: Task Harness, State Verification and Lifecycle Boundary

- **Status:** Proposed
- **Date:** 2026-11-16
- **Related:** ADR-011, ADR-012, ADR-017, ADR-024, ADR-026, ADR-029

## 1. Context

The approved milestone replaces the legacy T1–T3 task set with TD1–TD4 and requires:

- a declared `startingPage` per task;
- task-start normalization before `task_start`;
- state-based completion predicates rather than component-touch matching;
- explicit timeout, abandonment and failure semantics;
- correct handling of reset, replacement and condition changes.

Today `TaskManager` lives in `src/testbed/tasks/`, while the framework exposes a generic `UiAdapter`
port (`getTaskState`, `onTaskStateChange`, `onTaskLifecycle`, `recordInteraction`, `abandonTask`).
The framework trace records task events, but the framework must not know TD1–TD4, their components,
their counts or their predicates.

The previous implementation is also not enough for a research trial:

- `TaskStatus` has no `Failed`;
- `taskTimeoutsMs` exists in configuration but is never read;
- `startTask()` overwrites an in-progress trial without an abandonment record;
- completion is satisfied by component ID + action, so a wrong region or report can complete a task;
- starting state is whatever the previous activity left behind.

## 2. Problem

Where do task definitions, state snapshots, completion predicates, timeout and failure semantics
live, and what is the minimum generic contract the framework must expose?

Three placements are plausible:

1. **Framework owns task definitions and predicates.** The framework would need testbed component
   IDs, counts and report names. This directly violates ADR-011 and the milestone boundary
   constraint.
2. **Testbed owns everything, including the lifecycle event vocabulary.** The framework trace would
   have to accept arbitrary task event names and statuses, and every consumer would need to
   understand the testbed's semantics.
3. **Split:** the testbed owns definitions/predicates/state; the framework owns a generic lifecycle
   contract and trace fields.

## 3. Options considered

| Option | Description | Problem |
| --- | --- | --- |
| A. Framework-owned task model | Task definitions and predicates in core | Re-couples core to the Analytics dashboard and TD1–TD4 |
| B. Testbed-owned lifecycle vocabulary | Testbed emits its own arbitrary events | Trace/model-preparation cannot consume a stable contract |
| **C. Split ownership** | Testbed owns tasks/predicates; framework owns generic status/lifecycle + trace fields | Requires one small contract extension; best fit with ADR-011 |

## 4. Evidence available

**Verified**

- `TaskManager` is already in `src/testbed/tasks/`; the framework runtime reaches it only through
  the adapter.
- The adapter contract already exposes task state/lifecycle/record methods.
- The trace schema records `TaskEvent` and task status.
- The quality assessment (F-15) records that completion is currently component-touch based.
- `taskTimeoutsMs` is configured in `src/config/runtimeConfig.ts` and has no reader.
- Starting a new task mid-trial does not emit `task_abandon` for the old trial.

**Not measured**

- The exact timeout values appropriate for participants; this is a protocol decision.
- Whether replacement should be allowed at all during a trial; the plan recommends disabling it.

## 5. Decision required

The ownership boundary for task state/predicates and the lifecycle vocabulary needed by the trace
and model-preparation ingestion.

## 6. Decision

**Adopt Option C: the testbed owns task definitions, state snapshots and predicates; the framework
owns a generic lifecycle/status contract and trace fields.**

Concretely:

- `TaskManager` remains testbed-owned.
- The testbed supplies a `TestbedTaskUiState` snapshot and TD1–TD4 predicates.
- The framework/`UiAdapter` continues to expose generic state/lifecycle snapshots; it does not
  receive task-specific predicate code.
- `TaskStatus` gains `Failed`.
- Lifecycle adds `task_fail` for timeout, with reason `timeout`.
- Abandonment reasons extend to `reset`, `replaced`, `condition_change`, `interrupted` and
  `timeout` (the last only where the implementation chooses `task_abandon` rather than
  `task_fail`; this plan chooses `task_fail`).
- Every task start/event records `taskDefinitionVersion` (for example `TD-v2`).
- The framework trace schema 1.4.0 carries the new status/reason/version fields; it does not carry
  a task predicate or task IDs as core constants.

The testbed normalizes the start before emitting `task_start`:

1. set `startingPage`;
2. reset applied and draft filters;
3. collapse filter sections;
4. clear current report/visited reports;
5. clear errors/evidence/timer;
6. reset active adaptation through the runtime reset path;
7. emit `task_start`.

Task-start routing is not a participant navigation action and must not emit a navigation or
backtrack outcome.

## 7. Consequences

- The framework remains reusable; a different application supplies its own tasks/predicates.
- The trace gains explicit `Failed`/timeout semantics and a task-definition version.
- Model-preparation sees a stable task lifecycle rather than testbed-specific names.
- Testbed tests must cover the state predicates, timeout and replacement/condition transitions.
- The existing `task_start`/`task_step`/`task_complete` path remains; `task_fail` is additive.
- A timeout is a failure, not a completion; a reset/replacement is an abandonment, not a failure.

## 8. What is being deferred

> **Decision:** The exact per-task timeout durations and whether a timeout is presented to the
> participant as a failure or a neutral trial end.
> **Deferred until:** The study protocol and supervisor review are finalized.
> **Reason:** The durations and participant-facing wording affect the study design, not the task
> harness contract. The harness uses placeholder values until then.
> **Current workaround:** `experiment.taskTimeoutsMs` holds placeholder TD1–TD4 values; the status
> is `Failed`/`task_fail` with reason `timeout`.
> **Risk:** Medium — a placeholder that reaches a real study would change participant burden and
> completion rates.
> **Evidence required to revisit:** A written study protocol or a pilot timing observation.

## 9. Conditions that would force this decision to be revisited

- A second application needs task predicates inside the framework rather than in its adapter.
- The trace/ingestion consumers cannot tolerate a `Failed` status or `task_fail` event.
- The study design requires timeout to be an abandonment rather than a failure, or requires no
  timeout at all.
- Task replacement during a trial becomes a required protocol feature.
