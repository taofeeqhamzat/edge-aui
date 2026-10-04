# Deployment Acceptance Runbook

The supervisor's acceptance sequence for the v0.1 research deployment, with each step marked by
what has **actually been observed** in this repository's environment — not by what is expected to
work.

```
ORT WASM entry point
        ↓
production build
        ↓
asset inventory
        ↓
Cloudflare Pages deployment
        ↓
browser loads model + WASM
        ↓
real sequence + context inference
        ↓
TargetInterventionHead
        ↓
policy
        ↓
visible intervention
        ↓
persistent research trace
```

## Status summary

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | ORT WASM entry point | **VERIFIED** | `require.resolve('onnxruntime-web/wasm')` → `ort.wasm.min.js`; asserted in `tests/deployed_acceptance.test.ts` |
| 2 | Production build | **VERIFIED** | `npm run build:ci` completes from a clean checkout (983 files, no `node_modules`, no Rust) |
| 3 | Asset inventory | **VERIFIED** | `npm run check:deploy-assets` → 20 files, 14.18 MiB total, largest 12.86 MiB, no JSEP asset |
| 4 | Cloudflare deployment | **VERIFIED** | Worker `edge-aui` at `https://edge-aui.hamzattao.workers.dev/`. Commit check `Workers Builds: edge-aui` reported `success` on `fc40b79` and `7f2727d`; origin returns HTTP/2 200 and serves the first-load bundle, `/models/model_int8.onnx` (170,206 B), `/models/intervention_head_int8.onnx` (176,839 B) and the 13,479,978 B ORT WASM binary. |
| 4a | Cross-origin isolation on the deployed origin | **VERIFIED** | `curl -sI` returns `cross-origin-opener-policy: same-origin` and `cross-origin-embedder-policy: require-corp`, so `dist/_headers` is applied by Workers static assets. This is the "works locally, degrades in production" failure the asset gate exists to prevent. |
| 5 | Browser loads model + WASM | **PARTIAL** | Real graphs load and serve inference headlessly (`modelLoaded: true`, provider `wasm`), and the deployed origin serves the assets. Running it in a **browser from the deployed origin** is **NOT VERIFIED**. |
| 6 | Real sequence + context inference | **VERIFIED** | 41 behaviour events → 11 MicroTensor windows → 2 predictions on a real capture |
| 7 | `TargetInterventionHead` executes | **VERIFIED** | `slowGateMode: 'onnx'`, `modelLoaded: true`, non-mock provider |
| 8 | Policy decision recorded | **VERIFIED** | 2 predictions, 2 policy decisions, every prediction attributed a verdict |
| 9 | Visible intervention | **PARTIAL** | The DOM↔trace correlation is asserted; in the recorded run the policy legitimately did not actuate (0 interventions), so a visible adaptation was not observed |
| 10 | Persistent research trace | **PARTIAL** | A canonical 1.3.0 trace is produced, verifier-clean, and ingests into `model-preparation`. The upload now runs on trial completion (`tests/trial_completion_upload.test.ts`), but **no trace has been observed reaching a live Supabase project** — see the production blocker below. |

### Production blocker for step 10 (observed 2026-10-04)

The deployed bundle contains the collection client — `grep -c research_sessions` on
`/assets/index-CJtcHgN2.js` returns 1 — but **no Supabase configuration**: the same bundle has zero
occurrences of the project ref and zero occurrences of `supabase`. The Worker's build trigger has no
`VITE_*` variables, so `vite build` inlined nothing and `resolveSupabaseCollectionConfig()` resolves
to unconfigured. The deployed origin therefore reports `collection: local_only` and uploads nothing.

