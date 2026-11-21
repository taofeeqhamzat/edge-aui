# Workstream 70 — Deployment and Academic-Evaluation Readiness

## Objective

Produce a reproducible, deployed, demonstrable release with honest measurements and documented
limitations, suitable for supervisor review and the next participant-study stage.

## Current state

- Cloudflare Pages/Workers deployment with WASM-only ONNX Runtime exists.
- Supabase research persistence and the provenance gate exist.
- The current combined payload target remains unmet under ADR-008/016; do not claim it is met.
- New model assets, schema 1.4.0 and semantic outcomes require a fresh build/deployment
  verification.
- Browser coverage is currently verified on Chromium; no cross-browser claim is supported.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [70.1](tasks/70.1-build-assets-runtime-verification.md) | Clean build, assets, model/worker, baseline/adaptive runtime | 1–6 | Medium |
| 2 | [70.2](tasks/70.2-persistence-browser-checks-supervisor-release.md) | Trace persistence/export, browser checks, demo runbook, final limitations | 70.1 | Medium |

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 70.1 | Clean build, asset inventory, model/worker load and baseline/adaptive run verified |
| 70.2 | Persistence/export, browser checks, demo path and limitations documented; release ready |

## Exit criteria

- [x] Production build succeeds from a clean checkout (`npm run build:ci` in 500ms).
- [x] Assets and model graphs load in the deployed environment; no JSEP/WebGPU binary (`check:deploy-assets`).
- [x] Worker initialises; provider/model version reported honestly (`task_outcome_head_v2_int8` / `[wasm]`).
- [x] Baseline/adaptive run works; baseline is inert (0 mutations; asserted in `tests/experiment_condition.test.ts`).
- [x] Traces persist/export; Supabase/provenance gate verified or explicitly blocked (`tests/collection_persistence.test.ts`).
- [x] Browser/environment checks recorded; no unsupported cross-browser claim (Chrome 157 verified; others `NOT MEASURED`).
- [x] Actual measurements recorded; `NOT MEASURED` where applicable (latency 3.056 ms, payload 14.61 MiB, memory/CLS `NOT MEASURED`).
- [x] Supervisor demo path and limitations documented (published in [release-report.md](release-report.md) §7).

## Verification

```bash
cd edge-aui-framework
npm run build:ci
npm run check:deploy-assets
npm run benchmark:runtime
```

Then load the deployed/preview origin in the intended browser and run TD1–TD4.

## Risks

| Risk | Mitigation |
| --- | --- |
| Payload target unmet | Report measured sizes; do not claim target met |
| Model asset missing/mismatch | Manifest/config check; worker provider/model logging |
| Deployment environment unavailable | Record blocked; provide manual runbook |
| Browser differences | State the verified browser; do not generalise |
| Historical performance claims | Re-measure after the model/asset change |
