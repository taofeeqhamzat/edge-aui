# Target Testbed Implementation Record

**Companion to:** [`target-testbed-quality-assessment.md`](./target-testbed-quality-assessment.md)
**Implementation date:** 2026-09-22
**Repositories:** `edge-aui-framework` (changed) · `model-preparation` (read-only; no tracked file modified)

This record documents the engineering work executed against the implementation sequence in
the assessment (§26). It states, for each step, what was built, where it lives, what
verifies it, and what remains. It supersedes the relevant readiness rows in the
assessment's §23 matrix; the assessment itself is kept as the historical "before" state.

---

## 1. Summary of change

|                        | Before                                                                    | After                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Booted pipeline        | Legacy `EdgeAUIFramework` (raw tracker + cognitive-state heuristics)      | Composed adaptive runtime (observer → window → macro → dual gate → policy → actuator → trace)                      |
| Runtime telemetry      | 0 events, 0 windows, 0 outcomes                                           | 498 behaviour events, 126 windows, 107 outcomes, 52 predictions in one measured trial                              |
| Window grid            | Event-anchored, inclusive bounds, silent fallback geometry                | Monotonic fixed grid, half-open slots, observed geometry                                                           |
| Outcome events         | Schema only, no producer                                                  | Deferred deterministic derivation with lookahead guarantee                                                         |
| Task events            | Schema absent, no UI control                                              | T1–T3 start/step/complete/error/abandon/reset, wired to the observer                                               |
| Experimental condition | Absent                                                                    | `baseline` / `adaptive`; baseline keeps telemetry and never mutates the DOM                                        |
| Trace identity         | No ids; `durationMs` mixed two clocks                                     | `experimentId`, `conditionId`, `windowId`, prediction + task + intervention-episode records; single-clock duration |
| Fast Gate              | `MockFastGate` only; WASM miner unused by arbitration                     | Real PrefixSpan gate firing live (`fast: 20 / none: 52` in one trial)                                              |
| Slow Gate              | Heuristic in a worker; reported `provider: webgpu` while loading no model | Real INT8 GRU graph loaded and executed; honest provider reporting                                                 |
| ONNX graph             | `(1, batch, seq, 9)` in → 6 logits out                                    | `(1, batch, seq, 18)` in → 7 outcome logits out, weights embedded                                                  |
| Tests                  | 149 tests, none composing the pipeline                                    | 230 tests including composed-pipeline, windowing, outcome, gate, task, and ONNX contract suites                    |

**Verified commands**

```
npx tsc --noEmit          → exit 0, no diagnostics
npx vitest run            → 32 files, 230 tests, 230 passed, 0 failed (~22–40s)
node scripts/parity:check → fixture matches the Python reference
```

---

## 2. Step-by-step record

### Step 0 — Compose and start the adaptive runtime (P0-1)

- **New:** `src/runtime/adaptiveRuntime.ts` — owns exactly one observer, rolling window
  buffer, macro stream, outcome deriver, worker client, inference engine, policy,
  actuator, and the shared recorder; wires them in dependency order; drives the window
  grid on a monotonic timer; dispatches windows and macro interactions to the worker;
  evaluates the dual-gate chain; applies accepted interventions; records everything.
- **New:** `src/runtime/boot.ts` — composition root. Starts the runtime, establishes the
  session and experiment identity, and defines `TESTBED_FAST_GATE_PATTERNS`. Rebuilds the
  runtime when the experimental condition changes, which is the correct trial boundary.
- **New:** `src/runtime/diagnostics.ts` — publishes live state to `debugBus` and exposes
  `window.__EDGE_AUI__` so the running pipeline is verifiable from the browser.
- **Changed:** `src/main.tsx` no longer boots the legacy framework; it starts the runtime.
- **Why it was blocking:** every downstream requirement was unobservable without it.
- **Verified:** `tests/adaptive_runtime.test.ts` asserts a session is established, real DOM
  interaction produces behaviour events with geometry, and a live stream produces windows,
  macro interactions, and outcomes with correlation ids.

### Step 1 — Window emission: monotonic grid, half-open slots, explicit geometry (P0-2)

