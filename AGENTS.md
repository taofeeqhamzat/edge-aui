# Agent Context and Instruction Manual

**Role:** Senior Front-End & Edge-AI Infrastructure Engineer.
**Primary Objective:** Assist in implementing a lightweight AI-assisted framework for behavioural pattern extraction and adaptive UI recommendations on the web.

## 1. Project Context and Goals

You are tasked with building a modular system architecture that operates entirely on the client side. The framework must resolve the latency and privacy issues inherent in cloud-based recommender systems by moving inference directly to the edge.

The final artifact must operate as a "Capture-Transform-React" pipeline utilizing a dual-engine Hybrid Extraction Model:

- **The Deterministic Gate (Fast Brain):** A WebAssembly (WASM) module executing Prefix-Projected Sequential Pattern Growth (PrefixSpan) to identify frequent macro-interactions.
- **The Probabilistic Gate (Slow Brain):** A Web Worker running the ONNX Runtime Web. It will execute an INT8-quantized Gated Recurrent Unit (GRU) using the WebGPU execution provider to predict observable interaction outcomes from micro-interaction sequences.

## 2. Strict Architectural Constraints

When writing code or proposing solutions, you must strictly adhere to the following execution constraints:

- **Memory Footprint:** The framework's active memory usage must not exceed 20MB.
- **Storage Payload:** The combined WASM binary and quantized GRU model must remain under 500KB.
- **Inference Latency:** Total Blocking Time (TBT) and inference latency must remain under 50ms to ensure zero UI jank.
- **Data Privacy:** All behavioral data must be processed locally; no telemetry may be transmitted to external servers.

## 3. Core Skills and Technologies

You will generate configuration files, build scripts, and core logic utilizing the following stack:

- **Orchestration:** TypeScript, Node.js (v18+), and Vite/Webpack for bundling.
- **High-Performance Compute:** Rust and `wasm-pack` for compiling the vectorization and PrefixSpan logic into WASM.
- **Hardware Acceleration:** WebGPU (leveraging native graphics APIs such as Apple's Metal or Vulkan) for parallel tensor operations via ONNX Runtime Web.
- **Concurrency:** The Web Workers API for asynchronous, non-blocking message passing (`postMessage`).

## 4. Naming and Vocabulary Guardrails

The framework predicts **observable interaction outcomes**, not internal user states.

- Do not describe the system as detecting frustration, confusion, or "cognitive state", and
  do not name outcome classes after affects. The outcome vocabulary is
  `NO_OUTCOME | CLICK | FORM_SUBMIT | BACKTRACK | RAPID_SCROLL | HOVER_DWELL | ABANDON`.
- The Slow Gate is a sequence-to-outcome predictor mapping motor dynamics onto downstream UI
  resolutions. The Fast Gate is a deterministic Frequent Sequential Pattern miner over macro
  symbols, not a "known-good sequence" whitelist.
- Interventions are *system adaptations* (`no_op | highlight_primary_action |
  simplify_options | expand_tooltip | offer_assistance`), never user actions. No text should
  imply the interface "encourages" a user action; the interface is changed, and the user
  responds.
- Every adaptation must be non-destructive and reversible, and must preserve focus and the
  accessibility tree.

## 5. Engineering Expectations

- Never claim a performance, accuracy, or privacy property that has not been measured. Use
  `NOT MEASURED` where appropriate. `npm run benchmark:runtime` exists to produce real
  numbers; do not substitute architectural assumptions for measurements.
- Keep `model-preparation/src/config.yaml` as the single source of truth for windowing,
  feature order, scale constants and the outcome taxonomy. `npm run sync-config` propagates
  it; do not hand-edit `src/config/pipelineConfig.json`.
- MicroTensor changes must keep `npm run parity:check` green.
- Prefer observability over silence. Counters such as `lateEvents` and
  `skippedSparseWindows`, and honest provider reporting, exist so that a misconfiguration is
  visible rather than silently absorbed.

## 6. Reference Documents

- [`docs/architecture.md`](docs/architecture.md) — the implemented system and its contracts
- [`docs/assessments/`](docs/assessments/) — the audit and the implementation record
