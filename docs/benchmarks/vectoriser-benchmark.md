# Dual-Path Vectoriser Benchmark Report

**Task:** 2.3 — Dual-Path Vectoriser Benchmark  
**Date:** 2026-09-25  
**Environment:** macOS (darwin arm64), Node.js v22.16.0  
**Workload:** `tests/fixtures/windowingEquivalenceStream.json` (5 scenarios, 26 total canonical events)  
**Evaluations per path:** 1000 windows

---

## 1. Per-Window Construction Latency

| Implementation | Mean ($\mu$s) | Median ($\mu$s) | p95 ($\mu$s) | p99 ($\mu$s) | Throughput (win/sec) |
|---|---|---|---|---|---|
| **TypeScript** (`src/microtensor/features.ts`) | 8.26 | 6.17 | 10.00 | 29.50 | 121,059 |
| **Rust/WASM** (`wasm-vectorizer`) | 33.41 | 32.54 | 42.38 | 64.25 | 29,928 |

*Ratio:* `0.25x` (TypeScript faster or comparable)

---

## 2. Batch Behaviour

Amortized per-window latency across different window batch sizes:

| Batch Size | TypeScript ($\mu$s/win) | Rust/WASM ($\mu$s/win) | TS Throughput (win/s) | WASM Throughput (win/s) |
|---|---|---|---|---|
| **1** | 6.37 | 32.79 | 156,995 | 30,501 |
| **8** | 5.52 | 26.95 | 181,098 | 37,102 |
| **64** | 4.68 | 25.12 | 213,583 | 39,809 |

---

## 3. Worker Transfer Overhead

Measured separately from construction latency (per ADR-003):

| Transfer Mechanism | Mean ($\mu$s) | p95 ($\mu$s) | Notes |
|---|---|---|---|
| **`structuredClone(Float32Array[18])`** | 1.33 | 1.42 | Deep copy across non-transferable boundaries |
| **Transferable `ArrayBuffer`** | `< 1.0` | `< 2.0` | Zero-copy transfer via `postMessage(tensor, [tensor.buffer])` |

---

## 4. Memory Behaviour (5,000 Consecutive Windows)

| Implementation | Heap Delta |
|---|---|
| **TypeScript** | -1323.7 KB |
| **Rust/WASM** | -5902.8 KB |

*Note on allocations:* Fine-grained per-call heap allocation counts without an external profiler are **Not measured (requires V8 trace profiler)**.

---

## 5. Main-Thread Blocking and Long Tasks

| Implementation | Long Tasks (> 50ms) | Max Single Latency | UI Impact |
|---|---|---|---|
| **TypeScript** | `0` | 1.018 ms | Negligible (far below 50ms TBT threshold) |
| **Rust/WASM** | `0` | 2.050 ms | Negligible (far below 50ms TBT threshold) |

*Browser PerformanceObserver long-task tracking:* **Not measured** in Node.js benchmark environment; measured in browser runtime benchmark (`npm run benchmark:runtime`).
