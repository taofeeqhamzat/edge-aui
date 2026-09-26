# Vectorisation Decision Package: TypeScript vs Rust/WASM MicroTensor Vectorisation

**Task:** 2.4 — Vectorisation Decision Package (Human Gate)  
**Date:** 2026-09-25  
**Related Decisions:** [ADR-001](../decisions/ADR-001-rust-wasm-microtensor-vectorisation.md), [ADR-002](../decisions/ADR-002-rust-wasm-prefixspan-boundary.md), [ADR-004](../decisions/ADR-004-microtensor-schema.md)  
**Evidence Sources:**
- Parity Suite: [`docs/benchmarks/vectoriser-parity.md`](../benchmarks/vectoriser-parity.md) (Task 2.2)
- Benchmark Suite: [`docs/benchmarks/vectoriser-benchmark.md`](../benchmarks/vectoriser-benchmark.md) (Task 2.3)

---

## 1. Pre-Registered Decision Criteria

*Pre-registered definition of success and null-result conditions:*

### 1.1 Criteria for Option B (Migrate to Rust/WASM)
Migration to Rust/WASM is justified if and only if **all** of the following hold:
1. **Parity Satisfied:** Numerical parity between TypeScript and Rust/WASM is proven on canonical interaction streams with \(\Delta \le 10^{-4}\) across all 18 dimensions.
2. **Computational Benefit:** Rust/WASM demonstrates a statistically significant construction speedup (\(\ge 2\times\)) over TypeScript on realistic recorded event streams, OR TypeScript per-window construction time exceeds 10% of the 250 ms window stride budget (\(> 25\text{ ms}\)).
3. **Main-Thread Responsiveness:** Rust/WASM eliminates long tasks (\(> 50\text{ ms}\)) attributable to TypeScript vectorisation.

### 1.2 Criteria for Option A (Retain TypeScript Vectorisation) — The Null-Result Condition
Retaining TypeScript vectorisation as the single live path is the pre-registered correct outcome if:
1. **Parity Satisfied:** Parity is confirmed (\(\Delta \le 10^{-4}\)).
2. **TypeScript Budget Compliance:** TypeScript per-window latency is negligible relative to the 250 ms window stride budget (\(< 1\text{ ms}\), or \(< 0.5\%\) of budget), with zero long tasks (\(0\) tasks exceeding 50 ms).
3. **Boundary Overhead Dominates:** Rust/WASM does not demonstrate a computational advantage because the JS-to-WASM linear memory serialization overhead (`serde_wasm_bindgen` / structured passing of event arrays) offsets or exceeds the compute savings of native execution for 500 ms micro-windows.

---

## 2. Empirical Evidence Table

All figures measured on macOS (darwin arm64, Apple Silicon), Node.js v22.16.0, on canonical recorded stream `tests/fixtures/windowingEquivalenceStream.json` (5 window scenarios, 26 events, 1,000 evaluations per path).

| Metric | TypeScript (`src/microtensor/features.ts`) | Rust/WASM (`wasm-vectorizer`) | Status | Notes |
|---|---|---|---|---|
| **Numerical Parity (\(\Delta \le 10^{-4}\))** | Reference | `0.000000` max delta | **Measured** | Exact parity across all 5 reference scenarios and 18 dimensions |
| **Per-Window Latency (Mean)** | **`8.26 µs`** (\(0.0083\text{ ms}\)) | **`33.41 µs`** (\(0.0334\text{ ms}\)) | **Measured** | TypeScript is **\(4.04\times\) faster** |
| **Per-Window Latency (Median)** | **`6.17 µs`** | **`32.54 µs`** | **Measured** | TypeScript is \(5.27\times\) faster |
| **Per-Window Latency (p95 Tail)** | **`10.00 µs`** (\(0.0100\text{ ms}\)) | **`42.38 µs`** (\(0.0424\text{ ms}\)) | **Measured** | TS p95 is \(4.24\times\) faster |
| **Per-Window Latency (p99 Tail)** | **`29.50 µs`** (\(0.0295\text{ ms}\)) | **`64.25 µs`** (\(0.0643\text{ ms}\)) | **Measured** | TS p99 is \(2.18\times\) faster |
| **Throughput** | **`121,059 win/sec`** | **`29,928 win/sec`** | **Measured** | TypeScript processes \(4.04\times\) more windows/sec |
| **Batch Size 1 (Amortized)** | `6.37 µs` / window | `32.79 µs` / window | **Measured** | TS \(5.15\times\) faster |
| **Batch Size 8 (Amortized)** | `5.52 µs` / window | `26.95 µs` / window | **Measured** | TS \(4.88\times\) faster |
| **Batch Size 64 (Amortized)** | `4.68 µs` / window | `25.12 µs` / window | **Measured** | TS \(5.37\times\) faster |
| **Thread Transfer Overhead** | `1.33 µs` (clone) / `< 1 µs` (transfer) | `1.33 µs` (clone) / `< 1 µs` (transfer) | **Measured** | 18-D `Float32Array` transfer is negligible |
| **Heap Memory Delta (5k windows)** | `-1323.7 KB` (stable post-GC) | `-5902.8 KB` (stable post-GC) | **Measured** | Both exhibit zero memory leaks |
| **Main-Thread Long Tasks (> 50ms)** | **`0`** (max = `1.018 ms`) | **`0`** (max = `2.050 ms`) | **Measured** | Zero UI jank risk from vectorisation |
| **Binary Storage Payload** | `0 KB` (pure TS in bundle) | `91.9 KB` (WASM binary) | **Measured** | PrefixSpan requires WASM regardless (ADR-002) |
| **Per-Call Allocation Counts** | `Not measured` | `Not measured` | **Not measured** | Requires low-level V8 trace profiler; unneeded given stable heap delta |
| **Constrained Mobile CPU Profile** | `Not measured` | `Not measured` | **Not measured** | Low-end mobile device hardware not available in CI environment |

