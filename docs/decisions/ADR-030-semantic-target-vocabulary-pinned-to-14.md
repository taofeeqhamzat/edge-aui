# ADR-030: Semantic Target Vocabulary Pinned to 14 Outcomes

- **Status:** Accepted
- **Date:** 2026-11-18
- **Related:** ADR-023, ADR-026, ADR-027, ADR-029, ADR-031

## 1. Context

The milestone plan approved a semantic outcome vocabulary of 14 IDs (including `NO_OUTCOME`) as the
target for a retrained Slow Gate ([plan §3.4](../plan/3/next-milestone-implementation-plan.md)).
Decision 6 left the exact vocabulary "to be settled before Phase 2 implementation". The runtime
implementation (Task 20.4) derives one additional ID, `inspect_help`, when a committed click lands
on a tooltip affordance, so the recorded vocabulary has 15 IDs while the approved target set has 14.

The extra ID is not incidental. It is the product of the exact-identifier rule that fixed
assessment limitation #6: `tooltip-region` contains the substring `region`, and the earlier
derivation classified it as `select_region`. Task 20.4 orders exact `data-aui-component`/role checks
before substring checks, so `tooltip-region` derives `inspect_help` and can never derive
`select_region` ([semanticOutcomes.ts](../../src/testbed/config/semanticOutcomes.ts)).

Task 40.2's acceptance criterion, the semantic dataset label set and the future head's output
dimension all depend on one number. Leaving "14 or 15" undecided would let the dataset and the
model disagree.

## 2. Problem

Given a recorded vocabulary of 15 IDs and an approved target vocabulary of 14, what happens to
`inspect_help`, and which artifact owns the number?

## 3. Options considered

| Option | Description | Consequence |
| --- | --- | --- |
| A. Delete `inspect_help` from the runtime vocabulary | Tooltip interactions become `NO_OUTCOME` | Loses the evidence, and weakens the exclusion rule that assessment limitation #6 required |
| **B. Record `inspect_help`, exclude it from targets** | Trace keeps 15 recorded IDs; dataset and head use the approved 14 | Evidence preserved; one extra recorded ID tagged as non-target |
| C. Expand the target vocabulary to 15 | Approve `inspect_help` as a target class | Reopens Decision 6; adds a class with no task (TD5 is excluded) and likely near-zero support |

## 4. Evidence available

**Verified**

- The plan lists 14 target outcomes (§3.4) and excludes `inspect_help`/`inspect_kpi`
  from this milestone (§1.2).
- The runtime vocabulary declares 15 outcomes including `inspect_help`
  ([semanticOutcomes.ts](../../src/testbed/config/semanticOutcomes.ts)).
- The tooltip rule is a committed click on `tooltip-region` or role `tooltip`; the exact-ID rule
  prevents the region substring rule from winning.
- The 1.4.0 trace contract accepts any application outcome string plus a vocabulary version
  (ADR-029). Ingestion allow-lists are key-based, not value-based.
- Task 40.2 has not started; no dataset or head yet encodes either count.

**Not measured**

- How often `inspect_help` occurs in participant traces (none exist yet).
- Whether tooltip inspection warrants a future task (TD5 is excluded by the researcher).

## 5. Decision

**Adopt Option B.**

1. **The target vocabulary is the approved 14 IDs** (plan §3.4). The semantic head's output
   dimension is 14, and the target-vocabulary version is declared in
   `model-preparation/src/config.yaml` and recorded in the dataset manifest.
2. **The runtime vocabulary stays at 15 recorded IDs.** `inspect_help` continues to be derived and
   recorded with its rule provenance. It is evidence, not a label.
3. **Dataset v2 labels only the 14 target IDs.** A window whose future semantic outcome is
   `inspect_help` is *excluded* from the training examples and the excluded count is reported per
   partition. It is not relabelled as `NO_OUTCOME`, which would assert that nothing happened.
4. **The `tooltip-region` → `select_region` exclusion is retained.** No change may weaken the
   exact-ID/role ordering to make the recorded count match the target count.
5. **Field names and migration point are unchanged** — `taskOutcome`/`taskOutcomeVocabularyVersion`
   in 1.4.0, retraining in Phase 4B (ADR-026, ADR-029).
6. **This decision narrows the target set only.** The residual defects in assessment limitation #6
   (macro-layer `tooltip-region` → `SELECT_REGION`, hover-driven `TABLE_ROW_SELECT`, unproduced
   behavioural symbols, unreachable pagination/sort symbols, `EXPAND_TOOLTIP` with no visible
   expansion) remain open and are tracked in plan §2.8. They are not closed by this ADR.

## 6. Consequences

- The trace vocabulary and the target vocabulary are now two declared, versioned sets. Consumers
  must state which they use, and the dataset manifest records both.
- The target head has 14 logits; the runtime can still observe `inspect_help`, so a prediction
  cannot be "wrong" about an ID the model was never trained on — that ID is simply never a target.
- Per-class metrics cover 14 classes; the excluded `inspect_help` windows appear as an excluded
  count, not as a class with zero recall.
- The next reader cannot resolve the "14 vs 15" discrepancy by deleting the tooltip rule.
- A future TD5/inspection task can promote `inspect_help` to a target class without rewriting the
  derivation, because the evidence is already recorded.

## 7. What is being deferred

> **Decision:** Whether `inspect_help` becomes a first-class target outcome, or is removed from the
> runtime vocabulary.
> **Deferred until:** A TD5/inspection task is approved, or participant coverage shows tooltip
> inspection is frequent enough to learn.
> **Reason:** TD5 is excluded from this milestone; a 15th target class with no task and unmeasured
> support would distort the class distribution and the evaluation.
> **Current workaround:** Record `inspect_help` as evidence, exclude it from targets, and report the
> excluded window count per partition.
> **Risk:** Low — no evidence is discarded; only the target set is narrowed, and the split between
> recorded and target IDs is versioned.
> **Evidence required to revisit:** A researcher decision on TD5, or a coverage report from
> participant traces showing usable `inspect_help` support.

## 8. Conditions that would force this decision to be revisited

- The researcher approves a TD5 inspection task and wants `inspect_help` predicted.
- Participant traces show `inspect_help` to be among the most frequent outcomes and the 14-class
  head underperforms because it must treat those windows as excluded.
- Ingestion or the trace contract is changed to a value-level allow-list that rejects out-of-target
  IDs (it is currently key-based).
