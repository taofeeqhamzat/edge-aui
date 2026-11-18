# ADR-031: Dataset Splits Are Session-Bounded Until Participant Identification Is Approved

- **Status:** Accepted
- **Date:** 2026-11-18
- **Related:** ADR-010, ADR-018, ADR-023, ADR-026, ADR-030

## 1. Context

The milestone plan required "session/participant-bounded splits before window generation" and
Task 40.3 required splits "participant/session-bounded where participant IDs exist, otherwise
session-bounded". Participant identification is deferred: `session.participantId` is nullable and
never populated, no participant identifier scheme is approved, and no consent or withdrawal runbook
exists (ADR-023, Option B — session-scoped anonymity).

A participant-bounded split is therefore impossible today: there is no key that groups one person's
sessions. Writing the criterion as if it were achievable would either block Phase 4A on a protocol
decision, or produce a claim ("participant-held-out") the data cannot support.

## 2. Problem

What is the leakage-control unit for the semantic dataset, and what may the Phase 4 evaluation
claim until a participant identifier exists?

## 3. Options considered

| Option | Description | Consequence |
| --- | --- | --- |
| A. Require participant IDs before 40.3 | Block the dataset/experiment on ADR-023 approval | Stalls 4A on a protocol decision; no dataset, split or coverage evidence meanwhile |
| **B. Session-bounded now; participant-bounded when ADR-023 lands** | Split on `session_id`; report task coverage; declare the held-out unit | Usable 4A result with an honest, narrower claim |
| C. Infer participant linkage from device/browser fingerprints | Reconstruct identity from the environment | Rejected by ADR-023 Option C; creates a re-identification surface nobody approved |

## 4. Evidence available

**Verified**

- `SessionContext.participantId` exists in the schema and is always `null` in captures
  ([collection-readiness §4](../plan/3/workstream/30-collection-validation/collection-readiness.md)).
- ADR-023 records that no identifier scheme, consent text or withdrawal procedure is approved.
- Every scripted capture is a single session with a unique anonymous session id.
- The existing dataset builder partitions by session (session-bounded) and derives class weights
  from the training partition only.
- Task-level metadata (`taskId`, `taskDefinitionVersion`) is present on 1.4.0 captures, so task
  coverage per partition is computable today.

**Not measured**

- How many sessions one participant would contribute under the eventual protocol.
- Whether session-boundary leakage is material for the planned model; that requires the participant
  linkage the ADR defers.

## 5. Decision

**Adopt Option B.**

1. **The split unit is the session.** Partitions are computed on `session_id` before window
   generation; no session appears in more than one partition. This is the same rule the existing
   dataset uses.
2. **Task-level coverage is reported per partition** — which tasks appear, their example counts and
   any absent task — because task diversity is the remaining generalisation check once participant
   linkage is unavailable.
3. **Participant-bounded splits replace session-bounded splits when ADR-023 approves an identifier.**
   The dataset version must be bumped when the split unit changes, and 40.3's configuration
   selection must be re-confirmed on the new split before 40.4 uses it.
4. **The Phase 4 evaluation must declare its held-out unit.** Until participant IDs exist it may
   claim session-held-out performance and task coverage only. Participant-held-out generalisation is
   **NOT MEASURED** and must not be asserted.
5. **Class weights, absent-class declarations and majority baselines stay partition-local**, as
   already required by the plan.

## 6. Consequences

- 4A proceeds without waiting for the study protocol, and its results are labelled with the split
  unit they used.
- Leakage claims are limited to session and task level. A participant who completes many sessions
  could still share style across partitions; the limitation is stated, not hidden.
- The re-split that follows ADR-023 approval invalidates the earlier dataset version and requires a
  manifest/version bump. The old dataset remains reproducible.
- 40.3's experiment structure is unchanged: window/horizon evaluation needs disjoint partitions,
  not participant identities.

## 7. What is being deferred

> **Decision:** Adopt participant-bounded dataset splits and participant-held-out evaluation.
> **Deferred until:** ADR-023 approves a participant identifier scheme and the collection protocol
> assigns it to each participant.
> **Reason:** No participant identifier exists, and inferring one from the environment is rejected
> on privacy grounds.
> **Current workaround:** Session-bounded splits with per-partition task-level coverage reporting.
> **Risk:** Medium — session-bounded splits can leak one participant's interaction style across
> partitions if that person completes several sessions.
> **Evidence required to revisit:** Approved identifier scheme and at least one participant with
> more than one recorded session.

## 8. Conditions that would force this decision to be revisited

- ADR-023 approves a participant identifier before 40.3 completes.
- Task-level coverage shows a task missing from a partition often enough to make the split
  unrepresentative.
- The evaluation shows session-boundary leakage (for example, near-duplicate sequences across
  partitions) that a participant split would have prevented.
