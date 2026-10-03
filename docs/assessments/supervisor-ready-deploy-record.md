# Supervisor-Ready Deployment — Implementation Record

- **Milestone:** v0.1 research testbed deployment (`docs/plan/2/supervisor-ready-deploy.md`)
- **Date:** 2026-10-02
- **Repositories changed:** `edge-aui-framework` (74 files), `model-preparation` (8 files)
- **Basis:** [`target-testbed-quality-assessment-2-findings.md`](./target-testbed-quality-assessment-2-findings.md) (F-01 … F-27)
- **Verification status:** see [`docs/deploy/verification-runbook.md`](../deploy/verification-runbook.md). Four acceptance steps are **NOT VERIFIED** and are stated as such below.

---

## 1. Implemented

### Trace trustworthiness (F-01, F-07, F-18, F-05, F-03)

| File | What it now does |
|---|---|
| `src/telemetry/normalizer.ts` | Added `getWallClockTimestamp()`: the canonical trace clock. Anchors `performance.now()` to the session epoch so records are durable *and* monotonic within a session. |
| `src/telemetry/traceSchema.ts` | Schema **1.3.0**. Added `policyDecisions`, `predictionId`, `evaluatedWindowIds`, `provenance`, `clock`, `applicationVersion`, `modelVersion`, `executionProvider`, `policyVersion`, `mining`, `evictions`, `integrityWarnings`. Legacy 1.2.0/1.1.0 remain readable. Added the shared `findOrphanedWindows` definition. |
| `src/telemetry/events.ts` | New `PolicyDecisionEvent` and `PolicyRejectionCategory`. `InterventionEvent` gained `predictionId` and a typed `reason`. One clock documented per record. |
| `src/telemetry/recorder.ts` | 8th buffer for policy decisions; per-buffer eviction accounting with `EvictionCounters`; integrity warnings computed at export; model/provider provenance; window bounds written through unchanged. |
| `src/runtime/adaptiveRuntime.ts` | `recordPolicyDecision()` on **every** path (no prediction, rejected, baseline decision-only, actuation failure, actuated). Explicit evaluated-window capture. Episode opened *before* the accepted record. TTL attached. Worker mining counters merged. Actuator drained before unsubscription. |
| `src/intervention/policy.ts` | `PolicyDecision` gained `rejectionCategory`, `cooldownRemainingMs`, `ttlMs`. TTL applied at the single point every accepted command passes through. |
| `src/intervention/actuator.ts` | `apply()` returns whether an element was adapted. Every adaptation type stamps `data-aui-active-adaptation` **and** `data-aui-adaptation-episode`. TTL expiry emits `reverted` with `reason: 'ttl'`. |
| `src/telemetry/session.ts` | `provenance` (defaults `scripted`) and nullable `participantId`. Epoch anchor established at session start; `restoreSession` for recovery. |
| `src/testbed/tasks/taskManager.ts` | Task timestamps moved to the canonical clock. |
| `src/telemetry/traceAttributionVerifier.ts` | 6 → 12 checks: canonical clock, policy-decision recording, episode→prediction attribution, provenance, export integrity warnings. Legacy versions are reported, not failed. |

### Fast Gate and macro symbols (F-02, F-06)

| File | What it now does |
|---|---|
| `src/gates/fast/prefixSpanFastGate.ts` | Bounds: `maxCorpusSequences` (40), `maxPatternLength` (4), `maxPatterns` (32), `miningTimeoutMs` (1500). Every evaluation reports `executed` / `no_corpus` / `timed_out` / `failed`. |
| `src/macro/symbols.ts` | `NAV_*` requires a deliberate navigation act (the `route` fallback no longer fires on incidental pointer traffic). `OPEN_FILTERS`/`CLOSE_FILTERS` derived from observed `aria-expanded`; an unclassifiable accordion click yields **no** symbol rather than a wrong one. |
| `src/telemetry/observer.ts` | Captures post-action `aria-expanded` so open/close is observed, not guessed. |
| `src/runtime/worker/core.ts`, `messages.ts` | Bounds flow from config through `INIT`; worker mining outcome counters returned in `diagnostics`. |
| `src/runtime/workerClient.ts` | Configurable RPC timeout, validated `>= miningTimeoutMs`. |
| `src/config/runtimeConfig.ts` | Fast Gate bounds and `rpcTimeoutMs`; validation rejecting non-positive bounds and inverted timeouts. |