Until the four variables in [`cloudflare-pages-setup.md` §2](./cloudflare-pages-setup.md#2-set-environment-variables)
are set on the **production build trigger** and a build runs afterwards, step 10 cannot pass on the
deployed origin, however correct the code is.

**This is now visible in the build log rather than only by grepping the deployed bundle.**
`npm run check:deploy-assets` reports the collection state it can measure from the emitted
JavaScript, so a build with no inlined Supabase configuration prints
`Collection:     NOT CONFIGURED — this build uploads no traces`. Absence is a warning by default
because the variables are optional; setting `REQUIRE_COLLECTION=1` on the trigger turns it into a
build failure. The check and its tests are in
[`scripts/check-deploy-assets.mjs`](../../scripts/check-deploy-assets.mjs) and
[`tests/check_deploy_assets_collection.test.ts`](../../tests/check_deploy_assets_collection.test.ts).

**The store side is verified.** Read-only probes against the live project
(`https://bfntyqahujplvcowjdmh.supabase.co`) with the anon key, on 2026-10-04:

| Probe | Result | What it establishes |
|---|---|---|
| `GET /rest/v1/research_sessions?select=session_id&limit=1` | `200 []` | The table exists, so the migrations are applied, and the anon key is valid |
| `GET /rest/v1/research_traces?select=session_id&limit=1` | `200 []` | As above |
| `GET /rest/v1/research_export?select=session_id&limit=1` | `401`, `42501 permission denied for view research_export` | The export view is correctly revoked from `anon` (migration 0003) |

`[]` is what an RLS-protected table returns to a role with no `SELECT` policy whether or not rows
exist, so these probes establish that the schema and key are correct. They do **not** establish that
any row has been written — that is what completing a task on the configured deployment and re-running
the step 5 query is for.

**Why steps 5 and 10 are not fully verified.** Browser automation cannot run in the environment where
this work was done: Chrome does not launch under the harness sandbox. The socket-directory failure
(`~/.agent-browser` is not writable) is worked around by pointing `HOME` at the workspace, but the
browser process still fails to start (`CDP response channel closed`), with and without
`--no-sandbox`. Steps that require a real browser are therefore recorded honestly rather than
reported as passing.

---

## What is verified locally, and how to re-run it

```bash
cd edge-aui-framework
npm run build:ci          # steps 2 + 3: clean-clone build and asset inventory gate
npm test                  # includes tests/deployed_acceptance.test.ts (steps 1, 5–10)
```

`tests/deployed_acceptance.test.ts` runs the **real** `AdaptiveRuntime` with the **real** INT8 ONNX
graphs against a synthetic DOM, and asserts:

- the asset inventory properties (step 3);
- both ONNX graphs load and the learned head — not the mock — serves inference (steps 5–7);
- a real DOM interaction sequence produces telemetry, windows, predictions and policy decisions
  (steps 6, 8);
- the resulting trace is canonical 1.3.0 on a single epoch clock, with window bounds on the same
  timeline as events (step 10);
- no prediction lacks a policy verdict, and every applied episode is attributable and terminal;
- the trace passes the project's own verifier;
- any adaptation visible in the DOM carries an episode id that matches an `applied` record.

It also writes a real exported capture to `docs/experiments/deploy-verification/`, which the
cross-repository ingestion contract test consumes.

---

## Manual steps that close the remaining gaps

### Step 4 — Deploy to Cloudflare Pages

Follow [`cloudflare-pages-setup.md`](./cloudflare-pages-setup.md). Build command `npm run build:ci`,
deploy command `npx wrangler deploy`. The build log must end with `[check-deploy-assets] OK`.

Confirm the deployed origin:

```bash
curl -sI https://<your-worker-host>/ | grep -i cross-origin
# expect: cross-origin-opener-policy: same-origin
#         cross-origin-embedder-policy: require-corp
```

> **Why this matters more than it looks.** The Vite dev server sets those two headers itself, so
> the threaded ONNX Runtime build works locally without `public/_headers`. In the deployed origin
> the headers come only from `_headers`. If they are missing, the runtime loads but fails to
> construct a session and the Slow Gate silently degrades to the mock — a "works locally, degrades
> in production" failure that no local test can catch.

### Steps 5, 9, 10 — Verify in a real browser

On a machine with a browser:

1. Open `https://<your-worker-host>/?auiDiagnostics=1`.
2. Expand the debug panel with the ⚡ toggle (labelled **Open Edge-AUI Development Debug Panel**),
   whose header now reads **Pipeline Inspector**. Confirm:
   - **Model:** `loaded [wasm]` — not `not loaded`, not `[webgpu]`;
   - **Slow Gate Mode:** `onnx`.
   If either is wrong, the learned head is not running and every subsequent observation is about
   the mock, not the model.
3. Start a task from the **Experimental Trial** controls and complete it.
4. Watch **Decision State**. It must move through one of the named states —
   `NO PREDICTION`, `FAST MATCH`, `SLOW GATE`, `BELOW THRESHOLD`, `POLICY ACCEPTED`,
   `POLICY REJECTED`, `ACTUATED`, `EXPIRED`, `ACTUATION FAILED` — and **Policy Reason** must be
   non-empty. A blank state is itself a defect.
5. If an intervention actuates, the adapted element carries
   `data-aui-active-adaptation` and `data-aui-adaptation-episode`. Check in DevTools:
   ```js
   document.querySelectorAll('[data-aui-active-adaptation]')
   ```
6. Trigger **Export Trace (JSON)** and confirm the file reports `schemaVersion: "1.3.0"`,
   `metadata.clock: "epoch_ms"`, `metadata.provenance: "scripted"`, and a non-empty
   `policyDecisions` array.
7. Note that an intervention **may legitimately not occur**: the policy requires a confidence
   threshold, UI-context eligibility and consecutive-window persistence, and a short session may
   not satisfy all three. The recorded policy decision states which gate refused. "No visible
   intervention" is only a failure if the decision record cannot explain it.

Record, for the run:

```
application version   docs/... -> metadata.applicationVersion
model version         metadata.modelVersion
execution provider    metadata.executionProvider
trace version         metadata.schemaVersion (1.3.0)
task version          metadata.uiVersion
policy version        metadata.policyVersion
session id            session.sessionId
condition             session.conditionId
browser / OS
screenshot(s)
```

### Step 10 — Verify Supabase persistence

Follow [`supabase-setup.md`](./supabase-setup.md), then:

```sql
select session_id, provenance, condition_id, status, created_at
from public.research_sessions order by created_at desc limit 5;

select session_id,
       jsonb_array_length(trace -> 'policyDecisions') as policy_decisions,
       jsonb_array_length(trace -> 'predictions')     as predictions
from public.research_traces order by inserted_at desc limit 5;
```

The panel's **Collection** row reports the outcome: `uploaded`, `failed` (with the reason),
`local_only` (not configured, or provenance refused), or `pending`.

Then export and ingest:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/export-traces.mjs --out ./.data/collected

cd ../model-preparation
python3 -m src.data --ingest-traces <export-dir>
```

---

## Cross-repository contract check (verified)

This is the one part of the sequence that has been exercised end to end across both repositories,
because it needs no browser and no hosted service:

```
real runtime capture (accepted by tests/deployed_acceptance.test.ts)
        ↓
docs/experiments/deploy-verification/*.json
        ↓
model-preparation: ingest_trace_directory(...)
        ↓
canonical Parquet
```

Observed result: **41 canonical events ingested, 0 unattributed windows, `provenance: "scripted"`.**

Re-run it:

```bash
cd edge-aui-framework
rm -f docs/experiments/deploy-verification/*.json
npx vitest run tests/deployed_acceptance.test.ts -t "writes a runtime-produced trace"

cd ../model-preparation
.venv/bin/python -c "
from src.trace_ingestion import ingest_trace_directory
print(ingest_trace_directory('../edge-aui-framework/docs/experiments/deploy-verification', force=True))
"
```

This check found a real, blocking defect: the ingestion pipeline overflowed on the first genuine
1.3.0 capture. See "Defects found while verifying" in the deployment record.

---

## Reported blocker (not worked around)

**Browser automation is unavailable in the implementation environment.** Chrome does not launch
under the harness sandbox. This is reported rather than worked around, because the alternative —
asserting browser-level behaviour from a headless approximation — is precisely the evidence failure
this milestone exists to remove. The headless acceptance test covers everything reachable without a
browser and marks the rest as unverified.