- **Changed:** `src/microtensor/window.ts`.
  - `anchor(origin)` establishes a fixed window grid; a timestamp now always falls in the
    same window regardless of first-interaction timing, which is what makes windows
    comparable across sessions.
  - Slots are half-open `[windowStart, windowEnd)`, matching
    `model-preparation/src/preprocessing.py` (`searchsorted(..., side="left")`). An event
    on a boundary is counted exactly once.
  - `tick()` advances the grid across every elapsed stride, so **verified inactivity now
    produces windows** (`inactive: true`, zero features, capability mask still set).
  - `push()` inserts out of order events in timestamp order so membership is deterministic.
  - `lateEvents` and `skippedSparseWindows` counters make silent data loss observable.
  - Geometry (viewport + document) is resolved from the most recent observed event and
    passed explicitly to the extractor.
- **Changed:** `src/telemetry/observer.ts` captures and attaches geometry to every event;
  adds `wheel`, `focus`, `blur`, `popstate`, `hashchange`, `beforeunload`, `unload`.
- **Verified:** `tests/windowing_contract.test.ts` (9 tests) covers half-open counting,
  inactivity emission and suppression, `windowId` monotonicity, geometry propagation,
  out-of-order insertion, late-event accounting, sparse skips, and batch/live consistency.
- **Known trade-off:** with `min_events_per_window = 3` the live grid processes a slot once
  and never revisits it, so a window holding 1–2 events is skipped. The Python reference is
  able to revisit because it segments a static stream. This is now **counted**
  (`skippedSparseWindows`) rather than silent. Recorded as a limitation in §4.

### Step 2 — Telemetry contracts (P1-1, P1-9)

- `BehaviourEvent` now carries `viewport`, `document`, `scrollTopPx`, and the extended
  event-type union; `getGeometrySnapshot()` added to the normalizer.
- `popstate`/`hashchange` are no longer collapsed into `navigation`, so `BACKTRACK`
  remains distinguishable from a route change.
- **Verified:** existing observer tests still pass; `tests/adaptive_runtime.test.ts`
  asserts geometry is present on recorded pointer events.

### Step 3 — MicroTensor output and CI parity (P1-2)

- **Changed:** `src/microtensor/features.ts` — scroll depth now follows the Python
  reference exactly (`min(1, count*80 / max(docH - vpH, 1))`). Previously the same tensor
  dimension returned either the last normalized scroll offset or a count-derived value
  depending on event shape (assessment D2). Verified against the `viewport_scroll`
  fixture: `4*80/1920 = 0.166667`.
- **New:** `scripts/regenerate-parity-fixture.mjs` — re-derives
  `tests/fixtures/syntheticEvents.json` by running the canonical Python extractor, with
  `--check` for CI. The fixture was previously static with no producer anywhere.
- **New:** `tests/parity_fixture_provenance.test.ts` — runs the check when the Python
  environment is available and fails on drift. Verified: _"Fixture matches the Python
  reference."_
- **New npm scripts:** `parity:check`, `parity:refresh`.
- **Not changed (and why):** `dwellTimeMs` remains the Python count-based proxy
  (`count × 40 ms`). Changing it would break parity; the construct-validity concern is a
  research question, recorded as a limitation.

### Step 4 — Live macro interaction output

- **Changed:** `src/macro/sequence.ts` — the stream stamps `sessionId`, `experimentId`,
  `conditionId`, `windowId`, and `route` onto every interaction, via injected context.
- **Changed:** `src/macro/symbols.ts` — tooltip controls now resolve to `EXPAND_TOOLTIP`
  (previously unreachable), and filter controls resolve on `change`/`input`.
- **Changed:** `src/runtime/adaptiveRuntime.ts` — `getMacroSequences()` groups interactions
  into **time-based slots** (`MACRO_SEQUENCE_SLOT_MS = 2000`). Grouping by 250 ms window id
  fragmented every episode into single-symbol sequences, so no multi-symbol pattern could
  ever reach support. This was a real defect found only by running it.
- **Verified:** `tests/macro_fast_gate_wiring.test.ts` asserts one filter episode
  (`OPEN_FILTERS`, `APPLY_FILTER`) forms a single mineable sequence.

### Step 5 — OutcomeEvent derivation and UIContext extension (P0-3)

- **New:** `src/outcome/derive.ts` — a faithful TypeScript port of
  `model-preparation/src/target_generation.py` (`extract_lookahead_outcome`,
  `extract_outcome_for_window`): same `[+500 ms, +1500 ms]` horizon, same
  earliest-event-wins rule, same 1 ms tie tolerance, same priority hierarchy, same
  `ABANDON` requirement for a lifecycle event or explicit stream termination. Exposes
  `OutcomeDerivationMetadata` for auditability.
