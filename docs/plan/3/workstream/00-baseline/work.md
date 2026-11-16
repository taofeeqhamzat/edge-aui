# Workstream 00 — Repository Audit and Implementation Baseline

## Objective

Lock the implementation baseline before any code changes: record the exact repository commits,
run the existing verification suites, confirm the deterministic task counts and model artifacts,
and convert any drift from the planning assumptions into a visible gap register.

This workstream does not implement product changes. It protects every later task from starting on
an assumed rather than verified state.

## Current state

- `edge-aui-framework` is on branch `feat/refinement` at commit `25033a8`; the working tree is
  clean apart from the assessment and planning documents.
- `model-preparation` is at commit `cbab411`; the working tree is clean.
- The framework already contains a substantial pipeline: telemetry, MicroTensor windows, macro
  stream, PrefixSpan/WASM, dual gates, policy, actuator, trace schema 1.3.0, UI adapter, session
  persistence, Supabase collection and Cloudflare deployment.
- The model-preparation repository contains a foundation GRU, a five-class intervention head,
  scripted traces, target dataset assembly, session-bounded splits, class weights, training,
  evaluation, ONNX export and a reproducibility bundle.
- The approved TD1–TD4 task set, semantic outcome layer, semantic target dataset and semantic
  target head are not implemented.
- The task-diversification assessment records the detailed UI/task gaps; this plan's §2 reconciles
  them with the current source.

## Task index

| Task | Description | Depends on | Scope |
| --- | --- | --- | --- |
| [00.1](tasks/00.1-baseline-lock-and-gap-register.md) | Record commits, test baseline, deterministic counts, artifacts and gap register | — | Small |

## Execution notes

1. Do not edit source code in this workstream.
2. Run the existing suites and record **pass / fail / blocked**, not an inferred status.
3. Recompute the deterministic counts from `src/testbed/mock-data/tableData.ts` with seed
   `20250921`: total 50, Europe 18, Books + dateFrom 2025-06-01 5, Europe + Books + dateFrom
   2025-09-01 0. If the dataset changed, record the new values and flag the predicate updates.
4. Record the model artifact hashes and bundle metadata; do not treat the historical five-class
   metrics as semantic-head performance.
5. Record the exact test commands and environment (Node/Python/OS/browser).
6. Update this plan only where the evidence materially contradicts it; otherwise the plan stands.

## Verification

```bash
cd edge-aui-framework
git rev-parse HEAD
git status --short
npm test
npm run typecheck
npm run parity:check

cd ../model-preparation
git rev-parse HEAD
git status --short
python3 -m pytest tests -q
```

Record any skipped/optional suite (for example a deployment test that requires a built `dist/`)
as **blocked**, with the exact reason.

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 00.1 | Baseline record and gap register reviewed; no source change; plan assumptions confirmed or updated |

## Exit criteria

- [ ] Both commit hashes and branch names recorded.
- [ ] Existing suite results recorded with command, pass/fail/blocked and reason.
- [ ] Deterministic counts re-verified (or deltas recorded).
- [ ] Model artifact hashes/bundle metadata recorded.
- [ ] Gap register maps every material gap to WS10–WS70.
- [ ] No source, configuration, model, dataset or deployment file changed.

## Risks

| Risk | Mitigation |
| --- | --- |
| Test environment differs from prior runs | Record environment and blocked tests; do not convert a blocked result into a pass |
| Dataset changed since the assessment | Recompute counts; update predicates in 10.5 and report presets in 10.4 |
| Plan drift already exists | Record it in the gap register; do not silently assume the plan is current |
