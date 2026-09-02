# Agent Context and Instruction Manual

**Role:** Senior Front-End & Edge-AI Infrastructure Engineer.
**Primary Objective:** Assist in implementing a lightweight AI-assisted framework for behavioural pattern extraction and adaptive UI recommendations on the web[cite: 1].

## 1. Project Context and Goals

You are tasked with building a modular system architecture that operates entirely on the client side[cite: 1]. The framework must resolve the latency and privacy issues inherent in cloud-based recommender systems by moving inference directly to the edge[cite: 2].

The final artifact must operate as a "Capture-Transform-React" pipeline utilizing a dual-engine Hybrid Extraction Model[cite: 15]:

- **The Deterministic Gate (Fast Brain):** A WebAssembly (WASM) module executing Prefix-Projected Sequential Pattern Growth (PrefixSpan) to identify frequent macro-interactions[cite: 15].
- **The Probabilistic Gate (Slow Brain):** A Web Worker running the ONNX Runtime Web. It will execute an INT8-quantized Gated Recurrent Unit (GRU) using the WebGPU execution provider to infer latent cognitive states from erratic micro-interactions[cite: 15].

## 2. Strict Architectural Constraints

When writing code or proposing solutions, you must strictly adhere to the following execution constraints:

- **Memory Footprint:** The framework's active memory usage must not exceed 20MB[cite: 1].
- **Storage Payload:** The combined WASM binary and quantized GRU model must remain under 500KB[cite: 1].
- **Inference Latency:** Total Blocking Time (TBT) and inference latency must remain under 50ms to ensure zero UI jank[cite: 15].
- **Data Privacy:** All behavioral data must be processed locally; no telemetry may be transmitted to external servers[cite: 1].

## 3. Core Skills and Technologies

You will generate configuration files, build scripts, and core logic utilizing the following stack[cite: 7]:

- **Orchestration:** TypeScript, Node.js (v18+), and Vite/Webpack for bundling[cite: 7].
- **High-Performance Compute:** Rust and `wasm-pack` for compiling the vectorization and PrefixSpan logic into WASM[cite: 7].
- **Hardware Acceleration:** WebGPU (leveraging native graphics APIs such as Apple's Metal or Vulkan) for parallel tensor operations via ONNX Runtime Web[cite: 1, 9].
- **Concurrency:** The Web Workers API for asynchronous, non-blocking message passing (`postMessage`)[cite: 1, 7].

## 4. Reference Documents

- [1] _docs: [Edge-Based Adaptive User Interface Framework](../docs/)_.
