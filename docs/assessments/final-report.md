# Final Engineering Report: Edge-AUI Framework & Model Preparation

- **Date:** 2026-09-29
- **Scope:** Complete implementation and verification report across `edge-aui-framework` and `model-preparation` repositories.
- **Reference:** Brief §24 Final Agent Report Specification; informs Chapters 4 and 5 of the thesis.

---

## 1. Implemented System Capabilities

Across both repositories, the lightweight client-side edge-AI framework for behavioural pattern extraction and adaptive UI recommendations has been built, connected, and verified:

1. **Telemetry Observer & Geometry Normalisation:** Non-intrusive DOM event listener capturing pointer coordinates, scroll metrics, clicks, and keys; coordinates are projected into virtual $1920 \times 1080$ viewport coordinates.
2. **Deterministic Half-Open Windowing:** Segmented onto a fixed 500 ms window / 250 ms stride grid with delayed settlement (`settlement_delay_ms = 250`) and observable sparse-window accounting (`lateEvents`, `skippedSparseWindows`, `settledSparseWindows`).
3. **18-Dimensional MicroTensor Construction:** Nine kinematic metrics (mean/max velocity, acceleration, hesitation, trajectory length, dwell time proxy, trajectory entropy, scroll depth, scroll velocity) concatenated with a 9-bit modality mask vector $[X \odot M, M]$.
4. **Deterministic Fast Gate:** Rust/WASM compiled PrefixSpan miner extracting frequent macro-interaction sequences in $O(1)$ lookup time (< 5 ms).
5. **Probabilistic Slow Gate:** WebGPU-accelerated INT8 ONNX dual-graph inference combining the base recurrent GRU backbone ($R^{144} \to R^{64}$) with the target-specific `TargetInterventionHead` ($R^{64} \oplus R^6 \to R^5$ intervention logits).
6. **Context Encoding & Privacy Redaction:** Normalized $R^6$ UI context vector extraction with zero free-text/form PII leakage and zero network primitives reachable (ADR-010).
7. **Dual-Gate Arbitration:** Fast Gate short-circuiting Slow Gate on match; cascading to Slow Gate on miss; independent recording of `fastGateLatencyMs` and `slowGateLatencyMs` (ADR-003).
8. **Adaptive Policy & Non-Destructive UI Actuator:** Multi-stage policy (cooldowns, dismissal feedback, confidence threshold, context eligibility, consecutive-window persistence) driving non-destructive, accessible CSS adaptations (`highlight_primary_action`, `simplify_options`, `expand_tooltip`, `offer_assistance`, `no_op`) with 100% deterministic reversibility.
9. **Trace Attribution & Schema 1.2.0:** Full correlation ID linkage (`sessionId`, `experimentId`, `conditionId`, `windowId`, `interventionEpisodeId`), per-gate latency recording, and explicit `mappingSource` attribution (`learned_head`, `deterministic_mapping`, `fast_gate_pattern`).
10. **Automated Verification Harnesses:** Parity checking against Python reference, CLI trace verifier (`scripts/verify-trace.mjs`), and comparative condition differ (`scripts/compare-condition-traces.mjs`).

---

## 2. Architecture & Identified Divergences

The system operates as an end-to-end "Capture-Transform-React" pipeline spanning the main thread and a dedicated Web Worker:

```
[Main Thread]
DOM Events ──► Observer ──► RollingWindowBuffer ──► MicroTensor (18-D) ──┬─► OutcomeDeriver ──► OutcomeEvent
                                (500ms/250ms, Delayed Settlement)       ├─► MacroStream    ──► MacroInteraction
                                                                         └─► UIContext (R^6)
                                                                                  │ (transferable ArrayBuffer)
                                                                                  ▼
[Worker Thread]
SequenceBuilder (T=8) ──► AdaptiveInferenceEngine
                             ├── Fast Gate (PrefixSpan WASM) ──► Subsequence Match (< 5ms)
                             └── Slow Gate (WebGPU ONNX)     ──► GRU (R^64) + Head (R^6) ──► Logits (R^5)
                                                                                  │ (postMessage)
                                                                                  ▼
[Main Thread]
DOM Modifications ◄── UIActuator ◄── InterventionPolicy ◄── InferenceResult (8-field causal chain)
```

### Divergences from Initial Specification

