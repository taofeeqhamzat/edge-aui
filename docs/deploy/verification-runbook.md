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
| 5 | Browser loads model + WASM | **VERIFIED** | Observed **in a browser on the deployed origin** (`https://edge-aui.hamzattao.workers.dev/?auiDiagnostics=1`, headless Chrome 154 over the DevTools Protocol): the panel reports `Model: loaded [wasm]`, `Model Version: TargetInterventionHead-v1.0.0-int8`, `Slow Gate Mode: onnx`. The ONNX Runtime session constructs on the deployed origin, so `_headers` isolation is working in practice and not merely present. |
| 6 | Real sequence + context inference | **VERIFIED** | 41 behaviour events → 11 MicroTensor windows → 2 predictions on a real capture. Also observed live: completing T1 on the deployed origin produced MicroTensor windows, worker transfer timings and a Slow Gate verdict (`NO_OUTCOME (conf: 0.48)`). |
| 7 | `TargetInterventionHead` executes | **VERIFIED** | `slowGateMode: 'onnx'`, `modelLoaded: true`, non-mock provider — including on the deployed origin (step 5) |
| 8 | Policy decision recorded | **VERIFIED** | 2 predictions, 2 policy decisions, every prediction attributed a verdict |
| 9 | Visible intervention | **PARTIAL** | The DOM↔trace correlation is asserted; in the recorded run the policy legitimately did not actuate (0 interventions), so a visible adaptation was not observed |
| 10 | Persistent research trace | **PARTIAL** | A canonical 1.3.0 trace is produced, verifier-clean, and ingests into `model-preparation`. The upload now runs on trial completion, and the deployed origin was observed issuing the correct request — but **no row has been observed in the live store**, and the export has not been read back. See "Where step 10 stands" below. |

### Where step 10 stands (verified 2026-10-04)

Every link in the chain has been observed except the committed row itself. Each item below is a
measurement, not an expectation.

**The deployed origin performs the write correctly.** Completing T1 in a browser on the deployed
origin, with `window.fetch` wrapped before application code ran and Supabase calls short-circuited
so that nothing was stored, captured exactly one request:

```
POST https://bfntyqahujplvcowjdmh.supabase.co/rest/v1/research_sessions
headers: Content-Type, apikey, Authorization, Prefer        ← apikey present, value sb_publishable…
body:    session_id, upload_token, experiment_id, condition_id: "adaptive",
         provenance: "scripted", task_id: "T1", trace_schema_version: "1.3.0",
         status: "Completed", metadata.clock: "epoch_ms", metadata.evictions.truncated: false
```

The task reached `Completed`; the panel read `Model: loaded [wasm]`, `Slow Gate Mode: onnx`.

**The store accepts that shape — once the client stops sending one header.** The read-only and
rejected probes against the live project:

| Probe | Result | What it establishes |
|---|---|---|
| `GET /rest/v1/research_sessions?select=session_id&limit=1` with the anon key | `200 []` | Table exists (migrations applied) and the anon key is valid |
| `GET /rest/v1/research_traces?select=session_id&limit=1` | `200 []` | As above |
| `GET /rest/v1/research_export?select=session_id&limit=1` | `401 42501 permission denied for view research_export` | The export view is correctly revoked from `anon` (migration 0003) |
| `OPTIONS` preflight as the browser sends it | `200` with `access-control-allow-headers: apikey,authorization,content-type,prefer` | The browser's preflight passes; CORS is not an obstacle |
| `POST research_sessions`, policy-satisfying row with `condition_id: 'NOT_VALID'`, `Prefer: return=minimal` | `400 23514` check-constraint violation | The row **passed** RLS and reached the constraint, so the INSERT policy applies. Nothing was written. |
| The same row with `Prefer: resolution=ignore-duplicates,return=minimal` | `401 42501 new row violates row-level security policy` | The preference, not the policy, is the obstacle |
| `POST research_traces`, policy-satisfying row with a non-existent parent, `Prefer: return=minimal` | `409 23503` foreign-key violation | Again the row passed RLS; the FK aborts the insert |