---

## 3. Limits and Constraints of the Evidence

1. **Hardware Environment:** Measurements were executed on an Apple Silicon Darwin arm64 processor in Node.js v22.16.0. While clock frequencies differ from low-end mobile devices, the relative architectural ratio (V8 JIT compilation vs WASM linear memory crossing) is structurally consistent across platforms.
2. **Boundary Crossing Bottleneck:** In a 500 ms window, the number of raw events is modest (typically 5–50 events). Serializing an array of JavaScript objects across the WASM boundary via `serde_wasm_bindgen` takes \(\sim 20\text{--}25\ \mu\text{s}\), whereas V8's TurboFan compiler optimizes the pure TypeScript vector math down to \(\sim 6\text{--}8\ \mu\text{s}\) with zero serialization.
3. **PrefixSpan Independence:** PrefixSpan pattern mining operates over macro tokens (`Vec<Vec<String>>`) with complex projection trees, where Rust's compile-time optimizations and memory layout are highly effective (ADR-002). MicroTensor construction, by contrast, is linear arithmetic over tiny coordinate vectors.

---

## 4. Evaluation and Recommendation

### 4.1 Evaluation Against Criteria
- The **Null-Result Condition (§1.2)** is completely satisfied:
  1. Parity holds at \(0.000000\) max delta (\(\le 10^{-4}\)).
  2. TypeScript consumes only \(0.0083\text{ ms}\) per window (\(0.003\%\) of the 250 ms window stride budget).
  3. TypeScript produces zero long tasks (\(0\) exceeding 50 ms).
  4. Rust/WASM is \(4\times\) slower for this specific stage due to JS \(\leftrightarrow\) WASM boundary deserialization of the event batch.

### 4.2 Recommendation
**Adopt Option A: Retain TypeScript Vectorisation.**
- Route the live production pipeline exclusively through `src/microtensor/features.ts`.
- Retain the Rust/WASM canonical vectoriser (`vectorize_canonical_events`) in `wasm-vectorizer` as an experimental/parity reference and regression test oracle (task 2.5), without routing live runtime telemetry through it.
- Maintain PrefixSpan in Rust/WASM per ADR-002.

---

## 5. Consequences of Each Option

| Dimension | Option A: Retain TypeScript (Recommended) | Option B: Migrate to Rust/WASM |
|---|---|---|
| **Latency** | **`8.26 µs`** (\(0.003\%\) of 250ms stride budget) | **`33.41 µs`** (4x slower due to boundary transfer) |
| **Code Simplicity** | Single active implementation on main path; zero IPC serialization for vectorisation | Adds serde boundary crossing on every 250ms window tick |
| **Thesis / Viva Defense** | Fully defensible with empirical data: demonstrates rigorous evidence-based engineering rather than dogmatic "everything in WASM" assumption | Slower runtime without performance justification |
| **PrefixSpan Impact** | Unchanged (WASM PrefixSpan remains active and tested per ADR-002) | Unchanged |
| **Parity Assurance** | TypeScript continues to match Python reference (\(10^{-4}\) in CI) | Requires maintaining dual parity in CI |
