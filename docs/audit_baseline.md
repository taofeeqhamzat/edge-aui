# Repository Structure & Infrastructure Audit

## 1. Overview
This document serves as the baseline audit for the `edge-aui-framework` repository. We have verified the infrastructure state on a clean implementation branch (`feat/target-ui-client-integration`).

## 2. Dependencies & Build Configuration
The repository utilizes a modern Web architecture focused on high performance client-side execution.

### Dependencies
- **Core ML runtime:** `onnxruntime-web` (v1.27.0) used for the Slow Brain (Probabilistic Gate).
- **Build tooling:** `vite` (v8.2.0), `typescript` (~6.0.2).
- **WASM support:** `vite-plugin-wasm` (v3.6.0) is configured to handle WebAssembly loading in Vite.

### Build Scripts
- `npm run dev`: Starts the Vite development server.
- `npm run build:wasm`: Compiles the Rust-based vectorizer using `wasm-pack` targeting the web.
- `npm run build`: Orchestrates the full build process (`build:wasm` -> `tsc` -> `vite build`).
- `npm run typecheck`: Runs TypeScript compiler in noEmit mode for static analysis.

### Tooling Configuration
- **TypeScript (`tsconfig.json`):** Set to target `ES2023` and `ESNext` modules. Resolves paths using `@/*` mapped to `./src/*`. Includes DOM and WebWorker libraries.
- **Vite (`vite.config.ts`):** 
  - Integrated `vite-plugin-wasm` in both the main app and worker build pipelines.
  - configured `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers to support SharedArrayBuffer for threading/WebGPU.

## 3. Existing Components & Reusable Modules
The project follows a modular structure primarily contained within `src/` and `wasm-vectorizer/`.

### Reusable Modules
1. **WASM Vectorizer (`wasm-vectorizer/`)**
   - **Role:** The Deterministic Gate (Fast Brain).
   - **Details:** Contains Rust source code (`kinematics.rs`, `prefix_span.rs`, etc.) compiled to WASM. Handles high-speed macro-interaction mapping.
   
2. **ONNX Gate (`src/workers/onnx-gate/`)**
   - **Role:** The Probabilistic Gate (Slow Brain).
   - **Details:** Contains the Worker wrapper (`onnx.worker.ts`), Client controller (`OnnxGateClient.ts`), and the INT8 quantized model (`model_int8.onnx`). Runs `onnxruntime-web`.
   
3. **WASM Gate (`src/workers/wasm-gate/`)**
   - **Role:** Web Worker interface for the compiled WASM Vectorizer.
   - **Details:** Contains `wasm.worker.ts` and `WasmGateClient.ts` to keep the main thread unblocked.

4. **Telemetry & Core Pipeline (`src/core/`)**
   - **Role:** Observation pipeline.
   - **Details:** `ClientBehaviorTracker.ts`, `SlidingWindowBuffer.ts`, and `pipeline.ts` aggregate interactions and feed them to the respective evaluation gates.

5. **Styles (`src/style.css`)**
   - **Role:** Global styling.

## 4. Verification
- **Branch status:** Checked out a clean feature branch `feat/target-ui-client-integration`.
- **Build status:** `npm run build` executed successfully in ~4s, generating optimized chunks for `vite`, the `.wasm` binary, and ONNX worker dependencies. No TypeScript compiler errors.
