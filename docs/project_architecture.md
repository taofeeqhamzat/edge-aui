# Edge-AUI Framework — System Architecture

This document describes the implemented system architecture of the Edge-AUI framework. For exhaustive component contracts and runtime measurements, refer to [`docs/architecture.md`](./architecture.md).

---

## 1. Architectural Overview

The framework operates as a client-side **Capture-Transform-React** pipeline with a dual-engine hybrid extraction model:

```
                     ┌──────────────────────── Main Thread ────────────────────────┐
                     │                                                             │
  DOM Events ──────► TelemetryObserver ──► BehaviourEvent ──┬─► RollingWindowBuffer ┤
                     │                                      │      (500/250 ms grid)│
                     │                                      │            │          │
                     │                                      │            ▼          │
                     │                                      │  computeWindowMicroTensor
                     │                                      │      18-D [X⊙M, M]    │
                     │                                      │            │          │
                     │                                      ├─► OutcomeDeriver ──► OutcomeEvent
                     │                                      │            │          │
                     │                                      └─► MacroInteractionStream
                     │                                                   │          │
                     │                         ┌─────────────────────────┘          │
                     │                         ▼                                    │
                     │                RuntimeWorkerClient (postMessage)             │
                     │                         │                                    │
                     │                         ▼                                    │
                     │                InterventionPolicy                            │
                     │                         │                                    │
                     │                         ▼                                    │
                     │                UIActuator.apply(command)                     │
                     │                         │                                    │
                     │                         ▼                                    │
                     │                    DOM Mutation                              │
                     │                                                              │
                     └──────────── ExperimentRecorder (Local Trace) ◄───────────────┘

                     ┌─────────────────────── Web Worker ──────────────────────────┐
                     │  SequenceBuilder (T = 8 MicroTensor windows)                │
                     │                         │                                   │
                     │                         ▼                                   │
                     │              AdaptiveInferenceEngine                        │
                     │     ├── Fast Gate: PrefixSpan over macro symbols (WASM)     │
                     │     └── Slow Gate: INT8 GRU via ONNX Runtime Web (WebGPU)   │
                     │                         │                                   │
                     │                         ▼                                   │
                     │                  InferenceResult                            │
                     └─────────────────────────────────────────────────────────────┘
```

### Clarification on Legacy Telemetry Buffering
Early conceptual iterations described a batching utility named `SlidingWindowBuffer`. In the implemented, tested codebase, that component is entirely superseded and deprecated by **`RollingWindowBuffer`** (`src/microtensor/window.ts`), which provides:
- Fixed monotonic temporal grid slots (`anchor(origin)`).
- Half-open time interval semantics `[start, end)`.
- Configurable delayed settlement (`settlementDelayMs = 250 ms`) resolving boundary-straddling events (ADR-005).
- Honest accounting of `lateEvents`, `skippedSparseWindows`, and `settledSparseWindows`.

---

## 2. Core Subsystems

### 2.1 Composition Root: `AdaptiveRuntime`
The framework is composed and orchestrated via `AdaptiveRuntime` (`src/runtime/adaptiveRuntime.ts`). It instantiates and manages the lifecycle of:
1. `TelemetryObserver`: Passively listens to DOM input events (pointer, keyboard, scroll).
2. `RollingWindowBuffer`: Slices event streams into 500 ms MicroTensor sliding windows.
3. `MacroInteractionStream`: Derives semantic interaction tokens (`OPEN_FILTERS`, `APPLY_FILTER`, etc.) for sequential pattern mining.
4. `OutcomeDeriver`: Evaluates downstream observable interaction resolutions (`CLICK`, `FORM_SUBMIT`, `BACKTRACK`, `RAPID_SCROLL`, `HOVER_DWELL`, `ABANDON`, `NO_OUTCOME`).
5. `RuntimeWorkerClient`: Communicates asynchronously with the background Web Worker.
6. `InterventionPolicy`: Rate-limits, debounces, and enforces confidence thresholds on candidate adaptations.
7. `UIActuator`: Applies non-destructive, reversible CSS and ARIA modifications to the DOM.
8. `ExperimentRecorder`: Captures structured in-memory session traces for offline replay.

### 2.2 Integration Boundary: `UiAdapter`
To isolate the framework from specific applications (such as the target testbed), host applications implement the `UiAdapter` interface (`src/integration/types.ts`):
- Supplies task catalog definitions (`UiTaskDefinition`).
- Resolves contextual UI states (`UIContext`).
- Emits task lifecycle events (`UiTaskLifecycleEvent`) without coupling the framework core to application logic.

### 2.3 Dual-Engine Hybrid Extraction Model
- **Deterministic Gate (Fast Brain):** Evaluates incoming sequences of semantic macro-interaction symbols using a WebAssembly-compiled PrefixSpan algorithm for sub-millisecond pattern recognition.
- **Probabilistic Gate (Slow Brain):** Operates inside a dedicated Web Worker running an INT8-quantized GRU (hidden dim = 64, sequence length T = 8 windows) via ONNX Runtime Web. It forecasts observable interaction outcomes from continuous motor dynamics.
- **Arbitration Strategy:** As specified in ADR-006, when both gates produce recommendations, the Fast Gate takes deterministic precedence unless confidence differentials or context eligibility dictate otherwise.

### 2.4 Two-Layer Configuration Model
As defined in [ADR-012](decisions/ADR-012-configurability-strategy.md):
- **Layer 1 (Canonical Pipeline Config):** Shared across Python model preparation and edge execution (`pipelineConfig.json` generated from `config.yaml`).
- **Layer 2 (Runtime Config):** Framework-owned typed configuration (`RuntimeConfig` in `src/config/runtimeConfig.ts`) governing telemetry, windowing, macro lookback, gate arbitration, policy cooldowns, actuation TTL, and experiment conditions.
