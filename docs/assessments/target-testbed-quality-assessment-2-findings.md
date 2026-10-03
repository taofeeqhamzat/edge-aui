# Target Testbed Quality Assessment II — Implementation Correctness & Gap Audit

- **Assessment date:** 2026-10-01
- **Assessed revision:** `edge-aui-framework` @ `67a242a2f0d7c17e44e388390fb9847d77e0f4b7` (branch `feat/target-ui-client-integration`)
- **Integration counterpart:** `model-preparation` (read-only; no tracked file modified)
- **Brief:** [`target-testbed-quality-assessment-2.md`](./target-testbed-quality-assessment-2.md)
- **Assessment type:** Read-only, evidence-driven implementation audit
- **Deliverable scope:** This document. No production source, test, or configuration file was modified. Browser-driver and verifier scripts were written to `/tmp` only.

Evidence labels (brief §21):

| Label | Meaning |
|---|---|
| `VERIFIED` | Directly observed in executing code, a real runtime session, or a trace |
| `PARTIALLY VERIFIED` | Observed for part of the claim; the rest is untested or environment-specific |
| `INFERRED` | Reasoned from indirect evidence |
| `UNVERIFIED` | Asserted but not checked |
| `NOT IMPLEMENTED` | Actively searched for and absent |
| `NOT MEASURED` | A measurable property this audit did not measure |
| `DEFERRED` | Explicitly deferred by a decision record |

Method and evidence base:

| Evidence source | What it establishes |
|---|---|
| Full read of `src/` (63 files) and `tests/` (47 files ≈ 9 105 LOC) | Implementation reality, symbols, line numbers |
| `npx vitest run` | 47 files / 336 tests / 336 passed (24.4 s) |
| Headless Chrome 154 (CDP, `/tmp/aui-live-audit.mjs`, `/tmp/aui-baseline-check.mjs`) against `vite` dev server on `:5177` | Real end-to-end runtime behaviour, DOM state, exported traces, worker timing |
| `traceAttributionVerifier` + `reconstructReplayStream` executed **in the browser** over four real/committed traces | Verifier behaviour on real data vs fixtures |
| ONNX graph introspection with `model-preparation/.venv` (onnx 1.22.0) | Shipped graph contracts, weight provenance |
| Static read of `scripts/*.mjs`, `docs/**`, ADRs | Benchmark and documentation claims |
| `git status` before/after | Confirms this audit mutated no tracked file |

---

## A. Executive Status

The framework is a **real, running, instrumented pipeline**, not a shell. Every stage the brief names (observer → window → MicroTensor → macro stream → worker → dual gate → policy → actuator → recorder) exists, is composed by `src/runtime/boot.ts`, starts in a browser, and produces populated traces. In a single 20 s trial this audit observed 75 behaviour events, 69 MicroTensor windows, 55 macro interactions, 59 outcomes, 5 predictions and 5 intervention records, with `modelLoaded: true` and `executionProvider: 'webgpu'` (`VERIFIED`).

Against the brief's status vocabulary, the honest state is:

| Area | Status | Evidence |
|---|---|---|
| Runtime composition and boot | **COMPLETE / VERIFIED** | Live session; `src/runtime/boot.ts`; `tests/adaptive_runtime.test.ts` |
| Telemetry capture | **COMPLETE / VERIFIED** (with defects) | 75 events with geometry in one trial |
| Windowing (fixed grid, half-open, delayed settlement, inactivity) | **COMPLETE / VERIFIED** | `window.ts:182-263`; live `inactive: true` windows |
| MicroTensor 18-D + Python parity | **COMPLETE / VERIFIED** | `tests/parity.test.ts`, `parity:check`, bit-exact feature-order/scale match |
| Macro stream | **PARTIALLY COMPLETE** | Emits, but symbol derivation produces dominant spurious symbols (F-06) |
| Fast Gate (WASM PrefixSpan) | **IMPLEMENTED, METHODOLOGICALLY QUESTIONABLE** | Live `matchedGate: 'fast'`; matches driven by repeated-symbol noise (F-06) and the miner is a non-standard variant (F-02) |
| Slow Gate (dual ONNX graph) | **COMPLETE / VERIFIED** | Both graphs load and run; contracts match training side exactly |
| Policy | **COMPLETE / VERIFIED** but **under-instrumented** | `policy.ts`; rejection reason never persisted (F-07) |
| Actuator | **COMPLETE / VERIFIED** | Live `edge-aui-simplified` class applied; baseline applied 0 |
| Experiment trace | **PARTIALLY COMPLETE** | Populated, but two incompatible clocks (F-01) |
| Persistence / collection | **NOT IMPLEMENTED** (deliberately) | No storage or network primitive anywhere in `src/` |
| Dataset preparation (edge → model-preparation) | **BLOCKED by contract drift** | `trace_ingestion.py` accepts only `1.1.0`; runtime emits `1.2.0` (F-09) |
| Baseline condition separation | **VERIFIED in DOM, PARTIALLY VERIFIED in trace** | Live: baseline applied 0 adaptations; trace alone cannot evidence "decided but not applied" (F-07) |
| Intervention observability | **GAP** | DebugPanel omits window id, confidence, mapping source, cooldown, rejection reason (F-07, F-08) |
| Task reassessment | **GAP** | No task lifecycle `fail`; step completion is component-id matching (F-15) |
| Performance claims | **PARTIALLY MEASURED / two fabricated** | 300 events and TBT = 0 ms are not measurements (F-14) |
| Documentation ↔ implementation consistency | **GAP** | Broken ADR links, documented topology ≠ deployed topology, stale numbers and requirements (F-12, F-14, F-24, F-25, F-27) |
| Participant deployment | **BLOCKED** | Per `participant-readiness.md` and confirmed here |

**Headline answer to the brief's final question (§23): NO — the system cannot be used today to collect research-participant telemetry and persist it for dataset preparation.** The blockers are enumerated in §L. The most important single blocker is not a missing feature: it is that **the trace this system produces cannot currently be consumed by the dataset pipeline that exists** (F-09), and that the trace's own internal timeline is not reconstructable (F-01).

---

## B. Actual Architecture

### B.1 Runtime entry points

| Concern | Actual entry point | Evidence |
|---|---|---|
| Browser entry | `index.html:11` → `/src/main.tsx` | `VERIFIED` |
| Composition root | `src/main.tsx:29` → `bootTestbed('adaptive')` → `src/runtime/boot.ts:60-122` | `VERIFIED` |
| Runtime owner | `src/runtime/adaptiveRuntime.ts:134` (`AdaptiveRuntime`) | `VERIFIED` |
| Worker entry | `new Worker(new URL('./worker/entry.ts', import.meta.url))` at `src/runtime/workerClient.ts:67` | `VERIFIED` |
| Worker core | `src/runtime/worker/core.ts:34` (`RuntimeWorkerCore`) | `VERIFIED` |
| Testbed UI | `src/app/App.tsx:16` (state-based page switch, no router) | `VERIFIED` |
| Task layer | `src/testbed/tasks/taskManager.ts:28`, `taskModel.ts:38` | `VERIFIED` |
| Diagnostics | `src/runtime/diagnostics.ts:60` → `window.__EDGE_AUI__` (dev or `?auiDiagnostics=1`) | `VERIFIED` |
| Debug panel | `src/debug/DebugPanel.tsx:40`, mounted at `App.tsx:61` | `VERIFIED` |

### B.2 Actual composition (observed, not documented)

```
[main thread]
DOM events ─► TelemetryObserver (src/telemetry/observer.ts:42)
      │  (capture:true, passive; every pointer/scroll/form/focus/lifecycle event;
      │   sampleIntervalMs default 0 = unthrottled)
      ├─► ExperimentRecorder.recordBehaviourEvent           (maxBufferSize 10 000, shift-on-overflow)
      ├─► RollingWindowBuffer.push                          (500 ms window / 250 ms stride grid,
      │        │                                             settlementDelayMs 250, minEventCount 3,
      │        └─ tick() on a 125 ms timer  ──► MicroTensorWindow (18-D, windowId)
      │                                              ├─► OutcomeDeriver (queued, settled after
      │                                              │     windowEnd+1500 ms or 2 s idle grace)
      │                                              ├─► ExperimentRecorder.recordMicroTensor
      │                                              └─► workerClient.pushWindow (transferable)
      ├─► MacroInteractionStream.recordFromBehaviourEvent
      │        └─► ExperimentRecorder.recordMacroInteraction  +  workerClient.pushMacro
      ├─► experimentRecorder.recordTaskEvent (via UiAdapter.onTaskLifecycle)
      └─► UiAdapter.recordInteraction (task step matching)

[worker thread — strictly serial message handling: entry.ts:19-22 awaits each request]
SequenceBuilder (T=8) ─► AdaptiveInferenceEngine.evaluate
     ├─ FastGate: PrefixSpanFastGate → WASM miner over time-slotted macro corpus
     └─ on miss: OnnxSlowGate.infer → 2× ONNX sessions (foundation 18→7, head 18+R⁶→5)
                 → softmax → candidate InterventionCommand

[main thread, back from EVALUATE]
InterventionPolicy.accept (confidence → cooldown → dismissal → context eligibility → persistence)
     ├─ reject → debugBus only (reason NOT persisted)
     └─ accept → if condition !== 'adaptive' → debugBus only (reason NOT persisted)
                 else beginEpisode() → UIActuator.apply → InterventionEvent → recorder
     → ExperimentRecorder.recordPrediction / recordIntervention
```

### B.3 Module inventory with observed status

| Layer | Module | Status | Evidence |
|---|---|---|---|
| Observer | `src/telemetry/observer.ts` | `VERIFIED` — `mouseover`/`mouseout`/`mousedown`/`mouseup`/`click`/`mousemove`/`scroll`/`wheel`/`input`/`change`/`submit`/`focusin`/`focusout`/`resize`/`popstate`/`hashchange`/`pagehide`/`beforeunload`/`unload` + custom `navigation` | `observer.ts:214-236` |
| Normalizer | `src/telemetry/normalizer.ts` | `VERIFIED` — `performance.now()` monotonic; geometry snapshot | `normalizer.ts:18-23, 101-119` |
| Session | `src/telemetry/session.ts` | `VERIFIED` — anonymous UUID, `startedAt` (monotonic) + `startedAtEpochMs` | `session.ts:59-75` |
| Recorder | `src/telemetry/recorder.ts` | `VERIFIED` — 7 buffers, 10 000/item caps, JSON export/download | `recorder.ts:66-89, 225-323` |
| Trace schema | `src/telemetry/traceSchema.ts` | `VERIFIED` — 1.2.0 (+1.1.0 accepted), structural validator, replay stream | `traceSchema.ts:31-32, 86-203, 229-253` |
| Verifier | `src/telemetry/traceAttributionVerifier.ts` | `VERIFIED` — 6 checks | `traceAttributionVerifier.ts:65-267` |
| Windowing | `src/microtensor/window.ts` | `VERIFIED` — delayed settlement actually active (`settlementDelayMs` 250 from config) | `window.ts:94-96, 182`; `runtimeConfig.ts:184` |
| Features | `src/microtensor/features.ts` | `VERIFIED` parity | `tests/parity.test.ts` |
| Sequence | `src/microtensor/sequence.ts` | `VERIFIED` T=8, shape `[1,8,18]` | `tests/windowing_contract.test.ts` |
| Macro | `src/macro/sequence.ts`, `symbols.ts` | `PARTIALLY VERIFIED` — see F-06 | live macro corpus |
| Outcome | `src/outcome/derive.ts` | `VERIFIED` — faithful port of `target_generation.py` | `tests/outcome_derivation.test.ts`; live `CLICK/FORM_SUBMIT/HOVER_DWELL/NO_OUTCOME` |
| Fast Gate | `src/gates/fast/prefixSpanFastGate.ts` + `wasm-vectorizer` | `VERIFIED` to fire; miner variant defective (F-02) | live `matchedGate: 'fast'`, `fastGateMode: 'prefixspan'` |
| Slow Gate | `src/gates/slow/onnxSlowGate.ts` | `VERIFIED` — both sessions load, run, softmax, map | live `modelLoaded: true`; `tests/intervention_head_contract.test.ts` |
| Arbitration | `src/gates/arbitration.ts` | `VERIFIED` — fast short-circuit, per-gate latency | `arbitration.ts:72-127` |
| Policy | `src/intervention/policy.ts` | `VERIFIED` | `tests/intervention_policy.test.ts`, `policy_cooldown_ttl.test.ts` |
| Actuator | `src/intervention/actuator.ts` | `VERIFIED` — reversible, WCAG-oriented, TTL when set | live `edge-aui-simplified`; `tests/actuator.test.ts` |
| Integration | `src/integration/types.ts`, `src/testbed/adapter.ts` | `VERIFIED` — `UiAdapter` port, 2 implementations | `tests/ui_adapter_contract.test.ts`, `..._second_implementation.test.ts` |
| Config | `src/config/runtimeConfig.ts` (9 groups) | `PARTIALLY VERIFIED` — several keys dead (F-17) | grep-verified |
| Instrumentation | `src/runtime/instrumentation.ts` | `VERIFIED` — 11 stages × 5 sides, ring buffer | live stage timings |
| Diagnostics / panel | `src/runtime/diagnostics.ts`, `src/debug/DebugPanel.tsx` | `PARTIALLY VERIFIED` — observability gaps (F-05, F-07) | live panel text |

### B.4 Documented vs implemented — divergences found

