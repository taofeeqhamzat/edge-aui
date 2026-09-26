# ADR-001: Rust/WASM versus TypeScript MicroTensor Vectorisation

- **Status:** Accepted — Option A: Retain TypeScript Vectorisation
- **Date:** 2026-09-26 (Human decision recorded)
- **Owner of decision:** Human researcher
- **Related:** ADR-002, ADR-004, [plan 1 Phase B](../plan/1/model-preparation-adaptive-intervention-integration-and-deployable-participant-pipeline-plan.md)

## 1. Context

The framework was originally specified to compile the vectorisation logic into Rust/WASM
(`wasm-vectorizer/src/kinematics.rs`). The implemented runtime instead constructs the 18-D
MicroTensor in TypeScript (`src/microtensor/features.ts`), and Rust/WASM is used only for
PrefixSpan mining. `docs/assessments/target-testbed-implementation-record.md` §4 does not
record this divergence as a defect, and the Fast Gate path is verified working.

The Rust module therefore exists but is not on the runtime vectorisation path.

## 2. Problem

There is no measured basis on which to decide whether MicroTensor construction belongs in
TypeScript or Rust/WASM. The earlier "every computational operation must be in Rust/WASM"
assumption was never tested. Without a decision, the codebase carries two divergent
vectorisation implementations with no owner and no separation-of-concerns rule.

## 3. Options considered

| Option | Description |
| --- | --- |
| **A. Retain TypeScript vectorisation** | Delete or archive the Rust vectoriser; keep one implementation. |
| **B. Migrate to Rust/WASM** | Route the live path through the Rust module; TypeScript keeps only an adapter. |
| **C. Maintain both behind a shared interface** | Implement both, prove parity, benchmark, then decide. |

## 4. Evidence available

**Measured (Task 2.2 & Task 2.3 Empirical Results, 2026-09-25)**

- **Numerical Parity:** Exact numerical parity proven across all synthetic scenarios and 18 dimensions
  (\(\Delta = 0.000000 \le 10^{-4}\)). Documented in [`docs/benchmarks/vectoriser-parity.md`](../benchmarks/vectoriser-parity.md).
- **Per-Window Construction Latency:**
  - TypeScript (`src/microtensor/features.ts`): mean = **`8.26 µs`** (\(0.0083\text{ ms}\)), median = `6.17 µs`, p95 = `10.00 µs`, throughput = `121,059 win/sec`.
  - Rust/WASM (`wasm-vectorizer`): mean = **`33.41 µs`** (\(0.0334\text{ ms}\)), median = `32.54 µs`, p95 = `42.38 µs`, throughput = `29,928 win/sec`.
  - Result: TypeScript is **\(4.04\times\) faster** than Rust/WASM because JS-to-WASM memory serialization (`serde_wasm_bindgen`) outweighs native arithmetic on 500 ms windows.
- **Window Stride Budget Consumption:**
  - TypeScript per-window vectorisation uses **\(0.003\%\)** of the 250 ms window stride budget.
- **Thread Transfer Overhead:**
  - `structuredClone`: \(1.33\ \mu\text{s}\); zero-copy transferable `ArrayBuffer`: \(< 1\ \mu\text{s}\).
- **Main-Thread Long Tasks (> 50ms):**
  - TypeScript: `0` long tasks (max single latency `1.018 ms`).
  - Rust/WASM: `0` long tasks (max single latency `2.050 ms`).
- **Memory Footprint:** Heap delta over 5,000 windows is stable post-GC on both paths (zero leaks).
- Full benchmark report in [`docs/benchmarks/vectoriser-benchmark.md`](../benchmarks/vectoriser-benchmark.md).

**Inferred / Not Measured**

- Low-end mobile CPU profile: **Not measured** in desktop test environment.
- Per-call V8 allocation counts: **Not measured** (requires external V8 tracing).

## 5. Decision required

Which implementation owns MicroTensor construction on the live runtime path, and what is the
disposition of the alternative implementation?

## 6. Recommended option

**Option A: Retain TypeScript vectorisation.** TypeScript is \(4\times\) faster in per-window latency
(\(8.26\ \mu\text{s}\) vs \(33.41\ \mu\text{s}\)), uses negligible CPU budget (\(0.003\%\) of 250 ms stride),
produces zero long tasks, and avoids serde marshalling overhead across the linear memory boundary.
The canonical Rust/WASM vectoriser is retained as a test oracle and parity reference (Task 2.5) rather
than the live path.

## 7. Consequences

- Doing nothing (implicit Option A) leaves the Rust vectoriser as dead code and keeps the
  "why is this in TypeScript?" question unanswerable at viva.
- Option C temporarily adds a second implementation and a parity burden. This is the explicit
  cost of buying an evidence-based decision.
- Retaining the Rust/WASM toolchain keeps `wasm-pack` in the build path regardless, because
  PrefixSpan already needs it (ADR-002).

## 8. Decision Outcome

> **Decision:** Option A — Retain TypeScript Vectorisation on the live runtime path.
> **Date:** 2026-09-26
> **Evidence:** Task 2.2 proved exact parity (\(\Delta = 0.000000 \le 10^{-4}\)). Task 2.3 demonstrated
> that TypeScript is \(4.04\times\) faster (\(8.26\ \mu\text{s}\) mean vs \(33.41\ \mu\text{s}\) in WASM)
> due to avoiding JS-to-WASM memory serialization across `serde_wasm_bindgen`. TypeScript vectorisation
> consumes only \(0.003\%\) of the 250 ms window stride budget and produces zero long tasks.
> **Role of Rust/WASM vectoriser:** The canonical Rust vectoriser is retained in `wasm-vectorizer` as an
> offline parity test oracle and cross-implementation regression check, but is not routed on the live
> execution path. PrefixSpan remains in Rust/WASM (ADR-002).

## 9. Conditions that would force this decision to be revisited

- TypeScript per-window construction exceeds the window stride budget (250 ms) at realistic
  event density, or produces long tasks attributable to vectorisation.
- Rust/WASM shows a material, reproducible advantage on the measured workload.
- The edge payload work (ADR-008) changes the cost model — for example if the ORT WASM binary
  is removed but the vectoriser WASM is retained.