### Observability (F-08, F-22, F-21)

| File | What it now does |
|---|---|
| `src/debug/DebugPanel.tsx` | Renders an explicit `policyState` vocabulary plus window id, prediction id, matched gate, mapping source, confidence, policy reason, cooldown, candidate count, episode id, TTL, model version, provider, mining counters, eviction count and collection state. Stable always-present toggle. Reachable in production via `?auiDiagnostics=1` / `VITE_AUI_DIAGNOSTICS=1`. Inactivity windows labelled. |
| `src/debug/debugBus.ts` | `LiveDebugMetrics` extended for all of the above. |
| `src/runtime/diagnostics.ts` | Stopped clobbering `latestMacroSequence`; added mining/eviction/collection accessors. |
| `src/runtime/boot.ts` | Re-points the diagnostics handle on condition switch; owns research collection across condition changes. |

### Persistence and collection (F-16)

| File | What it now does |
|---|---|
| `src/config/supabaseConfig.ts` | Reads `VITE_SUPABASE_URL` / `_ANON_KEY` / `VITE_AUI_COLLECTION_MODE`. A malformed URL or unknown mode degrades to the safe configuration. `mayUploadProvenance()` is the egress decision point. |
| `src/telemetry/localStore.ts` | IndexedDB write-ahead: one snapshot per session, replaced on flush. Session state machine (`in_progress` → `completed` → `uploaded` / `upload_failed`; `incomplete`). Injectable backend so it is testable and degrades without throwing. |
| `src/telemetry/collectionClient.ts` | Thin `fetch` client, INSERT-only, idempotent via `upload_token` + `Prefer: resolution=ignore-duplicates`. No SDK dependency. |
| `src/telemetry/collection.ts` | Ordering (session then trace), provenance gating, visible failure with retry count, explicit retry, incomplete-session detection. |
| `src/telemetry/version.ts` | Application/policy version constants so provenance metadata is not a literal typed into a report. |
| `supabase/migrations/0001–0003` | Two tables, RLS policies, researcher export view. |
| `scripts/export-traces.mjs` | Service-role export to one JSON file per session plus a manifest, warning about truncated traces. |

### Deployment (F-14, F-25, F-26, F-27)

| File | What it now does |
|---|---|
| `src/gates/slow/onnxSlowGate.ts` | Loads `onnxruntime-web/wasm` (WASM-only) and defaults to providers `['wasm','cpu']`. |
| `scripts/check-deploy-assets.mjs` | **New gate**, wired into `build:ci`: fails on any asset ≥ 25 MiB, any JSEP binary, a missing WASM-only ORT binary, missing COOP/COEP headers, or missing model/vectoriser assets. |
| `scripts/check-wasm-pkg.mjs`, `scripts/normalize-wasm-pkg.mjs` | Fail loudly when the compiled WASM package is incomplete; keep wasm-pack from re-ignoring it. |
| `public/_headers` | COOP/COEP plus cache policy for the deployed origin. |
| `package.json` | `build:ci` (clean-clone, no Rust) and `check:deploy-assets`. |
| `.gitignore` | Commits the WASM package (a build input); ignores `.env` and `.env.*` (previously **not** ignored). |
| `docs/deploy/` | `README`, `supabase-setup`, `cloudflare-pages-setup`, `verification-runbook`. |
| `README.md`, `docs/architecture.md`, `AGENTS.md`, `docs/integration.md` | Claims corrected: egress model, local persistence, WASM provider, deployed head topology, payload budget, historical implementation record. The integration guide was regenerated against the real `UiAdapter`/`UIContext` members, `data-aui-role` annotations, actual CSS class names and current config values — its example did not compile and it linked a non-existent ADR (F-25). `condition-comparison.md` is marked superseded because its artifacts are hand-authored fixtures (F-12). |
| `tests/documentation_consistency.test.ts` | **New machine check** for the failure class the audit found unguarded: relative links resolve, `ADR-NNN` references name existing records, ADR filenames follow the convention, the integration guide names real interface members and CSS classes, and no current document claims a superseded trace schema version. `docs/assessments/` and `docs/plan/` are explicitly excluded as historical records — the audit quotes the broken names *because* they were broken. |

