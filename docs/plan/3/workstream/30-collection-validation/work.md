# Workstream 30 — Scripted Validation and Participant Trace Readiness

## Objective

Prove the completed testbed + framework + trace path on scripted TD1–TD4 runs under baseline and
adaptive conditions, and make the export/collection path ready for participant traces.

Scripted runs are engineering evidence only. They are `provenance: scripted` and must never be
described as participant evidence.

## Current state

**Before this workstream**

- The model-preparation scripted harness still drove T1–T3 with `EMEA` and `Enterprise` and old
  controls. It could not exercise the approved task set.
- The framework could export 1.3.0 traces only.
- The trace verifier and condition-comparison script were a second, stale JavaScript copy that
  accepted only 1.2.0 and required T1–T3 step ids.
- Collection, session persistence, participant identity and the Supabase provenance gate already
  existed but had not been verified after the 1.4.0 change.

**After 30.1 and 30.2 (2026-11-17)**

- Eight scripted captures (TD1–TD4 × baseline/adaptive) were recorded in a real browser against
  framework `5f5f734` and model-preparation `963ae54`; all eight export verified `1.4.0` traces.
- `verify-trace.mjs` and `compare-condition-traces.mjs` load the single TypeScript verification
  contract; the verifier checks generic lifecycle consistency, prediction→window attribution,
  semantic/task-version attribution and condition/provenance agreement.
- Ingestion accepts `1.4.0`, and a real exported capture is ingested in the tests.
- Five defects were found and fixed during validation (finished-trial destruction, duplicate
  window ids, inverted disclosure semantics, the stale CLI verifier, logit-as-confidence).
- A post-validation review of TD2 surfaced a participant-facing gap: the old prose admitted
  a later start date that the predicate rejects, and the resulting frozen controls were
  unexplained. Exact step labels and an `aria-live` lock note now explain the state; the
  completion predicate is unchanged.
- Evidence: [validation-report.md](validation-report.md),
  [acceptance-matrix.md](acceptance-matrix.md),
  [collection-readiness.md](collection-readiness.md).

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [30.1](tasks/30.1-scripted-task-driver.md) | Rewrite the scripted driver for TD1–TD4 × baseline/adaptive | 10.1–10.6, 20.1–20.5 | Medium |
| 2 | [30.2](tasks/30.2-trace-verification-and-collection-readiness.md) | Verify traces, acceptance matrix and collection readiness | 30.1 | Medium |

## Execution notes

1. Run each task under both `baseline` and `adaptive` conditions.
2. Use the real browser runtime; do not hand-author a trace.
3. Record the exact commits, model version, configuration, browser and viewport.
4. Assert task completion, counts, timeout/abandon fixtures and no duplicate canonical errors.
5. Keep scripted traces separate from participant traces in filenames/manifests.
6. Ingest at least one exported 1.4.0 trace in model-preparation as a cross-repository smoke test.

## Checkpoints

| After | Checkpoint | Result |
| --- | --- | --- |
| 30.1 | Eight scripted runs export valid 1.4.0 traces; expected counts and completion evidence hold | **Passed** — 8/8 recorded, 8/8 verified |
| 30.2 | Verifier, ingestion smoke test and collection checklist pass; blocked items recorded | **Passed** — 15/15 checks per capture, 17 ingestion tests, blocked items named |

## Exit criteria

- [x] Eight scripted runs (TD1–TD4 × baseline/adaptive) complete and export 1.4.0 traces.
      → [acceptance matrix §1](acceptance-matrix.md#1-scripted-capture-matrix)
- [x] Each canonical path completes with state evidence and zero canonical-path errors.
      → [acceptance matrix §2](acceptance-matrix.md#2-canonical-completion-evidence-per-task)
- [x] Baseline traces contain no adaptive DOM mutation; adaptive traces contain the configured
      interventions only. No adaptive actuation was observed on the canonical path (policy
      declined); every applied intervention would have to be configured and attributed.
      → [acceptance matrix §3](acceptance-matrix.md#3-condition-integrity)
- [x] Trace verifier and model-preparation ingestion accept the real exports.
      → [validation report §4](validation-report.md#4-verification-detail)
- [x] Collection readiness checklist is signed off; participant protocol items remain explicitly
      deferred. → [collection-readiness.md](collection-readiness.md)

## Verification

```bash
cd edge-aui-framework
node scripts/verify-trace.mjs <trace.json>
node scripts/compare-condition-traces.mjs --baseline <baseline.json> --adaptive <adaptive.json>

cd ../model-preparation
python3 -m pytest tests/test_trace_ingestion.py -q
```

## Risks

| Risk | Mitigation |
| --- | --- |
| Browser automation timing/flakiness | Deterministic waits on state/events; record retries; do not fabricate a run |
| Scripted run mistaken for participant evidence | Provenance field, filenames and report wording |
| Trace verifier rejects legitimate in-flight windows | Use the settlement allowance; test with real exports |
| Collection environment unavailable | Record blocked, not passed; use the runbook for manual verification |
