# ADR-007: ONNX Runtime versus Alternative Inference Runtimes

- **Status:** Proposed — decision required, currently deferred
- **Date:** 2026-09-24
- **Related:** ADR-003, ADR-006, ADR-008

## 1. Context

The Slow Gate runs `onnxruntime-web` (`^1.27.0`) inside a Web Worker, preferring the WebGPU
execution provider with fallback. The combined `dist/` from the last production build was
`26.31 MB`, dominated by `ort-wasm-simd-threaded.jsep.wasm` at `26.8 MB`, against a
`< 500 KB` combined target.

The model itself is small and quantisation-hostile: dynamic INT8 quantisation leaves the two GRU
layers in FP32, so `model_int8.onnx` (`170 206 B`) is marginally **larger** than `model.onnx`
(`169 356 B`).

## 2. Problem

Whether ONNX Runtime is the right inference runtime for a two-layer GRU with
`hidden_dim = 64`, or whether the payload is being spent on a general-purpose runtime for a
model with a very narrow op set.

## 3. Options considered

| Option | Description | Risk |
| --- | --- | --- |
| **A. Retain ORT, leaner configuration** | Build/config a reduced ORT (drop JSEP, drop unused ops, single-threaded). | Low — same code path |
| **B. Hand-written GRU runtime** | Implement the two GRU layers and heads in TypeScript or Rust/WASM. | Medium — new numerical code path, must be parity-checked |
| **C. Specialised WASM inference** | Use a minimal WASM runtime for the specific graph. | Medium — new dependency |
| **D. Replace ORT now** | Migrate immediately. | High — unmeasured premise; brief forbids it |

## 4. Evidence available

**Measured**

- `dist/` `26.31 MB`, ORT JSEP WASM `26.8 MB` (pre-existing build output; **not re-measured**
  in the latest audit).
- `model.onnx` `169 356 B`; `model_int8.onnx` `170 206 B`.
- ONNX inference `~11 ms` under the production condition suite.

**Not measured**

- Native ORT runtime library size **separately** from the model and WASM payload. The brief
  explicitly asks for this to be investigated separately. `NOT MEASURED`.
- Whether a leaner ORT configuration retains WebGPU support. `NOT MEASURED`.
- Latency of a hand-written GRU for `(1, 8, 18) → 64 → 7`. `NOT MEASURED`.

## 5. Decision required

Which inference runtime the project commits to, subject to measured payload and latency
evidence.

## 6. Recommended option

**Option A first, investigated as a bounded measurement.** Isolate ORT's contribution to the
payload and test whether a reduced ORT configuration meets the budget while preserving the
provider fallback chain. **Do not replace ORT** until that measurement exists and the human
researcher supports the change — the brief states this explicitly.

Option B is the most likely fallback if Option A fails, because the graph is two GRU layers plus
two small heads: a narrow, well-understood op set that a hand-written runtime can implement and
parity-check against the ONNX graph on fixed inputs. It is *not* recommended yet, because its
numerical-parity risk has not been scoped.

## 7. Consequences

- The payload budget is **not met today** and this plan does not assume it will be met.
- Any runtime replacement invalidates the "WebGPU execution provider" claim, which is currently
  a stated part of the architecture. That claim must be re-earned, not carried over.
- Quantisation is not a lever for this model in its current form; this is documented so the
  INT8 path is not repeatedly revisited.

## 8. What is being deferred

> **Decision:** Whether to replace ONNX Runtime.
> **Deferred until:** Plan 1 task 7.1 produces an isolated ORT payload measurement and, if
> needed, a scoped feasibility note for a hand-written GRU.
> **Reason:** The brief forbids replacing ORT until measured evidence and human support exist.
> **Current workaround:** ORT is retained; the budget is reported as unmet.
> **Risk:** High for the edge-deployment claim — the `< 500 KB` target is an architectural target,
> not a measurement, and it is currently exceeded by roughly two orders of magnitude.
> **Evidence required to revisit:** Isolated ORT payload figure; a leaner-configuration payload
> and latency comparison; if that fails, a parity-checked hand-written GRU prototype with
> measured latency and payload.

## 9. Conditions that would force this decision to be revisited

- The edge deployment target becomes a hard requirement for the participant study.
- A leaner ORT configuration cannot preserve the provider fallback chain.
- The intervention head adds a second graph and pushes the payload further out of reach.