### Model-preparation

| File | What it now does |
|---|---|
| `src/trace_ingestion.py` | `TRACE_KEY_ALLOWLIST` / `BEHAVIOUR_EVENT_KEY_ALLOWLIST` keyed by version; accepts 1.3.0 (`policyDecisions`, `ariaExpanded`, provenance). **Replaced the silent skip** with `UnsupportedTraceSchemaError` (`.skipped` report) and `strict=True` by default. |
| `src/data.py` | `provenance` column on the canonical event schema; `--ingest-traces` reports skipped files and exits non-zero; `--allow-unsupported-trace-versions` for explicit lenient mode. |
| `src/data_manager.py` | Trace-schema fallback 1.1.0 → 1.3.0 (preprocessing versions deliberately unchanged). |
| `src/intervention_label_policy.py` | Docstring corrected to match the code (`> 0.5`); **comparison unchanged**, so labels are unaffected. |
| `tests/test_trace_ingestion.py` | 1.3.0 acceptance, loud failure, invalid-provenance rejection, lenient mode, real-directory classification, and the epoch-overflow regression test. |

---

## 2. Deployment

```
GitHub ──► Cloudflare Pages ──► React testbed (dist/)
   │
   └────► Supabase ──► research traces
```

| Setting | Value |
|---|---|
| Build command | `npm run build:ci` = `check:wasm-pkg && tsc && vite build && check:deploy-assets` |
| Output directory | `dist` |
| Deployment branch | `main` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUI_COLLECTION_MODE`, `VITE_AUI_DIAGNOSTICS` — **all optional** |

A build with no environment variables set is supported: it records locally, exports from the panel,
and reports `collection: local_only`.

### Two blockers found and resolved

**1. The build was not reproducible from a clean checkout.** `wasm-vectorizer/pkg/` was gitignored
while `src/gates/fast/prefixSpanMiner.ts` imported it, so only a machine that had already run a Rust
build could compile. The package (~140 KB) is now committed, with `check:wasm-pkg` failing loudly if
it is missing.

**2. A single asset exceeded Cloudflare Pages' 25 MiB per-file limit.** The build emitted
`ort-wasm-simd-threaded.jsep-*.wasm` at **26,827,543 bytes** — 160 KiB over, which rejects the whole
deployment. Requesting the WebGPU execution provider is what loads it.

| | Before | After |
|---|---|---|
| ONNX Runtime WASM asset | 26,827,543 B (JSEP) | 13,479,978 B (`ort-wasm-simd-threaded`) |
| Total `dist/` | ≈28.8 MB | **14,856,477 B (14.17 MiB)** |
| Largest asset | 25.6 MiB — **rejected** | **12.86 MiB — accepted** |
| JSEP asset emitted | Yes | No |

This is a runtime/packaging change only ([ADR-016](../decisions/ADR-016-cloudflare-pages-deployment.md)).
Model architecture, weights, head, policy and trace contract are unchanged. It **does** change the
reported `executionProvider` to `wasm`, which invalidates earlier WebGPU latency figures — those
must be relabelled, not reused.

Verified from a **clean checkout** (983 files, no `node_modules`, no Rust toolchain):

```
[check-wasm-pkg] OK — 5 files present; wasm_vectorizer_bg.wasm is 114009 bytes.
tsc --noEmit          → clean
vite build            → built in 1.26s
[check-deploy-assets] OK — 20 files, 14.17 MiB total, largest 12.86 MiB, ORT WASM binary present
```

---

## 3. Research trace

### Flow

```
DOM event → BehaviourEvent (epoch ms)
    ├─ RollingWindowBuffer → MicroTensorWindow (windowStart/End on the same clock)
    ├─ OutcomeDeriver      → OutcomeEvent
    └─ MacroInteractionStream → symbol
                 ↓
        worker: SequenceBuilder (T=8) → dual gate → TargetInterventionHead
                 ↓
        PredictionEvent (predictionId, evaluatedWindowIds, windowId)
                 ↓
        PolicyDecisionEvent (verdict + reason, always written)
                 ↓
        InterventionEvent (episodeId + predictionId; applied → terminal)
                 ↓
        ExperimentTrace 1.3.0 ──► IndexedDB write-ahead ──► Supabase (provenance-gated)
