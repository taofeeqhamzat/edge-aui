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
- **40.1–40.3 are implemented** (2026-11-19): 1.4.0 ingestion carries semantic/task fields; the
  semantic dataset and manifest exist (14 target IDs, `inspect_help` excluded); the
  window/horizon experiment is reproducible and provenance-scoped.
- **Participant evidence (2026-11-20):** 92 Supabase sessions exported, all schema 1.4.0 and
  untruncated. 44 trace bodies still declared `scripted` (upload-mode oversight); they were
  corrected on the exported copy under a recorded researcher authority and the whole set is
  participant-declared. The framework verifier passed 77 and excluded 15 capture defects.
  Dataset `v2.2.0-participant` has 9,686 examples from 77 session-bounded splits, and the 40.3
  re-run selected **D (12×500 ms, [500,1500])** again, still provisional.
- **40.4–40.5 are implemented** (2026-11-20). A 14-class `TargetSemanticHead` was trained in the
  E1/E2/E3 freeze/partial/full ablation; E2 was selected on validation macro-F1 (test macro-F1
  0.1297 vs majority 0.0841, accuracy 0.1271 vs 0.8603). ONNX/INT8 export, bundle v2 and the
  framework manifest handoff are in place. These are participant-derived engineering results,
  not participant-held-out or user-benefit evidence.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [40.1](tasks/40.1-ingest-schema-1.4-semantic-outcomes.md) | Trace ingestion 1.4.0 + semantic/task fields | 20.5, 30.2 | Medium |
| 2 | [40.2](tasks/40.2-semantic-target-generation-and-dataset.md) | Semantic target generation and dataset v2 | 40.1 | Medium |
| 3 | [40.3](tasks/40.3-window-horizon-splits-class-balance.md) | Window/horizon experiment, splits, class balance | 40.2 | Medium |
| 4 | [40.4](tasks/40.4-semantic-head-training-evaluation.md) | Semantic head training and evaluation | 40.3, participant traces | Medium |
| 5 | [40.5](tasks/40.5-onnx-export-bundle-v2-handoff.md) | ONNX export, bundle v2, framework handoff | 40.4 | Medium |

## Phase boundary

**40.4 was started only after the participant configuration was re-run on the enlarged set.**
40.1–40.3 may use scripted traces for pipeline verification; any result from that data is a
pipeline/engineering result, not evidence about participants or usability. The current
participant set is provisional (77 verified sessions, no approved participant identifier,
~83% `NO_OUTCOME` in the selected training partition). The previous five-class
`bundle/v1.0.0` remains the historical artifact; it was not overwritten and its hashes are
checked by the export test.

Two target-side rules are fixed before 4A starts:

- **Labels.** Only the 14 target IDs are labels; `inspect_help` is recorded evidence and its windows
  are excluded and counted ([ADR-030](../../../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).
  Do not delete the tooltip rule that produces it.
- **Splits.** Session-bounded, with per-partition task-level coverage
  ([ADR-031](../../../../decisions/ADR-031-session-bounded-dataset-splits.md)). Participant-bounded
  splits are adopted only after ADR-023 approves an identifier; until then no participant-held-out
  claim may be made.

## Checkpoints

| After | Checkpoint | Result |
| --- | --- | --- |
| 40.3 | Semantic dataset, splits, class balance and window/horizon report are reproducible | **Passed (provisional on participant evidence)** — scripted and participant reports; `v2.0.0-semantic`, `v2.1.0-participant` and `v2.2.0-participant` datasets validate |
| 40.5 | Semantic head is trained/evaluated/exported; bundle v2 loads; old artifacts remain reproducible | **Passed (participant-derived engineering evidence)** — E2 head, ONNX/INT8, `bundle/v2.0.0`, framework manifest load; legacy artifacts hashed unchanged |

## Exit criteria

- [x] 1.4.0 traces ingest with semantic outcomes/task version; legacy versions still readable.
- [x] Semantic target generation is deterministic, labels only the 14 target IDs (excluding and
      counting `inspect_help` windows) and is mirrored by the TypeScript rules on shared fixtures.
- [x] Dataset v2 has semantic labels, provenance, session-bounded splits with task-level coverage,
      and class weights from the training partition only.
- [x] Window/horizon experiment is small, pre-declared and reports per-outcome coverage/lead time;
      re-run on participant evidence (provisional).
- [x] Semantic target head is trained/evaluated with per-class/macro-F1/confusion/majority metrics
      and no future leakage, on the declared held-out split unit (session-bounded, stated
      explicitly in the report and bundle).
- [x] ONNX/bundle v2 records vocabulary, dataset, code, seed and metrics; the browser can load it
      through the framework manifest and the committed public artifact.
- [x] Old foundation/head artifacts remain reproducible (hashes unchanged; legacy tests pass).

## Verification

```bash
cd model-preparation
python3 -m pytest tests -q
python3 -m src.target_dataset --help
python3 -m src.training --help
python3 -m src.export --help
```

Task-specific commands are in the task files.

## Participant evidence (2026-11-20)

| Item | Result |
| --- | --- |
| Export | 92 sessions (schema 1.4.0, TD1–TD4, baseline) from Supabase `bfntyqahujplvcowjdmh` |
| Declarations | 48 bodies `participant`, 44 bodies `scripted` (upload-mode oversight); the whole export is participant-declared under a recorded researcher authority |
| Retrofit | Local only; 44 corrected, 48 already correct; database and source export untouched; `participantId` null (ADR-023) |
| Verification | 77 verified; 15 excluded (`prediction_window_attribution` ×11, `structural_validity` ×3, `task_lifecycle_consistency` ×1) |
| 40.3 participant re-run | [report](../../../../../../model-preparation/docs/experiments/window-horizon-participant-r2/window-horizon-report.md) — selected **D (12×500 ms, [500,1500])**, provisional; 12/14 classes with ≥5 train examples; `NO_OUTCOME` ≈ 82.6% of train |
| Dataset | `v2.2.0-participant`, 9,686 examples, 77 session-bounded splits, manifest validated |
| 40.4 training | [report](../../../../../../model-preparation/docs/experiments/semantic-head/semantic-head-report.md) — E2 selected on validation macro-F1; test macro-F1 0.1297 vs majority 0.0841; accuracy 0.1271 |
| 40.5 export | `models/task_outcome_head_v2.onnx` / `_int8.onnx`; `models/bundles/v2.0.0/bundle.json`; framework copy under `public/models/`; real INT8 graph load verified (55 framework tests) |
| Presentation | [notebook](../../../../../../model-preparation/notebooks/04_semantic_target_head_retraining.ipynb) |
| Retrofit / verification audit | [participant-evidence README](../../../../../../model-preparation/docs/experiments/participant-evidence/README.md) |

The re-run confirms configuration D under the pre-declared criteria, but the selection remains
provisional: the margin between the top configurations is inside sampling noise. No
participant-held-out claim is made (ADR-023, ADR-031). The training result is participant-derived
engineering evidence: macro-F1 is above the majority baseline, accuracy is far below it, and the
model is poorly calibrated.

## Risks

| Risk | Mitigation |
| --- | --- |
| Retraining starts before participant data | Hard gate on 40.4; scripted runs labelled engineering only |
| Semantic classes too sparse | Coverage report; class weights; per-class support; absent-class reporting |
| Future leakage | Prediction-time inputs only; participant/session/task splits before windows |
| Old model overwritten | Versioned artifacts and bundle v2; never overwrite v1.0.0 |
| Label mismatch TS/Python | Shared fixtures and cross-repo parity tests |
