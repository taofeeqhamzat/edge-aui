# Target Testbed Quality Assessment II — Implementation Correctness and Gap Audit

- **Assessment date:** 2026-10-01
- **Assessed revision:** `edge-aui-framework` @ `67a242a2f0d7c17e44e388390fb9847d77e0f4b7` (branch `feat/target-ui-client-integration`)
- **Integration counterpart:** `model-preparation` (read-only. No tracked file was changed)
- **Brief:** [`target-testbed-quality-assessment-2.md`](./target-testbed-quality-assessment-2.md)
- **Assessment type:** Read-only, evidence-driven implementation audit
- **Deliverable scope:** This document. The audit changed no production source, test, or configuration file. Browser-driver and verifier scripts were written to `/tmp` only.

Evidence labels (brief §21):

| Label | Meaning |
|---|---|
| `VERIFIED` | Directly observed in executing code, a real runtime session, or a trace |
| `PARTIALLY VERIFIED` | Observed for part of the claim. The remainder is untested or environment-specific |
| `INFERRED` | Reasoned from indirect evidence |
| `UNVERIFIED` | Asserted but not verified |
| `NOT IMPLEMENTED` | Actively searched for and absent |
| `NOT MEASURED` | A measurable property that this audit did not measure |
| `DEFERRED` | Explicitly deferred by a decision record |

Method and evidence base:

| Evidence source | What it establishes |
|---|---|
| Full read of `src/` (63 files) and `tests/` (47 files ≈ 9 105 LOC) | Implementation reality, symbols, and line numbers |
| `npx vitest run` | 47 files / 336 tests / 336 passed (24.4 s) |
| Headless Chrome 154 (CDP, `/tmp/aui-live-audit.mjs`, `/tmp/aui-baseline-check.mjs`) against `vite` dev server on `:5177` | Real end-to-end runtime behaviour, DOM state, exported traces, and worker timing |
| `traceAttributionVerifier` + `reconstructReplayStream` executed **in the browser** over four real or committed traces | Verifier behaviour on real data compared to fixtures |
| ONNX graph introspection with `model-preparation/.venv` (onnx 1.22.0) | Shipped graph contracts and weight provenance |
| Static read of `scripts/*.mjs`, `docs/**`, and ADRs | Benchmark and documentation claims |
| `git status` before and after | Shows that this audit changed no tracked file |

---

## A. Executive Status

The framework is a real, running, instrumented pipeline, not a shell. Every stage named in the brief exists and runs in a browser. The pipeline stages include observer, window, MicroTensor, macro stream, worker, dual gate, policy, actuator, and recorder. Module `src/runtime/boot.ts` composes all stages and produces populated traces.

In a single 20-second trial, this audit observed 75 behaviour events, 69 MicroTensor windows, and 55 macro interactions. The trial recorded 59 outcomes, 5 predictions, and 5 intervention records. The runtime reported `modelLoaded: true` and `executionProvider: 'webgpu'` (`VERIFIED`).

Against the status vocabulary in the brief, the honest state is:

| Area | Status | Evidence |
|---|---|---|
| Runtime composition and boot | **COMPLETE / VERIFIED** | Live session, `src/runtime/boot.ts`, and `tests/adaptive_runtime.test.ts` |
| Telemetry capture | **COMPLETE / VERIFIED** (with defects) | 75 events with geometry in one trial |
| Windowing (fixed grid, half-open, delayed settlement, inactivity) | **COMPLETE / VERIFIED** | `window.ts:182-263`, and live `inactive: true` windows |
| MicroTensor 18-D + Python parity | **COMPLETE / VERIFIED** | `tests/parity.test.ts`, `parity:check`, bit-exact feature-order and scale match |
| Macro stream | **PARTIALLY COMPLETE** | Emits, but symbol derivation produces dominant spurious symbols (F-06) |
| Fast Gate (WASM PrefixSpan) | **IMPLEMENTED, METHODOLOGICALLY QUESTIONABLE** | Live `matchedGate: 'fast'`. Matches depend on repeated-symbol noise (F-06). Miner is a non-standard variant (F-02). |
| Slow Gate (dual ONNX graph) | **COMPLETE / VERIFIED** | Both graphs load and run. Contracts match training side exactly. |
| Policy | **COMPLETE / VERIFIED** but **under-instrumented** | `policy.ts`. Rejection reason is never persisted (F-07). |
| Actuator | **COMPLETE / VERIFIED** | Live `edge-aui-simplified` class applied. Baseline condition applied 0. |
| Experiment trace | **PARTIALLY COMPLETE** | Populated, but contains two incompatible clocks (F-01). |
| Persistence / collection | **NOT IMPLEMENTED** (deliberately) | No storage or network primitive exists anywhere in `src/`. |
| Dataset preparation (edge to model-preparation) | **BLOCKED by contract drift** | `trace_ingestion.py` accepts only `1.1.0`. Runtime emits `1.2.0` (F-09). |
| Baseline condition separation | **VERIFIED in DOM, PARTIALLY VERIFIED in trace** | Live baseline run applied 0 adaptations. Trace alone cannot show unapplied decisions (F-07). |
| Intervention observability | **GAP** | DebugPanel omits window ID, confidence, mapping source, cooldown, and rejection reason (F-07, F-08). |
| Task reassessment | **GAP** | No task lifecycle `fail` state exists. Step completion uses component-ID matching (F-15). |
| Performance claims | **PARTIALLY MEASURED / two fabricated** | 300 events and TBT = 0 ms are not real measurements (F-14). |
| Documentation to implementation consistency | **GAP** | Broken ADR links. Documented topology differs from deployed topology. Stale numbers and requirements (F-12, F-14, F-24, F-25, F-27). |
| Participant deployment | **BLOCKED** | Per `participant-readiness.md` and verified here. |

**Headline answer to question 23 of the brief: NO. The system cannot collect research-participant telemetry and save it for dataset preparation today.** Section L lists all blockers. The most critical blocker is that the existing dataset pipeline cannot ingest the trace that this system produces (F-09). In addition, the internal timeline of the trace cannot be reconstructed (F-01).

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
| Observer | `src/telemetry/observer.ts` | `VERIFIED` — All standard pointer, scroll, form, focus, resize, and history events are captured. | `observer.ts:214-236` |
| Normalizer | `src/telemetry/normalizer.ts` | `VERIFIED` — Monotonic `performance.now()` and geometry snapshot. | `normalizer.ts:18-23, 101-119` |
| Session | `src/telemetry/session.ts` | `VERIFIED` — Anonymous UUID, monotonic `startedAt`, and epoch `startedAtEpochMs`. | `session.ts:59-75` |
| Recorder | `src/telemetry/recorder.ts` | `VERIFIED` — 7 buffers, 10 000 item caps, and JSON export. | `recorder.ts:66-89, 225-323` |
| Trace schema | `src/telemetry/traceSchema.ts` | `VERIFIED` — Schema 1.2.0, accepts 1.1.0, structural validator, and replay stream. | `traceSchema.ts:31-32, 86-203, 229-253` |
| Verifier | `src/telemetry/traceAttributionVerifier.ts` | `VERIFIED` — 6 verification tests. | `traceAttributionVerifier.ts:65-267` |
| Windowing | `src/microtensor/window.ts` | `VERIFIED` — Delayed settlement is active (`settlementDelayMs` 250 from config). | `window.ts:94-96, 182, and runtimeConfig.ts:184` |
| Features | `src/microtensor/features.ts` | `VERIFIED` — Parity verified with Python reference. | `tests/parity.test.ts` |
| Sequence | `src/microtensor/sequence.ts` | `VERIFIED` — Sequence length T=8 and shape `[1,8,18]`. | `tests/windowing_contract.test.ts` |
| Macro | `src/macro/sequence.ts`, `symbols.ts` | `PARTIALLY VERIFIED` — See finding F-06. | Live macro corpus |
| Outcome | `src/outcome/derive.ts` | `VERIFIED` — Faithful port of `target_generation.py`. | `tests/outcome_derivation.test.ts`, live outcomes |
| Fast Gate | `src/gates/fast/prefixSpanFastGate.ts` and `wasm-vectorizer` | `VERIFIED` to run. Miner variant is defective (F-02). | Live `matchedGate: 'fast'`, `fastGateMode: 'prefixspan'` |
| Slow Gate | `src/gates/slow/onnxSlowGate.ts` | `VERIFIED` — Both sessions load, run, apply softmax, and map. | Live `modelLoaded: true`, `tests/intervention_head_contract.test.ts` |
| Arbitration | `src/gates/arbitration.ts` | `VERIFIED` — Fast short-circuit and per-gate latency. | `arbitration.ts:72-127` |
| Policy | `src/intervention/policy.ts` | `VERIFIED` | `tests/intervention_policy.test.ts`, `policy_cooldown_ttl.test.ts` |
| Actuator | `src/intervention/actuator.ts` | `VERIFIED` — Reversible, WCAG-oriented, and applies TTL when set. | Live `edge-aui-simplified`, `tests/actuator.test.ts` |
| Integration | `src/integration/types.ts`, `src/testbed/adapter.ts` | `VERIFIED` — `UiAdapter` port and two implementations. | `tests/ui_adapter_contract.test.ts`, `tests/ui_adapter_second_implementation.test.ts` |
| Config | `src/config/runtimeConfig.ts` (9 groups) | `PARTIALLY VERIFIED` — Several keys are unused (F-17). | Grep verification |
| Instrumentation | `src/runtime/instrumentation.ts` | `VERIFIED` — 11 stages across 5 sides with ring buffer. | Live stage timings |
| Diagnostics / panel | `src/runtime/diagnostics.ts`, `src/debug/DebugPanel.tsx` | `PARTIALLY VERIFIED` — Observability gaps exist (F-05, F-07). | Live panel text |

### B.4 Documented versus implemented divergences found

| Document claims | Implementation | Verdict |
|---|---|---|
| `docs/architecture.md:87-92`: Delayed settlement active. `settlementDelayMs` in trace metadata. | Active in `runtimeConfig.ts:184`. Metadata includes `settlementDelayMs` in `recorder.ts:257`. | Consistent |
| `docs/architecture.md:127-130`: TypeScript vectorisation on the live path. | `features.ts` uses TypeScript. WASM is used only for pattern mining. | Consistent |
| `participant-readiness.md:38`: "Retained drop-once semantics per ADR-005" | ADR-005 Option B (delayed settlement) is accepted and implemented (`window.ts:182`, `runtimeConfig.ts:184`). | **CONTRADICTED** |
| `participant-readiness.md:29`: "1000ms lookahead" | Horizon is `[windowEnd+500, windowEnd+1500]` (`pipelineConfig.json`, `derive.ts:58-59`). A 1000 ms span follows a 500 ms offset. | **CONSISTENT** |
| `participant-readiness.md:33`: `InteractionObserver` captures pointer, click, scroll, and key events. | Class name is `TelemetryObserver`. No keyboard events are bound (`observer.ts:214-236`). | **CONTRADICTED** |
| `participant-readiness.md:5,56`: Links to ADR-008, ADR-011, and ADR-014 telemetry files. | Actual files cover combined edge payload, UI adapter boundary, and deferred UI features. | **BROKEN (3 links)** |
| `condition-comparison.md:5`: Link to `ADR-014-participant-pipeline-scope-boundaries.md` | Target file name is incorrect. | **BROKEN** |
| `gate-routing-evidence.md:4`: Links ADR-002 arbitration and ADR-003 budget. | Actual files cover Rust WASM boundary and worker boundary. | **BROKEN (2 links)** |
| `gate-routing-evidence.md:104`: Script `verify-trace.mjs` verifies Fast Gate sub-10 ms budget. | Script `verify-trace.mjs` contains no latency evaluation (`verify-trace.mjs:33-140`). | **UNSUPPORTED** |
| `gate-routing-evidence.md:81`: Quotes `expect(result.bothGatesEvaluated)` on `InferenceResult`. | `InferenceResult` has no `bothGatesEvaluated` field (`arbitration.ts:24-35`). The field exists on `PredictionEvent`. | **CONTRADICTED** |
| `gate-routing-evidence.md:100-110`: Code snippet uses `slowGate.infer(seq, uiContext)`. | Code calls `this.slowGate.infer({sequence, shape, context})` (`arbitration.ts:75, 104-108`). | **CONTRADICTED** |
| `condition-comparison.md:26`: Task T2 includes select region, apply filters, and export. | Task model defines T2 as navigate and export only (`taskModel.ts:50-58`). | **CONTRADICTED** |
| `architecture.md:56`: Slow Gate uses ONNX Runtime Web with WebGPU. | Provider is returned from `session.executionProvider ?? providers[0]`. It can report the requested provider (`onnxSlowGate.ts:171-174`). | **PARTIALLY VERIFIED** (F-10) |
| `target-testbed-implementation-record.md:195`: References `src/runtime/worker.ts`. | File path is `src/runtime/worker/core.ts`. File `worker.ts` does not exist. | **STALE** |
| `target-testbed-implementation-record.md` §4: Target intervention head is not exported. | Graph is exported and shipped. File `intervention_head_int8.onnx` loads. | **STALE** |
| `sparse-window-loss.md:20`: Claims 6 real participant traces. | ADR-013 records traces as scripted substitute data. Traces have `participantId: null`. | **OVERCLAIM** |
| `condition-comparison.md:32-33`: Baseline and adaptive trace artifacts presented as trial runs. | Files are hand-authored fixtures with synthetic IDs and round timestamps. | **MISLEADING** |