```

### Schema 1.3.0 — the four changes that make the record usable

1. **One clock.** Every `timestamp` is epoch milliseconds via `getWallClockTimestamp()`;
   `metadata.clock = 'epoch_ms'`. Schema 1.2.0 mixed `performance.now()` and `Date.now()` in one
   array, so `reconstructReplayStream` placed 8 600+ behaviour events before every decision and task
   duration was underivable (F-01).
2. **Policy decisions.** One `PolicyDecisionEvent` per evaluation, including refusals with a
   `rejectionCategory`, the baseline decision-only branch, and the absence of a candidate. A
   pre-1.3.0 baseline trace recorded 7 predictions and 0 interventions, making "did it decide but not
   apply?" unanswerable (F-07).
3. **Explicit attribution.** `predictionId`, `evaluatedWindowIds`, `interventionEpisodeId` and the
   DOM attributes `data-aui-active-adaptation` + `data-aui-adaptation-episode` form a complete,
   verifiable chain from prediction to visible effect (F-18, F-05).
4. **Provenance and version identity.** `provenance` (`scripted` default), `applicationVersion`,
   `modelVersion`, `executionProvider`, `policyVersion` (F-19, ADR-018).

### Verified trace content

From a runtime-produced capture (`docs/experiments/deploy-verification/`):

```
41 behaviour events · 11 MicroTensor windows · 40/41 events inside a window bound
2 predictions · 2 policy decisions · 0 unattributed windows
schemaVersion 1.3.0 · clock epoch_ms · provenance scripted · provider wasm
```

---

## 4. Persistence

**Collection.** On session completion the trace is written locally, then — only if a Supabase URL and
anon key are configured **and** the provenance gate permits — the session row and the trace are
inserted. Session first, trace second, so a partial failure leaves a session whose trace is missing
rather than an orphaned trace.

**Idempotency without SELECT.** The anon role has `INSERT` and no `SELECT`, so an `upsert` is
impossible. A client-generated `upload_token` plus `ON CONFLICT DO NOTHING` makes a retry a no-op.

**Failure is visible and retryable.** `CollectionState` is one of `not_configured`, `pending`,
`uploading`, `uploaded`, `failed`, `local_only`, shown in the research panel. A failure records the
attempt count and the error; `retryPendingUploads()` retries explicitly and stops at the first
failure so a systematic problem is not retried once per queued session.

**Recovery.** A session found still `in_progress` on the next load is marked `incomplete` and is
never presented or uploaded as a finished capture. Recovery is reported, not automatic: silently
resuming would merge two page loads into one record and call it complete.

**Truncation is no longer silent.** Every FIFO eviction is counted per buffer. A truncated trace
carries `metadata.evictions.truncated = true` and an integrity warning naming the affected buffers,
and `export-traces.mjs` warns when any exported trace is truncated.

**Retrieval and export.**

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/export-traces.mjs --out ./.data/collected
cd ../model-preparation && python3 -m src.data --ingest-traces <dir>
```

The service-role key is required and must never reach a browser bundle, `.env.local`, or a Pages
variable. The read-back limitation is documented rather than resolved by granting `anon` a `SELECT`
([`supabase-setup.md`](../deploy/supabase-setup.md)).

---

## 5. Model / runtime

**The learned `TargetInterventionHead` is used in the deployed runtime.** Verified by a headless
acceptance test that drives the real `AdaptiveRuntime` with the real INT8 graphs:

```
slowGateMode: 'onnx'      (not the deterministic mock)
modelLoaded: true
executionProvider: wasm   (the provider that actually served inference)
```

Both `public/models/model_int8.onnx` and `public/models/intervention_head_int8.onnx` load and serve
inference. The deployed ONNX input topology is documented correctly as

```
sequence(batch, seq, 18) + context(batch, 6) → intervention_logits(batch, 5)
```

with the encoder reduction and context concatenation happening **inside** the exported graph
(`head.fc.0.weight` is `[64, 70]`), replacing the earlier `h_T ⊕ R⁶` description of the conceptual
training architecture that was never the deployed interface (F-24).