| Architectural Area | Initial Brief Specification | Implemented Architecture | Rationalizing ADR |
|---|---|---|---|
| **MicroTensor Vectorisation** | Vectorisation compiled into Rust/WASM | Implemented in pure **TypeScript**; Rust retained only as parity test oracle | [ADR-001](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-001-rust-wasm-microtensor-vectorisation.md) |
| **Window Settlement** | Instantaneous boundary emission | **Delayed Settlement** (1 stride / 250 ms delay) to recover sparse boundary straddlers | [ADR-005](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-005-window-settlement-semantics.md) |
| **Target Intervention Model** | Single monolithic GRU with intervention head | **Dual-graph execution**: Base GRU ($R^{144} \to R^{64}$) + TargetInterventionHead ($R^{64} \oplus R^6 \to R^5$) | [ADR-006](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-006-target-intervention-head-interface.md) |
| **Packaging & Modules** | Standalone published `@edge-aui/*` npm packages | Single monorepo workspace with directory-level module boundaries | [ADR-011](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-011-ui-adapter-generalisation-boundary.md) |
| **Target Domain Telemetry** | Human participant data collected in target UI | Canonical scripted testbed telemetry with explicit non-generalizability boundary | [ADR-013](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-013-substitute-data-source.md) |
| **Storage & Remote Ingress** | Browser IndexedDB persistence and remote telemetry egress | Strict **in-memory only** buffers with zero remote network egress primitives | [ADR-009](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-009-participant-telemetry-storage-export.md) & [ADR-010](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-010-privacy-retention-model.md) |

---

## 3. Empirical Experiments Summary

1. **Controlled Baseline vs Adaptive Comparison ([`docs/experiments/condition-comparison.md`](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/experiments/condition-comparison.md)):**
   - Verified that Baseline condition enforces strictly zero DOM adaptations while maintaining 100% telemetry, windowing, and prediction coverage.
   - Verified that Adaptive condition executes dual-gate routing, triggers attributable interventions, and completes full terminal lifecycles (`applied` followed by `reverted`).
   - Confirmed structural and schema parity (Schema `1.2.0`) across both conditions.
2. **Vectoriser Benchmark ([`docs/benchmarks/vectoriser-benchmark.md`](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/benchmarks/vectoriser-benchmark.md)):**
   - Demonstrated exact numerical parity ($\Delta \le 10^{-4}$) between TypeScript and Rust/WASM vectorisers across all 18 dimensions.
   - Proved TypeScript vectorisation is $4.04\times$ faster than WASM ($8.26\ \mu\text{s}$ vs $33.41\ \mu\text{s}$), consuming only $0.003\%$ of the window stride budget.
3. **Sparse-Window Loss Quantification ([`docs/assessments/sparse-window-loss.md`](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/assessments/sparse-window-loss.md)):**
   - Measured active-slot sparse loss rate at $10.95\%$ across 6 canonical traces (14,765 events).
   - Demonstrated that Delayed Settlement ($250\text{ ms}$) rescues $66.2\%$ of sparse boundary slots.
4. **Runtime Pipeline & WebGPU Benchmark ([`docs/benchmarks/runtime-benchmark.md`](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/benchmarks/runtime-benchmark.md)):**
   - Confirmed smooth 30 FPS active pipeline throughput with 0 ms Total Blocking Time (TBT).
   - Validated resident memory within budget (14.22 MB final heap vs 20 MB budget).

---

## 4. Rust/WASM Vectorisation Decision (ADR-001)

- **Formal Status:** Accepted (Option A: Retain TypeScript Vectorisation).
- **Decision Owner:** Human Researcher (Decided 2026-09-26).
- **Rationale:** While native compilation is advantageous for compute-intensive workloads, vectorising 500 ms micro-interaction windows involves small array allocations. Profiling revealed that `serde_wasm_bindgen` serialization across the linear memory boundary incurred a $\sim 25\ \mu\text{s}$ marshalling penalty. Pure TypeScript executes in $8.26\ \mu\text{s}$, producing zero long tasks.
- **WASM Role:** Rust/WASM remains active and essential in the framework for PrefixSpan frequent pattern mining (`src/gates/fast/prefixSpanMiner.ts`), where projected sequential growth over macro symbols benefits from linear memory allocation and CPU cache locality ([ADR-002](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/decisions/ADR-002-rust-wasm-prefixspan-boundary.md)).

---

## 5. Automated Verification & Test Registry

*Test execution executed on 2026-09-29T12:19Z under darwin-arm64 (macOS):*

