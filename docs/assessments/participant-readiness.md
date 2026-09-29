# Participant-Readiness Gap Report

- **Date:** 2026-09-29
- **Task:** Phase I Task 8.1 ([`docs/plan/1/tasks/8.1.md`](../plan/1/tasks/8.1.md))
- **Decision Informs:** [ADR-008: Telemetry Retention Model](../decisions/ADR-008-telemetry-retention-model.md), [ADR-011: Telemetry Ring Buffer Sizing](../decisions/ADR-011-telemetry-ring-buffer-sizing.md), [ADR-014: Participant Pipeline Scope Boundaries](../decisions/ADR-014-participant-pipeline-scope-boundaries.md)
- **Status:** Complete — Evaluated without Overclaiming

---

## 1. Executive Verdict: Deployable Participant Pipeline Claim

> **CAN THE PARTICIPANT-FACING DEPLOYMENT CLAIM BE MADE TODAY?**
>
> **NO.**
>
> In accordance with Brief §20 and ADR-014, it is **not acceptable** to claim that the deployable participant pipeline is ready for wild, unmonitored participant deployment. While the core client-side edge-AI framework ("Capture-Transform-React" pipeline, dual-gate arbitration, TargetInterventionHead execution, and Schema 1.2.0 trace attribution) is fully functional and empirically verified, all participant-packaging and remote collection boundaries have been explicitly **Deferred** under ADR-014 (D1–D7).
> 
> The framework is fully operational as a **laboratory and developer testbed**, but cannot be deployed as an unassisted, self-contained multi-participant user study without closing the deferred items.

---

## 2. Standing Performance Targets Evaluation

Evaluated against the three hard architectural constraints using empirical measurements from Phase C ([`docs/benchmarks/runtime-benchmark.md`](../benchmarks/runtime-benchmark.md)) and Phase F/G:

| Standing Target | Architectural Threshold | Measured Reality | Status | Evidence / Reference |
|---|---|---|---|---|
| **Resident Memory** | $\le 20\text{ MB}$ | **14.22 MB** final JS heap (peak allocated: **18.51 MB**) | **Met** | `Measured` via `scripts/benchmark-runtime.mjs` on Apple M1, Chromium Headless. |
| **Inference Latency & TBT** | $\le 50\text{ ms}$ Total Blocking Time | **0 ms TBT**; Fast Gate **< 5 ms**; Slow Gate ONNX p50: **6.03 ms**, p95: **18.17 ms** | **Met** | `Measured` via `PerformanceObserver` and runtime high-res timing (`docs/assessments/gate-routing-evidence.md`). |
| **Storage & Bundle Payload** | $\le 500\text{ KB}$ | **27.74 MB** total client assets (WASM: **26.31 MB**, Models: **331.6 KB**, JS/CSS: **1.10 MB**) | **Not met** | `Measured` filesystem stat. Exceeded due to unbundled ONNX Runtime Web JSEP WASM binary (`ort-wasm-simd-threaded.jsep.wasm`). Documented in ADR-008 & ADR-011. |

---

## 3. Brief §23 Readiness Condition Matrix

Every area from the Brief §23 Readiness Matrix is audited below with honest, evidence-based labels (`Measured`, `Verified by automated test`, `Inferred`, `Not measured`, `Deferred`, `Blocked`):