**Model provenance is now recorded from what the runtime reports**, not from a hardcoded literal
(F-19), so two different exported graphs can no longer be recorded under one name.

---

## 6. Intervention observability

A researcher can determine `prediction → policy → intervention → visible UI effect` from two
inspectable surfaces.

**Live, in the research panel** (`?auiDiagnostics=1`): an explicit decision state from a closed
vocabulary —

```
NO PREDICTION | FAST MATCH | SLOW GATE | BELOW THRESHOLD
POLICY ACCEPTED | POLICY ACCEPTED (BASELINE — NOT APPLIED)
POLICY REJECTED | ACTUATED | EXPIRED | DISMISSED | ACTUATION FAILED
```

— alongside the current window id, prediction id, matched gate, mapping source, confidence,
**policy reason**, cooldown remaining, candidate persistence count, active episode id, adaptation TTL,
model version, execution provider, mining counters, eviction count and collection state. No console
reading is required.

**Post hoc, in the trace.** Every prediction has a policy verdict with a non-empty reason and a
`rejectionCategory`; every applied episode carries an `interventionEpisodeId` and a `predictionId`;
every episode termination is typed (`ttl`, `user_dismissal`, `session_end`, `reset`, `replaced`).

**Bidirectionally verifiable.** Every adaptation type stamps both DOM attributes, and the acceptance
test asserts on a real capture that a visible adaptation's episode id matches an `applied` record —
and that every applied episode is either still visible or terminated. This is what F-05 and F-03 were
about: previously only `highlight_primary_action` set any attribute, and no adaptation ever expired.

An intervention **may legitimately not occur**: the policy requires a confidence threshold,
context eligibility and consecutive-window persistence. In the recorded run it did not actuate, and
the policy decision states why. The shortfall is recorded as `PARTIAL` for step 9 in the runbook
rather than presented as success.

---

## 7. Task measurement

| Metric | Status |
|---|---|
| Task identity | `taskId`, `taskStepId` on every task event |
| Task start / step / complete / error / reset / abandon | Recorded, each with a canonical-clock timestamp |
| Task duration | `durationMs` on `task_complete`, derived on the canonical clock, reproducible from the trace alone |
| Condition and session | On every task event |
| Attempt identity | **Not implemented** — a reset discards the attempt (F-15) |
| State-based success predicate | **Not implemented** — a step is satisfied by component-id + action matching (F-15) |
| Explicit failure state | **Not implemented** — no `Failed` status (F-15) |
| Timeouts | `experiment.taskTimeoutsMs` remains declared and unused (F-15) |

The brief (§15) asks only that "existing tasks can produce reliable research measurements" and that
task completion be tied to "an explicit task-state condition rather than an accidental UI state".
Completion is driven by the task manager's own state machine and is recorded as `task_complete` with
a duration, so the *measurement* is reliable and honestly labelled. What is **not** implemented is a
state-based success predicate — and that is a methodology decision, not an oversight. It is carried
forward as a question for the supervisor rather than guessed at, because "task success" must be
defined before it can be measured.

---

## 8. Verification

### Evidence produced

| Evidence | Result |
|---|---|
| `npx tsc --noEmit` (edge) | clean |
| `npx vitest run` (edge) | **51 files, 380 tests, 0 failures** (baseline: 47 files / 336 tests / 1 pre-existing failure) |
| `python -m pytest tests` (model-preparation) | **121 passed, 0 failed** (before this work: 115 passed) |
| `npm run build:ci` from a **clean checkout** | **PASS** — `check:wasm-pkg` OK, `tsc` clean, `vite build` OK, asset gate OK |
| Asset inventory gate | **PASS** — 20 files, 14,856,477 B total, largest 12.86 MiB, no JSEP asset |
| Headless acceptance test with real ONNX graphs | **PASS** — learned head served inference; trace verified clean |
| Cross-repository ingestion of a real 1.3.0 capture | **PASS** — 41 canonical events, 0 unattributed windows, `provenance: scripted` |
| Deployment acceptance steps 4, 5 (deployed origin), 10 (live upload) | **NOT VERIFIED** — no Cloudflare project, no Supabase project, and no browser available in the implementation environment |