Additional stale internal references exist. File `src/telemetry/traceAttributionVerifier.ts:8` cites schema version 1.1.0, while the code verifies against version 1.2.0. File `src/gates/slow/onnxSlowGate.ts:186-187` claims honest provider reporting, while lines 171-174 fall back to the requested provider.

---

## C. End-to-End Trace: participant interaction to persisted research record

Every step in the telemetry pipeline appears below with its executing implementation:

| # | Step | Implementation | Data structure | Producer to consumer | Validation and errors | Timing | Identity | Tests | Linked finding |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Participant to target UI | React 19 SPA, 5 pages, semantic annotations | DOM | `App.tsx` | None | Immediate | None | `semantic_dom_annotations.test.tsx` | F-15 |
| 2 | DOM to `BehaviourEvent` | `observer.ts:137-417` | `BehaviourEvent` | `TelemetryObserver` to subscribers | Listener wrapped. Try-catch per listener. | Monotonic `performance.now()` | Component ID, role, route, task ID | `telemetry_observer.test.ts` | F-01 |
| 3 | Session and task identity | `sessionManager`, `recordSession` | `SessionContext` | `boot.ts:87-89`, `adaptiveRuntime.ts:266-273` | Session snapshot retained | Epoch and monotonic | `sessionId`, `experimentId`, `conditionId` | `telemetry_session_recorder.test.ts` | None |
| 4 | Windowing | `RollingWindowBuffer.push` and `tick` | `MicroTensorWindow` | 125 ms timer and event push | Skipped sparse and late counters | Fixed grid, 250 ms settlement delay | `windowId` | `windowing_contract.test.ts` | F-04 |
| 5 | MicroTensor | `computeWindowMicroTensor` | `Float32Array(18)` | `window.buildWindow` | Non-positive geometry throws | ~0.03 ms measured | None | `parity.test.ts`, `vectorizer_parity.test.ts` | None |
| 6 | Macro history | `deriveMacroSymbol`, `MacroStream` | `MacroInteraction` | Observer bridge | Null for non-semantic events | Event time | Correlation IDs injected | `macro_sequence.test.ts` | F-06 |
| 7 | Fast Gate | `PrefixSpanFastGate.evaluate` and WASM miner | `GateDecision` | `AdaptiveInferenceEngine` | Mining failure yields miss | p95 2 943–3 149 ms measured | Matched pattern on decision | `prefixspan_fast_gate.test.ts` | F-02 |
| 8 | Slow Gate | `OnnxSlowGate.infer` | `SlowGateResult` | Arbitration | Invalid tensor shapes throw. Missing session yields `NO_OUTCOME`. | p50 1.2–36.9 ms measured | Context encoded as R⁶ | `intervention_head_contract.test.ts` | F-11 |
| 9 | Policy | `InterventionPolicy.accept` | `PolicyDecision` | `adaptiveRuntime.ts:666` | Candidate state machine | 0.02–0.14 ms measured | None | `intervention_policy.test.ts` | F-07 |
| 10 | Actuator | `UIActuator.apply` | `InterventionEvent` | `adaptiveRuntime.ts:707` | Selector escaping and TTL | 0.105 ms measured | Episode ID | `actuator.test.ts` | F-03 |
| 11 | Visible UI intervention | CSS class, ARIA, and banner | DOM | `actuator.ts:221-503` | Reversible cleanup | Immediate | `data-aui-active-adaptation` | `actuator.test.ts` | F-05 |
| 12 | Outcome and task event | `deriveForWindow`, `taskManager` | `OutcomeEvent`, `TaskEvent` | Runtime timer, task manager | Provisional versus settled flag | `[+500, +1500] ms` | `windowId`, task IDs | `outcome_derivation.test.ts`, `task_wiring.test.tsx` | F-01, F-15 |
| 13 | Experiment trace | `ExperimentRecorder` | 7 arrays and session snapshot | Runtime | 10 000 item buffer cap | Mixed clocks | Correlation IDs on records | `trace_attribution_verifier.test.ts` | F-01, F-07, F-08 |
| 14 | Persistence and export | Manual `downloadTraceAsJSON` from DebugPanel | JSON blob | `recorder.ts:297-323` | None | On user click | Embedded IDs | `telemetry_session_recorder.test.ts` | F-19 |
| 15 | Edge to dataset preparation | Absent. Script `trace_ingestion.py` expects 1.1.0. | None | None | Rejects schema 1.2.0 | None | None | `test_trace_ingestion.py` | F-09 |

Missing links in the chain: step 14 lacks durable storage and automated transport. Step 15 lacks a compatible consumer. All stages from 1 through 13 exist and execute.

## D. Correctness Findings

Finding severity reflects engineering and research impact, not personal preference.

### F-01 — Two incompatible clocks inside one trace

- **Area:** Telemetry, experiment trace, and dataset preparation
- **Severity:** **Critical**
- **Evidence:** `VERIFIED` in a live trace and in a committed trace. In the live export (`/tmp/aui-live-audit.out`), `behaviour` and `microTensor` timestamps `[4 034 … 19 572]` use monotonic `performance.now()`. In contrast, `prediction` `[1 790 852 146 903 …]`, `task` `[1 790 852 147 586 …]`, and `intervention` use `Date.now()` epoch values. The same split exists in `docs/experiments/random/traces/experiment-trace-7029a1f9-…json`. In that file, behaviour timestamps span `2 514…192 784`. Prediction timestamps use `1 790 687 428 324`. Task event timestamps use `1 790 687 425 649`.
- **Observed behaviour:** `BehaviourEvent.timestamp` is documented as monotonic (`events.ts:54`, `normalizer.ts:18-23`). Predictions use `Date.now()` (`arbitration.ts:62`). Interventions use `Date.now()` (`adaptiveRuntime.ts:668`, `actuator.ts:81-181`). Task events use `Date.now()` (`taskManager.ts:80-206`). Running `reconstructReplayStream` in the browser over the real trace returns behaviour records first and task records last. The replay stream (`traceSchema.ts:229-253`) places more than 8 600 behaviour events before every decision. This ordering destroys causal sequence.
- **Expected behaviour:** One trace must use one timeline, or provide an explicit documented offset for each record class.
- **Impact:** First, task start, interactions, and task completion cannot align. Therefore, task completion time cannot be derived from a trace. Second, prediction and intervention `windowId` links cannot be verified. Third, offline window-to-event correlation in `trace_ingestion.py:246-253` (`wstart <= ts <= wend`) never matches. Fourth, replay fails to reproduce real execution order.
- **Recommended action:** Use a single clock for all trace records. Monotonic time with one session epoch anchor is sufficient. Alternatively, attach an explicit `clock: 'monotonic' | 'epoch'` field to every record and normalize on export. Do not mask the issue with heuristic sorting.
- **Implementation required?:** Yes. Small and local across 6 call sites.
- **Human decision required?:** No. However, document the choice of canonical clock.

### F-02 — The PrefixSpan miner is a non-standard variant, is unbounded, and serializes the worker

- **Area:** Fast Gate, worker boundary, and performance
- **Severity:** **Critical**
- **Evidence:** `VERIFIED`. File `wasm-vectorizer/src/prefix_span.rs:38-45` counts each item once per sequence (`seen_in_seq` set) instead of every position. Line 68 projects only on the first occurrence (`seq.iter().position(...)`). It enumerates subsequences rather than growing projected databases. With repeated symbols, the pattern set grows combinatorially. Live measurement: `PrefixSpan mining [wasm]` required p95 2 943 ms and max 3 149 ms on a corpus of 9 or fewer sequences (`/tmp/aui-live-audit.out`).
- **Observed behaviour:** The worker uses a serial request loop (`worker/entry.ts:19-22` awaits `handleRequest` before the next message). A multi-second mining pass blocks every queued `PUSH_WINDOW` and `EVALUATE` call. Live console output shows: `Worker request EVALUATE timed out after 5000ms` and `Worker request PUSH_WINDOW timed out after 5000ms`. Worker transfer p95 reached 4 030 ms. The system drops requests during the trial. In an earlier committed trace, the same failure reduced a 190-second session to one prediction (session `7029a1f9`).
- **Expected behaviour:** Mining must be bounded by corpus size. The worker must avoid head-of-line blocking and silent window loss.
- **Impact:** The system loses telemetry and predictions during dense interactions. Fast Gate behaviour is not reproducible. Latency exceeds the 50 ms budget in practice, even though documentation asserts zero Total Blocking Time (F-16). Any claim about Fast Gate latency from this implementation is unsupported.
- **Recommended action:** First, fix the miner to true PrefixSpan semantics with hard bounds on pattern length, pattern count, and corpus size. Second, add backpressure so at most one evaluation remains active. Third, add a configurable RPC timeout and record dropped window counts in the trace.
- **Implementation required?:** Yes.
- **Human decision required?:** No for recommended fixes. Yes if the project decides to replace the miner rather than fix it.

### F-03 — Interventions never expire, and policy and actuation TTL configurations are unused