### Frontend & Runtime Suite (`edge-aui-framework`)
- **Command:** `npx vitest run`
- **Total Test Files:** **47 passed (47/47)**
- **Total Tests:** **336 passed (336/336)**, 0 failed, 0 skipped
- **Duration:** 19.70 seconds
- **Typecheck (`npm run typecheck`):** Clean (0 errors)
- **Parity Check (`npm run parity:check`):** Match verified against canonical Python reference

### Machine Learning & Data Pipeline Suite (`model-preparation`)
- **Command:** `./.venv/bin/pytest tests`
- **Total Test Files:** 15 test files
- **Total Tests:** **115 passed (115/115)**, 0 failed, 38 warnings
- **Duration:** 13.07 seconds

### Combined Test Count
**451 automated tests passed out of 451 total (100% pass rate).**

---

## 6. Empirical Performance Measurements

All metrics reported below trace directly to high-resolution browser benchmarks ([`docs/benchmarks/runtime-benchmark.md`](file:///Users/user/Workspace/MivaCS/FYP/edge-aui-framework/docs/benchmarks/runtime-benchmark.md)) and test harnesses. No unmeasured quantities are stated as compliant.

| Constraint / Metric | Architectural Budget | Measured Empirical Result | Status | Measurement Method & Environment |
|---|---|---|---|---|
| **Resident Memory** | $\le 20\text{ MB}$ | **14.22 MB** final JS heap; **18.51 MB** total allocated | **Met** | `Measured` via `performance.memory` over 62 windows in Headless Chrome 153 on Apple M1. |
| **Total Blocking Time (TBT)** | $\le 50\text{ ms}$ | **0 ms** Total Blocking Time; 0 main-thread long tasks | **Met** | `Measured` via `PerformanceObserver` during active interactive workload. |
| **Fast Gate Latency** | $< 10\text{ ms}$ | **< 5 ms** (typically $0.1$–$0.5\text{ ms}$) | **Met** | `Measured` via `performance.now()` surrounding WASM PrefixSpan match. |
| **Slow Gate Inference Latency** | $< 40\text{ ms}$ | **6.03 ms** (p50), **18.17 ms** (p95), **8.90 ms** (mean) | **Met** | `Measured` via WebGPU ONNX Runtime execution timing. |
| **Client Storage & Bundle Payload** | $\le 500\text{ KB}$ | **27.74 MB** total client assets (WASM: **26.31 MB**, Model: **331.6 KB**, JS/CSS: **1.10 MB**) | **Not met** | `Measured` filesystem stat. Exceeded due to unbundled `ort-wasm-simd-threaded.jsep.wasm`. Deferred under ADR-008/011. |
| **V8 GC Allocation Rate** | Unspecified | `Not measured` | `Not measured` | Requires native `--trace-gc` flags not accessible in browser runtime. |
| **Zero-Copy SharedArrayBuffer Pinning** | Unspecified | `Not measured` | `Not measured` | Framework utilizes structured cloning / transferable ArrayBuffers; SAB requires COOP isolation headers. |

---

## 7. Architectural Decisions (ADR Register)

| ADR | Title | Status | Decision Date | Summary |
|---|---|---|---|---|
| **ADR-001** | Rust/WASM vs TS Vectorisation | `Accepted` | 2026-09-26 | Option A: Retain TypeScript vectoriser ($4\times$ faster); Rust retained as parity oracle. |
| **ADR-002** | Rust/WASM PrefixSpan Boundary | `Accepted` | 2026-09-24 | Option A: WASM PrefixSpan dedicated to Fast Gate pattern mining. |
| **ADR-003** | Worker / Main Thread Boundary | `Accepted` | 2026-09-24 | Option A: Web Worker for sequence buffering, pattern mining, and tensor inference. |
| **ADR-004** | MicroTensor Schema & Parity | `Accepted` | 2026-09-24 | 18-D schema $[X \odot M, M]$ with virtual viewport normalisation. |
| **ADR-005** | Window Settlement Semantics | `Accepted` | 2026-09-25 | Option B: Delayed Settlement (250 ms delay) recovering 66.2% of sparse straddlers. |
| **ADR-006** | TargetInterventionHead Interface | `Accepted` | 2026-09-29 | Option A: Separate INT8 versioned graph concatenating GRU state $h_T$ and $R^6$ context. |
| **ADR-007** | Inference Runtime Selection | `Proposed (Deferred)` | 2026-09-24 | Retain ONNX Runtime Web WebGPU; evaluate hand-written GRU if payload remains critical. |
| **ADR-008** | Combined Edge Payload Target | `Accepted (Unmet)` | 2026-09-24 | Report 27.7 MB payload honestly as NOT MET; defer reduction until study packaging. |
| **ADR-009** | Telemetry Storage & Export | `Proposed (Deferred)` | 2026-09-24 | Retain in-memory buffering and manual export; defer IndexedDB persistence. |
| **ADR-010** | Privacy & Retention Model | `Accepted` | 2026-09-29 | Option A: Zero form field leakage and zero network egress enforced by tests. |
| **ADR-011** | UI Adapter Generalisation Boundary | `Accepted` | 2026-09-26 | Option B: Named Adapter Interface without premature npm packaging. |
| **ADR-012** | Configurability Strategy | `Accepted` | 2026-09-26 | Option B: Two-layer configuration (`config.yaml` synced + runtime overrides). |
| **ADR-013** | Substitute Data Source | `Accepted` | 2026-09-24 | Scripted testbed traces accepted for pipeline validation; non-generalizability boundary set. |
| **ADR-014** | Deferred Target-UI Features | `Accepted` | 2026-09-24 | Explicit index of all deferred items (D1 through D12). |

---

## 8. Consolidated Deferment Register (ADR-014 D1–D12)

Every deferred item across all ADRs is indexed below with its required six-field specification:

1. **D1: Participant Deployment Hardening**
   - *Decision:* Privacy controls, consent flow, retention UI, multi-participant pooling.
   - *Deferred until:* A participant study is scheduled.
   - *Reason:* Brief §20: "It is acceptable to defer participant deployment hardening."
   - *Current workaround:* Scripted testbed traces (ADR-013).
   - *Risk:* Medium — deferred work becomes critical path at study time.
   - *Evidence required to revisit:* A scheduled study or ethics submission.
2. **D2: `@edge-aui/*` Package Split and Publication**
   - *Decision:* Package modularization and external npm registry publication.
   - *Deferred until:* A second UI is adapted against the adapter interface.
   - *Reason:* Brief §15 — do not package for naming purposes.
   - *Current workaround:* Directory-level module boundaries and barrel exports.
   - *Risk:* Low.
   - *Evidence required to revisit:* ADR-011 §9 conditions.
3. **D3: Edge Payload Reduction**
   - *Decision:* Custom tree-shaken ORT WASM compilation or CDN decoupling.
   - *Deferred until:* The intervention-head experiment works end to end.
   - *Reason:* Brief §20 — vertical slice over broad generalisation; ADR-008.
   - *Current workaround:* Payload reported as NOT MET with the measured figure (27.7 MB).
   - *Risk:* High for the deployment goal.
   - *Evidence required to revisit:* ADR-008 §9 conditions.
4. **D4: Browser Coverage Beyond Chromium**
   - *Decision:* Automated cross-browser test matrix and validation (Firefox, Safari, mobile).
   - *Deferred until:* After the runtime contract is stable.
   - *Reason:* All measurements to date come from headless Chrome 153 on macOS; Firefox, Safari and GPU-less fallback paths are unexercised.
   - *Current workaround:* Provider fallback is implemented but untested on those browsers.
   - *Risk:* Medium — the "browser-side inference" claim is currently Chromium-only.
   - *Evidence required to revisit:* A cross-browser smoke run of the production build.
5. **D5: `dwellTimeMs` Construct Validity**
   - *Decision:* Independent physical hover tracking replacing event-count proxy.
   - *Deferred until:* Independently measured hover duration exists.
   - *Reason:* Both implementations use a `count × 40 ms` proxy; parity holds, meaning does not (ADR-004).
   - *Current workaround:* Documented as a proxy in implementation records.
   - *Risk:* Medium for research validity.
   - *Evidence required to revisit:* ADR-004 §9 conditions.
6. **D6: Legacy Module Removal**
   - *Decision:* Deletion of dead prototype modules (`src/main.ts`, `src/core/pipeline.ts`, `src/counter.ts`, `SlidingWindowBuffer`).
   - *Deferred until:* A task already touches the surrounding area.
   - *Reason:* Removal is safe but was deferred to avoid churn.
   - *Current workaround:* Documented as unused.
   - *Risk:* Low.
   - *Evidence required to revisit:* Any task that edits those files or their importers.
7. **D7: Multi-Participant Experiment Design**
   - *Decision:* Automated Latin-square condition rotation and participant balancing.
   - *Deferred until:* A participant study is designed.
   - *Reason:* Only a single-participant scripted trial has been exercised; the condition switch is manual.
   - *Current workaround:* Manual condition selection, recorded in the trace.
   - *Risk:* Medium for the experimental-validity chapter.
   - *Evidence required to revisit:* Study protocol drafting.
8. **D8: Online Support Tuning for PrefixSpan Miner**
   - *Decision:* Adaptive min_support scaling as the live macro interaction corpus grows.
   - *Deferred until:* Gate routing data exists (ADR-002 §8).
   - *Reason:* Support is currently a fixed configured value; no evidence exists about what a session-length corpus requires.
   - *Current workaround:* `support` is a configuration field.
   - *Risk:* Low — mis-set support changes gate hit rate, not correctness.
   - *Evidence required to revisit:* Gate hit/miss ratios and false-match rate over complete tasks.
9. **D9: Retroactive Window Revision for Late Events**
   - *Decision:* Whether late events are re-admitted to an already-emitted window (retroactive revision).
   - *Deferred until:* Delayed settlement is measured as insufficient (ADR-005 §8).
   - *Reason:* Retroactive revision breaks deterministic window boundaries and append-only traces.
   - *Current workaround:* `lateEvents` is counted and events outside the settlement window are dropped.
   - *Risk:* Low (conservative choice).
   - *Evidence required to revisit:* A measured late-event tail that extends beyond the chosen settlement delay.
10. **D10: Participant Telemetry Persistence & Retention Controls**
    - *Decision:* Implementing local storage persistence (IndexedDB) and user deletion controls.
    - *Deferred until:* A participant study is scheduled (ADR-009 / ADR-010).
    - *Reason:* Immediate milestone does not involve participants; storage sizing depends on trace size.
    - *Current workaround:* In-memory buffers plus manual JSON export.
    - *Risk:* Low now; medium at study time.
    - *Evidence required to revisit:* Measured trace size per completed task and per session.
11. **D11: WebGPU Provider Claim Re-Verification**
    - *Decision:* Empirical re-verification of the WebGPU acceleration claim.
    - *Deferred until:* The inference-runtime decision (ADR-007) is made.
    - *Reason:* Provider reporting is honest, but the WebGPU claim must be re-earned upon runtime replacement.
    - *Current workaround:* Provider reporting records actual provider (`webgpu` / `wasm`).
    - *Risk:* High for architectural claim integrity.
    - *Evidence required to revisit:* Measured runtime provider output on candidate runtime.
12. **D12: Hot-Reload / Configuration UI**
    - *Decision:* Whether the framework should support runtime configuration hot-reload or a config UI.
    - *Deferred until:* The configurability refactor lands and its ergonomics are observed in use (ADR-012 §8).
    - *Reason:* Hot-reload is a convenience that interacts badly with reproducibility.
    - *Current workaround:* Restart with a different configuration; configuration is recorded in the trace.
    - *Risk:* Low.
    - *Evidence required to revisit:* Reported friction during ablation runs.

---

## 9. Remaining Blockers & Gap Categorization

- **Blocking (for wild, unassisted participant deployment):**
  - D1 (Participant consent, instructions, and error-recovery UI)
  - D3 (Asset payload reduction from 27.7 MB to < 500 KB, or CDN separation)
  - D7 (Counterbalanced condition rotation to eliminate order effects)
- **Important (for cross-platform generalizability):**
  - D4 (Cross-browser WebGPU testing across Firefox, Safari, and mobile Android/iOS)
- **Deferred (architectural maintenance):**
  - D2 (`@edge-aui/*` package extraction)
  - D6 (Cleanup of legacy dead prototype files)
  - D10 (Local IndexedDB persistence)
- **Research-Only (epistemological validity):**
  - D5 (`dwellTimeMs` proxy validation against physical gaze/pointer dwell)
  - D13 (Generalisation of TargetInterventionHead to non-scripted human interaction)

---

## 10. Recommended Next Action

The single **smallest** next implementation step:

> **Host `ort-wasm-simd-threaded.jsep.wasm` on a static CDN (or external asset server) and configure ONNX Runtime Web to fetch it on demand.**

This single change removes the 26.3 MB WASM binary from the application bundle, bringing the initial client load down to $\sim 1.4\text{ MB}$ (and paving the way to resolve D3 and achieve the $< 500\text{ KB}$ standing architectural target without touching any core pipeline or model inference code).
