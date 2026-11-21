# ADR-026: Additive Semantic Task-Outcome Taxonomy and Migration

- **Status:** Proposed
- **Date:** 2026-11-16
- **Related:** ADR-006, ADR-012, ADR-017, ADR-025, ADR-027, ADR-029, ADR-030, ADR-031

## 1. Context

The model-preparation foundation model uses a seven-class generic outcome taxonomy:

```text
NO_OUTCOME, CLICK, FORM_SUBMIT, BACKTRACK, RAPID_SCROLL, HOVER_DWELL, ABANDON
```

The target head currently predicts five scripted intervention classes, not task-oriented outcomes.
The approved milestone needs both gates to eventually produce outcomes consumable by one policy,
and the testbed to record meaningful future task actions such as `select_report`, `apply_filter`
and `export_report`.

The existing seven-class model cannot predict those semantic IDs. Relabelling its output head
without retraining would be a false claim. Replacing the taxonomy immediately would invalidate the
current model, the existing dataset and the reproducibility bundle before new participant traces
exist.

The task-diversification assessment proposes **additive semantic recording during collection**,
followed by retraining the Slow Gate on the semantic vocabulary after sufficient participant
traces exist. The researcher has mostly finalized this direction.

## 2. Problem

What taxonomy do the runtime and traces use during the transition, where is the source of truth, and
at exactly what point must the model, training configuration and exported artifact change?

## 3. Options considered

| Option | Description | Consequence |
| --- | --- | --- |
| A. Replace the seven-class taxonomy immediately | Runtime, traces, config and model all switch now | Invalidates the current untrained-semantic model; no data yet |
| **B. Additive semantic recording, then retrain** | Keep generic `outcome`; add `taskOutcome`; retrain later | Compatible, evidence-preserving, but two fields during transition |
| C. Parallel indefinitely | Keep two unrelated taxonomies forever | Duplicated policy/evaluation logic; no shared contract |
| D. Relabel the old head | Map old classes to semantic IDs heuristically | False claim; wrong target semantics |

## 4. Evidence available

**Verified**

- `model-preparation/src/config.yaml` defines seven generic outcomes and five intervention classes.
- `target_dataset.py` labels examples with the five-class intervention policy; its
  `target_outcome` is generic.
- `TargetInterventionHead` and `export.py` are five-class contracts.
- Framework trace schema 1.3.0 has no semantic outcome field.
- The task-diversification assessment records that `OutcomeDeriver` is click-centric and cannot
  represent committed filter selections; it recommends a semantic layer.
- The previous `bundle/v1.0.0` is a reproducible five-class artifact and must not be overwritten.

**Not measured**

- Semantic class coverage in participant traces (none exist yet).
- Whether 14 classes are learnable at the planned data volume; this is a Phase 4B measurement.

## 5. Decision required

The transition taxonomy, the additive trace field, the model/config migration point, and the
minimum approval needed before implementation.

## 6. Decision

**Adopt Option B — additive semantic recording, then a explicit retraining migration.**

1. **During collection (Phases 3–4A):**
   - retain the seven-class `outcome` and its existing meaning;
   - add `taskOutcome` (or the approved equivalent) plus `taskOutcomeVocabularyVersion` to
     semantic-capable outcome records;
   - record the testbed's semantic vocabulary alongside the generic label;
   - the existing model and `bundle/v1.0.0` remain untouched.

2. **Before retraining (Phase 4B start):**
   - the exact target vocabulary is pinned to the 14 IDs including `NO_OUTCOME` by
     [ADR-030](ADR-030-semantic-target-vocabulary-pinned-to-14.md); the recorded `inspect_help` ID
     is not a target;
   - add the semantic taxonomy and head dimension to `model-preparation/src/config.yaml` as the
     source of truth;
   - define a new dataset version for semantic labels;
   - keep the old dataset/bundle reproducible.

3. **At retraining:**
   - train a **new** semantic target head; do not relabel the old five-class head;
   - evaluate on participant-held-out data; export a new ONNX artifact and bundle v2;
   - record vocabulary/version, dataset, code commit, seed and metrics in the manifest.

4. **At runtime adoption:**
   - point the Slow Gate to the new artifact through configuration/manifest;
   - keep the old model loadable for comparison/fallback;
   - policy consumes semantic predictions only after the model is trained and validated.

5. **Lifecycle labels are not prediction targets.** `task_complete` and `task_abandon` are
   evaluation labels; `task_fail` is a lifecycle outcome. They must not be used as model inputs or
   targets.

The exact migration point is **after participant traces exist and before the semantic-head training
run**. The current seven-class model must not be described as predicting semantic outcomes.

## 7. Consequences

- Traces carry both generic and semantic fields during the transition; consumers must declare which
  they use.
- Model-preparation gains a second taxonomy and a new dataset version; the old path remains.
- Evaluation can compare generic and semantic heads on overlapping data where labels permit.
- The semantic vocabulary must be versioned and recorded in both the trace and the model bundle.
- The policy can be tested against semantic outcomes before the model predicts them by using the
  deterministic semantic deriver.
- Any claim about semantic-model performance is deferred until Phase 4B and must state the dataset,
  support and held-out protocol.

## 8. What is being deferred

> **Decision:** Whether the generic seven-class taxonomy is eventually removed or retained as an
> auxiliary diagnostic/ablation head.
> **Deferred until:** The semantic head has been trained and evaluated on participant traces.
> **Reason:** Removing the generic path now would break the current model, trace comparisons and
> reproducibility bundle before the replacement is validated.
> **Current workaround:** Keep both fields; both heads remain loadable; the old bundle is frozen.
> **Risk:** Medium — two taxonomies can confuse readers and downstream analysis if not labelled.
> **Evidence required to revisit:** Semantic-head evaluation and a decision on whether the generic
> head still provides diagnostic value.

> **Decision:** The exact semantic field name and vocabulary version string.
> **Deferred until:** Decision 6 approval before Phase 2.5/4.1.
> **Reason:** The runtime, trace schema and ingestion must agree before collection; renaming later
> would create two trace dialects.
> **Current workaround:** The plan uses `taskOutcome` and `taskOutcomeVocabularyVersion` as proposed
> names.
> **Risk:** Medium — a late rename invalidates early captures.
> **Evidence required to revisit:** Written supervisor approval of the field/vocabulary names.

## 9. Conditions that would force this decision to be revisited

- Participant data shows the semantic vocabulary is too sparse or ambiguous to learn.
- The generic `outcome` and semantic `taskOutcome` cannot be reconciled for the same window.
- A supervisor requires immediate replacement rather than additive recording.
- The semantic head cannot be exported/integrated within the browser constraints.