- **Area:** Actuation and research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED`. No component sets `ttlMs`. Grep across `src/` shows that only `intervention/types.ts`, `actuator.ts`, and `prefixSpanFastGate.ts` reference `ttlMs`. File `runtimeConfig.ts:233` defines `policy.ttlMs = 8000`. Line 240 defines `actuation.defaultTtlMs = 8000`. No code reads either value outside `runtimeConfig.ts`. Live evidence: class `edge-aui-simplified` remained on `filter-drawer` at the end of the trial. The trace recorded `applied` at `ep_1` with no matching `reverted` or `dismissed` event.
- **Expected behaviour:** The adaptation must revert on TTL expiry or user action, or documentation must qualify the reversible claim.
- **Impact:** Once applied, an adaptation persists until page reload. A single early decision permanently changes the participant session. The intervention-history signal recorded in the trace becomes biased. Tests in `tests/actuator.test.ts` and `policy_cooldown_ttl.test.ts` test TTL only when set, but production code never sets it.
- **Recommended action:** Pass `actuation.defaultTtlMs` into every command, or explicitly document that adaptations persist for the session.
- **Implementation required?:** Yes. One line of code and a documented decision.
- **Human decision required?:** **Yes.** This is a research methodology parameter governing adaptation visibility.

### F-04 — Live window semantics diverge from the Python reference by one stride

- **Area:** Windowing and parity
- **Severity:** **High** (methodological)
- **Evidence:** `VERIFIED` by code read. Class `RollingWindowBuffer` assigns events to a 250 ms slot and emits `windowEnd = windowStart + strideMs` (`window.ts:215-216`). It uses `windowDurationMs` only as the tensor span for feature extraction (`window.ts:246-253`). The Python reference segments 500 ms overlapping windows with a 250 ms stride. ADR-005 records that Option B may change emitted window counts, macro sequence contents, and Fast Gate hit rates. It requires re-baselining. No re-baselining was recorded. The measured 10.95% sparse loss used `flushDelayMs: 0` (`sparse-window-loss.md:96`), before delayed settlement was enabled.
- **Observed behaviour:** The live pipeline emits windows on a 250 ms boundary. Feature extraction spans 500 ms.
- **Expected behaviour:** Live window boundaries must match the training reference, or differences must be documented and measured.
- **Impact:** Window-to-outcome labels, macro sequences, Fast Gate hit rates, and cross-pipeline comparisons use different window definitions than model training and validation. The system never re-measured `settledSparseWindows` after ADR-005 took effect.
- **Recommended action:** Measure and record `skippedSparseWindows` and `settledSparseWindows` under the shipped configuration. State the exact emitted window definition in trace metadata. Note that `architecture.md:92` exports the static constant rather than the resolved runtime value.
- **Implementation required?:** No new mechanism. Requires measurement and documentation updates.
- **Human decision required?:** **Yes.** Decide whether the live slot definition or the Python window definition is authoritative.
- **Related unsupported claim (`VERIFIED`):** File `architecture.md:87-89` and `final-report.md:71` state that delayed settlement recovers 66.2% of sparse slots straddling window boundaries. The 66.2% figure is a lookahead crossing statistic, not a measured rescue. The harness models delay as a flush offset over static data (`scripts/quantify-sparse-window-loss.mjs:286-290`). Its table shows identical counts for drop-once and delayed emission (2 144 emitted, 144 skipped). No measurement shows a slot rescued by `settledSparseWindows`.

### F-05 — An applied intervention leaves no DOM-observable footprint for correlation

- **Area:** Intervention observability and trace integrity
- **Severity:** **High** for automated tests, Medium for researcher inspection
- **Evidence:** `VERIFIED`. Method `UIActuator.applyHighlightPrimaryAction` sets `data-aui-active-adaptation="highlight"` (`actuator.ts:240`). No other adaptation sets that attribute (`simplify_options` at line 279, `expand_tooltip` at lines 349-351, `offer_assistance` at lines 443-446). In the live run, query `[data-aui-active-adaptation]` returned empty, while query `.edge-aui-simplified` returned the `filter-drawer` form. In the trace, `ep_0` and `ep_1` identify applied interventions, but `interventionEpisodeId` does not appear on the DOM.
- **Observed behaviour:** The DOM does not store episode IDs or correlation attributes for most adaptations.
- **Expected behaviour:** Every applied adaptation must set a consistent DOM attribute that links the DOM element to the trace episode ID.
- **Impact:** An automated verifier cannot prove from the DOM that a recorded adaptation is visible. In addition, an adaptation can remain live without a terminal event in the trace (F-03). The `intervention_terminal_states` test fails on real captures.
- **Recommended action:** Add the episode ID to a DOM attribute on every adaptation type.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** No.

### F-06 — Macro symbol derivation produces dominant spurious symbols, and the Fast Gate matches noise

- **Area:** Macro stream, Fast Gate, and research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED` live. In one short trial, 54 macro interactions were dominated by `NAV_OVERVIEW` 18 times and `OPEN_FILTERS` 18 times. `NAV_OVERVIEW` fired on every mouseover on the page root because `deriveMacroSymbol` classifies by `event.route` (`symbols.ts:66-72`). `OPEN_FILTERS` fired on every click on any accordion (`symbols.ts:90-94`). No closing branch exists, so `CLOSE_FILTERS` is unreachable. The Fast Gate winning pattern was `NAV_ANALYTICS > OPEN_FILTERS`. The corpus had size 5 out of 9.
- **Observed behaviour:** Spurious events flood the macro interaction stream.
- **Expected behaviour:** Macro symbols must reflect distinct, intentional user interactions.
- **Impact:** The Fast Gate matches repetition artifacts rather than meaningful behavioural episodes. Claims that the Fast Gate recognized a known pattern are unsupported. Spurious symbols also inflate the pattern corpus, causing the 3-second mining cost (F-02).
- **Recommended action:** Derive `OPEN_FILTERS` and `CLOSE_FILTERS` from the `aria-expanded` state transition. Derive `NAV_*` only on click events. Remove or restrict the route-based fallback. Re-measure the Fast Gate hit rate.
- **Implementation required?:** Yes.
- **Human decision required?:** No for the code fix. Yes for choosing intentional navigation semantics.

### F-07 — Policy decisions are not persisted, and the trace cannot explain why the system did not intervene