| # | Brief §23 Area | Verdict | Label | Evidence & Implementation Reality | Deferring ADR / Closing Condition |
|---|---|---|---|---|---|
| 1 | **Target UI** | `Ready with conditions` | `Verified by automated test` | Tasks T1–T3 fully executable in synthetic & adapter tests. Reset filters, KPI toggle, and export actions present. Extended pagination and column sorting surfaces omitted. | Deferred under **ADR-014 (D1)**. Requires extending `ResultsTable.tsx` DOM surface. |
| 2 | **Task Workflows** | `Ready` | `Verified by automated test` | `TaskManager` manages T1–T3 states. Emits `task_start`, `task_step`, `task_complete`, `task_abandon` into trace. Tested in `tests/ui_adapter_second_implementation.test.ts` & `tests/trace_attribution_verifier.test.ts`. | Closed. |
| 3 | **Telemetry** | `Ready` | `Measured` | `InteractionObserver` captures pointer, click, scroll, key events with geometry. 404+ events processed in benchmark at 30.6 events/sec. Redaction verified in `tests/context_redaction.test.ts`. | Closed. |
| 4 | **MicroTensor** | `Ready` | `Verified by automated test` | 18-D feature order, virtual viewport normalisation (1920x1080), modality masking, and numerical parity with Python pipeline verified green in `tests/parity.test.ts`. | Closed. |
| 5 | **Windowing** | `Ready with conditions` | `Measured` | Fixed-grid 500ms window / 250ms stride with monotonic scheduling. Sparse window loss measured at 10.95% in `docs/assessments/sparse-window-loss.md`. Evaluated in ADR-005. | Retained drop-once semantics per **ADR-005**. Closing requires delayed settlement buffer. |
| 6 | **Macro Events** | `Ready` | `Verified by automated test` | 30-symbol closed taxonomy. Time-slotted macro sequence extraction verified in `tests/macro_sequence.test.ts` and `tests/macro_symbols.test.ts`. | Closed. |
| 7 | **PrefixSpan Interface** | `Ready` | `Verified by automated test` | Rust PrefixSpan WASM module compiles and executes frequent pattern mining. `PrefixSpanFastGate` matches sequence in < 5ms. Verified in `tests/prefixspan_fast_gate.test.ts`. | Closed. |
| 8 | **Outcome Events** | `Ready` | `Verified by automated test` | Self-supervised `OutcomeDeriver` derives `CLICK`, `FORM_SUBMIT`, `BACKTRACK`, `RAPID_SCROLL`, `HOVER_DWELL`, `ABANDON`, `NO_OUTCOME` over 1000ms lookahead. Tested in `tests/outcome_derivation.test.ts`. | Closed. |
| 9 | **UI Context** | `Ready` | `Verified by automated test` | ContextProvider captures route, component role, feasibility flags. Encodes into normalized $R^6$ tensor. Redaction & zero-PII verified in `tests/context_redaction.test.ts`. | Closed. |
| 10 | **Intervention Taxonomy** | `Ready` | `Verified by automated test` | Closed 5-adaptation vocabulary (`no_op`, `highlight_primary_action`, `simplify_options`, `expand_tooltip`, `offer_assistance`). Validated in `tests/intervention_types.test.ts`. | Closed. |
| 11 | **Policy Layer** | `Ready` | `Verified by automated test` | `InterventionPolicy` enforces confidence threshold (0.75), consecutive window persistence (2 windows), context eligibility, cooldowns (5s), and dismissal feedback (15s). Tested in `tests/intervention_policy.test.ts`. | Closed. |
| 12 | **Actuator** | `Ready` | `Verified by automated test` | `UIActuator` applies non-destructive adaptations via CSS classes, preserves focus and ARIA accessibility, supports Esc dismissal, and deterministic cleanup. Tested in `tests/actuator.test.ts`. | Closed. |
| 13 | **Worker Boundary** | `Ready` | `Verified by automated test` | Asynchronous message passing across thread boundaries via Web Worker with structured cloning / transferable ArrayBuffers. Tested in `tests/worker_runtime.test.ts`. | Closed. |
| 14 | **Model Integration** | `Ready` | `Verified by automated test` | Dual-model execution (`OnnxSlowGate`): loads base GRU and `TargetInterventionHead` INT8 ONNX graphs on WebGPU/WASM. Evaluates $R^{144}$ microtensors + $R^6$ UIContext. Tested in `tests/intervention_head_contract.test.ts`. | Closed. |
| 15 | **Experiment Trace** | `Ready` | `Verified by automated test` | Schema `1.2.0` with full correlation IDs (`sessionId`, `experimentId`, `conditionId`, `windowId`, `interventionEpisodeId`), per-gate latencies, and `mappingSource` attribution. Tested in `tests/trace_attribution_verifier.test.ts`. | Closed. |
| 16 | **Baseline Condition** | `Ready` | `Verified by automated test` | Baseline condition maintains telemetry capture and windowing while strictly enforcing zero DOM mutations. Comparative distinctiveness verified in `tests/condition_trace_comparison.test.ts`. | Closed. |
| 17 | **Testing** | `Ready` | `Verified by automated test` | 45 test files, 324 tests passing with zero failures. Vitest suite covers contracts, parity, arbitration, actuation, redaction, and comparison. | Closed. |
| 18 | **Performance & Latency** | `Partially ready` | `Measured` | Latency (< 50ms) and Memory (< 20MB) targets met. Bundle payload (27.7MB) exceeds 500KB target due to ORT Web JSEP WASM runtime. | Payload reduction deferred under **ADR-008 & ADR-011**. Closing requires CDN dynamic loading or custom tree-shaken ORT build. |
| 19 | **Privacy & Egress** | `Ready` | `Verified by automated test` | Zero network egress verified by mock network trap in `tests/context_redaction.test.ts`. Zero PII / field values stored in traces or logs (ADR-010). Strictly local edge inference. | Closed. |