The previously failing test (`macro_fast_gate_wiring.test.ts`, a timing-dependent assertion) is green.

### Test suites added

`tests/deployed_acceptance.test.ts` (9), `tests/collection_persistence.test.ts` (17),
`tests/fast_gate_bounds.test.ts` (8), `tests/documentation_consistency.test.ts` (7), plus new cases
in the macro-symbol, verifier, recorder, mapping-attribution, debug-panel and ADR-register suites.

### Defects found *while* verifying — the part worth reading

The milestone's stated purpose was to stop asserting properties that were never measured. Measuring
found four real defects that no amount of reading had exposed:

**1. The ingestion pipeline overflowed on the first genuine 1.3.0 capture.**
`trace_ingestion.py` correlated an event to a window with `wstart <= ts <= wend` and, on a miss,
fell back to `int(ts_ms // 250)`. That arithmetic assumed a short monotonic timestamp. Against epoch
milliseconds it produced a window id in the billions, and `pa.Table.from_pylist` raised
`ArrowInvalid: Value 7164181643 too large to fit in C integer type` — **aborting ingestion of an
otherwise valid trace**. Every synthetic Python fixture passed, because they all used small
timestamps. This is precisely the F-09/F-13 class of failure: the contract looked satisfied and was
not. Fixed by removing the arithmetic fallback in favour of the latest closing window, plus a
regression test that reproduces the original `ArrowInvalid` when the fix is reverted.

**2. Window bounds were on a different timeline from events — a bug I introduced.**
Moving the window grid to the canonical epoch clock meant window bounds were already epoch
milliseconds; `exportSerializable()` *also* applied a session epoch offset, double-counting it and
placing windows at ~3.58e12 against events at ~1.79e12. The trace still looked populated, and the
cross-repository check is what exposed it (0 of 41 events fell inside any window bound). Fixed by
writing window bounds through unchanged, and the acceptance test now asserts that events fall inside
window bounds and that windows do not overlap out of order.

**3. The orphaned-window check rejected every healthy capture.**
`window_outcome_completeness` counted any window without an outcome as a failure. Outcomes settle
lazily, so a live session legitimately has ~13 windows in flight at any instant — meaning the verifier
could only ever pass on hand-authored fixtures, which is exactly how the audit found it behaving on
real traces (F-13). Fixed by defining "orphaned" once, in `findOrphanedWindows`, as a window that has
outlived its whole settlement allowance (`lookahead + grace + tolerance`), shared by the recorder's
integrity warnings and the verifier so the two cannot disagree.

**4. The built HEAD-to-episode linkage was broken.**
`beginEpisode()` ran *after* the accepted record was written, so `issued`/`accepted` carried the
previous episode id while `applied` carried the new one — issued↔applied linkage never matched.
Found by reading the flow while writing the episode-attribution check.

Each of these was found by *running* the path, not by reviewing it. That is the argument for the
acceptance harness existing at all.

---

## 9. Deferred

Explicitly **not** built, with the reason and the condition to revisit. Full records in
ADR-015 … ADR-023.

**Research-methodology decisions awaiting the supervisor**

| Item | Why deferred |
|---|---|
| Task list, state-based success predicate, `Failed` status, attempt identity, task timeouts | "Task success" must be defined before it can be measured (F-15) |
| Which side owns outcome labels (trace `outcomes` vs re-derivation) | Both paths exist; reconciling them changes training labels |
| Fast Gate pattern semantics (the miner is a non-standard PrefixSpan variant) | Changing it changes what a "match" means and therefore the results (F-02) |
| Adapting the intervention visual strength | Needs a participant-facing judgement, not an engineering one (audit K-6) |
| The teacher-policy boundary at `taskProgress == 0.5` | Observable for exactly one case (T2 step 2), which routes to `expand_tooltip`; the code is unchanged and the docstring now matches it |

**Engineering work deferred**

