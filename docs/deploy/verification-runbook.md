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
| 3 | Asset inventory | **VERIFIED** | `npm run check:deploy-assets` → 20 files, 14.17 MiB total, largest 12.86 MiB, no JSEP asset |
| 4 | Cloudflare Pages deployment | **NOT VERIFIED** | No Cloudflare account or project exists. Manual steps below. |
| 5 | Browser loads model + WASM | **PARTIAL** | Real graphs load and serve inference headlessly (`modelLoaded: true`, provider `wasm`). Loading from a deployed origin is **NOT VERIFIED**. |
| 6 | Real sequence + context inference | **VERIFIED** | 41 behaviour events → 11 MicroTensor windows → 2 predictions on a real capture |
| 7 | `TargetInterventionHead` executes | **VERIFIED** | `slowGateMode: 'onnx'`, `modelLoaded: true`, non-mock provider |
| 8 | Policy decision recorded | **VERIFIED** | 2 predictions, 2 policy decisions, every prediction attributed a verdict |
| 9 | Visible intervention | **PARTIAL** | The DOM↔trace correlation is asserted; in the recorded run the policy legitimately did not actuate (0 interventions), so a visible adaptation was not observed |
| 10 | Persistent research trace | **PARTIAL** | A canonical 1.3.0 trace is produced, verifier-clean, and ingests into `model-preparation`. Upload to a live Supabase project is **NOT VERIFIED**. |

**Why steps 4, 5 and 10 are not verified.** Neither Supabase nor Cloudflare Pages existed when this
milestone was implemented. Additionally, browser automation cannot run in the environment where the
work was done: Chrome does not launch under the harness sandbox (`~/.agent-browser` is not writable
and the browser process fails to start). Steps that require a live deployed origin or a live
database are therefore recorded honestly rather than reported as passing.

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