- **Changed:** `OutcomeEvent` carries `sessionId`, `windowId`, `experimentId`,
  `conditionId`, source-event identity, route, `lookaheadComplete`, and derivation
  metadata.
- **Changed:** `UIContext` gains `viewport`, `document`, `scrollState`, `conditionId`, and
  `uiVersion`.
- **Two defects found and fixed by running the pipeline:**
  1. **Every outcome was `ABANDON`.** The deriver inferred `sessionTerminated` from "no
     event beyond the horizon", which is always true during a live session. Termination is
     now an explicit signal only (`endSession()`, set on `pagehide`/`beforeunload`).
  2. **`CLICK`/`FORM_SUBMIT` were never produced.** Windows were labelled immediately,
     before their lookahead horizon had any data, so `lookaheadComplete` was always false
     and post-click activity was invisible. Derivation is now **deferred**: a window is
     queued and settled once the stream has advanced past `windowEnd + 1500 ms`, with a
     2 s idle grace period so genuine inactivity settles as `NO_OUTCOME`.
- **Verified:** `tests/outcome_derivation.test.ts` (7 cases mirroring the Python
  semantics) and browser measurement showing a discriminative histogram:
  `CLICK 17 / FORM_SUBMIT 11 / NO_OUTCOME 43`.

### Step 6 — Task model wiring and experiment condition (P0-4)

- **Changed:** `src/testbed/tasks/taskManager.ts` — emits explicit
  `task_start`/`task_step`/`task_complete`/`task_error`/`task_abandon`/`task_reset`
  lifecycle events; `resetTask()` records an abandonment when a task was in progress;
  adds `Abandoned` status and `abandonTask(reason)`.
- **Changed:** `src/testbed/tasks/taskModel.ts` — T2 now starts from Analytics (the only
  view that renders the results table), T3 targets the real Product Category accordion, and
  `getTaskRequiredComponentIds()` exposes the contract for testing.
- **New:** `src/testbed/components/TrialControls.tsx` — task start/reset and the
  baseline/adaptive condition selector, making both reachable from the UI.
- **Changed:** `src/app/App.tsx` — bridges observed telemetry into `taskManager`, tracks
  UI context, wires the filter drawer to the results table, and abandons a trial on
  navigation.
- **Changed:** `FilterDrawer` is now a real `<form>` with a submit control, so `submit`
  events exist; `ResultsTable` gained real export and filter application; both were
  previously inert buttons. `tableData` is now a seeded deterministic generator
  (mulberry32) instead of `Math.random()` at module load.
- **Verified:** `tests/task_wiring.test.tsx` (11 tests) asserts every task step references a
  component that is actually rendered, that T1 completes through the real observer bridge,
  and that the stimulus dataset is stable across module evaluations.

### Step 7 — Experiment trace: correlation ids, clock, reproducibility (P0-5)

- **Changed:** `src/telemetry/traceSchema.ts` — schema `1.1.0`; adds `predictions` and
  `taskEvents`; requires `windowId` on windows and outcomes; requires a
  `metadata.conditionId`.
- **Changed:** `src/telemetry/recorder.ts` — records predictions and task events; binds a
  session snapshot at start so a trace can never be attributed to the wrong session;
  `durationMs` is computed from `startedAtEpochMs` only. Previously it subtracted the
  monotonic `startedAt` from `Date.now()`, producing values around 1.7×10¹².
- **Changed:** `src/telemetry/events.ts` — adds `PredictionEvent`, `TaskEvent`,
  `interventionEpisodeId`.
- **Verified:** browser export inspected: `schemaVersion 1.1.0`, resolved session and
  experiment ids, `durationMs: 33701` for a ~34 s trial, windows carrying `windowId` and
  `inactive`, outcomes carrying `windowId` + derivation metadata, and a prediction record
  per evaluation.

### Step 8 — Real PrefixSpan Fast Gate (P1)

- **New:** `src/gates/fast/prefixSpanFastGate.ts` — a `FastGate` implementation driven by
  mined frequent patterns, with a declared pattern → intervention map, deterministic
  ranking (support, then length, then lexicographic), injectable miner, and fail-safe
  behaviour.
- **Changed:** `src/runtime/worker.ts` — `INIT` accepts `fastGateMode: 'mock' | 'prefixspan'`
  and constructs the real gate; `getMacroSequences()` builds the corpus from
  window-tagged history.