| Document claims | Implementation | Verdict |
|---|---|---|
| `docs/architecture.md:87-92`: delayed settlement active, `settlementDelayMs` in trace metadata | Active (`runtimeConfig.ts:184`); metadata carries `settlementDelayMs` (`recorder.ts:257`) | Consistent |
| `docs/architecture.md:127-130`: TS vectorisation on the live path | `features.ts` is TS; WASM used only for mining | Consistent |
| `participant-readiness.md:38`: "**Retained drop-once semantics per ADR-005**" | ADR-005 Option B (delayed settlement) is accepted **and implemented** (`window.ts:182`, `runtimeConfig.ts:184`) | **CONTRADICTED** |
| `participant-readiness.md:29`: "1000ms lookahead" | Horizon `[windowEnd+500, windowEnd+1500]` (`pipelineConfig.json`; `derive.ts:58-59, 120-121, 135`) — a 1000 ms span after a 500 ms offset | **CONSISTENT** (the audit of `target-testbed-quality-assessment.md` read this as a 1500 ms horizon; it is not) |
| `participant-readiness.md:33`: "`InteractionObserver` captures pointer, click, scroll, **key** events" | Class is `TelemetryObserver`; **no keyboard events are bound** (`observer.ts:214-236`) | **CONTRADICTED** |
| `participant-readiness.md:5,56`: links to `ADR-008-telemetry-retention-model.md`, `ADR-011-telemetry-ring-buffer-sizing.md`, `ADR-014-participant-pipeline-scope-boundaries.md` | Real files: `ADR-008-combined-edge-payload-target.md`, `ADR-011-ui-adapter-generalisation-boundary.md`, `ADR-014-deferred-target-ui-features.md` | **BROKEN (3 links)** |
| `condition-comparison.md:5`: link to `ADR-014-participant-pipeline-scope-boundaries.md` | Same break | **BROKEN** |
| `gate-routing-evidence.md:4`: links `ADR-002-dual-gate-arbitration.md`, `ADR-003-sub-50ms-inference-budget.md` | Real files: `ADR-002-rust-wasm-prefixspan-boundary.md`, `ADR-003-worker-main-thread-boundary.md` | **BROKEN (2 links)** |
| `gate-routing-evidence.md:104`: "`scripts/verify-trace.mjs` can audit whether the Fast Gate meets its < 10 ms budget" | `verify-trace.mjs` performs no latency check (`verify-trace.mjs:33-140`) | **UNSUPPORTED** |
| `gate-routing-evidence.md:81`: quotes `expect(result.bothGatesEvaluated)` on `InferenceResult` | `InferenceResult` has no `bothGatesEvaluated` field (`arbitration.ts:24-35`); it exists on `PredictionEvent` | **CONTRADICTED** |
| `gate-routing-evidence.md:100-110`: code snippet `slowGate.infer(seq, uiContext)`, `this.fastGate.match(...)` | Actual calls: `this.slowGate.infer({sequence, shape, context})`, `this.fastGate.evaluate(...)` (`arbitration.ts:75, 104-108`) | **CONTRADICTED** |
| `condition-comparison.md:26`: "Task `T2` (Analytics Filter, Select Region, Apply Filters, Export Table)" | `taskModel.ts:50-58`: T2 = navigate + export only | **CONTRADICTED** |
| `architecture.md:56`: Slow Gate "ONNX Runtime Web, **WebGPU**" | Provider is reported from `session.executionProvider ?? providers[0]`, i.e. it can report the *requested* provider (`onnxSlowGate.ts:171-174`) | **PARTIALLY VERIFIED** (see F-10) |
| `target-testbed-implementation-record.md:195` and elsewhere: `src/runtime/worker.ts` | The file is `src/runtime/worker/core.ts`; `worker.ts` does not exist | **STALE** |
| `docs/assessments/target-testbed-implementation-record.md` §4 limitation 6: "The target intervention head is not exported" | Exported and shipped; `intervention_head_int8.onnx` loads | **STALE** (record is historical) |
| `sparse-window-loss.md:20`: "6 **real participant traces**" | `ADR-013` records the traces as scripted substitute data; all traces have `participantId: null`; no human session exists | **OVERCLAIM** |
| `condition-comparison.md:32-33`: baseline/adaptive "trace artifacts" presented as exported trial results | The two files are **hand-authored fixtures** (`sessionId: 'sess-ctrl-baseline-t2-001'`, integer timestamps 1000…2800) | **MISLEADING** |

Additional stale-internal-reference findings: `src/telemetry/traceAttributionVerifier.ts:8` says "schemaVersion 1.1.0" while the code validates against `EXPERIMENT_TRACE_SCHEMA_VERSION` (`1.2.0`); `src/gates/slow/onnxSlowGate.ts:186-187` claims honest provider reporting while `:171-174` falls back to the requested provider.

---

## C. End-to-End Trace: participant interaction → persisted research record

Every arrow in the brief's §4 chain, with what actually carries it:

| # | Arrow | Implementation | Data structure | Producer → consumer | Validation / error handling | Timing | Identity | Tests | Linked finding |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Participant → target UI | React 19 SPA, 5 state pages, semantic `data-aui-*` annotations | DOM | `App.tsx` | none | — | — | `semantic_dom_annotations.test.tsx` | F-15 |
| 2 | DOM → `BehaviourEvent` | `observer.ts:137-417` | `BehaviourEvent` | `TelemetryObserver` → subscribers | listener wrapped; `emit()` try/catch per listener (`observer.ts:118-126`) | `performance.now()` per event | componentId/role/route/taskId captured per event | `telemetry_observer.test.ts` | F-01 |
| 3 | Session / experiment / task identity | `sessionManager`, `experimentRecorder.bindSession` | `SessionContext` | `boot.ts:87-89`, `adaptiveRuntime.ts:266-273` | session snapshot retained | epoch + monotonic | `sessionId`, `experimentId`, `conditionId` | `telemetry_session_recorder.test.ts` | — |
| 4 | Windowing | `RollingWindowBuffer.push/tick` | `MicroTensorWindow` | timer 125 ms + event push | skipped-sparse / late counters | fixed grid, 250 ms settlement delay | `windowId` | `windowing_contract.test.ts` | F-04 (semantics divergence) |
| 5 | MicroTensor | `computeWindowMicroTensor` | `Float32Array(18)` | `window.buildWindow` | non-positive geometry throws (`features.ts:52-57`) | ~0.03 ms measured | — | `parity.test.ts`, `vectorizer_parity.test.ts` | — |
| 6 | Macro history | `deriveMacroSymbol` + `MacroInteractionStream` | `MacroInteraction` | observer bridge | null for non-semantic events | event time | `sessionId`/`experimentId`/`conditionId`/`windowId` injected | `macro_sequence.test.ts` | F-06 |
| 7 | Fast Gate | `PrefixSpanFastGate.evaluate` + WASM miner | `GateDecision` | `AdaptiveInferenceEngine` | mining failure → miss (fail-safe) | **p95 2 943–3 149 ms measured** | matchedPattern recorded on decision | `prefixspan_fast_gate.test.ts` | F-02 |
| 8 | Slow Gate | `OnnxSlowGate.infer` | `SlowGateResult` | arbitration | shape checks throw; no session → `NO_OUTCOME`, conf 0 | p50 1.2–36.9 ms measured | context encoded R⁶ | `intervention_head_contract.test.ts` | F-11 |
| 9 | Policy | `InterventionPolicy.accept` | `PolicyDecision` | `adaptiveRuntime.ts:666` | candidate state machine | 0.02–0.14 ms measured | — | `intervention_policy.test.ts` | F-07 |
| 10 | Actuator | `UIActuator.apply` | `InterventionEvent` | `adaptiveRuntime.ts:707` | selector escaping; TTL if set | 0.105 ms measured | episode id | `actuator.test.ts` | F-03 |
| 11 | Visible UI intervention | CSS class / ARIA / banner | DOM | `actuator.ts:221-503` | revertible cleanups | immediate | `data-aui-active-adaptation` | `actuator.test.ts` | F-05 |
| 12 | Outcome / task event | `deriveForWindow`, `taskManager` | `OutcomeEvent`, `TaskEvent` | runtime timer, task manager | provisional vs settled flag | `[+500, +1500] ms` | `windowId`, task ids | `outcome_derivation.test.ts`, `task_wiring.test.tsx` | F-01, F-15 |
| 13 | Experiment trace | `ExperimentRecorder` | 7 arrays + session snapshot | runtime | 10 000/item cap | mixed | all correlation ids on most records | `trace_attribution_verifier.test.ts` | F-01, F-07, F-08 |
| 14 | Persistence / export | **manual** `downloadTraceAsJSON()` from the DebugPanel | JSON blob | `recorder.ts:297-323` | none | on click | embedded | `telemetry_session_recorder.test.ts` | F-19 |
| 15 | Edge → dataset preparation | **absent**; `model-preparation/src/trace_ingestion.py` expects `1.1.0` | — | — | rejects `1.2.0` | — | — | `model-preparation/tests/test_trace_ingestion.py` | **F-09** |

**Missing links in the chain:** 14 (no transport, no durable storage, no session-recovery write) and 15 (no compatible consumer). Everything from 1–13 exists and runs.

---

## D. Correctness Findings

Severity is engineering/research impact, not priority of taste.

### F-01 — Two incompatible clocks inside one trace

- **Area:** Telemetry / experiment trace / dataset preparation
- **Severity:** **Critical**
- **Evidence:** `VERIFIED` in a live trace and in a committed trace. Live export (`/tmp/aui-live-audit.out`, 2026-10-01):
  `behaviour` and `microTensor` timestamps `[4 034 … 19 572]` (monotonic, `performance.now()`), while `prediction` `[1 790 852 146 903 …]`, `task` `[1 790 852 147 586 …]` and `intervention` are `Date.now()` epoch values. Same split in `docs/experiments/random/traces/experiment-trace-7029a1f9-…json`: behaviour `2 514…192 784`, predictions `1 790 687 428 324`, task events `1 790 687 425 649`.
- **Observed behaviour:** `BehaviourEvent.timestamp` is documented as monotonic (`events.ts:54`; `normalizer.ts:18-23`). Predictions use `Date.now()` (`arbitration.ts:62`), interventions `Date.now()` (`adaptiveRuntime.ts:668`, `actuator.ts:81-181`), task events `Date.now()` (`taskManager.ts:80-206`). Running `reconstructReplayStream` in the browser over the real trace returns `behaviour@2514 … behaviour@2571` first and `task@1790687557446, task@1790687559778` last — i.e. the "strictly chronological" replay stream (`traceSchema.ts:229-253`) places 8 600+ behaviour events before every decision, destroying causal order.
- **Expected behaviour:** one trace, one timeline (or an explicit, documented offset per record class).
- **Impact:** (a) `taskStart → interactions → taskComplete` cannot be aligned, so **task completion time cannot be derived from a trace**; (b) prediction/intervention `windowId` links cannot be verified; (c) the offline window↔event correlation in `trace_ingestion.py:246-253` (`wstart <= ts <= wend`) can never match; (d) replay is not a replay.
- **Recommended action:** adopt a single clock for all trace records (monotonic + one session epoch anchor is sufficient), or carry an explicit `clock: 'monotonic' | 'epoch'` on every record and normalise on export. Do not mask it with a heuristic sort.
- **Implementation required?:** Yes (small, local: 6 call sites).
- **Human decision required?:** No — but the choice of canonical clock should be recorded.

### F-02 — The "PrefixSpan" miner is a non-standard variant, is unbounded, and serialises the worker

- **Area:** Fast Gate / worker boundary / performance
- **Severity:** **Critical**
- **Evidence:** `VERIFIED`. `wasm-vectorizer/src/prefix_span.rs:38-45` counts each item **once per sequence** (`seen_in_seq` set) instead of every position, and `:68` projects only on the **first** occurrence (`seq.iter().position(...)`). It therefore enumerates subsequences rather than projected-database growth, and with repeated symbols the pattern set is combinatorial. Measured live: `PrefixSpan mining [wasm]` `p95 2 943 ms`, `max 3 149 ms` on a corpus of **≤ 9 sequences** (`/tmp/aui-live-audit.out`).
- **Observed behaviour:** the worker is a strictly serial request loop (`worker/entry.ts:19-22` awaits `handleRequest` before the next message). A multi-second mining pass therefore blocks every queued `PUSH_WINDOW`/`EVALUATE`. Live console shows `Worker request EVALUATE timed out after 5000ms` and `Worker request PUSH_WINDOW timed out after 5000ms`, and `worker message/transfer` p95 of **4 030 ms** — i.e. requests are dropped on the floor mid-trial. In an earlier committed trace the same failure reduced a 190 s session to **1 prediction** (session `7029a1f9`).
- **Expected behaviour:** mining bounded by corpus size; no head-of-line blocking; no silent loss of windows.
- **Impact:** telemetry and predictions are lost during exactly the interaction-dense moments that matter; the Fast Gate's behaviour is not reproducible; the `< 50 ms` budget is not met in practice even though the docs assert `TBT = 0 ms` (F-16). Any claim about Fast Gate latency from the current implementation is unsupported.
- **Recommended action:** (1) fix the miner to true PrefixSpan semantics with a hard bound (max pattern length, max patterns, max corpus size); (2) add backpressure so at most one evaluation is in flight; (3) add a configurable, workload-proportional RPC timeout and surface dropped-window counts in the trace.
- **Implementation required?:** Yes.
- **Human decision required?:** No for (1)–(3); yes if the intended fix is "replace the miner" rather than repair it.

### F-03 — Interventions never expire; `policy.ttlMs` and `actuation.defaultTtlMs` are dead

