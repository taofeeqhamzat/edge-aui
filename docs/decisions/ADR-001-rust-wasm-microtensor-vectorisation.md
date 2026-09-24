# ADR-001: Rust/WASM versus TypeScript MicroTensor Vectorisation

- **Status:** Proposed — awaiting human approval
- **Date:** 2026-09-24
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

**Measured (existing, pre-this-plan)**

- Full production condition suite: `230` tests passing; `61 FPS`; `17.13 MB` resident memory;
  ONNX inference `~11 ms` (`target-testbed-implementation-record.md` §5).
- Combined edge payload is `NOT MET`: last production `dist/` was `26.31 MB`, dominated by
  the `26.8 MB` `ort-wasm-simd-threaded.jsep.wasm`.
- `npm run benchmark:runtime` exists and produces runtime numbers.

**Inferred / not measured**

- Per-window MicroTensor construction latency, on its own, is **NOT MEASURED**.
- The Rust vectoriser's own cost, parity, and transfer overhead are **NOT MEASURED**.
- The Rust `extract_micro_tensor` signature consumes *raw pointer points* plus scalar
  `dwellTimeMs` / `scrollDepthPercentage` / `scrollVelocity` — it does **not** consume the
  canonical `BehaviourEvent` stream. Passing the canonical stream to Rust therefore requires
  new adapter code, not a call swap.
- No allocation-count or long-task measurement exists for either path.

## 5. Decision required

Which implementation owns MicroTensor construction on the live runtime path, and may the
losing implementation be deleted?

## 6. Recommended option

**Option C, as a bounded experiment, then decide.** Implement a Rust/WASM vectoriser that
consumes the *same canonical event representation* as the TypeScript path, prove parity, and
benchmark both against each other on the same recorded event streams. Do **not** delete either
path until the numbers exist.

A recommendation between A and B is deliberately withheld: current evidence is consistent with
TypeScript being sufficient, but it does not prove it, because per-stage vectorisation cost has
never been isolated from inference cost.

## 7. Consequences

- Doing nothing (implicit Option A) leaves the Rust vectoriser as dead code and keeps the
  "why is this in TypeScript?" question unanswerable at viva.
- Option C temporarily adds a second implementation and a parity burden. This is the explicit
  cost of buying an evidence-based decision.
- Retaining the Rust/WASM toolchain keeps `wasm-pack` in the build path regardless, because
  PrefixSpan already needs it (ADR-002).

## 8. What is being deferred

> **Decision:** Which vectoriser owns the live path.
> **Deferred until:** Plan 1 tasks 3.1–3.4 produce parity and benchmark evidence.
> **Reason:** No per-stage vectorisation measurement exists; the two implementations do not yet
> even consume the same input.
> **Current workaround:** TypeScript is the live path; Rust/WASM is retained unused for
> vectorisation and used only for PrefixSpan.
> **Risk:** Low for correctness — the live path is tested and parity-checked against the Python
> reference. Medium for the thesis claim — an unexamined architecture divergence.
> **Evidence required to revisit:** Per-window construction latency and throughput for both
> paths on the same event streams, mean and p95, plus main-thread long-task counts.

## 9. Conditions that would force this decision to be revisited

- TypeScript per-window construction exceeds the window stride budget (250 ms) at realistic
  event density, or produces long tasks attributable to vectorisation.
- Rust/WASM shows a material, reproducible advantage on the measured workload.
- The edge payload work (ADR-008) changes the cost model — for example if the ORT WASM binary
  is removed but the vectoriser WASM is retained.
