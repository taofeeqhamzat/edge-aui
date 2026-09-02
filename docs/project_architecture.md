# Target Artifact Description: Edge-AUI Framework

## 1. Overview
The proposed framework is a client-side-only, multi-threaded library designed to seamlessly integrate into modern web applications[cite: 1]. It captures high-frequency implicit feedback (e.g., cursor velocity, hover duration) without requiring active user input, vectorizes these signals, and executes them through quantized models to predict user intent[cite: 1, 2].

## 2. Phase 1: Core Infrastructure Layout
The repository must be scaffolded to support separate execution threads to maintain 60 frames-per-second (FPS) rendering[cite: 7]. 

### A. The Main Thread (UI & Capture Layer)
*   **Responsibilities:** DOM instrumentation, event listener attachment, and UI actuation[cite: 15].
*   **Mechanism:** Implements a `SlidingWindowBuffer` to batch high-frequency micro-interactions every 500ms, effectively throttling main-thread workload.

### B. The WASM Worker (Data Vectorization & Pattern Mining)
*   **Responsibilities:** Normalizing raw JSON events into dense numerical tensors and executing the deterministic PrefixSpan algorithm[cite: 7, 18].
*   **Mechanism:** Written in Rust and compiled via `wasm-pack` to achieve near-native execution speeds within the browser sandbox[cite: 7, 9].

### C. The Inference Worker (ONNX Runtime)
*   **Responsibilities:** Predicting latent intent (e.g., hesitation) when chaotic interactions bypass the WASM gate[cite: 15].
*   **Mechanism:** Runs an INT8-quantized GRU utilizing the WebGPU API to offload heavy matrix multiplications to the local device's GPU[cite: 9, 15].
