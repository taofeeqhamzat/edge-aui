# Workstream 40 — Model Preparation and Semantic Target Head

## Objective

Prepare the model-preparation pipeline for semantic task outcomes and train/evaluate/export a
target head over the approved 14-outcome target vocabulary, evaluated on the declared held-out
split unit (session-held-out until a participant identifier is approved).

Phase 4 is split:
- **4A (tasks 40.1–40.3):** ingestion, semantic dataset, splits, class balance and the
  window/horizon experiment. This can run on scripted traces and must not claim participant
  performance.
- **4B (tasks 40.4–40.5):** training, evaluation, export and framework handoff. This is blocked on
  usable participant traces.

## Current state

- Trace ingestion accepts 1.3.0 (plus 1.2.0/1.1.0) with a strict allow-list.
- `target_generation.py` derives the generic seven-class outcome.
- `target_dataset.py` labels examples with the five-class scripted intervention policy; its
  `target_outcome` is the generic outcome.
- `config.yaml` has generic `outcome_taxonomy` (7), `target_intervention_vocabulary` (5) and
  `training.target_classes: 5`.
- `TargetInterventionHead` outputs five classes; `export.py` validates a five-class
  `intervention_logits` graph.
- The runtime records 15 semantic IDs (the 14 approved target IDs plus `inspect_help`); the target
  vocabulary is the 14, so dataset labels and the head's output dimension are 14
  ([ADR-030](../../../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).
- Foundation GRU, session-bounded splits, class weights, provenance manifest, training/eval,
  ONNX export and `bundle/v1.0.0` are implemented and must be preserved.
- The scripted harness is updated in Workstream 30, not here.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [40.1](tasks/40.1-ingest-schema-1.4-semantic-outcomes.md) | Trace ingestion 1.4.0 + semantic/task fields | 20.5, 30.2 | Medium |
| 2 | [40.2](tasks/40.2-semantic-target-generation-and-dataset.md) | Semantic target generation and dataset v2 | 40.1 | Medium |
| 3 | [40.3](tasks/40.3-window-horizon-splits-class-balance.md) | Window/horizon experiment, splits, class balance | 40.2 | Medium |
| 4 | [40.4](tasks/40.4-semantic-head-training-evaluation.md) | Semantic head training and evaluation | 40.3, participant traces | Medium |
| 5 | [40.5](tasks/40.5-onnx-export-bundle-v2-handoff.md) | ONNX export, bundle v2, framework handoff | 40.4 | Medium |

## Phase boundary

**Do not start 40.4 before usable participant traces exist.** 40.1–40.3 may use scripted traces for
pipeline verification; any result from that data is a pipeline/engineering result, not evidence
about participants or usability. The previous five-class `bundle/v1.0.0` remains the historical
artifact; do not overwrite it.

Two target-side rules are fixed before 4A starts:

- **Labels.** Only the 14 target IDs are labels; `inspect_help` is recorded evidence and its windows
  are excluded and counted ([ADR-030](../../../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).
  Do not delete the tooltip rule that produces it.
- **Splits.** Session-bounded, with per-partition task-level coverage
  ([ADR-031](../../../../decisions/ADR-031-session-bounded-dataset-splits.md)). Participant-bounded
  splits are adopted only after ADR-023 approves an identifier; until then no participant-held-out
  claim may be made.

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 40.3 | Semantic dataset, splits, class balance and window/horizon report are reproducible |
| 40.5 | Semantic head is trained/evaluated/exported; bundle v2 loads; old artifacts remain reproducible |

## Exit criteria

- [ ] 1.4.0 traces ingest with semantic outcomes/task version; legacy versions still readable.
- [ ] Semantic target generation is deterministic, labels only the 14 target IDs (excluding and
      counting `inspect_help` windows) and is mirrored by the TypeScript rules on shared fixtures.
- [ ] Dataset v2 has semantic labels, provenance, session-bounded splits with task-level coverage,
      and class weights from the training partition only.
- [ ] Window/horizon experiment is small, pre-declared and reports per-outcome coverage/lead time.
- [ ] Semantic target head is trained/evaluated with per-class/macro-F1/confusion/majority metrics
      and no future leakage, on the declared held-out split unit (session- or participant-bounded,
      stated explicitly).
- [ ] ONNX/bundle v2 records vocabulary, dataset, code, seed and metrics; the browser can load it.
- [ ] Old foundation/head artifacts remain reproducible.

## Verification

```bash
cd model-preparation
python3 -m pytest tests -q
python3 -m src.target_dataset --help
python3 -m src.training --help
python3 -m src.export --help
```

Task-specific commands are in the task files.

## Risks

| Risk | Mitigation |
| --- | --- |
| Retraining starts before participant data | Hard gate on 40.4; scripted runs labelled engineering only |
| Semantic classes too sparse | Coverage report; class weights; per-class support; absent-class reporting |
| Future leakage | Prediction-time inputs only; participant/session/task splits before windows |
| Old model overwritten | Versioned artifacts and bundle v2; never overwrite v1.0.0 |
| Label mismatch TS/Python | Shared fixtures and cross-repo parity tests |