- **Area:** Actuation / research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED`. No producer sets `ttlMs` (`grep` over `src/`: only `intervention/types.ts`, `actuator.ts`, `prefixSpanFastGate.ts` reference it). `runtimeConfig.ts:233` defines `policy.ttlMs = 8000` and `:240` `actuation.defaultTtlMs = 8000`; neither is read anywhere (`grep`: 0 consumers outside `runtimeConfig.ts`). Live evidence: `edge-aui-simplified` remained on `filter-drawer` at the end of the trial (`active adaptations in DOM`), and the trace shows `applied` at `ep_1` with no matching `reverted`/`dismissed`.
- **Expected behaviour:** either the adaptation reverts on TTL/action, or the "reversible adaptation" claim is qualified.
- **Impact:** once applied, an adaptation persists until a page reload. A participant's session can be permanently altered by a single early decision; the intervention-history signal recorded in the trace is therefore biased (adaptation present for the rest of the session). `tests/actuator.test.ts` and `policy_cooldown_ttl.test.ts` verify TTL **when set**, which no production path does.
- **Recommended action:** wire `actuation.defaultTtlMs` into every command (or consciously decide that adaptations are session-persistent and document it).
- **Implementation required?:** Yes (one line, plus a documented decision).
- **Human decision required?:** **Yes** — this is a research-methodology parameter (how long an adaptation is visible).

### F-04 — Live window semantics diverge from the Python reference by one stride

- **Area:** Windowing / parity
- **Severity:** **High** (methodological)
- **Evidence:** `VERIFIED` by code read. `RollingWindowBuffer` assigns events to a **250 ms** slot and emits `windowEnd = windowStart + strideMs` (`window.ts:215-216`), with `windowDurationMs` used only as the tensor span passed to feature extraction (`window.ts:246-253`). The Python reference segments **500 ms** overlapping windows with 250 ms stride. `ADR-005` itself records that "Option B may change the emitted window count, which changes macro sequence contents and therefore Fast Gate hit rates. Any before/after comparison must re-baseline" (`ADR-005:86-87`) — no such re-baselining is recorded. The measured 10.95 % sparse loss was computed with `flushDelayMs: 0` (`sparse-window-loss.md:96`), i.e. **before** delayed settlement was enabled.
- **Impact:** window-to-outcome labels, macro sequences, Fast Gate hit rates and any cross-pipeline comparison are computed on different window definitions than the model was trained/validated on. `settledSparseWindows` was never re-measured after ADR-005 took effect.
- **Recommended action:** measure and record `skippedSparseWindows`/`settledSparseWindows` under the shipped configuration, and state the exact emitted-window definition used by the current build in the trace metadata (already half-present: `settlementDelayMs`). Note also that `architecture.md:92` exports `PREPROCESSING_CONFIG.settlement_delay_ms` (the Layer-1 constant) rather than the resolved runtime value, so a runtime override would not appear in the trace.
- **Implementation required?:** No new mechanism; a measurement and a documentation correction.
- **Human decision required?:** **Yes** — whether the live slot definition or the Python window definition is authoritative.
- **Related unsupported claim (`VERIFIED`):** `architecture.md:87-89` and `final-report.md:71` state that delayed settlement "recover[s] 66.2 % of sparse slots straddling window boundaries (`settledSparseWindows`)". 66.2 % is the **lookahead-crossing** statistic (`sparse-window-loss.md:23,79`), not a measured rescue; the harness models the delay as a pure flush offset over a static stream (`scripts/quantify-sparse-window-loss.mjs:286-290`) and its own table shows drop-once and delayed emission producing identical counts (2 144 emitted / 144 skipped). **No measurement anywhere shows a slot actually rescued by `settledSparseWindows`.**

### F-05 — An applied intervention leaves no DOM-observable footprint for correlation

- **Area:** Intervention observability / trace integrity
- **Severity:** **High** for the automated checks; Medium for the researcher
- **Evidence:** `VERIFIED`. `UIActuator.applyHighlightPrimaryAction` sets `data-aui-active-adaptation="highlight"` (`actuator.ts:240`) but **no other adaptation type sets that attribute** (`simplify_options` `:279`, `expand_tooltip` `:349-351`, `offer_assistance` `:443-446`). In the live run the verification query `[data-aui-active-adaptation]` returned `[]` while `document.querySelectorAll('.edge-aui-simplified')` returned the `filter-drawer` form. In the trace, `ep_0`/`ep_1` identify applied interventions, but the `interventionEpisodeId` does not appear on the DOM.
- **Impact:** a verifier cannot prove from the DOM that the adaptation in the trace is the one visible; conversely, an adaptation can be live with no trace-side terminal event (F-03). The `intervention_terminal_states` check therefore fails on real captures.
- **Recommended action:** add the episode id to a DOM attribute on every adaptation type.
- **Implementation required?:** Yes (small).
- **Human decision required?:** No.

### F-06 — Macro symbol derivation produces dominant spurious symbols; the Fast Gate matches noise

- **Area:** Macro stream / Fast Gate / research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED` live. 54 macro interactions in one short trial were dominated by `NAV_OVERVIEW` ×18 (one per `mouseover` on the page root, because `deriveMacroSymbol` classifies by `event.route` — `symbols.ts:66-72`) and `OPEN_FILTERS` ×18 (because **every** click on any accordion returns `OPEN_FILTERS` — `symbols.ts:90-94`; there is no close path and `COSE_FILTERS` is unreachable). The Fast Gate's winning pattern was `NAV_ANALYTICS > OPEN_FILTERS`, and its corpus was `workerCorpusSize: 5/9`. `CLOSE_FILTERS` has no producing branch at all (`grep`: 0).
- **Impact:** the "deterministic Fast Gate over frequent macro patterns" is currently matching repetition artifacts, not behavioural episodes. Any conclusion of the form "the Fast Gate recognised a known pattern" is not supported by the current macro layer. This also inflates the pattern corpus that drives the 3 s mining cost (F-02).
- **Recommended action:** derive `OPEN_FILTERS`/`CLOSE_FILTERS` from the accordion's `aria-expanded` transition, derive `NAV_*` only on click, and remove or gate the `route`-based fallback. Re-measure Fast Gate hit rate afterwards.
- **Implementation required?:** Yes.
- **Human decision required?:** No for the fix; yes for choosing which navigation semantics the experiment intends.

### F-07 — Policy decisions are not persisted: the trace cannot answer "why didn't it intervene?"