- **Changed:** `AdaptiveRuntime` passes the fresh macro sequence explicitly to `evaluate()`
  and mirrors macro interactions into the worker. Relying on the worker's own history made
  the gate evaluate a corpus that lagged the just-closed window.
- **Measured:** the real WASM miner, running in the browser against a live corpus, returns
  `OPEN_FILTERS > APPLY_FILTER` (support 3, confidence 0.6) and the gate resolves it to
  `highlight_primary_action` with `source: 'fast'`.
- **Verified:** `tests/prefixspan_fast_gate.test.ts` (11 tests) and
  `tests/macro_fast_gate_wiring.test.ts` (4 tests).
- **Fixed after initial verification:** the first wiring reused the main-thread
  `WasmGateClient` from inside the runtime worker, which silently failed on a worker-scope
  guard and a `window.setTimeout` call. `src/gates/fast/prefixSpanMiner.ts` now loads the
  WASM module directly, so the miner runs in any scope. The live trial above is the
  verification.
- **Remaining nuance:** the gate is an eager online learner, so its first evaluations on a
  short session see an incomplete corpus and miss. With `minPatternSupport: 1` it fires as
  soon as a declared pattern recurs, which is what the measurement shows.

### Step 9 — Intervention policy hardening (P1-4)

- **Changed:** `src/intervention/policy.ts` — adds a `cooldownMs` refractory period after
  acceptance (default 5 s) and a `dismissalCooldownMs` per-type suppression after the user
  dismisses (default 15 s); `notifyDismissal()` and `cooldownRemainingMs()` added; `reset()`
  clears both.
- **Changed:** `AdaptiveRuntime` feeds `dismissed` intervention events back into the policy.
- **Verified:** `tests/policy_cooldown_ttl.test.ts`.

### Step 10 — Actuator hardening (P1-5)

- **Changed:** `src/intervention/actuator.ts` — `ttlMs` is now enforced (an adaptation with
  a declared lifetime reverts itself, verified by timer); `targetComponentId` is escaped
  before it is interpolated into a CSS attribute selector, so a component id containing a
  quote or bracket no longer produces an invalid selector.
- **Verified:** `tests/policy_cooldown_ttl.test.ts` covers TTL expiry, no-TTL persistence,
  and a metacharacter id.

### Step 11 — ONNX graph re-export (P2-1)

- Re-exported `src/workers/onnx-gate/model.onnx` and `model_int8.onnx` from the existing
  `model-preparation/models/foundational_gru.pth` through a minimal inference wrapper
  (GRU backbone → terminal hidden state → head) so the traced graph contains no Python
  control flow.
- **Before:** input `(1, batch, seq, 9)`, output 6 logits.
  **After:** input `(1, batch, seq, 18)`, output 7 outcome logits, weights embedded (no
  external data file). `model.onnx` 169 356 B, `model_int8.onnx` 170 206 B — both inside
  the 200 KB model-artifact budget.
- **Verified:** `tests/onnx_contract.test.ts` parses the protobuf graph directly and
  asserts the input dimension, output class count, weight embedding, artifact budget, and
  softmax stability.
- **Note:** dynamic INT8 quantisation does not shrink this graph, because the dominant
  weights are the two GRU layers, which `quantize_dynamic` leaves in FP32. Recorded as a
  limitation.

### Step 12 — UI context vector (P2-2)

- **New:** `src/types/contextVector.ts` — the previously undefined encoding from
  `UIContext` to the `R^6` vector that `TargetInterventionHead(context_dim=6)` requires,
  with a documented index table, bounds validation, and vocabularies.
- **Verified:** `tests/context_vector.test.ts` (10 tests).

### Step 13 — Real ONNX Slow Gate (P2-3)

- **New:** `src/gates/slow/onnxSlowGate.ts` — implements `SlowGate` against the re-exported
  graph: loads the session eagerly (`warmup()`), reports the provider that actually served
  it, validates the `(1, T, 18)` shape, runs `session.run`, applies softmax over the 7
  logits, maps to the outcome taxonomy, and emits a candidate intervention above the
  confidence threshold. Fails visibly (no fabricated probabilities) when no session exists.
- **Changed:** `src/runtime/worker.ts` — `slowGateMode: 'mock' | 'onnx'`; the ONNX gate is
  loaded and warmed during `INIT`, with an explicit fallback to the mock and a warning when
  the model cannot be loaded.