---

## 4. Participant Deployment Gap Inventory (ADR-014 Deferment Mapping)

To advance from the current laboratory research engine to a deployable, multi-participant empirical study, the following deferred items must be resolved:

1. **D1: Advanced UI Surfaces:**
   - *Status:* Deferred.
   - *Gap:* Extended table pagination and multi-column sorting are not implemented in the testbed DOM.
   - *Resolution Criteria:* Implement pagination and column sorting controls in `ResultsTable.tsx` and map them to macro symbols.
2. **D2: Participant Token Authentication & Session Orchestration:**
   - *Status:* Deferred.
   - *Gap:* Currently session IDs are generated locally or configured in code; no participant token login or remote study coordinator interface exists.
   - *Resolution Criteria:* Build an unauthenticated or token-based participant entry gate.
3. **D3: Remote Trace Ingress Endpoint:**
   - *Status:* Deferred.
   - *Gap:* Trace export is strictly local JSON download or filesystem persistence. Zero egress is guaranteed by ADR-010, which precludes automatic remote trace upload.
   - *Resolution Criteria:* Implement an opt-in, encrypted end-of-session telemetry sync service or participant submission portal.
4. **D4: Cross-Browser & Mobile Hardware Validation:**
   - *Status:* Deferred.
   - *Gap:* WebGPU inference has been tested primarily on Apple Metal (Chromium on macOS). Firefox and Safari WebGPU implementations remain non-standard or behind flags.
   - *Resolution Criteria:* Run automated cross-browser test matrix (Safari, Firefox, Mobile Chrome) with WASM CPU fallback validation.
5. **D5: Participant Consent & Ethics UI:**
   - *Status:* Deferred.
   - *Gap:* No participant information sheet, informed consent modal, or withdrawal mechanism is rendered prior to session start.
   - *Resolution Criteria:* Add pre-task consent gate in UI shell.
6. **D6: Automated Client Asset Bundling (< 500 KB):**
   - *Status:* Deferred.
   - *Gap:* Combined payload is 27.7 MB.
   - *Resolution Criteria:* Host the 26.3 MB `ort-wasm-simd-threaded.jsep.wasm` on a global CDN and load lazily, bringing initial bundle under 500 KB.
7. **D7: Counterbalanced Latin-Square Trial Sequencer:**
   - *Status:* Deferred.
   - *Gap:* Condition switching is manual or paired; no automated balanced Latin-Square rotation ($A \to B$ vs $B \to A$) is implemented.
   - *Resolution Criteria:* Implement participant group assignment and condition rotation in `TaskManager`.