- **Area:** Observability / research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED` by code read and live trace. `evaluateAndAct` records a `PredictionEvent` (`adaptiveRuntime.ts:607-624`) and an `InterventionEvent` **only for accepted decisions** (`:667-680`). Rejection reasons exist only as `debugBus` strings (`:684-689`, `:696-703`) and are never written to the recorder. The baseline branch (`:694-704`) is explicitly "decision only (baseline condition)" and is also not persisted. Consequently the exported trace contains `interventions: []` for a baseline session in which the policy **did** accept candidates (live: baseline recorded 7 predictions, all `matchedGate: 'fast'`, with `appliedCount: 0`).
- **Impact:** the brief's §11 requirement — distinguish *no prediction / below threshold / policy rejected / cooldown active / baseline decision-only / actuator failure* — is not satisfiable from a trace. Baseline "zero mutation" can only be evidenced by DOM inspection, not by the research record. A whole class of research questions ("did the policy reject because of eligibility or confidence?") cannot be answered post hoc.
- **Recommended action:** add a `PolicyDecisionEvent` (candidate, accepted, reason, candidateCount, cooldownRemainingMs, condition) to the trace for every evaluation, including the baseline branch and the no-op path. This is pure instrumentation, not a methodology change.
- **Implementation required?:** Yes (schema addition + recorder call).
- **Human decision required?:** **Yes** — adding a trace record type is a schema/experiment-format decision.

### F-08 — Developer/research panel omits the fields needed to confirm intervention activation

- **Area:** Observability
- **Severity:** **High** (the brief names this a priority)
- **Evidence:** `VERIFIED` against live panel text (`/tmp/aui-live-audit.out`, "debug panel text"). The panel **does** show session, task, step, route, focus, capability flags, Fast Gate match + pattern, Slow Gate called/outcome/confidence, intervention type + source, policy state string, latencies, worker status, stage timings, MicroTensor and modality mask. It **does not** show: `windowId`, `matchedGate` as a field, `mappingSource`, intervention **confidence** / class probabilities, cooldown remaining, candidate persistence count, `executionProvider`, `modelLoaded`, `slowGateMode`, runtime counters, or the actuated target element. Two further defects are visible in the same output:
  - **`MACRO SEQUENCE: No macro events recorded`** while the recorder held 55 macro interactions. Cause: `diagnostics.ts:107` overwrites `latestMacroSequence: undefined` every 500 ms.
  - **MicroTensor display showed `0.000` for all nine features with mask `[111111111]`** — the panel last rendered an inactivity window; there is no indication that the values are a stale/inactive window.
  - `Feature Extr. Latency 4878.10 ms` and `Inference Latency 4723.47 ms` are **not inference timings**: `adaptiveRuntime.ts:720` records `getMonotonicTimestamp() - start` where `start` is the time the *previous* evaluation began.
- **Impact:** the observer cannot distinguish "no prediction" from "prediction below threshold" or "cooldown active" while watching a session, which is precisely the confidence-building requirement.
- **Recommended action:** publish and render window id, gate, mapping source, intervention confidence, policy reason/cooldown, provider/model, and per-buffer counters; stop clobbering `latestMacroSequence`; label inactive windows and fix the two mislabelled latency fields.
- **Implementation required?:** Yes.
- **Human decision required?:** No (presentation only).

### F-09 — The dataset pipeline rejects the traces the runtime produces

- **Area:** Persistence / dataset preparation — **the named next milestone**
- **Severity:** **Critical (blocking)**
- **Evidence:** `VERIFIED` by source read on both sides.
  - Runtime emits `schemaVersion: '1.2.0'` (`traceSchema.ts:31`; confirmed in every live and committed recent trace).
  - `model-preparation/src/trace_ingestion.py:42,110-115` hard-codes `EXPERIMENT_TRACE_SCHEMA_VERSION = "1.1.0"` and raises `Invalid schemaVersion` for anything else. `grep "1\.2\.0"` across `model-preparation/src`, `tests`, `scripts` → **no matches**.
  - `KNOWN_BEHAVIOUR_EVENT_KEYS` (`:62-79`) is also 1.1.0-era; any new behaviour-event field is rejected as "Unmapped trace event field".
  - The offline pipeline re-derives outcomes itself (`microtensor_store.py:249` calls `extract_lookahead_outcome`) and **ignores** the trace's `outcomes` array, so F-07's missing policy evidence is not compensated offline either.
- **Impact:** a trace collected today cannot be ingested, so no training/evaluation dataset can be built from the current runtime without a code change on the Python side. This is the single most concrete blocker to the stated next goal.
- **Recommended action:** agree a schema-version contract (either emit 1.1.0-compatible traces or extend the ingestion layer to 1.2.0 with explicit field allow-lists), and add a cross-repository ingestion contract test.
- **Implementation required?:** Yes (mostly in `model-preparation`, one consumer to update).
- **Human decision required?:** **Yes** — where the schema of record lives and which side moves.

### F-10 — Execution-provider reporting can echo the *requested* provider

- **Area:** Model integration / honest reporting
- **Severity:** Medium
- **Evidence:** `VERIFIED` by read; `PARTIALLY VERIFIED` in runtime. `createSingleSession` returns `session.executionProvider ?? providers[0] ?? 'wasm'` (`onnxSlowGate.ts:171-174`), where `providers[0]` is `'webgpu'` by default (`:193`); the comment at `:186-187` claims the opposite. Environment-independent corroboration: in the audit's Node run, `onnxruntime-web` reported "backend not found" for WebGPU and silently used wasm/CPU, and `tests/intervention_head_contract.test.ts` passes on wasm/cpu — the same fallback shape. The live browser reported `executionProvider: 'webgpu'` and `modelLoaded: true`, which may be genuine on Apple Metal, but the code cannot distinguish "used WebGPU" from "requested WebGPU".
- **Impact:** `executionProvider: 'webgpu'` currently recorded in predictions/traces is not established evidence. `final-report.md:221-227` (D11) already concedes this.
- **Recommended action:** report the provider from the session's own capability output, or mark the provider as requested vs actual.
- **Implementation required?:** Yes (small).
- **Human decision required?:** No.

### F-11 — The deterministic-mapping ablation arm is not the teacher policy

- **Area:** Model integration / ablation validity
- **Severity:** Medium (High if an ablation comparison is reported)
- **Evidence:** `VERIFIED`. Teacher: `intervention_label_policy.py:88-94` — `HOVER_DWELL` + `primaryActionAvailable` + `taskProgress > 0.5` → `highlight_primary_action`, else `expand_tooltip` (context-conditional). Runtime ablation: `onnxSlowGate.ts:56-64` maps `HOVER_DWELL → expand_tooltip` unconditionally and never reads context. The policy docstring says `>= 0.5` while the code says `> 0.5`.
- **Impact:** an ablation comparing `learned_head` against `deterministic_mapping` compares the model to a *different* policy than the one that produced its training labels.
- **Recommended action:** port the teacher's context condition into `buildDeterministicIntervention`, or document that the ablation arm is deliberately a simpler baseline.
- **Implementation required?:** Yes if ablation results are reported.
- **Human decision required?:** **Yes** — which comparison the experiment intends.

### F-12 — The "controlled baseline vs adaptive comparison" evidence is hand-authored fixtures

- **Area:** Research validity / evidentiary integrity
- **Severity:** **High**
- **Evidence:** `VERIFIED`. `docs/experiments/baseline-trace.json` and `adaptive-trace.json` contain `sessionId: 'sess-ctrl-baseline-t2-001'` / `'sess-ctrl-adaptive-t2-002'`, `experimentId: 'exp-controlled-pair-01'`, integer timestamps (`1000, 1100, 1250, 1500, 1750, 1760, 1850, 1860, 1900, 2000, 2600, 2700, 2800`), `interventionEpisodeId: 'ep-t2-adaptive-01'` — none of which any runtime code generates (`generateAnonymousSessionId`, `exp_${Date.now().toString(36)}`, `ep_${n}`). `condition-comparison.md` presents them as "Trace Artifacts" from "Run 1/Run 2" with a protocol table.
- **Impact:** the repository's headline evidence that baseline and adaptive conditions are distinguishable rests on data constructed to satisfy the verifier. The underlying *engineering* claim (baseline applies nothing) happens to be independently true — this audit verified it live with zero DOM mutations in a clean baseline run (`/tmp/aui-baseline-check.mjs`) — but the artifact that is cited does not demonstrate it.
- **Recommended action:** replace the fixtures with genuine exports from two live runs, label them as fixtures if retained, and state the synthetic provenance explicitly.
- **Implementation required?:** Yes (data, not code).
- **Human decision required?:** **Yes** — whether this comparison belongs in the thesis at all.

### F-13 — Verification harness passes on real traces only by accident; real captures fail it

- **Area:** Testing / trace integrity
- **Severity:** **High**
- **Evidence:** `VERIFIED` by executing `verifyTraceCompleteness` in the browser over four traces:
  - `baseline-trace.json`, `adaptive-trace.json` (fixtures) → `valid: true`.
  - `experiment-trace-7029a1f9-…json` (real synthetic capture) → `valid: false`: *"5 microTensor windows lack corresponding outcome record for windowId: [518, 519, 520, 521, 522]"*.
  - `experiment-trace-ec286e06-…json` → `valid: false`: 3 orphans.
  Also `VERIFIED`: the live session's own intervention `ep_1` has `applied` with no terminal event, which the `intervention_terminal_states` check is designed to catch (F-03). The pinned `tests/condition_trace_comparison.test.ts:20-21` asserts the verifier passes **for those two fixtures only**.
- **Impact:** the automated claim "trace integrity is verified" is verified against fixtures, not captures. Real traces are dropped-window-incomplete, which matters because the orphaned windows are exactly those lost while the worker was blocked (F-02).
- **Recommended action:** make the verifier part of the export path (warn or refuse on failure), record orphan counts in metadata, and fix the capture gaps it exposes.
- **Implementation required?:** Yes.
- **Human decision required?:** No.

### F-14 — Several performance and volume numbers in the narrative docs are not measurements

- **Area:** Performance / evidentiary integrity
- **Severity:** **High**
- **Evidence:** `VERIFIED` by reading the generator and the artifacts.
  - `scripts/benchmark-runtime.mjs:571`: `const totalEvents = Object.values(resultPass1.counts.byType ?? {}).reduce(...) || 300;` — `getEventCounts()` has **no** `byType` key (`recorder.ts:349-378`), so this is *always* `300`. `docs/benchmarks/runtime-benchmark.md` therefore reports `300` events, `30.6 events/sec` (committed) and `30.5 events/sec` (uncommitted re-run) while every other count changed by 50–370 %. The correct field (`counts.total`) was available.
  - `benchmark-runtime.mjs:439`: `"UI Impact: Zero jank detected. Total Blocking Time (TBT) remains 0ms."` is a hardcoded string. The same artifact records `longTaskCount: 1`, `durationMs: 121` — ≈ 71 ms of blocking under the standard TBT definition, i.e. over the 50 ms budget. The long-task observer's failure path is a silent `catch {}` (`:218-220`), so an unsupported `longtask` entry type would print "0 / Measured" rather than "unavailable".
  - `Fast Gate < 5 ms` is cited in `final-report.md:118` and `participant-readiness.md:29`, but no benchmark reads `fastGateLatencyMs`; the cited test injects its own literals (`tests/gate_routing_evidence.test.ts:191,238,331`). The only real datum is n=1 in the fixture comparison.
  - `worker message/transfer` is recorded as the **full RPC round trip** (`workerClient.ts:224,284` spans queueing + mining + ONNX + transfer) and is then added to per-window cost alongside the worker's own stages — the "99.27 % share" and the per-window p95 are double-counted aggregates, not a breakdown.
  - Percentiles are off: `instrumentation.ts:279-281` uses `sorted[floor(len*0.5)]`; with `count = 2` "p50" is the maximum.
  - `final-report.md` and `participant-readiness.md` still cite the **superseded** 2026-09-26 run (14.22 MB heap, 331.6 KB models, slow gate 6.03/18.17, 27.74 MB payload) while the working tree holds a 2026-09-29 re-run (models 703 968 B over 4 files, payload 28 787 955 B, ONNX `mean 14.925 p50 28.535 n=2`).
- **Impact:** three claims in the thesis-facing narrative are unsupported or contradicted by their own artifacts. The brief explicitly forbids "performance budgets that were not measured".
- **Recommended action:** use `counts.total`; delete or compute the TBT claim; extract `fastGateLatencyMs`/`slowGateLatencyMs`; fix the percentile index or suppress small-n percentiles; split transfer from queueing; rename the stage; regenerate the narrative from the artifacts.
- **Implementation required?:** Yes.
- **Human decision required?:** No (correction of claims, not of method).

### F-15 — Task lifecycle cannot express failure, and step success is component-id matching

- **Area:** Task reassessment / UX metrics
- **Severity:** Medium
- **Evidence:** `VERIFIED`. `TaskStatus` has no `Failed` (`taskModel.ts:2`); non-matching clicks increment `errors` (`taskManager.ts:144-155`) but nothing ever transitions a task to failed. A step is satisfied purely by matching `componentId` + `action` (`taskManager.ts:136-141`). Live: the agent's `change` event left the Region select at its default value (`"changed to All"`) and T1 still completed all four steps with `errors: 0`.
- **Impact:** "task success" is currently "the participant touched the required controls in order", not "the participant produced the required state". Task completion rate and errors are therefore weak measures. `taskFail`, `taskAbandon` on timeout, and state validation would be needed before UX metrics are meaningful.
- **Recommended action:** define a success predicate per step (state-based, not interaction-based), add `Failed`, and add an explicit timeout path (`experiment.taskTimeoutsMs` is configured at `runtimeConfig.ts:248-252` and never used).
- **Implementation required?:** Yes.
- **Human decision required?:** **Yes** — what "task success" means is a methodology decision.

### F-16 — Trace buffers are bounded by silent eviction; nothing survives a closed tab

- **Area:** Persistence / data integrity
- **Severity:** **High** for collection readiness (Medium for today's lab use)
- **Evidence:** `VERIFIED`. `ExperimentRecorder.maxBufferSize = 10 000` per array, `shift()` on overflow (`recorder.ts:118-179`). Live session: 75 behaviour events in ~20 s (3.8 evt/s); a dense pointer stream produced 4 132 events in 117 s (≈ 35 evt/s) in the committed trace `3850a5d9`. At 35 evt/s the behaviour buffer evicts oldest events after **≈ 4.8 minutes**, silently — no counter, no trace flag. Nothing is written to any storage: `grep` for `localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|WebSocket|fetch(` in `src/` returns **zero** matches (`VERIFIED`). The only export is the DebugPanel button (`recorder.ts:297-323`).
- **Impact:** a participant session longer than a few minutes loses its beginning; a closed tab loses everything. There is no partial-session, crash, or duplicate-submission handling because there is no submission.
- **Recommended action:** this is the first piece of real collection work, not a bug fix (see §L).
- **Implementation required?:** Yes (new work).
- **Human decision required?:** **Yes** — persistence architecture.

### F-17 — Configuration surface overstates what is configurable

- **Area:** Configuration
- **Severity:** Medium
- **Evidence:** `VERIFIED` by grep across `src/`: keys defined in `runtimeConfig.ts` with **no consumer** outside that file:
  `telemetry.enabledEventTypes`, `telemetry.captureGeometry`, `telemetry.sessionSettings.*`, `windowing.lateEventPolicy`, `fastGate.maxPatternLength`, `fastGate.rankingStrategy`, `slowGate.modelPath`, `slowGate.executionProvider`, `slowGate.batchSize`, `slowGate.targetContextEncoding`, `slowGate.fallbackBehavior`, `slowGate.enabled`, `policy.sustainedConfidenceDurationMs`, `policy.maxInterventionsPerTask`, `policy.conflictResolution`, `policy.ttlMs`, `actuation.defaultMechanism`, `actuation.revertBehavior`, `actuation.defaultTtlMs`, `experiment.trialOrder`, `experiment.taskTimeoutsMs`.
  Of these, three are actively misleading because they are serialized into traces: `slowGate.modelPath` is recorded as `'/models/gru_edge_aui.onnx'` — **a file that does not exist** (`public/models/` holds only the four shipped graphs) — while the runtime actually loads `/models/model_int8.onnx` + `/models/intervention_head_int8.onnx`; `policy.ttlMs` and `actuation.defaultTtlMs` imply an expiry that never happens (F-03).
- **Impact:** an experimenter changing these values changes nothing, and the trace's `effectiveConfig` misstates the model that ran.
- **Recommended action:** wire or delete each key; never serialize an unenforced value as effective configuration.
- **Implementation required?:** Yes (small per key).
- **Human decision required?:** Only for the keys that should become real parameters.

### F-18 — Duplicate concurrent evaluations and duplicate `windowId` attribution

- **Area:** Runtime correctness / trace integrity
- **Severity:** Medium
- **Evidence:** `VERIFIED` in a live trace. `maybeEvaluate()` guards with `this.evaluating`, but `dispatchWindow()` is fire-and-forget (`adaptiveRuntime.ts:544, 550-560`) and increments `processedWindowCount` only after the worker replies; `maybeEvaluate` is called per emitted window. Live trace shows **three consecutive predictions all carrying `windowId: 10`** and later `windowId: 55`, i.e. predictions whose stated window is not the window they evaluated. The worker's own diagnostics (`evaluatedSequenceLength: 39` vs `corpusSize: 2`) confirm the main thread and worker corpora are also out of step.
- **Impact:** "which window produced this decision" is not reliable in the trace, which undermines the window→prediction→intervention chain the brief asks to be reconstructable.
- **Recommended action:** capture the window id at evaluation time from the evaluated sequence (or serialise evaluations).
- **Implementation required?:** Yes (small).
- **Human decision required?:** No.

### F-19 — `modelVersion` is a hardcoded literal, so the trace cannot identify the deployed model

- **Area:** Model integration / reproducibility
- **Severity:** Medium
- **Evidence:** `VERIFIED`. `adaptiveRuntime.ts:603-605`: `const modelVersion = this.options.interventionModelUrl ?? (this.modelLoaded ? 'TargetInterventionHead-v1.0.0-int8' : undefined)`. The shipped ONNX graphs carry **no** version metadata (`metadata_props` empty for FP32; `[('onnx.infer','onnxruntime.quant')]` for INT8; `model_version = 0`). Real provenance *does* exist next to the artifacts — `model-preparation/models/bundles/v1.0.0/bundle.json` records `experiment: e3`, checkpoint sha256, ONNX sha256 (`89d4549a…`, matching the shipped `intervention_head.onnx` byte-for-byte), dataset hash, code commit and seed — but the runtime never reads it.
- **Impact:** swapping to the e1/e2 ablation graph would still be recorded as `TargetInterventionHead-v1.0.0-int8`. Model version is therefore not a usable variable in analysis.
- **Recommended action:** read the bundle manifest (or an embedded hash) and record it.
- **Implementation required?:** Yes (small).
- **Human decision required?:** No.

### F-20 — Slow-Gate confidence cutoff is 0.5 in code and 0.75 in configuration

- **Area:** Configuration / model integration
- **Severity:** Low–Medium
- **Evidence:** `VERIFIED` by read. `OnnxSlowGate` defaults `confidenceThreshold ?? 0.5` (`onnxSlowGate.ts:486, 506`); the worker forwards `minOutcomeConfidence` (`core.ts:83`) which `bootTestbed` never sets, so `undefined` → 0.5. `slowGate.confidenceThreshold: 0.75` (`runtimeConfig.ts:219`) is never read (`AdaptiveRuntime` passes only `modelPath`/`confidenceThreshold` from `options`, `:196-201`). The policy still gates actuation at 0.75.
- **Impact:** candidate interventions with confidence in [0.5, 0.75) are created and recorded as `issued` and then rejected by policy — a behaviour the configuration does not describe.
- **Recommended action:** forward the configured threshold and delete the duplicate default.
- **Implementation required?:** Yes (small).
- **Human decision required?:** No.

### F-21 — Condition switch kills in-flight work and the diagnostics handle goes stale

- **Area:** Runtime lifecycle / observability
- **Severity:** Medium
- **Evidence:** `VERIFIED` live. Switching condition produced **18 identical console errors** `[AdaptiveRuntime] Evaluation failed: Error: RuntimeWorkerClient terminated` / `Window dispatch failed: ...` (every in-flight request rejected by `terminate()` at `workerClient.ts:200-205`). After the switch, `window.__EDGE_AUI__` still pointed at the **stopped** runtime: `status()` reported `running: false, conditionId: 'baseline'` while the new baseline runtime was running, and recorder counts (`behaviourEvents: 0`) belonged to the old instance's handle closure.
- **Impact:** the trial boundary is noisy and the primary observability handle silently lies after the first condition switch — which is exactly when a researcher switches it.
- **Recommended action:** drain or cancel in-flight requests on stop; re-point the diagnostics handle on `switchCondition`.
- **Implementation required?:** Yes (small).
- **Human decision required?:** No.

### F-22 — `first-child`/`last-child`-style UI state and other minor UI issues

- **Area:** Testbed UI
- **Severity:** Low
- **Evidence:** `VERIFIED` live: `document.querySelector('.edge-aui-debug-toggle')` exists only while the panel is collapsed (`DebugPanel.tsx:120-142`), so a scripted or assistive user cannot expand the panel by the same handle twice; the panel's own toggle is the only affordance. `DebugPanel` renders micro-tensor values with 3 decimals, so a genuinely active window with small kinematics is indistinguishable from an inactive one (F-08). The panel is excluded from production builds unless `forceShow` is passed (`DebugPanel.tsx:44-50`) — and `App.tsx:61` never passes it.
- **Impact:** minor for a lab session, material for a packaged participant build where the debug panel is not rendered at all.
- **Recommended action:** decide explicitly whether the panel ships; add a stable always-present toggle; label inactive windows.
- **Implementation required?:** Yes (small).
- **Human decision required?:** **Yes** — whether the developer panel is present in participant builds.

### F-23 — Configuration audit: hard-coded values that materially affect experimentation

- **Area:** Configuration
- **Severity:** Informational
- **Evidence:** `VERIFIED` by grep. Values that are **hard-coded and materially experimental**, i.e. not in `runtimeConfig`:
  - `DEFAULT_RUNTIME_CONFIG.fastGate.patternInterventionMap` and `TESTBED_FAST_GATE_PATTERNS` (`boot.ts:34-40`) — the declared deterministic patterns, duplicated in two places, with `boot.ts` overriding the config's map wholesale rather than merging.
  - `minPatternSupport` is passed as `1` from `boot.ts:110` while the config default is `1` and `AdaptiveRuntime`'s fallback is `2` (`adaptiveRuntime.ts:295`) — three sources, one effective value.
  - `minOutcomeConfidence` never reaches the gate (F-20); `sequenceLength` comes from config.
  - Outcome-derivation constants (`rapidScrollMinEvents: 4`, `hoverDwellMinEvents: 2`, lookahead `[500, 1500]`) are hard-coded in `derive.ts:58-61` and duplicated in `pipelineConfig.json`, which is generated from `config.yaml`; the `OutcomeDeriver` is constructed with no options (`adaptiveRuntime.ts:232`), so the Python config values are not the ones in force.
  - `dwellTimeMs = count × 40 ms` (`features.ts:196`) and `scrollDepth = count × 80 / scrollable` (`:213`) are parity-preserving proxies; they are **construct-validity** choices, not implementation details (already flagged in the implementation record §4.4).
  - `taskManager` uses `Date.now()`; the window grid uses `performance.now()`.
  - `experiment.taskTimeoutsMs` defined, unused (F-15).
- **Impact:** the brief asks for high configurability so experiments can change parameters quickly; today several parameters that decide experimental behaviour live in code or in three competing defaults.
- **Recommended action:** see §I.

### F-24 — The documented model topology is not the deployed one

- **Area:** Model integration / architecture documentation / research validity
- **Severity:** **High** (documentation of the core learned component)
- **Evidence:** `VERIFIED` on both sides. `docs/architecture.md:181-182` and `final-report.md:17,40,53` describe the informed fusion as "GRU `R^144 → R^64`" then "`TargetInterventionHead` concatenates `h_T` with the 6-dim `R^6`" — i.e. a 70-wide input to the head. The deployed graph takes **`sequence_input (batch, seq, 18)` + `context_input (batch, 6)` → `intervention_logits (batch, 5)`** and internally concatenates the GRU's 64-wide hidden state with the context (`head.fc.0.weight [64, 70]` = 64 + 6; `intervention_head.onnx` introspection; `tests/intervention_head_contract.test.ts:5-6,199-217`). `OnnxSlowGate.infer` therefore feeds the **raw `[1,8,18]` sequence tensor** to the head (`onnxSlowGate.ts:300-331`) and runs the foundation graph in parallel on the same tensor; `h_T` is never read, surfaced, or recorded by the runtime.
- **Impact:** the architecture narrative describes a hidden-state-only interface, while the deployed model is a full-sequence encoder with context conditioning. Anyone reasoning about what the head "sees", why its confidence is what it is, or what an ablation isolates will be reasoning about a model that is not running. It also changes the meaning of the ablation arms in `model-preparation`.
- **Recommended action:** correct the architecture diagram and the report to the deployed dual-input fusion, or export a hidden-state-only head if that was the intended design.
- **Implementation required?:** Documentation correction; possibly a model re-export if the fusion point was meant to be `h_T`.
- **Human decision required?:** **Yes** — which topology is the intended research artifact.

### F-25 — The integration guide does not type-check against the shipped interfaces

- **Area:** Documentation / shareability
- **Severity:** Medium
- **Evidence:** `VERIFIED`. `docs/integration.md:27-91` documents a `UiAdapter` with `getTasks()`, `resolveUiContext()`, `notifyTaskEvent()`, `expectedSteps`, `timeoutMs`, and a `UIContext` of `{activePage, activeRegion, currentViewport, formValidity, openModalId}`. The real port (`src/integration/types.ts:75-146`) is `id`, `version?`, `getActiveContext?`, `getTaskState?`, `onTaskStateChange?`, `onTaskLifecycle?`, `recordInteraction?`, `abandonTask?(reason)`, `getTaskActionForEvent?`; the real `UIContext` is `route / activeComponentId / componentRole / taskId / taskStepId / availableActions / primaryActionAvailable / helpAvailable / expandable / viewport / document / scrollState / conditionId / uiVersion` (`src/types/uiContext.ts:78-98`). The same wrong interface also appears in `docs/data_schemas.md:126-139`, which is presented as the authoritative schema index. Additionally `integration.md:35,135,165` imports from `'edge-aui-framework/integration' | 'runtime' | 'telemetry' | 'types'`, but `package.json` is `"private": true` with **no** `main`/`module`/`exports`, so those specifiers do not resolve. `integration.md:128` names CSS classes `aui-highlight`/`aui-simplified`/`aui-tooltip-expanded`/`aui-assistance-active`; the actuator ships `edge-aui-highlight`, `edge-aui-simplified`, `edge-aui-tooltip-expanded`, `edge-aui-assistance-banner` (`actuator.ts:239,279,349,444`). `integration.md:220` gives `revertBehavior: 'on_reset' | 'timeout'`; the type is `'on_reset' | 'on_ttl' | 'on_action'` (`runtimeConfig.ts:133`). `integration.md:226` documents `traceSchemaVersion` default `'1.1.0'`; the constant is `'1.2.0'`.
- **Impact:** ADR-011 claims the framework can be embedded in another UI without bespoke configuration; the documented embedding path does not compile, so the portability claim is currently unproven outside the two in-repo adapters (which *do* pass `ui_adapter_contract.test.ts` and `ui_adapter_second_implementation.test.ts`).
- **Recommended action:** regenerate the guide from the real types, or add a doctest/compile check for the documented example.
- **Implementation required?:** Documentation.
- **Human decision required?:** No.

### F-26 — "Zero network primitives" is not true of model inference

- **Area:** Privacy claim accuracy
- **Severity:** Medium
- **Evidence:** `VERIFIED`. `architecture.md:387-388` states that no network primitives are reachable or called "during telemetry processing **or model inference**". `src/` contains no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon` call, but `onnxSlowGate.ts:166` calls `ort.InferenceSession.create(modelUrl)` (and the ORT Web runtime loads `ort-wasm-simd-threaded.jsep.wasm`), which is an HTTP fetch of same-origin static assets. The enforcing test (`tests/context_redaction.test.ts:214-259`) stubs network primitives around **telemetry** execution only.
- **Impact:** the claim as phrased is false; the *substantive* privacy property (no behavioural data leaves the client) is nonetheless true. Precision matters here because the thesis rests on it.
- **Recommended action:** rephrase to "no behavioural telemetry egress; model and runtime assets are loaded as same-origin static files", and extend the redaction test to cover an inference cycle.
- **Implementation required?:** Documentation + one test.
- **Human decision required?:** No.

### F-27 — Additional documentation defects confirmed by the consistency sweep

- **Area:** Documentation
- **Severity:** Low (each), except where noted
- **Evidence:** `VERIFIED` (174 local links machine-checked; counts from `filesystem`).
  - **One further broken ADR link:** `docs/integration.md:14` → `decisions/ADR-009-edge-model-storage-strategy.md`; the real file is `ADR-009-participant-telemetry-storage-export.md`. (Adds to the 6 broken links in §B.4.)
  - `docs/architecture.md:142` says "**Thirty symbols** in `src/macro/symbols.ts`" and `participant-readiness.md:45` says "30-symbol closed taxonomy"; `symbols.ts:9-47` contains exactly **26**.
  - `docs/experiments/condition-comparison.md:51` references macro symbols `FILTER_SELECT` and `FILTER_APPLY`; the canonical taxonomy uses `SELECT_REGION` / `APPLY_FILTER`. The comparison's own artifacts are therefore not reproducible from the documented vocabulary.
  - Both condition traces contain `microTensors` with `eventCount: 2`, which the live pipeline **cannot emit** (`min_events_per_window = 3`, `pipelineConfig.json:53`; `window.ts:236-240`). This directly contradicts `condition-comparison.md:30` ("identical code paths").
  - `docs/data_schemas.md:73` gives `trajectoryEntropy` scale `/5.0`; the implementation divides by `log2(8) = 3.0` (`features.ts:184`).
  - `runtime-benchmark.md:118` labels the payload row "**All client assets**" at 28 787 955 B; the actual `dist/` total is 28 819 461 B — the table omits `index.html`, `favicon.svg`, `icons.svg`, two Vite stubs and two miner chunks (31 506 B). Byte/1024 values are also labelled "KB" while assessments quote them as "MB" (26310.11 KB for 26 941 552 B).
  - `final-report.md:260` claims removing the ORT WASM binary brings initial client load to "~1.4 MB"; the residual is ≈ 1.99 MB, still far above the 500 KB target.
  - `final-report.md:137` cites "**D13** (Generalisation of TargetInterventionHead…)"; ADR-014 defines only D1–D12.
  - `participant-readiness.md:64-93` defines its own D1–D7 mapping while citing "ADR-014 (D1–D7)"; ADR-014's D1–D7 are different items (deployment hardening, edge payload, `dwellTimeMs` validity, legacy removal, …). Two incompatible deferment numbering schemes share one citation.
  - `final-report.md:120` and `participant-readiness.md:30,57` attribute the payload deferment to "ADR-008 **& ADR-011**"; ADR-011 (UI-adapter boundary) contains no payload/WASM/500 KB content.
  - `participant-readiness.md:56` states "45 test files, 324 tests"; actual: **47 files, 336 tests**.
  - `docs/benchmarks/vectoriser-parity.md:31` labels the geometry schema "v1.1.0" while `data_schemas.md:14` gives the MicroTensor feature schema as 1.0.0.
  - `docs/decisions/ADR-009-participant-telemetry-storage-export.md:39` and `ADR-013-substitute-data-source.md:47` still say trace schema `1.1.0`.
  - `docs/project_architecture.md:82` claims "sub-millisecond" Fast Gate recognition; the current artifact records PrefixSpan mean 7.35 ms, p95 33.13 ms. `:84` attributes Fast-Gate precedence to "ADR-006" and invents a "confidence differentials" rule that exists in no code.
  - `docs/experiments/random/traces/` also contains a schema `1.0.0` trace (`unknown-session`, all arrays empty) and a `1.2.0` trace (`7029a1f9`) that no assessment mentions.
- **Impact:** individually minor; collectively they mean the documentation set cannot yet be used as the authoritative record of what was built.
- **Recommended action:** regenerate the affected documents from code; add a machine check for (a) local link resolution and (b) documented constant equality with `src/config/runtimeConfig.ts` and `src/types/*`.
- **Implementation required?:** Documentation + one lightweight test.
- **Human decision required?:** No.

---

## E. Research-Readiness Gaps

### E.1 Participant telemetry collection

| Requirement | Status | Evidence |
|---|---|---|
| Captures interaction without obstructing it | **READY** | passive listeners, `capture: true, passive: true`; live session |
| Normalised, monotonic event model | **READY** | `observer.ts`, `normalizer.ts` |
| Geometry captured per event | **READY** | `captureGeometry()`, live records carry viewport/document |
| No keyboard/content capture | **READY (by absence)** | no key events bound; `BehaviourEvent` has no text field |
| No egress primitives | **READY** | zero network APIs in `src/` |
| Survives a long session | **GAP** | 10 000-item silent eviction (F-16) |
| Survives tab close / crash | **NOT IMPLEMENTED** | in-memory only |
| Participant identity | **NOT IMPLEMENTED** | anonymous session UUID only; no participant token (DEFERRED D2) |
| Consent / withdrawal | **NOT IMPLEMENTED** | DEFERRED D5 |

### E.2 Persistence

Nothing is persisted. There is no durable store, no queue, no retry, no schema versioning of stored records, no partial/failed-session handling, no duplicate-submission protection, no offline behaviour and no synchronisation — because no write path exists. `DEFERRED` by ADR-009/ADR-010/ADR-014 D3, and confirmed absent by grep.

### E.3 Dataset generation

| Layer | Exists? |
|---|---|
| A. Runtime collection | Yes (F-16 caveats) |
| B. Transport | **No** |
| C. Persistence | **No** |
| D. Dataset preparation | **Exists in `model-preparation`** (ingestion → Parquet → MicroTensor store → target dataset → training), but **rejects the current runtime's schema** (F-09) and re-derives outcomes independently |
| E. Research analysis | Partially: `scripts/verify-trace.mjs`, `scripts/compare-condition-traces.mjs`; no task-level metric computation (see E.4) |

### E.4 Task measurement

| Metric | Status |
|---|---|
| Task completion time | **Derivable, but not from the trace** — `TaskEvent.durationMs` exists and is computed from a single epoch clock (`taskManager.ts:178-181`; live `durationMs: 4953`), but task events cannot be aligned to behaviour events (F-01) and `metadata.durationMs` (20 121 ms) is a different quantity from task duration (4 953 ms) |
| Task success / failure | **PARTIAL** — completion is structural step-matching (F-15); no failure state |
| Task abandonment | **IMPLEMENTED** — `abandonTask`, navigation-triggered and reset-triggered (`taskManager.ts:96-120, 195-213`); no timeout path |
| Number of attempts | **GAP** — no attempt model; a reset discards the attempt |
| Backtracking | **PARTIAL** — `BACKTRACK` outcome and macro symbol exist; the app has no router, so `popstate`/`hashchange` rarely fire |
| Navigation errors | **PARTIAL** — `taskManager.errors` counts mis-targeted clicks, not wrong-route navigation |
| Interaction count | **DERIVABLE** — `behaviourEvents` / `macroInteractions` counts |
| Intervention count, timing, acceptance/dismissal | **PARTIAL** — applied/reverted/dismissed are recorded; acceptance/rejection decision is not (F-07); no TTL so "expired" cannot occur (F-03) |
| Time-to-completion after intervention | **GAP** — requires F-01 and F-07 |
| Condition-level comparison | **PARTIAL** — condition is on every relevant record and live separation was verified; the tooling's own evidence is fixtures (F-12) |

Items needing **new task lifecycle events**: step success predicate, explicit failure, attempt identity, timeout.
Items needing **persistent timestamps**: all of E.4 (F-01).
Items needing **explicit participant actions**: consent, withdrawal, session submission.
Items needing **methodological decisions**: what counts as success; whether adaptations expire; participant identifier strategy.

### E.5–E.7 Intervention observability, baseline/adaptive experimentation, UX assessment

Covered by F-03, F-05, F-07, F-08, F-12, F-15. The brief's required distinctions map as follows:

| Required distinction | Available today? |
|---|---|
| No prediction | Only implicitly (absence of a `PredictionEvent`) |
| Prediction below threshold | **No** (not recorded) |
| Policy rejected prediction | **No** — visible only transiently in the DebugPanel string (F-07) |
| Cooldown active | **No** (F-07); `cooldownRemainingMs()` exists and is unused by any recorder |
| Fast Gate handled interaction | Yes (`PredictionEvent.matchedGate`) |
| Slow Gate invoked | Yes (`matchedGate`, `slowResult`, per-gate latencies) |
| Intervention emitted | Yes (`InterventionEvent`) |
| Actuator failed | Only as a `console.warn` (`actuator.ts:93`) — **not** recorded |
| Intervention currently active | Yes in DOM (partially, F-05); not derivable purely from the trace |
| Intervention expired | **Impossible** — no TTL (F-03) |

---

## F. Task Coverage Matrix

Task definitions are `src/testbed/tasks/taskModel.ts:38-70`. Reachability and behaviour were checked against the live DOM and a live T1 run.

### F.1 Per-task factual assessment

**T1 — Filter Analytics** (`T1-1` nav-Analytics/click → `T1-2` filter-Region/click → `T1-3` filter-Region-select/change → `T1-4` btn-apply-filters/click)

| Aspect | Fact |
|---|---|
| Primary user goal | Narrow the results table by region and re-run the query |
| Expected interaction sequence | navigate → expand accordion → change select → submit form |
| Behavioural pattern exercised | filtering/navigation, form interaction, option disclosure |
| Expected telemetry | clicks, `change` on select, focus events, pointer kinematics, hover |
| Expected macro pattern | `NAV_ANALYTICS, OPEN_FILTERS, SELECT_REGION, APPLY_FILTER` |
| Observed macro stream | `NAV_ANALYTICS, OPEN_FILTERS ×18, SELECT_REGION …, APPLY_FILTER ×13` — noise-dominated (F-06) |
| Expected Fast Gate | declared pattern `SELECT_DATE > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER` needs a date step T1 never asks for; the shipped declared patterns are not aligned to the task |
| Observed Fast Gate | matched `NAV_ANALYTICS > OPEN_FILTERS` → `simplify_options`, rejected by policy (`Ineligible: No expandable options or accordions`) |
| Expected intervention | eligibility for `simplify_options` requires `context.expandable`, which `getActiveUIContext` sets only when the **tracked element** is an accordion (`contextProvider.ts:117-132`) — after a click on the apply button it is not |
| Expected observable UI change | accordion collapse (`edge-aui-simplified`) when eligible |
| Expected outcome | `task_complete` with a filtered table |
| Research metric | completion time, errors, filter use |
| Implementation status | **Completable** (live: 4/4 steps, `Completed`, `durationMs: 4953`); the region value is not validated, so selecting the default completes the step (F-15) |

**T2 — Export Report** (`T2-1` nav-Analytics/click → `T2-2` btn-export/click)

| Aspect | Fact |
|---|---|
| Goal | Export the visible result rows |
| Sequence | navigate → click export |
| Pattern | navigation + primary action |
| Expected macro | `NAV_ANALYTICS, EXPORT_REPORT` |
| Expected intervention | `highlight_primary_action` (declared pattern `OPEN_FILTERS > APPLY_FILTER` / `NAV_ANALYTICS > OPEN_FILTERS` map to it) |
| Observable UI change | `edge-aui-highlight` + `data-aui-active-adaptation="highlight"` on `btn-export` — **the only adaptation type that sets the correlation attribute** (F-05) |
| Status | **Completable**, 2 steps, no filtering required. Shortest task; exercises primary-action highlighting. Note: `condition-comparison.md:26` describes T2 as also filtering and applying — documentation error (F-12) |

**T3 — Configure Advanced Filter** (`T3-1` nav-Analytics → `T3-2` filter-Product Category/click → `T3-3` filter-segment-select/change → `T3-4` btn-apply-filters/click)

| Aspect | Fact |
|---|---|
| Goal | Change product category and customer segment, then apply |
| Sequence | navigate → expand category → checkbox toggles → advanced accordion → segment change → apply |
| Pattern | multi-accordion disclosure, checkbox interaction, option complexity |
| Expected macro | `NAV_ANALYTICS, OPEN_FILTERS, SELECT_CATEGORY, SELECT_SEGMENT, APPLY_FILTER` |
| Caveat | T3-3 targets `filter-segment-select`, which lives in the **Advanced Options** accordion; the step description says "Change Segment" after "Open Product Category", so the participant must discover a *second* accordion that the task never tells them to open. Usable, but it conflates "option complexity" with "hunt for the control" |
| Status | **Completable**; exercises the richest UI surface, and is the only task that would produce `SELECT_CATEGORY` |

### F.2 Coverage matrix (fact, not ranking)

| Behaviour / path | T1 | T2 | T3 | Notes |
|---|---|---|---|---|
| Habitual/repeated sequences | ○ | ○ | ○ | produced only as repetition artefacts (F-06) |
| Filtering / navigation | ● | ● | ● | all three start with `nav-Analytics` |
| Form interaction | ● | — | ● | `change` on select / checkbox |
| `FORM_SUBMIT` outcome | ● | — | ● | via `<form onSubmit>`; also fires for any click on a `btn`/`input` id (`derive.ts:100-105`) |
| Hesitation / dwell | ○ | ○ | ○ | producible by any hover; no task step requires it |
| Hover/dwell | ○ | ○ | ○ | KPI cards and tooltips are hover-annotated |
| Backtracking | — | — | — | no router; `popstate`/`hashchange` practically unreachable |
| Rapid scrolling | ○ | ○ | ○ | needs 4 scroll/wheel events in one lookahead horizon; not required by any task |
| Option complexity | ● | — | ● | accordions + checkboxes |
| Tooltip/help demand | ○ | ○ | ○ | tooltips exist but no task requires consulting one |
| Intervention opportunities | ● | ● | ● | eligibility depends on the currently tracked element (F-06) |
| No-intervention control cases | implicit | implicit | implicit | no task is designed as a negative control |
| Fast Gate match | ○ | ○ | ○ | matches are noise-driven (F-06) |
| Slow Gate invocation | ● | ● | ● | fires on every Fast Gate miss; live `slowGateMode: 'onnx'` |
| Learned head prediction | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | every observed decision was `fast_gate_pattern`; no live `mappingSource: 'learned_head'` was observed in any run or trace reviewed by this audit |
| Macro symbols reached | 5 | 3 | 7 | `CLOSE_FILTERS`, `RESET_FILTERS`, `TABLE_PAGE_*`, `TABLE_SORT`, `OPEN_REPORT`, `EXPAND_TOOLTIP`, `BACKTRACK`/`IDLE_DWELL`/`RAPID_SCROLL`-as-symbol are **not producible** by the shipped UI |

Legend: ● exercised and observed/producible; ○ producible incidentally but not required; — not producible.

### F.3 Gaps identified

- **Redundant:** all three tasks begin identically (`nav-Analytics`) and all three end on `btn-apply-filters` (T1, T3) or a primary action (T2); T1 and T3 differ mainly in which accordion they open.
- **Tasks that do not exercise the intended behaviour:** none are impossible, but none *forces* hesitation, dwell, backtracking or rapid scrolling, so the intended behavioural patterns depend on incidental participant behaviour.
- **Tasks that depend on accidental UI state:** T1/T3 step success depends only on touching controls, not on producing the required filtered state (F-15).
- **Tasks that cannot produce the intended telemetry:** the learned Slow Gate head has no verified live intervention; if the experiment's adaptive condition is meant to be driven by `TargetInterventionHead`, no task currently demonstrates it.
- **Intervention visibility that is too subtle:** `simplify_options` collapses accordions (clear), `highlight_primary_action` adds a CSS class (subtle if the class styling is not salient); only the latter sets a correlation attribute.
- **Missing control/baseline tasks:** there is no task designed to produce *no* eligible intervention, and no explicit negative-control trial.
- **Missing explicit "no-intervention" case:** none of the tasks is annotated as such; the only negative control is the whole `baseline` condition.

---

## G. Intervention Observability Matrix

Every intervention path observed or traceable in the current implementation.

| Intervention | Prediction source | Trigger | Policy decision | Actuator | Visible effect | Dev-panel evidence | Trace evidence | Verification status |
|---|---|---|---|---|---|---|---|---|
| `highlight_primary_action` (fast) | `PrefixSpanFastGate` via declared pattern map | mined pattern matches recent macro symbols | confidence 1.0 (default) → context: requires `primaryActionAvailable` → persistence ≥ 2 windows → cooldown | `applyHighlightPrimaryAction` adds `edge-aui-highlight` + `data-aui-active-adaptation="highlight"` on `[data-aui-role="primary-action"]` fallback | button styling | "Fast Gate: MATCH (pattern)"; "Intervention: highlight_primary_action [fast]"; "Policy State: …" | `PredictionEvent{matchedGate:'fast', mappingSource:'fast_gate_pattern'}` + `InterventionEvent{accepted/applied}` | `VERIFIED` in an earlier live trial (implementation record §14c); this audit observed the pattern attempt but the policy rejected it for `simplify_options` |
| `simplify_options` (fast) | same | declared pattern `NAV_ANALYTICS > OPEN_FILTERS` | rejected in this audit because `expandable` was false at evaluation time | `applySimplifyOptions` adds `edge-aui-simplified` to `filter-drawer` **and clicks accordions closed** | accordion collapse | "Intervention: no_op [fast]"; "Policy State: Ineligible: No expandable options or accordions" | `PredictionEvent` yes; **rejection not recorded** (F-07); earlier run has `accepted`+`applied` | **`VERIFIED` applied** in the first live run (DOM `.edge-aui-simplified` present); the panel text afterwards describes the *last* decision, not the active adaptation |
| `expand_tooltip` (fast or slow) | declared pattern `HOVER_KPI > HOVER_KPI`, or learned head / deterministic map | hover repetition | confidence → `helpAvailable || targetComponentId` | injects `.edge-aui-tooltip-bubble` with `aria-describedby`, Escape to dismiss | tooltip bubble | "Intervention: expand_tooltip" | `InterventionEvent{applied}` then `dismissed` on Escape | `IMPLEMENTED` + unit-tested (`actuator.test.ts`); **not observed live** in this audit |
| `offer_assistance` | deterministic map for `BACKTRACK`/`ABANDON`, or learned head | any eligible outcome | always context-eligible | banner `aside.edge-aui-assistance-banner` with dismiss button | banner | "Intervention: offer_assistance" | applied/dismissed | `IMPLEMENTED` + unit-tested; **not observed live** |
| `no_op` | arbitration returns no intervention, or policy returns `createNoOpCommand` | any rejected candidate | "accepted" as safe default | `apply()` emits an `applied` event for `no_op` too (`actuator.ts:79-89`) | none | "Intervention: no_op"; "Policy State: <reason>" | `InterventionEvent{type:'issued', intervention:'no_op'}` — **and the actual reason is lost** (F-07) | `VERIFIED` — 3 of 5 intervention records in the live trace are `issued: no_op` |

### Why interventions are currently difficult to confirm (evidence, not assumption)

Ordered by observed contribution:

1. **The rejection reason is never persisted** (F-07). Live trace: `issued: no_op` three times with no recorded reason; the panel showed the last reason only because `debugBus` happened to hold it.
2. **No TTL, and only one adaptation type sets a correlation attribute** (F-03, F-05). The applied `simplify_options` was still present in the DOM minutes later with `[data-aui-active-adaptation]` returning `[]`.
3. **The Fast Gate's winning patterns are repetition artefacts**, so "it matched" is not evidence of the intended behavioural pattern (F-06).
4. **The panel describes the last decision, not the active state**, and zeroes the macro sequence every 500 ms (F-08).
5. **Long round trips drop evaluations**: `EVALUATE`/`PUSH_WINDOW` timeouts at 5 000 ms (F-02), so an evaluation can silently never happen.
6. **`latestWindowId` attribution is ambiguous**, so the panel's numbers cannot be tied to a specific window (F-18).
7. **No live `learned_head` decision was observed** in any run or trace examined; where the slow path did fire, the recorded `mappingSource` must be checked per record rather than assumed.
8. **Low confidence** remains plausible but is *not* the demonstrated cause here: the observed rejections were context-eligibility, not confidence.

Not observed as causes in this audit: wrong selector (the actuator's selector resolved and matched), actuator failure (no `[UIActuator] DOM root not available` warning), and short TTL (no TTL exists).

---

## H. Test Coverage Matrix

`npx vitest run` at HEAD: **47 files, 336 tests, 336 passed, 0 failed, 24.4 s** (`VERIFIED`). All test files run under `jsdom` (`vitest.config.ts:9`) — there is no real-browser test in the suite.

| Suite | Class | What it genuinely tests | What it does not |
|---|---|---|---|
| `parity.test.ts`, `vectorizer_parity.test.ts`, `parity_fixture_provenance.test.ts`, `windowing_reference_equivalence.test.ts` | parity | 18-D feature order, scales, masks, half-open boundaries at 1e-4; fixture re-derivation via Python | live-vs-Python window **count** equivalence (F-04) |
| `telemetry_observer.test.ts`, `telemetry_normalizer.test.ts` | unit | event binding, normalisation, listener isolation | real browser dispatch; backgrounded-tab behaviour; event-loss under load |
| `windowing_contract.test.ts`, `microtensor_window.test.ts` | unit | grid, inactivity, late/sparse counters, geometry | whether the shipped configuration produces the counters the docs claim (F-04) |
| `outcome_derivation.test.ts` | unit/schema | Python lookahead semantics, 7 cases | live settling under load; the ABANDON-on-`pagehide` path is not exercised end to end |
| `macro_sequence.test.ts`, `macro_symbols.test.ts`, `macro_fast_gate_wiring.test.ts` | unit | stream, symbol derivation, corpus shape | that derived symbols correspond to intended user actions (F-06) |
| `prefixspan_fast_gate.test.ts`, `fast_gate.test.ts` | unit | gate semantics, fail-safe on miner throw | the miner's own correctness/bound (F-02) — the miner is injected/stubbed |
| `slow_gate.test.ts`, `onnx_contract.test.ts`, `intervention_head_contract.test.ts` | contract | graph shapes, class counts, softmax, dual execution | WebGPU (unavailable in the harness); runtime-vs-training parity on identical inputs beyond shape |
| `gate_arbitration.test.ts`, `gate_routing_evidence.test.ts` | integration | routing, short-circuit, per-gate latency fields, error handling | that the latency values come from a real model run — the tests inject literals (`:191,238,331`) |
| `intervention_policy.test.ts`, `policy_cooldown_ttl.test.ts` | unit | thresholds, persistence, cooldown, dismissal, TTL **when set** | that production ever sets a TTL (F-03) |
| `actuator.test.ts` | unit | reversibility, focus preservation, ARIA, Escape; TTL expiry when set | correlation attributes on non-highlight adaptations (F-05) |
| `adaptive_runtime.test.ts` | integration | the composed pipeline produces events/windows/outcomes with ids | concurrency, worker timeouts, condition switching under load |
| `worker_runtime.test.ts` | integration | request/response contract, fallback core | backpressure, head-of-line blocking, timeout behaviour (F-02) |
| `task_wiring.test.tsx`, `active_ui_context.test.tsx`, `semantic_dom_annotations.test.tsx`, `target_ui_components.test.tsx` | component | every task step references a rendered component; stimulus determinism | state-based success, failure, timeout (F-15) |
| `ui_adapter_contract.test.ts`, `ui_adapter_second_implementation.test.ts` | contract | the `UiAdapter` port and a second implementation | — (this is good evidence of portability) |
| `trace_attribution_verifier.test.ts`, `trace_mapping_attribution.test.ts`, `context_redaction.test.ts` | schema/contract | verifier logic, mapping-source attribution, no egress primitives, no field values | verifier behaviour on real captures (F-13) |
| `condition_trace_comparison.test.ts` | integration | comparison CLI over **hand-authored fixtures** | any real two-condition run (F-12) |
| `e2e_simulation.test.ts` | integration (jsdom) | a scripted composition of mock gates + policy + actuator + recorder | the real runtime, real gates, real ONNX, real worker |
| `runtime_instrumentation.test.ts`, `pipeline_configuration.test.ts`, `sync_config.test.ts`, `documentation_schema_index.test.ts`, `adr_register_consistency.test.ts` | contract/determinism | stage/side registry, config validation, config sync, doc/schema index, ADR register shape | that documentation **claims about code** are true — `adr_register_consistency.test.ts` checks ADR files exist and carry deferment fields, but not that the ADR *names cited in other docs* exist (F-27) |

### Claims with no corresponding test

| Claim | Where | Status |
|---|---|---|
| Baseline and adaptive differ only by the adaptation mechanism | `participant-readiness.md:16` row 16 | verified live by this audit (0 DOM mutations in baseline), **not** by any test on real traces |
| Intervention activation is verifiable | brief §10 | no test asserts that an applied adaptation is correlatable in the DOM to the trace episode |
| Fast Gate latency < 5 ms | `final-report.md:118` | no benchmark measures it (F-14) |
| TBT = 0 ms | `runtime-benchmark.md` | hardcoded (F-14) |
| Traces are complete / no dropped windows | `verify-trace.mjs` | real captures fail the verifier (F-13) |
| The learned head is exercised | `intervention_head_contract.test.ts` | tests the gate in isolation; no live `learned_head` decision was observed |
| Schema compatibility with the dataset pipeline | — | no cross-repository contract test; the two sides disagree (F-09) |
| Task completion time is measurable | brief §7 | no test; not derivable from a trace (F-01) |

Failure-path coverage: gate exceptions are covered; **worker timeout, request cancellation on condition switch, buffer eviction, trace overflow, and partial-session loss are not**.

---

## I. Configuration Audit

Materially experimental values that are currently hard-coded or defined-but-dead.

| Parameter | Where it lives | Should be configurable? | Current effect |
|---|---|---|---|
| Fast Gate declared pattern → intervention map | `DEFAULT_RUNTIME_CONFIG.fastGate.patternInterventionMap` **and** `TESTBED_FAST_GATE_PATTERNS` (`boot.ts:34-40`) | Yes — it defines the deterministic arm | two sources; `boot.ts` overrides the config entirely |
| `minPatternSupport` | config (`1`), `AdaptiveRuntime` fallback (`2`), `boot.ts` (`1`) | Yes | effective value is `1`; three sources |
| Slow Gate confidence threshold | `slowGate.confidenceThreshold: 0.75` (dead) vs `OnnxSlowGate` default `0.5` | Yes | effective 0.5, then policy 0.75 (F-20) |
| Slow Gate model paths | `slowGate.modelPath` (dead, points at a nonexistent file) vs hard-coded `DEFAULT_MODEL_URL` | Yes | traces record a model that never loads (F-17) |
| Outcome-derivation constants (`rapidScrollMinEvents`, `hoverDwellMinEvents`, lookahead) | hard-coded in `derive.ts:58-61`; `OutcomeDeriver` constructed with no options | Yes — they define the label semantics | config.yaml values are mirrored in `pipelineConfig.json` but not passed to the deriver |
| Event sampling | `telemetry.sampleIntervalMs` (wired) | Yes | `0` = every browser event; throughput driver of trace volume |
| Enabled event types | `telemetry.enabledEventTypes` (dead) | Yes | all bound event types are captured |
| Policy TTL / actuation TTL | `policy.ttlMs`, `actuation.defaultTtlMs` (dead) | Yes — how long an adaptation is visible | no expiry (F-03) |
| `maxInterventionsPerTask`, `sustainedConfidenceDurationMs`, `conflictResolution` | dead | Yes if the experiment requires them | none |
| Task timeouts | `experiment.taskTimeoutsMs` (dead) | Yes | no timeout-driven failure/abandonment |
| Trace buffer size | `telemetry.maxBufferSize` (dead; recorder default 10 000) | Yes | silent eviction beyond the cap (F-16) |
| Task step success criterion | code (`taskManager.ts:136-141`) | Yes — it defines "success" | component-id matching only (F-15) |
| Macro grouping interval | `macro.groupingIntervalMs` (wired, 2 000 ms) | Yes | drives the mining corpus shape |
| `dwellTimeMs`/`scrollDepth` proxies | `features.ts:196, 213` | Parity-locked | construct-validity question, not a config bug |

Values that are legitimately implementation details and should **not** be exposed: the 125 ms tick interval (`adaptiveRuntime.ts:504`), the 60 s INIT timeout, the 5 s RPC timeout (though see F-02 — this one should become adaptive), `escapeCssAttributeValue`, the `HttpOnly`-free session UUID generator.

---

## J. Legacy / Dead-Code Findings

Nothing was deleted or modified. Classifications:

| Item | Classification | Evidence |
|---|---|---|
| `src/gates/fast/mockFastGate.ts` | **Needs verification** | still exported and unit-tested; no longer used by the shipped boot because `boot.ts` always supplies a non-empty pattern map → `fastGateMode: 'prefixspan'` (`adaptiveRuntime.ts:291`). Retained as the test double and as the no-pattern fallback |
| `src/gates/slow/mockSlowGate.ts` | **Intentionally retained** | the explicit fallback when ONNX is unavailable (`core.ts:99`) and the test double |
| `src/gates/slow/onnxSlowGate.ts` `useDeterministicMapping` arm | **Intentionally retained** (ablation) | but not the teacher policy (F-11) |
| `src/runtime/workerClient.ts` in-process fallback | **Intentionally retained** | lazy import; reached only when `Worker` is unavailable, i.e. tests |
| `docs/experiments/baseline-trace.json`, `adaptive-trace.json` | **Misleading** — needs replacement, not removal | hand-authored fixtures presented as trial exports (F-12) |
| `docs/experiments/report-export-*.json` (3 files, 2026-09-22/23) | **Obsolete** | legacy `ResultsTable` export payloads, unrelated to the trace schema |
| `docs/experiments/random/traces/experiment-trace-unknown-session-1789699931139.json` | **Obsolete** | schema `1.0.0`, all arrays empty — predates the current recorder |
| `model-preparation/models/model.onnx` / `model_int8.onnx` (49 278 / 50 892 B) | **Conflicting implementation** | 6-class / hidden-32 graphs contradicting `config.yaml` (7 classes, hidden 64) and their own checkpoint; the correct 7-class graph exists only on the edge side. `dvc.lock` is stale. `model.onnx.data` is an orphaned sidecar |
| `slowGate` config keys (`modelPath`, `executionProvider`, `targetContextEncoding`, `fallbackBehavior`, `batchSize`, `enabled`) | **Dead configuration** | F-17 |
| `telemetry.enabledEventTypes`, `captureGeometry`, `sessionSettings`, `windowing.lateEventPolicy`, `fastGate.maxPatternLength`, `rankingStrategy`, `policy.{sustainedConfidenceDurationMs,maxInterventionsPerTask,conflictResolution,ttlMs}`, `actuation.{defaultMechanism,revertBehavior,defaultTtlMs}`, `experiment.{trialOrder,taskTimeoutsMs}` | **Dead configuration** | F-17 |
| `adaptation.defaultMechanism` semantics (DOM vs css_class) | **Unknown / deprecated** | only CSS/ARIA adaptation exists |
| `src/gates/fast/prefixSpanMiner.ts` vs the former `WasmGateClient` | **Resolved** | the record documents the removal; no `WasmGateClient` remains |
| `src/main.ts`, `src/core/**`, `src/types/telemetry.ts`, `src/workers/onnx-gate/**`, `src/workers/wasm-gate/**` | **Already removed** | absent from the tree; the implementation record §14b documents the removal |
| `scripts/quantify-sparse-window-loss.mjs` | **Needs verification** | globs the whole traces directory, so its documented figures no longer reproduce once a seventh trace was added (documented 6 traces / 14 765 events / 10.95 %; current directory → 7 traces / 21 604 events / 9.50 %) |
| `dist/` | **Generated, stale** | contains the four model files copied from `public/models` plus a previous build; not part of the assessment beyond size evidence |

No item in this list requires removal to execute the audit; all are documented only.

---

## K. Architectural Decision Log

Each item requires the human researcher. Format per brief §2.

### K-1 Persistence architecture and participant identifier strategy

- **Decision:** Where participant telemetry is durably stored (browser-local with manual export; browser-local with opt-in sync; or a research ingress endpoint), and how a participant is identified across sessions without collecting PII.
- **Why it matters:** it determines consent text, retention, the failure model for a participant study, and whether "collection" exists at all. It also decides whether the developer panel export survives a closed tab.
- **Current implementation:** in-memory only; a single anonymous UUID per session (`session.ts:39-75`); manual JSON download (`recorder.ts:297-323`); no storage or network primitive anywhere in `src/` (`VERIFIED` by grep); ADR-009/010/D3 mark this deferred.
- **Options:** (a) session-scoped IndexedDB write-ahead with end-of-session export; (b) researcher-mediated export only; (c) opt-in encrypted upload to a study endpoint; (d) adaptive streaming with consent gating.
- **Evidence required:** a decision on retention and consent; a threat model for the ingest path; a measured storage footprint against the 20 MB memory constraint.
- **Recommended next investigation:** prototype (a) behind the existing `UiAdapter` port so no core module changes.
- **Human decision required:** **Yes.**

### K-2 Cross-repository trace schema of record

- **Decision:** Whether the runtime emits `1.1.0`-compatible traces, or `model-preparation` ingestion moves to `1.2.0` (and who owns the next version bump).
- **Why it matters:** today no trace can be ingested, so the dataset milestone is blocked (F-09).
- **Current implementation:** runtime `1.2.0` (`traceSchema.ts:31`); ingestion pinned to `1.1.0` (`trace_ingestion.py:42,110-115`).
- **Options:** (a) ingestion accepts 1.2.0 with an explicit allow-list; (b) runtime downgrades; (c) a single generated schema checked into both repositories with a contract test.
- **Evidence required:** the exact field-set delta (mappingSource, modelVersion, contextEncodingVersion, per-gate latencies, prediction arrays, taskEvents).
- **Recommended next investigation:** diff `KNOWN_TRACE_KEYS`/`KNOWN_BEHAVIOUR_EVENT_KEYS` against the runtime types and run one real trace through a patched ingestion copy.
- **Human decision required:** **Yes.**

### K-3 Canonical clock for trace records

- **Decision:** one monotonic timeline anchored to an epoch, or per-record clock tags.
- **Why it matters:** task completion time, intervention timing and replay all depend on it (F-01).
- **Current implementation:** mixed (`performance.now()` for behaviour/windows/outcomes; `Date.now()` for predictions/interventions/tasks).
- **Options:** (a) monotonic everywhere + `startedAtEpochMs` anchor; (b) epoch everywhere; (c) explicit `clock` tag per record.
- **Evidence required:** none beyond the decision; the change is mechanical.
- **Recommended next investigation:** none.
- **Human decision required:** **Yes** (choice of record format).

### K-4 Adaptation lifetime

- **Decision:** do interventions expire, revert on user action, or persist for the session?
- **Why it matters:** it changes what the participant experiences and what the trace means (F-03).
- **Current implementation:** persist indefinitely; TTL config exists but is never applied.
- **Options:** (a) apply `actuation.defaultTtlMs`; (b) revert on next qualifying user action; (c) document session-persistence as the intended behaviour.
- **Evidence required:** a pilot observation of whether a persistent adaptation contaminates the rest of a task.
- **Recommended next investigation:** instrument active-adaptation duration in the trace and measure it in a scripted run.
- **Human decision required:** **Yes.**

### K-5 Task list changes and the definition of task success

- **Decision:** whether the task set changes, and whether success becomes state-based.
- **Why it matters:** task completion time and success rate are the primary UX metrics (F-15).
- **Current implementation:** T1–T3; component-id step matching; no failure state; no attempt model; no timeouts.
- **Options:** (a) keep the task list and add state predicates + `Failed` + timeout; (b) redesign tasks to force hesitation/backtracking; (c) add an explicit no-intervention control task.
- **Evidence required:** a coverage claim per task against the behavioural patterns the experiment needs.
- **Recommended next investigation:** run each task once with a scripted driver under both conditions and check whether the intended telemetry patterns actually appear (this audit found they do not, for the Fast Gate).
- **Human decision required:** **Yes.**

### K-6 Intervention visualisation strength

- **Decision:** how visible an adaptation must be for both the participant and the researcher, without changing the task.
- **Why it matters:** too subtle and the intervention cannot be evaluated; too strong and it becomes the experiment.
- **Current implementation:** CSS class / ARIA attribute / injected banner; only `highlight_primary_action` sets a correlation attribute.
- **Options:** (a) strengthen styling; (b) add a permanent, unobtrusive adaptation indicator; (c) leave as is and rely on the dev panel.
- **Evidence required:** pilot discrimination (can a participant tell? can the researcher confirm from the DOM?).
- **Recommended next investigation:** screenshot both adaptation states and compare.
- **Human decision required:** **Yes.**

### K-7 Baseline/adaptive protocol, randomisation and counterbalancing

- **Decision:** within- or between-subjects; order; how many trials per condition; whether the condition is switched in-session (the current mechanism) or fixed per session.
- **Why it matters:** the current switch is manual, order is fixed, and in-flight work is destroyed on switch (F-21); D7 records no Latin-square sequencer.
- **Current implementation:** manual buttons in `TrialControls`; `experimentId` per page load; `conditionId` on the session.
- **Options:** (a) fixed condition per session via URL; (b) counterbalanced rotation; (c) keep manual for lab-only use.
- **Evidence required:** the study design.
- **Recommended next investigation:** none until the design is fixed.
- **Human decision required:** **Yes.**

### K-8 Miner strategy: repair, replace, or bound

- **Decision:** repair the Rust PrefixSpan to standard semantics, bound it and keep it, or replace the Fast Gate's mining with a maintained implementation.
- **Why it matters:** the current miner produces multi-second blocking on a tiny corpus (F-02) and its pattern semantics differ from the literature.
- **Current implementation:** `wasm-vectorizer/src/prefix_span.rs` subsequence-enumeration variant.
- **Options:** (a) fix semantics + hard bounds; (b) keep semantics, add bounds only; (c) move mining off the critical path (periodic, cached).
- **Evidence required:** a bounded benchmark: corpus size vs latency vs pattern count.
- **Recommended next investigation:** instrument pattern counts per evaluation and re-measure.
- **Human decision required:** **Yes** if the fix changes what "Fast Gate match" means.

### K-9 Developer panel in participant builds

- **Decision:** does the panel ship, and is it researcher-only?
- **Why it matters:** production builds exclude it (`DebugPanel.tsx:44-50`, `App.tsx:61`), so a packaged study builds without observability.
- **Options:** (a) keep dev-only and rely on `?auiDiagnostics=1`; (b) ship a researcher-locked panel; (c) ship a minimal status strip.
- **Evidence required:** whether the study needs live observation.
- **Human decision required:** **Yes.**

### K-10 Provenance and claim boundaries

- **Decision:** how the synthetic-label provenance and the scripted-trace boundary are represented in every artifact that reports results (traces, benchmarks, comparisons).
- **Why it matters:** `ADR-013` already fixes the boundary ("scripted, not observed"), but `sparse-window-loss.md:20` says "real participant traces" and the condition comparison presents fixtures as runs (F-12). Provenance must be machine-readable, not prose.
- **Current implementation:** `is_scripted_policy: true` in the offline dataset; `session.participantId` is `null`/absent in traces; no provenance field on traces or benchmarks.
- **Options:** (a) add `provenance: 'scripted' | 'participant'` to the trace session and benchmark artifacts; (b) state it only in prose; (c) both.
- **Evidence required:** none.
- **Human decision required:** **Yes** (a change of record format).

---

## L. Recommended Next Milestones (derived from this audit)

The brief's suggested milestone families are not taken as given. The order below is derived from what actually blocks the stated next goal.

**Dependency order**

```
M0 Make the record trustworthy   (F-01 clock, F-07 policy records, F-18 window attribution, F-05 episode attribute)
     │  without this, everything collected is uninterpretable
     ▼
M1 Make collection survivable    (F-16 persistence, F-19 model provenance, F-03 TTL decision)
     │  without this, sessions are lost and adaptation state is uncontrolled
     ▼
M2 Unblock the dataset path      (F-09 schema contract, cross-repo ingestion test)
     │  without this, no dataset can be built
     ▼
M3 Make the gate meaningful      (F-02 miner bound/backpressure, F-06 macro symbols, F-04 window measurement)
     │  without this, "the adaptive condition intervened for a reason" is not demonstrable
     ▼
M4 Make the intervention legible (F-08 panel, F-12 fixture replacement, F-14 claim corrections)
     ▼
M5 Task and protocol work        (F-15 success/failure/attempt, K-5 task list, K-7 protocol)
     ▼
M6 Participant packaging         (consent, participant id, deployment, cross-browser) — DEFERRED today
```

**M0 — Trustworthy record (smallest slice that removes the most important blocker).**
1. Single canonical timeline for all trace records (F-01) — 6 call sites, no schema-structure change if a clock tag is used.
2. Record policy decisions, including rejections and the baseline decision-only branch (F-07).
3. Capture the evaluated window id at evaluation time (F-18).
4. Add the episode id DOM attribute to every adaptation type (F-05).
5. Wire `actuation.defaultTtlMs` or record an explicit decision that adaptations persist (F-03).
6. Add a regression test that exports a real capture and asserts: single-clock ordering, no orphaned windows, every applied episode has a terminal event, and each applied episode is DOM-correlatable.

This slice touches no model, no policy semantics, no task definitions, and no UI design. It converts the current trace from "populated" to "usable", and it is a precondition for every measurement in the brief's §7.

**M1 — Survivable collection.** Durable session storage (IndexedDB write-ahead or equivalent) behind the integration port, session-recovery on reload, an eviction counter instead of silent `shift()`, and model-provenance capture from the bundle manifest (F-19). This is where the persistence decision (K-1) must already have been made.

**M2 — Dataset path.** Resolve the schema contract (K-2), add a cross-repository ingestion contract test using one real trace, and stop re-deriving outcomes offline when the trace carries them (or make the re-derivation an explicit cross-check).

**M3 — Meaningful gate behaviour.** Repair/bound the miner, add evaluation backpressure and workload-aware timeouts, fix macro symbol derivation, and re-measure `skippedSparseWindows`/`settledSparseWindows` under the shipped configuration. Only after this does "the Fast Gate recognised a known pattern" become a defensible sentence.

**M4 — Legible interventions and honest claims.** Panel fields (F-08), replace the fixture comparison with real exports (F-12), correct the benchmark generator and the narrative numbers (F-14).

**M5 — Tasks and protocol.** State-based success predicates, a failure state, attempt identity, timeouts, and the task-list decision (K-5).

**M6 — Participant packaging.** Consent, participant identifier, deployment, cross-browser validation — already `DEFERRED` under ADR-014 and correctly so until M0–M2 land.

**Not recommended now:** UI redesign, WASM migration of the vectoriser, backend/database introduction, model retraining, changing intervention semantics. The brief forbids all of these, and nothing found in this audit argues for revisiting that.

---

## M. Final Question: what prevents participant deployment today?

### Must fix before participant deployment

1. **F-01 — mixed clocks.** Without a single timeline there is no defensible task completion time, no intervention timing, and no replay.
2. **F-16 — no persistence and silent eviction.** A participant session longer than a few minutes loses its start, and a closed tab loses everything.
3. **F-09 — the dataset pipeline rejects the runtime's schema.** Collection without a consumer is not collection.
4. **F-02 — the worker drops evaluations and windows under load.** Real sessions lose telemetry at exactly the wrong moments; a participant cannot be asked to redo a session.
5. **F-07 — no policy-decision record.** Without it, no analysis can distinguish "did not intervene because the model was unsure" from "because the UI made it ineligible".
6. **K-1, K-2, K-3 decisions must be taken** (storage, schema of record, clock).

### Must fix before meaningful UX assessment

7. **F-15 — no task failure, no state-based success, no timeout, no attempt model.** Completion time and success rate are currently "touched the right controls".
8. **F-03 — uncontrolled adaptation lifetime.** An intervention that never expires contaminates the remainder of a participant's session.
9. **F-06 — macro symbols and Fast Gate matches are repetition artefacts.** The adaptive condition is not demonstrably intervening for the intended reason.
10. **F-05 + F-08 — the applied adaptation cannot be confidently attributed, live or post hoc.**
11. **F-04 — the live window definition differs from the Python reference; unmeasured since ADR-005.**

### Should fix for research reliability

12. **F-13 — traces fail the project's own verifier; the harness only passes fixtures.**
13. **F-18 — duplicate/ambiguous window attribution on predictions.**
14. **F-21 — condition switching destroys in-flight work and leaves a stale diagnostics handle.**
15. **F-11 — the ablation arm is not the teacher policy.**
16. **F-20 — Slow-Gate confidence threshold mismatch.**

### Should fix for maintainability / shareability

17. **F-14 — benchmark generator fabricates the event count and hardcodes TBT.** Every number in the narrative docs should be regenerable.
18. **F-12 — replace the fixture-based condition comparison.**
19. **F-17 — wire or delete dead configuration; never serialize unenforced values as `effectiveConfig`.**
20. **F-24 — the documented head topology (`h_T ⊕ R^6`) is not the deployed one (raw `R^144 ⊕ R^6`).** This is a description of the core learned component, so it affects how the model is explained, not just how the code is documented.
21. **F-25 — the integration guide's `UiAdapter`/`UIContext` example, CSS class names and package import paths do not match the shipped interfaces.** The ADR-011 portability claim is unproven outside the two in-repo adapters until this is fixed.
22. **F-27 — the ADR-link breakage (7 links across 4 documents), the "30 symbols" error, the non-canonical symbols and sub-threshold windows in the condition-comparison artifacts, the phantom D13, the two competing D-number maps, the stale test counts (324 vs 336), the `ADMIN`-scale unit confusion, and the two ADRs still naming schema 1.1.0.**
23. **The stale implementation record** should be labelled historical at the top so a reader does not treat §4 "known limitations" and §5 readiness as current.
24. **F-19 — model provenance in the trace.**
25. **F-26 — rephrase the absolute "no network primitives during model inference" claim and extend the redaction test across an inference cycle.**
26. **The artifact budget (28.82 MB vs 500 KB) remains unmet** and is already tracked as ADR-008/D6; it does not block a lab study but does block easy participant distribution.
27. **Nine dead config keys that imply storage, TTL or event filtering** (`sessionSettings.storagePrefix`, `idleTimeoutMs`, `enabledEventTypes`, `captureGeometry`, `lateEventPolicy`, `policy.ttlMs`, `actuation.defaultTtlMs`, `defaultMechanism`, `revertBehavior`) — flagged because their names promise behaviour the system does not have.

### Can remain deferred

- Cross-browser/mobile validation (D4) — a lab study can standardise on Chromium.
- Counterbalanced sequencing (D7) — only needed once a multi-participant design exists.
- Participant token authentication (D2) — needed with remote collection, not with researcher-mediated export.
- ONNX Runtime payload reduction (D6) — needed for distribution, not for measurement.
- Pagination/sorting surfaces (D1) — the tasks do not need them.
- INT8 GRU quantisation gains — the models are already inside budget (703 968 B for four graphs).

### The smallest next implementation slice

**M0 as defined above**, and specifically in this order: (1) one clock across trace records; (2) policy-decision records including rejections and the baseline branch; (3) evaluation-time window capture; (4) episode-id DOM attribute on every adaptation; (5) a regression test that exports a real capture and asserts trace self-consistency.

That is roughly one schema bump, four small call-site changes, one DOM attribute, and one test. It requires **no** model change, **no** policy-semantics change, **no** task change and **no** UI redesign, and it removes the largest obstacle to every measurement the brief lists — while leaving the persistence and schema-of-record decisions (K-1, K-2) in the researcher's hands.

**This audit does not begin that slice.** Per the brief's scope boundary, implementation waits for explicit authorisation after review of these findings.

---

## N. Audit Artefacts Produced

All outside the repository; nothing tracked was modified (`git status` shows only the pre-existing uncommitted benchmark files plus the brief itself).

| Artefact | Purpose |
|---|---|
| `/tmp/aui-live-audit.mjs`, `/tmp/aui-live-audit.out` | CDP driver and raw output for the live adaptive/baseline session (scenarios 1–3) |
| `/tmp/aui-baseline-check.mjs` | Baseline-condition isolation run (zero DOM mutations) |
| `/tmp/aui-verify.mjs`, `/tmp/aui-verify2.mjs` | Verifier + replay execution over committed and real traces |
| `/tmp/vitest.audit.config.ts`, `/tmp/aui-verify.test.ts` | Unused config attempt (kept only to document method) |
| `/tmp/chrome-aui`, `/tmp/aui-vite.log`, `/tmp/chrome.log` | Headless Chrome profile and server logs |
| Headless Chrome 154 on `:9444` and `vite` dev server on `:5177` | Left running at the time of writing; both are transient processes, not repository changes |

### Limitations of this audit

- `NOT MEASURED`: WebGPU vs wasm provider confirmation (the audit reports what the runtime states, not what the GPU actually executed); long-session memory growth; FPS under load; cross-browser behaviour.
- `PARTIALLY VERIFIED`: `docs/assessments/**` and `docs/plan/**` were sampled rather than read line by line for every claim; the documentation cross-check in §B.4 and the ADR-link sweep were performed by direct verification of every link in the two assessment documents named, not of every markdown link in the repository.
- The live session used synthetic CDP input, not a human; 0 human participants were involved in this audit, and no participant-derived data exists in the repository.
- One deliberate behavioural deviation was observed and is recorded here for completeness: the scripted `change` event on `filter-Region-select` did not register through the native setter in headless mode, so the select remained at `All`; the task still completed, which is itself the F-15 evidence.