**The defect this exposed, and its fix.** `Prefer: resolution=ignore-duplicates` is rendered by
PostgREST as `INSERT ... ON CONFLICT DO NOTHING`, and PostgreSQL applies the table's **`SELECT`**
policies while looking for a conflicting row. The `anon` role holds no `SELECT` grant here by
design, so that preference made every insert impossible — including a first insert with no conflict
— and the resulting `42501 new row violates row-level security policy` reads exactly like a broken
policy. The comment in `0002_rls_policies.sql` asserting that `ON CONFLICT DO NOTHING` is "a pure
insert" was wrong, and an earlier revision of the deployment notes repeated it. Both are corrected.

The client now sends `Prefer: return=minimal` and treats a `409` as success, which preserves
idempotency on a retry without needing the `SELECT` grant
([`src/telemetry/collectionClient.ts`](../../src/telemetry/collectionClient.ts)). `npm run
check:collection-policies` probes both shapes, so a header problem can never again be reported as a
policy problem.

The captured body satisfies every condition of the `WITH CHECK` (`provenance in ('scripted',
'participant')`, non-empty `session_id`, non-empty `upload_token`), which both tables' policies
require.

**What is still missing.** No row has been observed in the store, because writing one requires
completing a task against the live project, and reading it back requires the `service_role` key —
`anon` cannot `SELECT` by design. `[]` from the read probes is what an RLS-protected table returns
whether or not rows exist, so those probes say nothing about whether a trace has been written. To
close the step: complete a task on the deployed origin, then run the step 5 query and
[`supabase-setup.md` §6](./supabase-setup.md#6-export-collected-traces) with the service-role key.

**A reported error that does not match this path.** A `{"message":"No API key found in request"}`
response was reported from `https://<id>.supabase.co/rest/v1/research_sessions`. That message is
returned only when the `apikey` header is absent entirely — a present but wrong key answers
`Invalid API key`, and the deployed origin was measured sending the header. Whatever produced that
response, it was not the deployed testbed's upload path, and it is recorded here so the difference
is not lost.

### Earlier blocker (resolved 2026-10-04)

The first successful deployment served the application with **no Supabase configuration at all**:
the bundle contained the collection client (`grep -c research_sessions` on
`/assets/index-CJtcHgN2.js` returned 1) but zero occurrences of the project ref, because the
Worker's build trigger carried no `VITE_*` variables. It reported `collection: local_only` and would
have uploaded nothing.

**Resolved.** The variables were added to the production build trigger and a new build produced
`/assets/index-CDOUxPZ2.js`, which contains the project ref, the `sb_publishable_…` anon key and the
`scripted` mode. The deployed origin now reports `Collection: pending` and
`Collection Detail: scripted | uploads: 0` — a state only a configured build can reach, since an
unconfigured one reports `local_only` instead.

The lesson is kept as a check rather than a note: `npm run check:deploy-assets` now reports the
collection state it measures from the emitted JavaScript, so a build with no inlined Supabase
configuration prints `Collection:     NOT CONFIGURED — this build uploads no traces`. Absence is a
warning by default because the variables are optional; setting `REQUIRE_COLLECTION=1` on the trigger
turns it into a build failure. See
[`scripts/check-deploy-assets.mjs`](../../scripts/check-deploy-assets.mjs) and
[`tests/check_deploy_assets_collection.test.ts`](../../tests/check_deploy_assets_collection.test.ts).

**Browser verification is possible after all — with a caveat worth recording.** The earlier
conclusion that "Chrome does not launch under the harness sandbox" was too broad. `agent-browser`
cannot attach (`CDP response channel closed`, with and without `--no-sandbox`), and the default
`--headless=new` invocation hangs. But Chrome itself launches with `--headless`, a
workspace-scoped `HOME`/`TMPDIR`, and a workspace `--user-data-dir`, and the DevTools Protocol can
be driven directly. Everything recorded above about the deployed origin was measured that way.
Steps 5 is therefore verified; step 10 remains partial only because the write itself has not been
observed committing a row.

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
