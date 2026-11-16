# Workstream 30 — Scripted Validation and Participant Trace Readiness

## Objective

Prove the completed testbed + framework + trace path on scripted TD1–TD4 runs under baseline and
adaptive conditions, and make the export/collection path ready for participant traces.

Scripted runs are engineering evidence only. They are `provenance: scripted` and must never be
described as participant evidence.

## Current state

- The model-preparation scripted harness still drives T1–T3 with `EMEA` and `Enterprise` and old
  controls. It cannot exercise the approved task set.
- The framework can export 1.3.0 traces; semantic outcome and task-definition fields do not exist
  until Workstream 20.5.
- A trace verifier and condition-comparison script exist but do not know 1.4.0/semantic fields.
- Collection, session persistence, participant identity and the Supabase provenance gate already
  exist; they need a post-change verification.

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

| After | Checkpoint |
| --- | --- |
| 30.1 | Eight scripted runs export valid 1.4.0 traces; expected counts and completion evidence hold |
| 30.2 | Verifier, ingestion smoke test and collection checklist pass; blocked items recorded |

## Exit criteria

- [ ] Eight scripted runs (TD1–TD4 × baseline/adaptive) complete and export 1.4.0 traces.
- [ ] Each canonical path completes with state evidence and zero canonical-path errors.
- [ ] Baseline traces contain no adaptive DOM mutation; adaptive traces contain the configured
      interventions only.
- [ ] Trace verifier and model-preparation ingestion accept the real exports.
- [ ] Collection readiness checklist is signed off; participant protocol items remain explicitly
      deferred.

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