| Item | Why deferred | Condition to revisit |
|---|---|---|
| `maxNodes` bound inside the Rust miner | Requires a WASM interface change and a re-measurement; the corpus cap bounds the cost in practice | Measured `timedOut`/`superseded` counts large enough to bias a trace |
| WebGPU reintroduction and ORT payload reduction | Supervisor's explicit instruction: defer until after feedback | Deployed WASM latency proves unusable, or participant distribution becomes a requirement |
| `policy.sustainedConfidenceDurationMs`, `maxInterventionsPerTask`, `conflictResolution` | Each changes intervention rate, i.e. the experimental condition | A study design states a requirement |
| Participant consent, withdrawal, identifier scheme, retention policy | Brief scope boundary; egress gate prevents participant data by construction | An approved protocol |
| In-app trace browsing, automated deletion | Needs authentication or weakened RLS, or a retention statement | A requirement or an institutional instruction |
| Cross-browser certification, counterbalancing, statistics | Brief scope boundary | A study design |
| Windows search-collected task-success metrics | Depends on the success-predicate decision above | Same |

**Known unmet target**

The 500 KB combined client payload target (ADR-008) is **not met**: the ONNX Runtime WASM binary
alone is 13,479,978 B. The `dist/` total is 14.17 MiB. This is a tracked deferment, not an oversight,
and no performance claim in the repository should be read as meeting that budget.

---

## 10. Supervisor review questions

1. **Task set.** T1–T3 all begin with the same navigation step and end on the same apply action, and
   none *requires* hesitation, dwell, rapid scrolling or backtracking — so the behavioural patterns
   the model is meant to detect depend on incidental behaviour. Should the task set be redesigned to
   exercise them deliberately, and is an explicit no-intervention negative-control task worth adding?

2. **Behavioural patterns.** The Fast Gate's miner is a non-standard PrefixSpan variant and its
   matches depend on the macro-symbol derivation, which this work corrected but which still reflects
   our instrumentation choices rather than validated semantics. What should "the Fast Gate recognised
   a known pattern" be allowed to mean in the thesis?

3. **Intervention design.** An 8 000 ms TTL is now applied; is that the right visibility window for a
   participant, and should adaptations instead persist until the next qualifying action? The current
   visual treatment is deliberately minimal — how visible must an intervention be to be evaluable
   without becoming the experiment?

4. **UX metrics.** Task completion rate and duration are now reliably measurable, but task success is
   still structural (the required controls were touched in order) rather than state-based (the
   required result was produced). What should count as task success, and which UX metrics do you want
   collected?

5. **Baseline/adaptive study design.** The condition is currently switched manually in-session, which
   destroys in-flight work and makes order an uncontrolled variable. Should the condition be fixed per
   session (e.g. by URL), and does the design need counterbalancing?

6. **Participant-study requirements.** What will the protocol require: a participant identifier
   linking sessions, a retention period, a consent and withdrawal flow, and what does that imply for
   the local IndexedDB store as well as Supabase?

7. **Acceptable use of synthetic intervention supervision.** The intervention model's supervision
   remains synthetic — scripted sessions generated by a deterministic policy, explicitly **not**
   participant ground truth. What claims may the thesis make about a system whose supervision signal
   will never have been a human judgement?

8. **Any changes required before participant recruitment.** Given that collection currently refuses
   participant provenance by construction and the retention policy is undecided, what must be true
   before the first participant session — and is there anything in the current deployment that should
   change first?

---

## Appendix — the stopping condition, assessed honestly

> The deployed testbed reliably runs the current research workflow, visibly demonstrates the adaptive
> system, persistently records usable traces, and provides enough evidence for the supervisor to give
> concrete direction for the final research/study phase.

| Clause | Assessment |
|---|---|
| Runs the current research workflow | **Yes, verified** in the production build and in Node with the real graphs. A hosted Cloudflare Pages origin is unverified. |
| Visibly demonstrates the adaptive system | **Yes** — the panel renders the decision state and the DOM carries an episode id matching the trace. A visible actuation was not observed in the recorded run because the policy did not actuate; the record explains why. |
| Persistently records usable traces | **Yes** — canonical 1.3.0 traces, locally durable, verifier-clean, and accepted by `model-preparation` end to end. Live Supabase upload is unverified. |
| Enough evidence for concrete direction | **Yes** — the four defects found while verifying, and the eight questions above, are the concrete direction. |

The three `NOT VERIFIED` items are unverified because the services and the browser do not exist in
this environment. They are listed with the exact manual steps that close them, rather than being
reported as passing.