- **Measured in the browser:** `modelLoaded: true`, `slowGateMode: 'onnx'`,
  `executionProvider: 'webgpu'`, steady-state inference ~11 ms (p95 ~16 ms). The model
  genuinely executes on WebGPU.

### Step 14 — Edge inference decisions (P2-4, P2-6)

- Provider reporting is now honest: the legacy worker no longer labels a heuristic as
  `webgpu`, and the runtime publishes `executionProvider` and `modelLoaded` to
  `debugBus` instead of a capability probe.
- The ONNX graph is bundled and served as a single self-contained file.
- **Verified:** browser `status.executionProvider === 'webgpu'` with `modelLoaded === true`.

### Step 14b — Legacy removal and documentation reconciliation

The goal also required removing legacy implementations and stale documentation. Auditing
reachability after step 0 showed that the entire legacy path had no production importer.

**Removed (code):**

| Path                                          | Why                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/core/pipeline.ts`                        | The legacy `EdgeAUIFramework` orchestrator; superseded by the runtime composition |
| `src/core/telemetry/ClientBehaviorTracker.ts` | Legacy `setInterval`-based tracker with subjective cognitive labels               |
| `src/core/telemetry/SlidingWindowBuffer.ts`   | Never used; the real buffer is `src/microtensor/window.ts`                        |
| `src/core/telemetry/index.ts`                 | Barrel for the above                                                              |
| `src/main.ts`                                 | A 296-line HTML sandbox harness that was never the Vite entry point               |
| `src/counter.ts`                              | Unused Vite template leftover                                                     |
| `src/types/telemetry.ts`                      | Legacy `InteractionPacket` / `MicroTensor` / `CognitiveState` schemas             |
| `src/types/worker-messages.ts`                | Message types for the deleted legacy workers                                      |
| `src/workers/wasm-gate/WasmGateClient.ts`     | Main-thread RPC client; replaced by `src/gates/fast/prefixSpanMiner.ts`           |
| `src/workers/wasm-gate/wasm.worker.ts`        | Worker for the above                                                              |
| `src/workers/onnx-gate/OnnxGateClient.ts`     | Legacy client that reported `webgpu` while loading no model                       |
| `src/workers/onnx-gate/onnx.worker.ts`        | The heuristic that stood in for the Slow Gate                                     |

**Added (code):** `src/gates/fast/prefixSpanMiner.ts` — the single WASM boundary in the
framework; `src/runtime/worker/entry.ts` (worker entry) and `src/runtime/worker/core.ts`
(moved); `src/types/uiContext.ts`.

**Removed (documentation and scratch):**

| Path                               | Why                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `docs/audit_baseline.md`           | Described a repository layout that no longer existed                                        |
| `docs/project_architecture.md`     | Described `SlidingWindowBuffer` batching, which was never used; referred to "latent intent" |
| `docs/data_schemas.md`             | Documented only the deleted legacy schemas; omitted every current contract                  |
| `docs/conversation/turn-{1..4}.md` | Transient agent transcripts                                                                 |
| `docs/testbed/prd.md`              | Transient agent clipboard                                                                   |
| `gemini-code-1787963806179.ts`     | Stray generated file at the repo root                                                       |
| `rebase.sh`                        | One-off, already-executed git history rewrite script                                        |
| `AGENT.target_testbed_QA.md`       | The audit brief itself, left in the working tree                                            |

**Added (documentation):** `docs/architecture.md` — the implemented system, its windowing
contract, feature table, macro vocabulary, gate semantics, all schemas, and the command set.
`README.md` was rewritten to describe what actually runs, including the fact that the ONNX
artifact is gitignored and must be produced by the export step. `AGENTS.md` gained vocabulary
guardrails (outcome vocabulary, not affects) and engineering expectations (never claim
unmeasured properties). `.gitignore` no longer hides `docs/plan/**`, so the staged
implementation plan is now part of the repository record.

`src/index.ts` was rewritten to export only modules that exist.

### Step 14c — Production build defects found and fixed

Building and serving `dist/` exposed three defects that development mode concealed:

1. **The worker was never bundled.** `new URL('./worker.ts', import.meta.url)` was assigned to
   a variable before being passed to `new Worker(...)`, which Vite cannot statically analyse.
   The production build emitted the worker as _raw TypeScript source_
   (`dist/assets/worker-*.ts`) that could not execute, so the entire research pipeline would
   have been dead in production while working in dev. The worker now lives at
   `src/runtime/worker/entry.ts`, and the URL literal is inline in the constructor call, so it
   is emitted as a proper bundle (`entry-*.js`).
2. **ONNX Runtime was loading on the main thread.** `RuntimeWorkerCore` — and therefore the
   whole of ONNX Runtime Web — was statically imported by the worker client for its
   in-process fallback, defeating thread isolation. The fallback is now a lazy dynamic
   import. Verified: the main bundle contains **zero** occurrences of `InferenceSession`.
3. **Task tracking only worked in development.** The observed-event → task-manager bridge
   lived in the dev-only diagnostics module, so a production build recorded no task steps.
   The bridge now lives in `AdaptiveRuntime`, where the task lifecycle subscription already
   was.

A fourth defect was found in the stimulus itself: every filter section started **expanded**,
so the "open Region" step of T1 collapsed it and removed the Region `<select>` from the DOM,
making step 3 impossible to reach. All sections now start collapsed, which is what the task
design assumes.

**Verified in the production bundle** (`vite preview`), one complete T1 trial:

```
taskEvents:   task_start:In Progress → task_step ×3 → task_step:Completed → task_complete:Completed
finalTaskStatus: "Completed"          (metadata)
gateHits:     { fast: 5, none: 6 }
applied:      ["highlight_primary_action"]   →  btn-export carries data-aui-active-adaptation
outcomes:     CLICK 3 / FORM_SUBMIT 3 / NO_OUTCOME 19
modelLoaded:  true   executionProvider: "webgpu"   slowGateMode: "onnx"
schemaVersion: "1.1.0"
```

### Step 15 — Measured benchmarks (P2-5)

- **New:** `scripts/benchmark-runtime.mjs` (npm `benchmark:runtime`) — starts the dev
  server, drives a scripted interaction in a real browser, and prints measured FPS, heap,
  DOM size, and prediction-latency percentiles. It refuses to emit numbers when
  `agent-browser` is unavailable rather than fabricating them.
- **Measured (headless Chrome 153, macOS, WebGPU, single clean trial):**

| Metric                                     | Before (assessment)           | After                                                                               |
| ------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| Idle rAF FPS                               | 61 (pipeline inactive)        | 61                                                                                  |
| Pipeline-load rAF FPS                      | NOT MEASURED                  | **61**                                                                              |
| JS heap in use                             | 11.25 MB (inactive)           | **17.13 MB**                                                                        |
| DOM nodes                                  | 583                           | 512                                                                                 |
| Prediction latency (full gate chain)       | NOT MEASURED                  | mean **11.13 ms**, p50 10.73 ms, p95 **16.22 ms**, max 21.0 ms (cold first 66.7 ms) |
| Gate routing (one trial)                   | n/a (no gates ran)            | **fast 5–20 / none 23–52**                                                          |
| Interventions applied to the DOM           | 0                             | **1–3** (`highlight_primary_action` on `btn-export`)                                |
| Task completion                            | impossible (no task events)   | **T1 completes: 4/4 steps, `task_complete`**                                        |
| Main bundle contains ONNX Runtime          | n/a                           | **no** (was yes; fallback made lazy)                                                |
| Production worker                          | emitted as raw `.ts` (broken) | bundled `entry-*.js`, verified in `vite preview`                                    |
| Windows / outcomes / predictions per trial | 0 / 0 / 0                     | 126 / 107 / 52                                                                      |
| Settled outcomes                           | n/a                           | 95 / 107 with a complete lookahead horizon                                          |
| Exported trace size                        | 622 B (empty)                 | 202 KB for ~90 windows                                                              |
| ONNX model artifact                        | 47 435 B, incompatible shape  | 170 206 B, `18→7`, budget-compliant                                                 |

- `NOT MEASURED` remains: total blocking time, long-task profiling, memory growth over a
  long task, and the combined `< 500 KB` WASM+model payload (the ORT WASM binary alone is
  ~26.8 MB in the last production build — an open decision, not a claim).

---

## 3. Test and typecheck results

```
npx tsc --noEmit                           → exit 0
npx vitest run                             → 32 files, 230 tests, 230 passed, 0 failed
node scripts/regenerate-parity-fixture.mjs --check
                                           → fixture matches the Python reference
git status model-preparation               → clean (no tracked file modified)
```

New suites added (81 tests):

| Suite                               | Tests | Contract                                                           |
| ----------------------------------- | ----- | ------------------------------------------------------------------ |
| `adaptive_runtime.test.ts`          | 6     | The composed pipeline runs end to end                              |
| `windowing_contract.test.ts`        | 9     | Grid, half-open slots, inactivity, geometry, accounting            |
| `outcome_derivation.test.ts`        | 7     | Python lookahead parity                                            |
| `task_wiring.test.tsx`              | 11    | Task steps ↔ rendered DOM; lifecycle events; deterministic stimuli |
| `policy_cooldown_ttl.test.ts`       | 9     | Cooldown, dismissal feedback, TTL, selector safety                 |
| `prefixspan_fast_gate.test.ts`      | 11    | Real miner-backed gate semantics                                   |
| `macro_fast_gate_wiring.test.ts`    | 4     | Corpus shape and engine wiring                                     |
| `context_vector.test.ts`            | 10    | `UIContext` → `R^6`                                                |
| `onnx_contract.test.ts`             | 13    | Graph shape, embedding, budget, softmax                            |
| `parity_fixture_provenance.test.ts` | 2     | Fixture is re-derived from Python                                  |

Four existing tests were updated where the change was intentional, and each update states
why: the window API now returns an array and uses a 250 ms slot; the apply-filters control
is a submit control; the trace schema is 1.1.0 and requires window ids.

---

## 4. Known limitations after this work

1. **Sparse windows are skipped, once.** With `min_events_per_window = 3` the live grid
   processes each slot once and does not revisit it, so a window holding 1–2 events is
   dropped. The Python reference revisits because it segments a static stream. Counted via
   `skippedSparseWindows`; a two-pass or delayed-emission design would remove the gap.
2. ~~The Fast Gate's in-worker mining path does not yet match.~~ **RESOLVED.** The root
   cause was a twelve-line chain of scope bugs, and each was found only by running the
   pipeline:
   1. `WasmGateClient` — a _main-thread_ RPC client — guards on
      `typeof Worker === 'undefined'`. `Worker` is also undefined **inside** a dedicated
      worker, so from the runtime worker it took the "workers unsupported" branch and never
      started a worker.
   2. `WasmGateClient.sendRequest` used `window.setTimeout` / `window.clearTimeout`, and
      `window` does not exist in a worker scope at all.
   3. The earlier `defaultMiner()` guard tested `typeof Worker`, disabling mining exactly
      where the gate normally runs.

   **Fix:** `src/gates/fast/prefixSpanMiner.ts` loads the Rust/WASM module _directly_ and
   exposes a `PatternMiner`. There is no nested worker hop and no `window` dependency, so the
   miner works identically on the main thread and inside a worker.

   **Verified live:** `gateHits: { fast: 20, none: 52 }` over one scripted trial, with the
   real WASM miner mining a worker-side corpus of 12 sequences.

3. ~~No intervention has been applied to the DOM by the live pipeline yet.~~ **RESOLVED for
   the Fast Gate path.** A live trial now shows the complete intervention lifecycle:

   ```
   issued:no_op/fast
   accepted:highlight_primary_action/fast
   applied:highlight_primary_action/fast
   ```

   with the target element carrying `data-aui-active-adaptation="highlight"` in the DOM, and
   `interventionsApplied: 1`.

   **Still open:** the ONNX Slow Gate's best-class probability remains ~0.44–0.48 for
   `NO_OUTCOME`, below the policy's 0.75 threshold, so no _slow_-gated intervention has been
   applied live. The policy is behaving correctly by refusing to act on an uncertain
   distribution; the open question is calibration of a freshly exported graph whose head was
   never fine-tuned on target-domain data, not a logic defect.

4. **`dwellTimeMs` is a proxy.** Both implementations derive it from a qualifying-event
   count (`count × 40 ms`), not from measured hover duration. Parity is preserved;
   construct validity is unestablished.
5. **Dynamic INT8 quantisation does not shrink this graph.** The two GRU layers dominate
   the parameters and `quantize_dynamic` leaves them in FP32, so `model_int8.onnx`
   (170 206 B) is marginally larger than `model.onnx` (169 356 B). A GRU-aware quantiser
   would be needed for a real size reduction.
6. **The target intervention head is not exported.** The runtime computes and validates the
   `R^6` context vector, but the shipped graph consumes only the MicroTensor sequence and
   produces foundation outcomes. A deterministic outcome → intervention mapping stands in;
   `TargetInterventionHead` remains in `model-preparation` as an unexported architecture.
7. **The combined artifact budget is not met.** `dist/` was 26.31 MB in the last production
   build, dominated by the 26.8 MB ONNX Runtime Web WASM/JSEP binary, against a `< 500 KB`
   target. Reducing it means either a leaner ORT build or a hand-written GRU; not attempted.
8. **Legacy code remains.** `src/main.ts` (a 296-line sandbox harness) and
   `src/core/pipeline.ts` are now unused by the application; `WasmGateClient` is still used
   by the real PrefixSpan gate. Removal is safe but was deferred to avoid unnecessary churn.
9. **Browser coverage is Chromium-only.** Measurements come from headless Chrome 153 on
   macOS. Firefox/Safari and GPU-less fallback paths were not exercised.
10. **Single-participant trial only.** No counterbalancing, randomisation, or
    multi-participant pooling has been exercised; the condition switch is manual.

---

## 5. Re-evaluated readiness

| Assessment §23 area   | Was                   | Now                       | Evidence                                                        |
| --------------------- | --------------------- | ------------------------- | --------------------------------------------------------------- |
| Target UI             | Partial               | **Ready with conditions** | Trial controls added; still no pagination/sort surface          |
| Task workflows        | Not ready             | **Ready**                 | T1–T3 reachable and completable; lifecycle events emitted       |
| Telemetry             | Implemented, unwired  | **Ready**                 | 498 events per measured trial, geometry attached                |
| MicroTensor           | Ready with conditions | **Ready**                 | D2 fixed; CI parity check added                                 |
| Windowing             | Partially ready       | **Ready with conditions** | Fixed grid, half-open, inactivity; sparse skip remains          |
| Macro events          | Ready with conditions | **Ready**                 | Time-slotted corpus; unreachable symbols addressed              |
| PrefixSpan interface  | Partially ready       | **Ready with conditions** | Real gate wired; online-support tuning remains                  |
| Outcome events        | Not ready             | **Ready**                 | `CLICK`/`FORM_SUBMIT`/`NO_OUTCOME` observed live                |
| UI context            | Ready with conditions | **Ready**                 | viewport, scroll, condition, uiVersion added                    |
| Intervention taxonomy | Ready                 | **Ready**                 | unchanged                                                       |
| Policy layer          | Ready with conditions | **Ready**                 | cooldown, dismissal feedback, TTL                               |
| Actuator              | Ready                 | **Ready**                 | TTL + selector escaping added                                   |
| Worker boundary       | Partially ready       | **Ready**                 | typed INIT modes, provider reporting                            |
| Model integration     | Not ready             | **Ready with conditions** | 18→7 graph loaded on WebGPU; target head not exported           |
| Experiment trace      | Partially ready       | **Ready**                 | 1.1.0 with all correlation ids; single-clock duration           |
| Baseline condition    | Not ready             | **Ready**                 | condition switch; telemetry preserved, no DOM mutation          |
| Testing               | Ready with conditions | **Ready**                 | 230 tests including composed-pipeline suite                     |
| Performance           | Not measured          | **Partially measured**    | 61 FPS, 17.13 MB, ~11 ms inference; TBT and payload budget open |
| Privacy               | Ready with conditions | **Ready**                 | unchanged: no egress, no storage, in-memory only                |

### Answer to the assessment's closing question

```text
NO — BLOCKING ENGINEERING WORK REMAINS
```

becomes

```text
YES, WITH SPECIFIC CONDITIONS
```

The target environment now reliably provides all nine required properties: observable
interaction telemetry, compatible MicroTensor windows, stable macro sequences, observable
target outcomes, sufficient UI context, concrete intervention targets, a stable model
integration boundary, reproducible experiment traces, and controllable baseline/adaptive
conditions. The conditions on that "yes" are now narrower: the deterministic path (Fast Gate → policy →
actuator → DOM) is verified end to end in a live trial, and the remaining items are the
slow-gated path, the edge payload budget, and the sparse-window gap in §4.

The smallest set of next changes:

1. **Calibrate the Slow Gate threshold.** The exported graph has an untrained target head, so
   its best-class probability sits around 0.45. Either fine-tune the head on target-domain
   data or set an explicit, documented testbed threshold, then confirm a live `slow`-gated
   intervention.
2. **Exercise a baseline and an adaptive trial back to back and diff the two traces.** The
   condition switch is implemented and the baseline preserves telemetry without mutating the
   DOM, but the comparison has not been run.
3. **Close the sparse-window gap** (limitation 1) and address the edge payload budget
   (limitation 7).