- **Area:** Observability and research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED` by code read and live trace. Function `evaluateAndAct` records `PredictionEvent` (`adaptiveRuntime.ts:607-624`). It records `InterventionEvent` only for accepted decisions (`adaptiveRuntime.ts:667-680`). Rejection reasons exist only as debug bus strings (`adaptiveRuntime.ts:684-689, 696-703`) and are never written to the recorder. The baseline branch (`adaptiveRuntime.ts:694-704`) represents decision-only execution and is not persisted. The exported trace contains an empty intervention array for baseline sessions, even when the policy accepted candidates. In the live baseline run, 7 predictions occurred with `appliedCount: 0`.
- **Observed behaviour:** The trace omits rejection reasons and baseline decisions.
- **Expected behaviour:** The trace must record every policy evaluation, candidate count, decision reason, and cooldown state.
- **Impact:** The system cannot satisfy brief requirement 11: distinguishing no prediction, below threshold, policy rejected, cooldown active, baseline condition, and actuator failure. Researchers cannot analyze baseline decisions from the trace.
- **Recommended action:** Add a `PolicyDecisionEvent` containing candidate, accepted flag, reason, candidate count, cooldown remaining, and condition to the trace for every evaluation.
- **Implementation required?:** Yes. Requires schema addition and recorder update.
- **Human decision required?:** **Yes.** Adding a trace record type changes the experiment data format.

### F-08 — Developer panel omits fields needed to verify intervention activation

- **Area:** Observability
- **Severity:** **High** (priority requirement in brief)
- **Evidence:** `VERIFIED` against live panel text (`/tmp/aui-live-audit.out`). The panel shows session, task, step, route, focus, capability flags, and Fast Gate pattern match. It also shows Slow Gate outcome, confidence, intervention type, policy state string, latencies, worker status, stage timings, MicroTensor, and modality mask. The panel omits: window ID, `matchedGate` field, mapping source, class probabilities, cooldown remaining, persistence count, execution provider, `modelLoaded`, `slowGateMode`, runtime counters, and target element. In addition:
  - The panel showed `MACRO SEQUENCE: No macro events recorded`, while the recorder held 55 macro interactions. File `diagnostics.ts:107` resets `latestMacroSequence` to undefined every 500 ms.
  - The MicroTensor panel row showed 0.000 for all features with mask `[111111111]` because it rendered an inactive window without labelling it.
  - `Feature Extr. Latency` and `Inference Latency` showed over 4 700 ms. File `adaptiveRuntime.ts:720` computes elapsed time from the start of the previous evaluation.
- **Observed behaviour:** The panel omits essential fields and shows misleading latency values.
- **Expected behaviour:** The panel must show complete runtime status, active window IDs, accurate latencies, and persistent macro sequences.
- **Impact:** Observers cannot distinguish no prediction from low confidence or active cooldown during a live session.
- **Recommended action:** Publish and render window ID, gate, mapping source, confidence, policy reason, provider, model status, and buffer counters. Stop clearing `latestMacroSequence`. Label inactive windows and fix latency calculations.
- **Implementation required?:** Yes.
- **Human decision required?:** No. Presentation change only.

### F-09 — The dataset pipeline rejects traces produced by the runtime

- **Area:** Persistence and dataset preparation (blocking milestone)
- **Severity:** **Critical (blocking)**
- **Evidence:** `VERIFIED` by source code inspection in both repositories. The runtime emits `schemaVersion: '1.2.0'` (`traceSchema.ts:31`). File `model-preparation/src/trace_ingestion.py:42, 110-115` hard-codes `EXPERIMENT_TRACE_SCHEMA_VERSION = "1.1.0"` and raises an exception for any other version. Searching for `1.2.0` in `model-preparation` yields zero matches. In addition, `KNOWN_BEHAVIOUR_EVENT_KEYS` is restricted to version 1.1.0 fields. Any new field causes ingestion to fail. The offline pipeline also re-derives outcomes independently and ignores the trace outcome array.
- **Observed behaviour:** Ingestion code fails immediately when given a version 1.2.0 trace.
- **Expected behaviour:** The dataset pipeline must ingest traces produced by the runtime.
- **Impact:** Traces collected from the current runtime cannot be ingested. No training or evaluation dataset can be constructed without changing Python code. This issue blocks the next research milestone.
- **Recommended action:** Agree on a schema contract. Either emit 1.1.0-compatible traces or update `model-preparation` to support 1.2.0 with field allow-lists. Add a cross-repository contract test.
- **Implementation required?:** Yes. Changes in `model-preparation` and tests.
- **Human decision required?:** **Yes.** Decide where the canonical schema lives and which repository updates.

### F-10 — Execution provider reporting can echo the requested provider

- **Area:** Model integration and honest reporting
- **Severity:** Medium
- **Evidence:** `VERIFIED` by code read and partially verified in runtime. Function `createSingleSession` returns `session.executionProvider ?? providers[0] ?? 'wasm'` (`onnxSlowGate.ts:171-174`). Variable `providers[0]` defaults to `webgpu`. Comments at lines 186-187 claim honest reporting, but the code falls back to the requested string. In Node.js, `onnxruntime-web` reported missing backend for WebGPU and used CPU or WASM. The browser reported `executionProvider: 'webgpu'`, but the code cannot distinguish requested provider from verified active provider.
- **Observed behaviour:** Runtime diagnostics may report the requested provider rather than the actual execution provider.
- **Expected behaviour:** The runtime must query the session capability output to report the active provider.
- **Impact:** Recording `executionProvider: 'webgpu'` in traces is not verified proof of WebGPU execution.
- **Recommended action:** Read the execution provider from session capabilities, or label provider fields as requested versus verified.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** No.

### F-11 — The deterministic mapping ablation arm does not match the teacher policy

- **Area:** Model integration and ablation validity
- **Severity:** Medium (High if ablation results are reported)
- **Evidence:** `VERIFIED`. The teacher policy in `intervention_label_policy.py:88-94` evaluates context: `HOVER_DWELL` with `primaryActionAvailable` and `taskProgress > 0.5` yields `highlight_primary_action`, otherwise `expand_tooltip`. The runtime ablation in `onnxSlowGate.ts:56-64` maps `HOVER_DWELL` to `expand_tooltip` unconditionally and ignores context. The teacher docstring states `>= 0.5`, while code evaluates `> 0.5`.
- **Observed behaviour:** The runtime ablation policy uses different logic than the training label generator.
- **Expected behaviour:** The ablation arm must match the teacher policy, or documentation must define it as a simplified baseline.
- **Impact:** Comparing `learned_head` against `deterministic_mapping` evaluates the model against a different policy than the training distribution.
- **Recommended action:** Port the context conditions from the teacher policy into `buildDeterministicIntervention`, or document the deliberate difference.
- **Implementation required?:** Yes, if reporting ablation results.
- **Human decision required?:** **Yes.** Choose which comparison the research paper intends to evaluate.

### F-12 — Controlled baseline versus adaptive comparison data consists of hand-authored fixtures

- **Area:** Research validity and evidence integrity
- **Severity:** **High**
- **Evidence:** `VERIFIED`. Files `docs/experiments/baseline-trace.json` and `adaptive-trace.json` contain synthetic IDs such as `sess-ctrl-baseline-t2-001` and `exp-controlled-pair-01`. Timestamps use round integer values from 1000 through 2800. Episode IDs use `ep-t2-adaptive-01`. Runtime code never generates these formats. Document `condition-comparison.md` presents these files as trace artifacts from experimental runs.
- **Observed behaviour:** The repository presents hand-authored test fixtures as experimental trial data.
- **Expected behaviour:** Experimental comparison documents must use exported data from real runs.
- **Impact:** Headline evidence comparing baseline and adaptive conditions relies on artificial data. While the engineering claim of zero baseline mutations was verified live, the cited document does not prove it.
- **Recommended action:** Replace fixtures with exported data from two real runs. Label remaining test fixtures clearly and document synthetic provenance.
- **Implementation required?:** Yes. Data update.
- **Human decision required?:** **Yes.** Decide whether this comparison belongs in the final thesis.

### F-13 — Verification harness passes on test fixtures but fails on real captures

- **Area:** Testing and trace integrity
- **Severity:** **High**
- **Evidence:** `VERIFIED` by running `verifyTraceCompleteness` in the browser across four traces:
  - Files `baseline-trace.json` and `adaptive-trace.json` returned valid.
  - File `experiment-trace-7029a1f9-…json` returned invalid: 5 MicroTensor windows lacked outcome records for windows 518 through 522.
  - File `experiment-trace-ec286e06-…json` returned invalid with 3 orphaned windows.
  - The live session intervention `ep_1` had an `applied` event without a terminal event. Test `condition_trace_comparison.test.ts:20-21` tests only the two hand-authored fixtures.
- **Observed behaviour:** Real trace captures fail the completeness verifier due to dropped windows and unclosed episodes.
- **Expected behaviour:** The verification harness must pass on real captures. Export routines must detect missing records.
- **Impact:** Automated verification claims test only artificial fixtures. Real captures contain gaps caused by worker blocking (F-02).
- **Recommended action:** Run the verifier during trace export. Warn or block export on invalid data. Record orphan counts in metadata and resolve capture gaps.
- **Implementation required?:** Yes.
- **Human decision required?:** No.

### F-14 — Performance and volume metrics in narrative documents are fabricated or unmeasured

- **Area:** Performance and evidence integrity
- **Severity:** **High**
- **Evidence:** `VERIFIED` by inspecting benchmark scripts and documents.
  - Script `scripts/benchmark-runtime.mjs:571` computes total events using `counts.byType ?? {} || 300`. Method `getEventCounts()` has no `byType` field (`recorder.ts:349-378`). The expression always defaults to 300. Document `docs/benchmarks/runtime-benchmark.md` reports exactly 300 events across runs, while all other counts changed significantly.
  - Script `benchmark-runtime.mjs:439` hard-codes the string: `Total Blocking Time (TBT) remains 0ms`. The same artifact records a long task of 121 ms, which represents 71 ms of blocking time under standard TBT definitions.
  - Fast Gate sub-5 ms latency is cited in `final-report.md:118` and `participant-readiness.md:29`. No benchmark measures this field. Test `gate_routing_evidence.test.ts` injects literal values.
  - Worker transfer duration measures the full RPC round trip, including queueing, mining, and inference (`workerClient.ts:224, 284`). Summing it with worker stages causes double-counting.
  - Percentile calculations in `instrumentation.ts:279-281` use `sorted[floor(len*0.5)]`. With two samples, p50 returns the maximum value.
  - Narrative reports cite obsolete numbers from 2026-09-26 rather than current artifacts from 2026-09-29.
- **Observed behaviour:** Key benchmark metrics are hard-coded or computed with invalid formulas.
- **Expected behaviour:** All narrative metrics must derive directly from executed measurements.
- **Impact:** Three core claims in the thesis documentation contradict their underlying artifacts. The assessment brief strictly prohibits unmeasured performance claims.
- **Recommended action:** Use `counts.total`. Compute real TBT from long tasks or remove the claim. Extract real gate latencies. Fix percentile calculations. Separate queueing time from transfer time. Update narrative text from current benchmarks.
- **Implementation required?:** Yes.
- **Human decision required?:** No. Fix measurements and claims.

### F-15 — Task lifecycle cannot express failure, and step success is component-ID matching

- **Area:** Task reassessment and UX metrics
- **Severity:** Medium
- **Evidence:** `VERIFIED`. `TaskStatus` has no `Failed` state (`taskModel.ts:2`). Clicks that do not match expected elements increment `errors` (`taskManager.ts:144-155`), but no transition ever moves a task to failed. A step succeeds purely by matching `componentId` and `action` (`taskManager.ts:136-141`). In the live run, the agent's `change` event left the Region select at its default value (`"changed to All"`). Task T1 still completed all four steps with `errors: 0`.
- **Observed behaviour:** Step completion measures element clicks rather than verified DOM state.
- **Expected behaviour:** Task steps must evaluate state-based success predicates, provide an explicit `Failed` state, and handle timeouts.
- **Impact:** Task success currently means that the participant touched controls in order. It does not measure whether the user created the intended application state. Task completion rates and error counts are therefore weak metrics.
- **Recommended action:** Define a state-based success predicate for each step. Add a `Failed` status. Add an explicit timeout path (`experiment.taskTimeoutsMs` is defined in `runtimeConfig.ts:248-252` but never evaluated).
- **Implementation required?:** Yes.
- **Human decision required?:** **Yes.** Defining task success criteria is an experimental methodology decision.

### F-16 — Trace buffers are bounded by silent eviction, and nothing survives a closed tab

- **Area:** Persistence and data integrity
- **Severity:** **High** for collection readiness, Medium for lab use
- **Evidence:** `VERIFIED`. `ExperimentRecorder.maxBufferSize = 10 000` per array, using `shift()` on overflow (`recorder.ts:118-179`). In the live session, 75 events occurred in 20 seconds (3.8 events per second). A dense pointer stream produced 4 132 events in 117 seconds (35 events per second) in committed trace `3850a5d9`. At 35 events per second, the buffer evicts the oldest events after 4.8 minutes without counters or trace warnings. Searching for browser storage or network APIs in `src/` yields zero matches (`VERIFIED`). The only export mechanism is the manual DebugPanel button (`recorder.ts:297-323`).
- **Observed behaviour:** Long sessions silently discard early telemetry. Closing a browser tab loses all data.
- **Expected behaviour:** The system must persist telemetry durably and log any buffer overflow.
- **Impact:** A participant session longer than five minutes loses early telemetry. Closing the tab loses the entire session. The system lacks handling for partial sessions, browser crashes, or duplicate submissions.
- **Recommended action:** Implement persistent telemetry storage as part of collection readiness (Section L).
- **Implementation required?:** Yes. New feature work.
- **Human decision required?:** **Yes.** Choose persistence architecture.

### F-17 — Configuration surface overstates what is configurable

- **Area:** Configuration
- **Severity:** Medium
- **Evidence:** `VERIFIED` by grep across `src/`. Keys defined in `runtimeConfig.ts` with no consumers outside that file include:
  `telemetry.enabledEventTypes`, `telemetry.captureGeometry`, `telemetry.sessionSettings.*`, `windowing.lateEventPolicy`, `fastGate.maxPatternLength`, `fastGate.rankingStrategy`, `slowGate.modelPath`, `slowGate.executionProvider`, `slowGate.batchSize`, `slowGate.targetContextEncoding`, `slowGate.fallbackBehavior`, `slowGate.enabled`, `policy.sustainedConfidenceDurationMs`, `policy.maxInterventionsPerTask`, `policy.conflictResolution`, `policy.ttlMs`, `actuation.defaultMechanism`, `actuation.revertBehavior`, `actuation.defaultTtlMs`, `experiment.trialOrder`, and `experiment.taskTimeoutsMs`.
  Three keys are actively misleading in exported traces: `slowGate.modelPath` records `'/models/gru_edge_aui.onnx'`, which is a nonexistent file. The runtime actually loads `model_int8.onnx` and `intervention_head_int8.onnx`. Keys `policy.ttlMs` and `actuation.defaultTtlMs` imply TTL expiration that never occurs (F-03).
- **Observed behaviour:** Changing these configuration keys has no effect on runtime execution.
- **Expected behaviour:** Every exported configuration key must control a real runtime mechanism, or be removed.
- **Impact:** Researchers cannot configure these parameters. In addition, `effectiveConfig` in traces misstates the model files that ran.
- **Recommended action:** Wire or remove each key. Never serialize unused values as effective configuration.
- **Implementation required?:** Yes. Small change per key.
- **Human decision required?:** Only for keys that should become active experimental parameters.

### F-18 — Duplicate concurrent evaluations and duplicate window ID attribution

- **Area:** Runtime correctness and trace integrity
- **Severity:** Medium
- **Evidence:** `VERIFIED` in a live trace. Method `maybeEvaluate()` guards evaluation with `this.evaluating`. However, `dispatchWindow()` runs asynchronously without waiting (`adaptiveRuntime.ts:544, 550-560`). It increments `processedWindowCount` only after worker reply. The runtime calls `maybeEvaluate` for each emitted window. The live trace shows three consecutive predictions that all carry `windowId: 10`, and later multiple predictions with `windowId: 55`. Predictions state window IDs that differ from the actual window evaluated. Worker diagnostics (`evaluatedSequenceLength: 39` versus `corpusSize: 2`) show that main-thread and worker corpora lose synchronization.
- **Observed behaviour:** The trace attributes multiple distinct evaluations to identical window IDs.
- **Expected behaviour:** Each evaluation must record the exact window ID of the evaluated sequence.
- **Impact:** Researchers cannot reliably trace which window triggered a prediction or intervention.
- **Recommended action:** Capture the window ID from the evaluated sequence at evaluation time, or serialize evaluations.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** No.

### F-19 — Model version is a hardcoded literal, and the trace cannot identify the deployed model

- **Area:** Model integration and reproducibility
- **Severity:** Medium
- **Evidence:** `VERIFIED`. File `adaptiveRuntime.ts:603-605` hard-codes: `const modelVersion = this.options.interventionModelUrl ?? (this.modelLoaded ? 'TargetInterventionHead-v1.0.0-int8' : undefined)`. Shipped ONNX graphs contain no version metadata (`metadata_props` is empty for FP32, contains ONNX quantizer strings for INT8, and `model_version = 0`). Real provenance exists in `model-preparation/models/bundles/v1.0.0/bundle.json`, which records experiment `e3`, checkpoint SHA-256, ONNX SHA-256 (`89d4549a…`), dataset hash, Git commit, and random seed. The runtime never reads this file.
- **Observed behaviour:** The runtime emits a static version string regardless of the loaded model artifact.
- **Expected behaviour:** The runtime must read and record genuine model provenance from the bundle manifest or model metadata.
- **Impact:** Swapping to an ablation model still records `TargetInterventionHead-v1.0.0-int8`. Model version cannot serve as an experimental variable in downstream analysis.
- **Recommended action:** Read the bundle manifest or embedded model hash and record it in prediction events.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** No.

### F-20 — Slow Gate confidence cutoff is 0.5 in code and 0.75 in configuration

- **Area:** Configuration and model integration
- **Severity:** Low to Medium
- **Evidence:** `VERIFIED` by code read. Class `OnnxSlowGate` sets `confidenceThreshold ?? 0.5` (`onnxSlowGate.ts:486, 506`). The worker forwards `minOutcomeConfidence` (`core.ts:83`), which `bootTestbed` never sets. The parameter falls back to 0.5. File `runtimeConfig.ts:219` sets `slowGate.confidenceThreshold: 0.75`. The runtime never reads this configuration key. However, the policy component independently enforces a 0.75 threshold.
- **Observed behaviour:** The Slow Gate emits candidate interventions with confidence between 0.5 and 0.75 as issued, but the policy rejects them later.
- **Expected behaviour:** The gate and policy must share a single consistent threshold from configuration.
- **Impact:** Candidates with confidence in `[0.5, 0.75)` are created and recorded as issued before rejection, contrary to documented configuration.
- **Recommended action:** Pass the configured threshold to the gate and remove the duplicate hard-coded default.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** No.

### F-21 — Condition switch kills in-flight work and leaves a stale diagnostics handle

- **Area:** Runtime lifecycle and observability
- **Severity:** Medium
- **Evidence:** `VERIFIED` live. Switching conditions produced 18 console errors: `Evaluation failed: Error: RuntimeWorkerClient terminated` and `Window dispatch failed`. Method `terminate()` in `workerClient.ts:200-205` rejects every in-flight request. After switching, `window.__EDGE_AUI__` still pointed to the stopped runtime. Function `status()` reported `running: false, conditionId: 'baseline'` while the new baseline runtime executed. Buffer counters reflected the old instance.
- **Observed behaviour:** Condition switching generates console errors and disconnects the diagnostics handle.
- **Expected behaviour:** The runtime must drain or cleanly cancel in-flight requests on stop, and update `window.__EDGE_AUI__` to point to the active instance.
- **Impact:** Switching conditions causes error noise, and diagnostics tools show inaccurate data during tests.
- **Recommended action:** Drain or cancel in-flight requests cleanly on stop. Update the global diagnostics pointer during `switchCondition`.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** No.

### F-22 — Debug toggle and minor UI issues limit accessibility and production use

- **Area:** Testbed UI
- **Severity:** Low
- **Evidence:** `VERIFIED` live. Element `.edge-aui-debug-toggle` exists only when the panel is collapsed (`DebugPanel.tsx:120-142`). Automated scripts and screen readers cannot expand the panel using the same selector twice. The panel formats MicroTensor values with 3 decimal places, making small kinematic values indistinguishable from zero (F-08). File `DebugPanel.tsx:44-50` excludes the panel from production builds unless `forceShow` is passed, which `App.tsx:61` never passes.
- **Observed behaviour:** The toggle control disappears when open, and production builds omit the panel entirely.
- **Expected behaviour:** The UI must maintain a stable toggle element and clearly format inactive versus active tensor states.
- **Impact:** Minor for lab sessions, but prevents developer panel access in packaged participant builds.
- **Recommended action:** Decide whether the panel ships in study builds. Maintain a permanent toggle handle and label inactive windows clearly.
- **Implementation required?:** Yes. Small change.
- **Human decision required?:** **Yes.** Decide whether the developer panel is included in study distributions.

### F-23 — Hard-coded configuration values materially affect experimentation

- **Area:** Configuration
- **Severity:** Informational
- **Evidence:** `VERIFIED` by grep. Multiple experimental values are hard-coded outside `runtimeConfig`:
  - `DEFAULT_RUNTIME_CONFIG.fastGate.patternInterventionMap` and `TESTBED_FAST_GATE_PATTERNS` duplicate pattern mappings (`boot.ts:34-40`). File `boot.ts` overrides config mappings completely.
  - Parameter `minPatternSupport` is passed as 1 from `boot.ts:110`. Config defaults to 1, while `AdaptiveRuntime` defaults to 2 (`adaptiveRuntime.ts:295`).
  - Parameter `minOutcomeConfidence` is ignored by the gate (F-20).
  - Outcome derivation constants (`rapidScrollMinEvents: 4`, `hoverDwellMinEvents: 2`, lookahead `[500, 1500]`) are hard-coded in `derive.ts:58-61`. The runtime constructs `OutcomeDeriver` with no options (`adaptiveRuntime.ts:232`), ignoring `pipelineConfig.json`.
  - Feature extraction proxies `dwellTimeMs = count * 40 ms` (`features.ts:196`) and `scrollDepth = count * 80 / scrollable` (`features.ts:213`) are construct validity assumptions.
  - Module `taskManager` uses `Date.now()`, while the window grid uses `performance.now()`.
  - Configuration `experiment.taskTimeoutsMs` is defined but unused (F-15).
- **Observed behaviour:** Several experimental parameters live in code rather than unified configuration.
- **Expected behaviour:** All experimental variables must derive from a single unified configuration schema.
- **Impact:** Researchers cannot easily tune experimental parameters across trials.
- **Recommended action:** Consolidate hard-coded values into `runtimeConfig` as detailed in Section I.
- **Implementation required?:** Yes.
- **Human decision required?:** No.

### F-24 — Documented model topology differs from the deployed model

- **Area:** Model integration, architecture documentation, and research validity
- **Severity:** **High**
- **Evidence:** `VERIFIED` on both sides. Files `docs/architecture.md:181-182` and `final-report.md:17, 40, 53` describe informed fusion as GRU `R^144 -> R^64`. Next, `TargetInterventionHead` combines `h_T` with 6-dimensional context `R^6` into the head. The deployed graph takes `sequence_input (batch, seq, 18)` and `context_input (batch, 6)`. It produces `intervention_logits (batch, 5)`. The deployed graph internally combines the 64-wide hidden state with context (`head.fc.0.weight [64, 70]`). File `OnnxSlowGate.infer` feeds the raw `[1, 8, 18]` tensor to the head (`onnxSlowGate.ts:300-331`) and executes the foundation model in parallel. Hidden state `h_T` is never extracted or recorded by the runtime.
- **Observed behaviour:** The deployed head accepts the raw sequence tensor, not an extracted hidden state vector.
- **Expected behaviour:** System documentation must accurately describe the deployed model graph.
- **Impact:** Architectural documentation describes an interface that does not run in production. Researchers analyzing model inputs evaluate inaccurate structural descriptions.
- **Recommended action:** Update the architecture diagram and reports to describe the dual-input sequence fusion graph. Alternatively, export a hidden-state head if that was the intended design.
- **Implementation required?:** Documentation update, or model re-export.
- **Human decision required?:** **Yes.** Decide which neural architecture is the intended research artifact.

### F-25 — Integration guide fails type compilation against shipped interfaces

- **Area:** Documentation and portability
- **Severity:** Medium
- **Evidence:** `VERIFIED`. Document `docs/integration.md:27-91` describes `UiAdapter` methods `getTasks()`, `resolveUiContext()`, and `notifyTaskEvent()`. The actual interface (`src/integration/types.ts:75-146`) requires `id`, `getActiveContext`, `getTaskState`, `onTaskStateChange`, and `recordInteraction`. Documented `UIContext` omits required fields: `route`, `taskId`, `taskStepId`, `availableActions`, and `conditionId` (`src/types/uiContext.ts:78-98`). Import paths like `edge-aui-framework/integration` fail because `package.json` specifies `"private": true` with no export map. Documented CSS class names and revert behaviours also mismatch code.
- **Observed behaviour:** Code snippets in the integration guide fail compilation against framework types.
- **Expected behaviour:** Integration documentation must compile and pass type verification against current framework interfaces.
- **Impact:** Claims that the framework can be embedded into third-party web applications without custom code remain unproven.
- **Recommended action:** Regenerate the integration guide from TypeScript definitions and add a compilation test for documentation examples.
- **Implementation required?:** Documentation and automated test.
- **Human decision required?:** No.

### F-26 — Zero network primitives claim is inaccurate for model asset loading

- **Area:** Privacy claim accuracy
- **Severity:** Medium
- **Evidence:** `VERIFIED`. Document `architecture.md:387-388` claims that no network primitives are called during telemetry processing or model inference. File `onnxSlowGate.ts:166` calls `ort.InferenceSession.create(modelUrl)`, and ONNX Runtime Web fetches `ort-wasm-simd-threaded.jsep.wasm`. These calls use HTTP fetches for same-origin static assets. Test `context_redaction.test.ts:214-259` mocks network calls only around telemetry processing.
- **Observed behaviour:** Model and WASM binaries are loaded via HTTP network requests.
- **Expected behaviour:** Privacy claims must state that behavioural data never leaves the client, while noting that model assets load via static HTTP requests.
- **Impact:** The claim as written is technically inaccurate, even though telemetry privacy remains fully preserved.
- **Recommended action:** Clarify the claim: no behavioural data leaves the client. Static model files load via same-origin HTTP requests. Extend the network redaction test to cover inference.
- **Implementation required?:** Documentation update and test extension.
- **Human decision required?:** No.

### F-27 — Consistency audit reveals additional documentation defects

- **Area:** Documentation
- **Severity:** Low individually, High collectively
- **Evidence:** `VERIFIED` across 174 local documentation links.
  - Document `docs/integration.md:14` contains a broken link to ADR-009.
  - Document `docs/architecture.md:142` claims 30 macro symbols, while `symbols.ts:9-47` defines exactly 26.
  - Document `condition-comparison.md:51` references `FILTER_SELECT` and `FILTER_APPLY`, which are absent from the canonical taxonomy.
  - Baseline and adaptive trace fixtures include windows with `eventCount: 2`, which the live runtime rejects (`min_events_per_window = 3`).
  - File `data_schemas.md:73` gives `trajectoryEntropy` scale `/5.0`, while code divides by 3.0 (`features.ts:184`).
  - Document `runtime-benchmark.md:118` labels total client assets at 28 787 955 bytes, omitting icons, HTML files, and WASM chunks.
  - Document `final-report.md:260` claims client assets total 1.4 MB without ORT WASM. The real residual is 1.99 MB.
  - Document `final-report.md:137` cites deferred item D13, but ADR-014 defines only D1 through D12.
  - Document `participant-readiness.md:64-93` and ADR-014 use two conflicting numbering schemes for deferred items D1 through D7.
  - Test counts in documentation state 45 files and 324 tests, whereas the test suite contains 47 files and 336 tests.
  - Two ADR files still cite trace schema version 1.1.0 instead of 1.2.0.
- **Observed behaviour:** Multiple documentation files contain obsolete figures, broken links, and vocabulary mismatches.
- **Expected behaviour:** All documentation metrics, symbols, and links must match current code.
- **Impact:** The documentation set cannot serve as an authoritative record of implementation until updated.
- **Recommended action:** Regenerate documentation metrics from code. Add automated tests to verify local links and constant parity.
- **Implementation required?:** Documentation and automated test.
- **Human decision required?:** No.

## E. Research-Readiness Gaps

### E.1 Participant telemetry collection

| Requirement | Status | Evidence |
|---|---|---|
| Captures interaction without obstructing it | **READY** | Passive listeners with `capture: true` and `passive: true` in live session. |
| Normalised, monotonic event model | **READY** | Implemented in `observer.ts` and `normalizer.ts`. |
| Geometry captured per event | **READY** | Method `captureGeometry` records viewport and document dimensions in live records. |
| No keyboard or content capture | **READY (by absence)** | No key events are bound. `BehaviourEvent` contains no text field. |
| No egress primitives | **READY** | The `src/` directory contains zero network APIs. |
| Survives a long session | **GAP** | Buffer uses silent eviction after 10 000 items (F-16). |
| Survives tab close or crash | **NOT IMPLEMENTED** | In-memory buffer only. |
| Participant identity | **NOT IMPLEMENTED** | Anonymous session UUID only. No participant token exists (DEFERRED D2). |
| Consent or withdrawal | **NOT IMPLEMENTED** | Deferred under item D5. |

### E.2 Persistence

The system persists no data. There is no durable store, no queue, and no retry mechanism. There is no schema versioning of stored records, and no handling for partial or failed sessions. The system lacks duplicate submission protection, offline behaviour, and synchronization because no write path exists. This work is deferred by ADR-009, ADR-010, and ADR-014 item D3. Grep shows that persistence is completely absent.

### E.3 Dataset generation

| Layer | Exists? | Description |
|---|---|---|
| A. Runtime collection | Yes | Operates with F-16 buffer eviction limits. |
| B. Transport | **No** | No transport mechanism exists. |
| C. Persistence | **No** | No persistent storage exists. |
| D. Dataset preparation | **Exists in `model-preparation`** | Ingestion, Parquet storage, MicroTensor store, target dataset, and training exist. However, the pipeline rejects runtime schema 1.2.0 (F-09) and re-derives outcomes independently. |
| E. Research analysis | Partially | Scripts `verify-trace.mjs` and `compare-condition-traces.mjs` exist. Task-level metric computation is absent (see E.4). |

### E.4 Task measurement

| Metric | Status | Evidence and details |
|---|---|---|
| Task completion time | **Derivable, but not from the trace** | `TaskEvent.durationMs` exists and derives from an epoch clock (`taskManager.ts:178-181`, live `durationMs: 4953`). However, task events cannot align with behaviour events (F-01). Metadata duration (20 121 ms) differs from task duration (4 953 ms). |
| Task success or failure | **PARTIAL** | Completion uses structural element matching (F-15). No failure state exists. |
| Task abandonment | **IMPLEMENTED** | Method `abandonTask` handles navigation and reset exits (`taskManager.ts:96-120, 195-213`). No timeout path exists. |
| Number of attempts | **GAP** | The system provides no attempt model. Resetting discards the current attempt. |
| Backtracking | **PARTIAL** | `BACKTRACK` outcome and macro symbol exist. The application has no router, so history navigation rarely fires. |
| Navigation errors | **PARTIAL** | Counter `taskManager.errors` counts mis-targeted clicks rather than wrong routes. |
| Interaction count | **DERIVABLE** | Counts derive from `behaviourEvents` and `macroInteractions` buffers. |
| Intervention count, timing, and acceptance or dismissal | **PARTIAL** | Applied, reverted, and dismissed events are recorded. Acceptance and rejection decisions are not recorded (F-07). Without TTL, expiration events cannot occur (F-03). |
| Time-to-completion after intervention | **GAP** | Requires single-clock resolution (F-01) and policy decision logging (F-07). |
| Condition-level comparison | **PARTIAL** | Condition ID appears on every relevant record, and live separation was verified. Current tooling evidence relies on test fixtures (F-12). |

The following items require new task lifecycle events:
- Step success predicate.
- Explicit failure state.
- Attempt identity.
- Task timeout path.

The following items require persistent timestamps:
- All task measurement metrics in section E.4 (F-01).

The following items require explicit participant actions:
- Consent capture.
- Participant withdrawal.
- Session submission.

The following items require methodological decisions:
- Defining task success criteria.
- Determining whether adaptations expire.
- Choosing participant identifier strategy.

### E.5–E.7 Intervention observability, baseline experimentation, and UX assessment

Findings F-03, F-05, F-07, F-08, F-12, and F-15 detail these gaps. The required distinctions map as follows:

| Required distinction | Available today? | Evidence |
|---|---|---|
| No prediction | Implicitly only | Inferred by the absence of a `PredictionEvent`. |
| Prediction below threshold | **No** | The runtime does not record sub-threshold predictions. |
| Policy rejected prediction | **No** | Visible only temporarily in the DebugPanel string (F-07). |
| Cooldown active | **No** | Method `cooldownRemainingMs()` exists, but no recorder calls it (F-07). |
| Fast Gate handled interaction | Yes | Recorded in `PredictionEvent.matchedGate`. |
| Slow Gate invoked | Yes | Recorded in `matchedGate`, `slowResult`, and gate latencies. |
| Intervention emitted | Yes | Recorded in `InterventionEvent`. |
| Actuator failed | Only in console | Logged as a warning (`actuator.ts:93`). Not recorded in trace. |
| Intervention currently active | Yes in DOM | Partially verified in DOM (F-05). Cannot be derived purely from trace. |
| Intervention expired | **Impossible** | No TTL exists (F-03). |

---

## F. Task Coverage Matrix

Task definitions are in `src/testbed/tasks/taskModel.ts:38-70`. Reachability and behaviour were verified against the live DOM and a live run of Task T1.

### F.1 Per-task factual assessment

**T1 — Filter Analytics** (`T1-1` nav-Analytics/click → `T1-2` filter-Region/click → `T1-3` filter-Region-select/change → `T1-4` btn-apply-filters/click)

| Aspect | Fact |
|---|---|
| Primary user goal | Narrow the results table by region and run the query again. |
| Expected interaction sequence | Navigate, expand accordion, change select control, and submit form. |
| Behavioural pattern exercised | Filtering, navigation, form interaction, and option disclosure. |
| Expected telemetry | Clicks, select changes, focus events, pointer kinematics, and hovers. |
| Expected macro pattern | `NAV_ANALYTICS, OPEN_FILTERS, SELECT_REGION, APPLY_FILTER` |
| Observed macro stream | Dominated by repetition noise: `NAV_ANALYTICS, OPEN_FILTERS x18, SELECT_REGION ..., APPLY_FILTER x13` (F-06). |
| Expected Fast Gate | Declared pattern requires date selection that T1 never requests. Declared patterns do not align with the task. |
| Observed Fast Gate | Matched `NAV_ANALYTICS > OPEN_FILTERS` to `simplify_options`. Policy rejected the match due to missing expandable options. |
| Expected intervention | Eligibility for `simplify_options` requires `context.expandable`. `getActiveUIContext` sets this flag only when tracking an accordion (`contextProvider.ts:117-132`). |
| Expected observable UI change | Accordion collapses with class `edge-aui-simplified` when eligible. |
| Expected outcome | Event `task_complete` with filtered table data. |
| Research metric | Completion time, errors, and filter usage. |
| Implementation status | **Completable.** Live run finished 4 of 4 steps with status `Completed` and `durationMs: 4953`. Selecting the default value completes the step (F-15). |

**T2 — Export Report** (`T2-1` nav-Analytics/click → `T2-2` btn-export/click)

| Aspect | Fact |
|---|---|
| Primary user goal | Export visible result rows. |
| Expected interaction sequence | Navigate to analytics, then click export. |
| Behavioural pattern exercised | Navigation and primary action execution. |
| Expected macro pattern | `NAV_ANALYTICS, EXPORT_REPORT` |
| Expected intervention | `highlight_primary_action` (declared patterns map to this action). |
| Expected observable UI change | Applies `edge-aui-highlight` and `data-aui-active-adaptation="highlight"` on `btn-export`. This is the only adaptation setting correlation attributes (F-05). |
| Implementation status | **Completable** in 2 steps without filtering. Exercises primary-action highlighting. Document `condition-comparison.md:26` inaccurately describes T2 as including filter selection (F-12). |

**T3 — Configure Advanced Filter** (`T3-1` nav-Analytics → `T3-2` filter-Product Category/click → `T3-3` filter-segment-select/change → `T3-4` btn-apply-filters/click)

| Aspect | Fact |
|---|---|
| Primary user goal | Change product category and customer segment, then apply filters. |
| Expected interaction sequence | Navigate, expand category, toggle checkboxes, expand advanced accordion, change segment, and apply filters. |
| Behavioural pattern exercised | Multi-accordion disclosure, checkbox interaction, and option complexity. |
| Expected macro pattern | `NAV_ANALYTICS, OPEN_FILTERS, SELECT_CATEGORY, SELECT_SEGMENT, APPLY_FILTER` |
| Caveat | Step T3-3 targets `filter-segment-select` inside Advanced Options. The instruction does not tell participants to open that second accordion. |
| Implementation status | **Completable.** Exercises the richest UI surface, and is the only task that produces `SELECT_CATEGORY`. |

### F.2 Coverage matrix

| Behaviour or path | T1 | T2 | T3 | Notes |
|---|---|---|---|---|
| Habitual or repeated sequences | Incident | Incident | Incident | Produced only as repetition artifacts (F-06). |
| Filtering and navigation | Active | Active | Active | All tasks start with `nav-Analytics`. |
| Form interaction | Active | None | Active | Select and checkbox change events. |
| `FORM_SUBMIT` outcome | Active | None | Active | Fires via `<form onSubmit>` or button clicks (`derive.ts:100-105`). |
| Hesitation and dwell | Incident | Incident | Incident | Producible by hovers. No task step requires it. |
| Hover and dwell | Incident | Incident | Incident | KPI cards and tooltips provide hover annotations. |
| Backtracking | None | None | None | Application lacks a router. History events rarely fire. |
| Rapid scrolling | Incident | Incident | Incident | Requires 4 scroll events in one lookahead window. Not required by tasks. |
| Option complexity | Active | None | Active | Exercises accordions and checkboxes. |
| Tooltip and help demand | Incident | Incident | Incident | Tooltips exist, but tasks do not require consulting them. |
| Intervention opportunities | Active | Active | Active | Eligibility depends on the active tracked element (F-06). |
| No-intervention control cases | Implicit | Implicit | Implicit | No task serves as a dedicated negative control. |
| Fast Gate match | Incident | Incident | Incident | Matches depend on repetition noise (F-06). |
| Slow Gate invocation | Active | Active | Active | Runs on every Fast Gate miss. Live `slowGateMode: 'onnx'`. |
| Learned head prediction | Unverified | Unverified | Unverified | All observed decisions used `fast_gate_pattern`. No run observed `learned_head`. |
| Macro symbols reached | 5 | 3 | 7 | Seven symbols are unreachable in the shipped UI. |

Legend: Active indicates required and observed. Incident indicates producible incidentally. None indicates not producible. Unverified indicates not observed in audit runs.

### F.3 Gaps identified

- **Redundant task starts:** All three tasks start with `nav-Analytics` and end on filter submission or export. Tasks T1 and T3 differ primarily in which accordion they open.
- **Tasks do not force intended behaviours:** Tasks do not compel hesitation, dwell, backtracking, or rapid scrolling. Telemetry depends entirely on accidental participant behaviour.
- **Tasks depend on accidental UI state:** Step success evaluates only whether controls were touched, not whether required filter states were produced (F-15).
- **Tasks do not exercise the learned Slow Gate:** No task demonstrates live intervention driven by `TargetInterventionHead`.
- **Intervention visibility is subtle:** Collapsing accordions is visible, but highlighting a button adds subtle CSS styling. Only highlighting sets a correlation attribute.
- **Missing control tasks:** The testbed includes no task designed to produce zero eligible interventions.
- **Missing negative-control condition:** The suite provides no within-task negative control beyond the broad baseline condition.

---

## G. Intervention Observability Matrix

The table below lists all intervention paths traceable in the framework:

| Intervention | Source | Trigger | Policy decision | Actuator | Visible effect | Panel evidence | Trace evidence | Verification status |
|---|---|---|---|---|---|---|---|---|
| `highlight_primary_action` | Fast Gate via declared pattern | Mined pattern matches recent macro symbols. | Confidence 1.0. Context requires `primaryActionAvailable`. Persistence requires 2 windows. | Sets `edge-aui-highlight` and `data-aui-active-adaptation="highlight"`. | Highlights target button. | Shows Fast Gate match, intervention name, and policy state. | `PredictionEvent` and `InterventionEvent` recorded. | `VERIFIED` in implementation record. Audit observed pattern attempt, but policy rejected it. |
| `simplify_options` | Fast Gate via pattern `NAV_ANALYTICS > OPEN_FILTERS` | Mined pattern matches navigation and filter opening. | Requires `context.expandable`. Rejected in audit because expandable was false at evaluation time. | Adds `edge-aui-simplified` to form and closes accordions. | Collapses accordions. | Shows `no_op` and ineligibility reason. | `PredictionEvent` recorded. Rejection not recorded (F-07). | `VERIFIED` applied in earlier live trial. |
| `expand_tooltip` | Fast Gate pattern `HOVER_KPI > HOVER_KPI` or Slow Gate | Repeated hovers or outcome prediction. | Evaluates confidence and `helpAvailable`. | Injects `.edge-aui-tooltip-bubble` with ARIA description. Dismisses on Escape. | Renders tooltip bubble. | Shows `expand_tooltip`. | `InterventionEvent` recorded. Dismissal recorded on Escape. | `IMPLEMENTED` and unit-tested (`actuator.test.ts`). Not observed live in audit. |
| `offer_assistance` | Slow Gate or deterministic map for `BACKTRACK` or `ABANDON` | Hesitation or abandonment outcome. | Always context-eligible. | Injects `aside.edge-aui-assistance-banner` with dismiss button. | Renders banner. | Shows `offer_assistance`. | Applied and dismissed events recorded. | `IMPLEMENTED` and unit-tested. Not observed live in audit. |
| `no_op` | Fast Gate miss or policy rejection | Any rejected candidate. | Accepted as safe default. | Method `apply()` emits an applied event for `no_op` (`actuator.ts:79-89`). | No DOM change. | Shows `no_op` and rejection reason. | Recorded as `issued: no_op`. Rejection reason is lost (F-07). | `VERIFIED`. Three of five intervention records in live trace were `no_op`. |

### Reasons why interventions are difficult to verify

The following observed factors impede intervention verification:

1. **Rejection reasons are not persisted (F-07):** Live traces record `issued: no_op` without recording the policy rejection reason.
2. **Missing TTL and missing correlation attributes (F-03, F-05):** Adaptations persist indefinitely. Only primary action highlighting sets `data-aui-active-adaptation`.
3. **Fast Gate matches repetition noise (F-06):** Pattern matches reflect event loop artifacts rather than meaningful behavioural sequences.
4. **Developer panel shows only the latest decision (F-08):** The panel clears macro sequences every 500 ms and shows stale window data.
5. **Worker request timeouts drop evaluations (F-02):** Multi-second mining passes trigger 5 000 ms RPC timeouts, dropping queued evaluations.
6. **Ambiguous window ID attribution (F-18):** Panel metrics and trace records cannot be tied reliably to specific evaluation windows.
7. **Absence of verified learned head decisions:** The audit observed no live intervention driven by `learned_head`.
8. **Context eligibility rejections:** Observed rejections stemmed from UI context eligibility rather than low model confidence.

The audit showed that selectors resolved accurately and actuators executed without throwing DOM errors.

## H. Test Coverage Matrix

Command `npx vitest run` at HEAD reports: 47 files, 336 tests, 336 passed, 0 failed in 24.4 s (`VERIFIED`). All test suites execute in `jsdom` (`vitest.config.ts:9`). The repository contains no real browser tests in the automated suite.

| Suite | Class | What it genuinely tests | What it does not test |
|---|---|---|---|
| `parity.test.ts`, `vectorizer_parity.test.ts`, `parity_fixture_provenance.test.ts`, `windowing_reference_equivalence.test.ts` | Parity | 18-D feature order, scales, masks, and boundaries at 1e-4 tolerance. Fixture derivation via Python. | Live versus Python window count equivalence (F-04). |
| `telemetry_observer.test.ts`, `telemetry_normalizer.test.ts` | Unit | Event binding, normalisation, and listener isolation. | Real browser dispatch, background tab behaviour, and event loss under load. |
| `windowing_contract.test.ts`, `microtensor_window.test.ts` | Unit | Grid, inactivity, late and sparse counters, and geometry. | Testing whether the shipped configuration produces documented counter values (F-04). |
| `outcome_derivation.test.ts` | Unit and schema | Python lookahead semantics and seven test cases. | Live settling under load. The abandon path on pagehide is not evaluated end to end. |
| `macro_sequence.test.ts`, `macro_symbols.test.ts`, `macro_fast_gate_wiring.test.ts` | Unit | Macro stream, symbol derivation, and corpus shape. | Verifying that derived symbols match intended user actions (F-06). |
| `prefixspan_fast_gate.test.ts`, `fast_gate.test.ts` | Unit | Gate semantics and fail-safe behaviour on miner errors. | Miner correctness and bounds (F-02). The test suite mocks the miner. |
| `slow_gate.test.ts`, `onnx_contract.test.ts`, `intervention_head_contract.test.ts` | Contract | Graph shapes, class counts, softmax, and dual execution. | WebGPU execution. Verifying runtime versus training parity on identical inputs beyond shape. |
| `gate_arbitration.test.ts`, `gate_routing_evidence.test.ts` | Integration | Gate routing, short-circuit execution, latency fields, and error handling. | Verifying that latencies come from real model runs. Tests inject literal numbers (`:191,238,331`). |
| `intervention_policy.test.ts`, `policy_cooldown_ttl.test.ts` | Unit | Thresholds, persistence, cooldown, dismissal, and TTL when set. | Verifying that production code ever sets a TTL (F-03). |
| `actuator.test.ts` | Unit | Reversibility, focus preservation, ARIA, Escape key, and TTL expiry when set. | Verifying correlation attributes on non-highlight adaptations (F-05). |
| `adaptive_runtime.test.ts` | Integration | Composed pipeline produces events, windows, and outcomes with correlation IDs. | Concurrency, worker timeouts, and condition switching under load. |
| `worker_runtime.test.ts` | Integration | Request-response contracts and fallback worker core. | Backpressure, head-of-line blocking, and timeout handling (F-02). |
| `task_wiring.test.tsx`, `active_ui_context.test.tsx`, `semantic_dom_annotations.test.tsx`, `target_ui_components.test.tsx` | Component | References rendered components and stimulus determinism. | State-based success, failure transitions, and timeouts (F-15). |
| `ui_adapter_contract.test.ts`, `ui_adapter_second_implementation.test.ts` | Contract | Port interface and a second implementation. | Tests demonstrate adapter portability across UI frameworks. |
| `trace_attribution_verifier.test.ts`, `trace_mapping_attribution.test.ts`, `context_redaction.test.ts` | Schema and contract | Verifier logic, mapping source attribution, zero egress, and redacted field values. | Verifier behaviour on real trace captures (F-13). |
| `condition_trace_comparison.test.ts` | Integration | Comparison CLI over hand-authored fixtures. | Real two-condition experimental runs (F-12). |
| `e2e_simulation.test.ts` | Integration (`jsdom`) | Scripted composition of mock gates, policy, actuator, and recorder. | Real runtime, real gates, real ONNX, and real worker execution. |
| `runtime_instrumentation.test.ts`, `pipeline_configuration.test.ts`, `sync_config.test.ts`, `documentation_schema_index.test.ts`, `adr_register_consistency.test.ts` | Contract | Stage registry, config validation, config sync, document index, and ADR register format. | Verifying that documentation claims about code are accurate. Tests verify ADR files exist, not that cited names exist (F-27). |

### Claims with no corresponding test

| Claim | Location | Status |
|---|---|---|
| Baseline and adaptive differ only by adaptation mechanism | `participant-readiness.md:16` | Verified live by audit (zero DOM mutations in baseline), but no automated test evaluates real traces. |
| Intervention activation is verifiable | Brief §10 | No test asserts that an applied adaptation in the DOM links to a trace episode. |
| Fast Gate latency < 5 ms | `final-report.md:118` | No benchmark measures Fast Gate latency (F-14). |
| TBT = 0 ms | `runtime-benchmark.md` | Hard-coded string in benchmark generator (F-14). |
| Traces are complete with no dropped windows | `verify-trace.mjs` | Real captures fail the verifier (F-13). |
| Learned head is exercised live | `intervention_head_contract.test.ts` | Tests the gate in isolation. No live decision was observed in runtime. |
| Schema compatibility with dataset pipeline | None | No cross-repository contract test exists. The two codebases disagree (F-09). |
| Task completion time is measurable | Brief §7 | No test exists. Cannot be derived from traces due to mixed clocks (F-01). |

Failure-path coverage: Gate exceptions are covered. In contrast, worker timeouts, request cancellations on condition switch, buffer eviction, trace overflow, and partial-session loss lack tests.

---

## I. Configuration Audit

Materially experimental values that are hard-coded or defined without consumers appear below:

| Parameter | Location | Configurable? | Current effect |
|---|---|---|---|
| Fast Gate declared pattern to intervention map | `DEFAULT_RUNTIME_CONFIG.fastGate.patternInterventionMap` and `TESTBED_FAST_GATE_PATTERNS` (`boot.ts:34-40`) | Yes. Defines deterministic arm. | Two sources exist. File `boot.ts` overrides config mappings completely. |
| `minPatternSupport` | Config (1), `AdaptiveRuntime` fallback (2), and `boot.ts` (1) | Yes. | Effective value is 1 across three competing sources. |
| Slow Gate confidence threshold | `slowGate.confidenceThreshold: 0.75` (unused) versus `OnnxSlowGate` default 0.5 | Yes. | Effective value is 0.5 in gate, then 0.75 in policy (F-20). |
| Slow Gate model paths | `slowGate.modelPath` (points to nonexistent file) versus hard-coded `DEFAULT_MODEL_URL` | Yes. | Traces record a model file that never loads (F-17). |
| Outcome derivation constants (`rapidScrollMinEvents`, `hoverDwellMinEvents`, lookahead) | Hard-coded in `derive.ts:58-61`. Deriver constructed without options. | Yes. Defines label semantics. | Values in `config.yaml` are mirrored in `pipelineConfig.json` but not passed to runtime deriver. |
| Event sampling | `telemetry.sampleIntervalMs` (wired) | Yes. | Default 0 captures every browser event, driving trace volume. |
| Enabled event types | `telemetry.enabledEventTypes` (unused) | Yes. | All bound event types are captured unconditionally. |
| Policy TTL and actuation TTL | `policy.ttlMs` and `actuation.defaultTtlMs` (unused) | Yes. Defines adaptation duration. | No expiration occurs (F-03). |
| `maxInterventionsPerTask`, `sustainedConfidenceDurationMs`, `conflictResolution` | Unused configuration | Yes, if required by experiment. | No runtime effect. |
| Task timeouts | `experiment.taskTimeoutsMs` (unused) | Yes. | No timeout-driven failure or abandonment occurs. |
| Trace buffer size | `telemetry.maxBufferSize` (unused, recorder defaults to 10 000) | Yes. | Traces silently evict events beyond 10 000 items (F-16). |
| Task step success criterion | Code in `taskManager.ts:136-141` | Yes. Defines task success. | Component-ID matching only (F-15). |
| Macro grouping interval | `macro.groupingIntervalMs` (wired, 2 000 ms) | Yes. | Shapes the mining corpus. |
| Kinematic proxies `dwellTimeMs` and `scrollDepth` | Code in `features.ts:196, 213` | Parity-locked | Represents construct validity assumptions, not a configuration bug. |

Values that are legitimately implementation details and should not be exposed:
- The 125 ms tick interval (`adaptiveRuntime.ts:504`).
- The 60 s initialisation timeout.
- The 5 s RPC timeout (which should become adaptive under F-02).
- CSS escaping logic.
- The anonymous session UUID generator.

---

## J. Legacy and Dead-Code Findings

The audit changed no files. Items are classified below:

| Item | Classification | Evidence |
|---|---|---|
| `src/gates/fast/mockFastGate.ts` | **Needs verification** | Exported and tested. No longer used by runtime boot because `boot.ts` supplies a non-empty pattern map. Retained as test double and fallback. |
| `src/gates/slow/mockSlowGate.ts` | **Intentionally retained** | Fallback when ONNX is unavailable (`core.ts:99`) and test double. |
| `src/gates/slow/onnxSlowGate.ts` `useDeterministicMapping` | **Intentionally retained** (ablation arm) | Does not match teacher policy (F-11). |
| `src/runtime/workerClient.ts` in-process fallback | **Intentionally retained** | Used when `Worker` is unavailable, such as in tests. |
| `docs/experiments/baseline-trace.json` and `adaptive-trace.json` | **Misleading, needs replacement** | Hand-authored fixtures presented as trial exports (F-12). |
| `docs/experiments/report-export-*.json` (3 files) | **Obsolete** | Legacy table export payloads, unrelated to trace schema. |
| `docs/experiments/random/traces/experiment-trace-unknown-session-1789699931139.json` | **Obsolete** | Schema 1.0.0 with empty arrays, predating current recorder. |
| `model-preparation/models/model.onnx` and `model_int8.onnx` | **Conflicting implementation** | 6-class hidden-32 graphs contradicting `config.yaml` (7 classes, hidden 64). The required 7-class graph exists only on the edge side. File `dvc.lock` is stale. File `model.onnx.data` is an orphaned sidecar. |
| `slowGate` configuration keys (`modelPath`, `executionProvider`, `targetContextEncoding`, `fallbackBehavior`, `batchSize`, `enabled`) | **Unused configuration** | Detailed in finding F-17. |
| Telemetry, policy, and actuation configuration keys (`enabledEventTypes`, `captureGeometry`, `sessionSettings`, `lateEventPolicy`, `maxPatternLength`, `rankingStrategy`, `policy.*`, `actuation.*`, `experiment.*`) | **Unused configuration** | Detailed in finding F-17. |
| Parameter `adaptation.defaultMechanism` (DOM versus css_class) | **Deprecated** | Only CSS and ARIA adaptation exists. |
| `src/gates/fast/prefixSpanMiner.ts` versus `WasmGateClient` | **Resolved** | Documentation records removal. No `WasmGateClient` remains. |
| Legacy files in `src/main.ts`, `src/core/**`, `src/types/telemetry.ts`, and `src/workers/**` | **Already removed** | Absent from working tree. |
| Script `scripts/quantify-sparse-window-loss.mjs` | **Needs verification** | Globs the traces directory, so figures no longer reproduce after adding a seventh trace. |
| Directory `dist/` | **Generated and stale** | Contains four model files and previous build output. |

No item in this list requires removal to complete the audit. All classifications are documented for planning.

## K. Architectural Decision Log

Each decision requires review by the human researcher.

### K-1 Persistence architecture and participant identifier strategy

- **Decision:** Determine where participant telemetry is stored durably. Choose browser-local storage with manual export, browser-local storage with sync, or a research endpoint. Determine how participants are identified without collecting PII.
- **Why it matters:** It determines consent text, data retention, study failure models, and whether automated collection exists. It also determines whether exported telemetry survives closed tabs.
- **Current implementation:** In-memory only. A single anonymous UUID per session (`session.ts:39-75`). Manual JSON export (`recorder.ts:297-323`). No storage or network primitive exists in `src/` (`VERIFIED`). ADR-009, ADR-010, and D3 defer this functionality.
- **Options:** (a) Session-scoped IndexedDB write-ahead log with end-of-session export. (b) Researcher-mediated manual export only. (c) Opt-in encrypted upload to a study endpoint. (d) Adaptive streaming with consent gating.
- **Evidence required:** A policy decision on retention and consent. A threat model for ingestion. Measured storage footprints against the 20 MB memory budget.
- **Recommended next investigation:** Prototype option (a) behind the existing `UiAdapter` interface so core modules remain unchanged.
- **Human decision required:** **Yes.**

### K-2 Cross-repository trace schema of record

- **Decision:** Choose whether the runtime emits 1.1.0-compatible traces, or `model-preparation` ingestion updates to 1.2.0. Determine which repository owns future schema bumps.
- **Why it matters:** The current pipeline cannot ingest traces, blocking the dataset milestone (F-09).
- **Current implementation:** Runtime emits 1.2.0 (`traceSchema.ts:31`). Ingestion expects 1.1.0 (`trace_ingestion.py:42, 110-115`).
- **Options:** (a) Ingestion accepts schema 1.2.0 with an explicit allow-list. (b) Runtime downgrades output to 1.1.0. (c) A single generated schema file is tracked in both repositories with a cross-repository contract test.
- **Evidence required:** The exact field delta between versions (mapping source, model version, context encoding, per-gate latencies, prediction arrays, and task events).
- **Recommended next investigation:** Diff schema keys against runtime types and run one real trace through an updated ingestion script.
- **Human decision required:** **Yes.**

### K-3 Canonical clock for trace records

- **Decision:** Select one monotonic timeline anchored to an epoch, or add per-record clock tags.
- **Why it matters:** Task completion time, intervention timing, and causal replay depend on consistent timing (F-01).
- **Current implementation:** Mixed clocks. Behaviour, window, and outcome records use monotonic `performance.now()`. Prediction, intervention, and task records use epoch `Date.now()`.
- **Options:** (a) Monotonic time for all records with an epoch start anchor. (b) Epoch timestamps for all records. (c) Explicit clock tags on each record.
- **Evidence required:** None beyond the decision. Implementation is mechanical across 6 call sites.
- **Recommended next investigation:** None.
- **Human decision required:** **Yes** (choice of record format).

### K-4 Adaptation lifetime

- **Decision:** Determine whether interventions expire on TTL, revert on user action, or persist for the session.
- **Why it matters:** Lifetime rules change what participants experience and how downstream traces are interpreted (F-03).
- **Current implementation:** Adaptations persist indefinitely. TTL configuration exists but code never applies it.
- **Options:** (a) Enforce `actuation.defaultTtlMs`. (b) Revert adaptations on qualifying user actions. (c) Document session persistence as intended behaviour.
- **Evidence required:** Pilot observation evaluating whether persistent adaptations bias subsequent task steps.
- **Recommended next investigation:** Instrument active adaptation duration in traces and measure it in a scripted run.
- **Human decision required:** **Yes.**

### K-5 Task list changes and definition of task success

- **Decision:** Determine whether the task set changes, and whether success evaluation becomes state-based.
- **Why it matters:** Task completion time and success rates are primary UX evaluation metrics (F-15).
- **Current implementation:** Tasks T1 through T3. Step matching evaluates element clicks. No failure state, attempt model, or timeouts exist.
- **Options:** (a) Retain current tasks and add state predicates, a `Failed` state, and timeouts. (b) Redesign tasks to compel hesitation and backtracking. (c) Add an explicit negative-control task with zero eligible interventions.
- **Evidence required:** Coverage verification showing that tasks trigger the intended behavioural patterns.
- **Recommended next investigation:** Execute each task with a scripted runner under both conditions to verify whether intended telemetry patterns occur.
- **Human decision required:** **Yes.**

### K-6 Intervention visualisation strength

- **Decision:** Determine how visible adaptations must be for participants and researchers without changing task goals.
- **Why it matters:** Subtle adaptations cannot be evaluated, while aggressive adaptations distort user interaction.
- **Current implementation:** CSS classes, ARIA attributes, and injected banners. Only primary action highlighting sets correlation attributes.
- **Options:** (a) Enhance styling salience. (b) Add an unobtrusive adaptation indicator. (c) Retain current styles and rely on developer panel inspection.
- **Evidence required:** Participant discrimination testing and DOM verification.
- **Recommended next investigation:** Capture visual screenshots of both adaptation states and compare clarity.
- **Human decision required:** **Yes.**

### K-7 Baseline and adaptive protocol, randomisation, and counterbalancing

- **Decision:** Choose within-subject or between-subject design, trial order, trials per condition, and condition switching mechanisms.
- **Why it matters:** Current switching is manual, condition order is fixed, and in-flight worker tasks stop on switch (F-21).
- **Current implementation:** Manual buttons in `TrialControls`. `experimentId` on page load. `conditionId` on session context.
- **Options:** (a) Fixed condition per session via URL parameters. (b) Automated Latin-square counterbalanced rotation. (c) Retain manual switching for lab evaluations only.
- **Evidence required:** Formal study design specification.
- **Recommended next investigation:** None until experimental protocol is selected.
- **Human decision required:** **Yes.**

### K-8 Miner strategy: fix, replace, or bound

- **Decision:** Fix Rust PrefixSpan to standard semantics, bound execution, or replace mining with a maintained library.
- **Why it matters:** The current miner causes multi-second blocking on small corpora (F-02) and diverges from standard literature semantics.
- **Current implementation:** File `wasm-vectorizer/src/prefix_span.rs` uses a non-standard subsequence enumeration variant.
- **Options:** (a) Implement standard projected-database semantics with hard bounds. (b) Retain current semantics with hard bounds on length and pattern counts. (c) Move mining off the critical evaluation path via periodic cached execution.
- **Evidence required:** Benchmark evaluating corpus size versus latency and pattern count.
- **Recommended next investigation:** Instrument pattern counts per evaluation and re-measure latency.
- **Human decision required:** **Yes**, if updates change the definition of a Fast Gate match.

### K-9 Developer panel in participant builds

- **Decision:** Determine whether the developer panel ships in participant distributions, and whether it is researcher-locked.
- **Why it matters:** Production builds exclude the panel (`DebugPanel.tsx:44-50`, `App.tsx:61`), preventing live observation in packaged deployments.
- **Options:** (a) Keep panel development-only and rely on query parameter `?auiDiagnostics=1`. (b) Ship a password-protected or hidden panel for researchers. (c) Ship a minimal, unobtrusive status strip.
- **Evidence required:** Confirmation whether the study protocol requires live researcher observation.
- **Human decision required:** **Yes.**

### K-10 Provenance and claim boundaries

- **Decision:** Determine how synthetic label provenance and scripted trace boundaries appear in reported artifacts.
- **Why it matters:** ADR-013 states that substitute data is scripted, but documentation claims real participant traces (F-12). Provenance must be machine-readable.
- **Current implementation:** File `is_scripted_policy: true` exists offline. Trace sessions lack participant IDs. Traces and benchmarks omit provenance fields.
- **Options:** (a) Add a structured `provenance: 'scripted' | 'participant'` field to traces and benchmarks. (b) Document provenance in prose only. (c) Provide both structured fields and clear prose statements.
- **Evidence required:** None.
- **Recommended next investigation:** None.
- **Human decision required:** **Yes** (data format change).

---

## L. Recommended Next Milestones

The order below derives from what directly blocks the next research goal:

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

**M0 — Trustworthy record (smallest slice removing the core blocker):**
1. Unify trace records under a single canonical timeline (F-01).
2. Record policy decisions, including rejections and baseline runs (F-07).
3. Capture evaluated window IDs at evaluation time (F-18).
4. Add the episode ID attribute to every adaptation type (F-05).
5. Apply `actuation.defaultTtlMs` or record a decision that adaptations persist (F-03).
6. Add a regression test asserting: single timeline, zero orphaned windows, closed episodes, and DOM correlation.

This slice touches no model, policy semantics, task definitions, or UI layouts. It converts traces from populated to usable, enabling every measurement in brief §7.

**M1 — Survivable collection:** Implement durable session storage behind the integration port. Add session recovery on reload, an eviction counter instead of silent truncation, and model provenance capture (F-19). This milestone requires resolving decision K-1.

**M2 — Dataset path:** Resolve schema contracts (K-2). Add a cross-repository ingestion test with real traces. Stop re-deriving outcomes offline when traces contain them.

**M3 — Meaningful gate behaviour:** Fix and bound the miner. Add evaluation backpressure and timeouts. Fix macro symbol derivation, and re-measure sparse window loss under the shipped configuration.

**M4 — Legible interventions and honest claims:** Add missing developer panel fields (F-08). Replace fixture comparisons with real exported traces (F-12). Fix benchmark generator formulas and update narrative metrics (F-14).

**M5 — Tasks and protocol:** Implement state-based success predicates, explicit failure states, attempt tracking, and timeouts (F-15). Resolve task list selection (K-5).

**M6 — Participant packaging:** Implement consent capture, participant identifiers, deployment packaging, and cross-browser validation. This work remains deferred under ADR-014.

**Not recommended at this time:** UI redesigns, WASM vectoriser migrations, backend database implementations, model retraining, or changing intervention taxonomy.

---

## M. Final Question: what prevents participant deployment today?

### Must fix before participant deployment

1. **F-01 — Mixed clocks:** Without a single timeline, task completion times and causal replays cannot be derived.
2. **F-16 — Missing persistence and silent eviction:** Sessions longer than a few minutes discard early telemetry. Closing a tab loses all data.
3. **F-09 — Ingestion pipeline rejects runtime schema:** Data collection without a functional consumer is not viable.
4. **F-02 — Worker drops evaluations under load:** Busy sessions drop telemetry during dense interaction periods.
5. **F-07 — Missing policy decision records:** Trace analysis cannot determine whether interventions were rejected by confidence or context rules.
6. **Decisions K-1, K-2, and K-3 must be decided:** Storage, schema ownership, and timeline formats require decisions.

### Must fix before meaningful UX assessment

7. **F-15 — Incomplete task lifecycle:** The system lacks failure states, state-based success predicates, timeouts, and attempt models.
8. **F-03 — Uncontrolled adaptation lifetime:** Adaptations that never expire bias subsequent participant interactions.
9. **F-06 — Spurious macro symbols:** Fast Gate matches reflect event noise rather than intentional user patterns.
10. **F-05 and F-08 — Ambiguous intervention attribution:** Applied adaptations cannot be linked reliably to trace episodes.
11. **F-04 — Window definition divergence:** Live window boundaries differ from the Python training reference.

### Should fix for research reliability

12. **F-13 — Traces fail verification:** The verification harness passes only on hand-authored test fixtures.
13. **F-18 — Duplicate window ID attribution:** Consecutive predictions share duplicate window identifiers.
14. **F-21 — Condition switching aborts active work:** Switching conditions logs errors and leaves a stale diagnostics handle.
15. **F-11 — Ablation arm mismatches teacher policy:** The runtime ablation uses simpler rules than training label generation.
16. **F-20 — Confidence threshold mismatch:** The Slow Gate default differs from policy configuration.

### Should fix for maintainability and shareability

17. **F-14 — Fabricated benchmark numbers:** Narrative reports must derive from executed benchmarks.
18. **F-12 — Replace fixture-based condition comparisons:** Document comparisons using genuine exported traces.
19. **F-17 — Clean up unused configuration:** Wire active parameters and remove dead configuration keys.
20. **F-24 — Documented model topology mismatch:** Update architecture diagrams to match the dual-input deployed graph.
21. **F-25 — Integration guide compilation errors:** Update documentation snippets to match TypeScript definitions.
22. **F-27 — Documentation defects:** Fix broken links, symbol count mismatches, and stale test numbers.
23. **Historical implementation records:** Label obsolete implementation records clearly.
24. **F-19 — Model provenance in traces:** Capture model bundle metadata in traces.
25. **F-26 — Clarify network primitive claims:** Accurately document static model asset loading.
26. **Artifact bundle size:** The 28.82 MB client payload exceeds the 500 KB target and is tracked under ADR-008.
27. **Unenforced configuration keys:** Clean up keys that imply storage or filtering behavior that code does not implement.

### Items that can remain deferred

- Cross-browser and mobile validation (D4) can wait for lab evaluations on Chromium.
- Counterbalanced sequencing (D7) is needed only for multi-participant studies.
- Participant token authentication (D2) is needed only for remote collection.
- ONNX Runtime payload reduction (D6) is needed for distribution, not local measurement.
- Table pagination surfaces (D1) are not required by active tasks.
- Additional INT8 quantisation gains are unnecessary because current models fit within memory limits.

### Smallest next implementation slice

Milestone M0 constitutes the smallest viable slice:
1. Unify trace record timelines.
2. Record policy decision events.
3. Capture window IDs during evaluation.
4. Add episode ID attributes to adaptations.
5. Add a regression test verifying trace consistency.

This work requires approximately one schema update, four call site updates, one DOM attribute, and one test. It requires no model changes, policy changes, task changes, or UI redesigns.

This audit does not start that slice. Implementation awaits authorization following findings review.

---

## N. Audit Artefacts Produced

All artifacts were generated outside the repository without changing tracked files:

| Artifact | Purpose |
|---|---|
| `/tmp/aui-live-audit.mjs` and `/tmp/aui-live-audit.out` | CDP driver and raw output for live session testing. |
| `/tmp/aui-baseline-check.mjs` | Baseline condition isolation run showing zero DOM mutations. |
| `/tmp/aui-verify.mjs` and `/tmp/aui-verify2.mjs` | Verifier and replay scripts executed over real traces. |
| `/tmp/vitest.audit.config.ts` and `/tmp/aui-verify.test.ts` | Test configuration script documenting audit methods. |
| `/tmp/chrome-aui`, `/tmp/aui-vite.log`, `/tmp/chrome.log` | Browser profile directory and local server logs. |
| Headless Chrome 154 on `:9444` and `vite` on `:5177` | Transient local processes used during audit execution. |

### Limitations of this audit

- `NOT MEASURED`: WebGPU versus WASM confirmation, long-session memory growth, frame rates under load, and cross-browser behaviour.
- `PARTIALLY VERIFIED`: Assessment and planning documents were sampled rather than audited exhaustively. Local links in assessment files were verified directly.
- The live session used synthetic Chrome DevTools Protocol input. Zero human participants were involved in the audit.
- The scripted change event deviation on Region select is documented under finding F-15.
