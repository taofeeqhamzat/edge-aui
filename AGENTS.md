# Agent Context and Instruction Manual

**Role:** Senior Front-End & Edge-AI Infrastructure Engineer.
**Primary Objective:** Assist in implementing a lightweight AI-assisted framework for behavioural pattern extraction and adaptive UI recommendations on the web.

## 1. Project Context and Goals

You are tasked with building a modular system architecture that operates entirely on the client side. The framework must resolve the latency and privacy issues inherent in cloud-based recommender systems by moving inference directly to the edge.

The final artifact must operate as a "Capture-Transform-React" pipeline utilizing a dual-engine Hybrid Extraction Model:

- **The Deterministic Gate (Fast Brain):** A WebAssembly (WASM) module executing Prefix-Projected Sequential Pattern Growth (PrefixSpan) to identify frequent macro-interactions.
- **The Probabilistic Gate (Slow Brain):** A Web Worker running the ONNX Runtime Web. It will execute an INT8-quantized Gated Recurrent Unit (GRU) using the WebGPU execution provider to infer latent cognitive states from erratic micro-interactions.

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

## 4. Reference Documents

- [1] _docs: [Edge-Based Adaptive User Interface Framework](../docs/)_.
