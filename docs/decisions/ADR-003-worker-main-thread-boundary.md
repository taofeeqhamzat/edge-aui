# ADR-003: Worker / Main-Thread Boundary

- **Status:** Accepted — with one deferred item
- **Date:** 2026-09-24
- **Related:** ADR-001, ADR-002, ADR-008, ADR-012

## 1. Context

`src/runtime/adaptiveRuntime.ts` composes the whole pipeline. The runtime worker
(`src/runtime/worker/core.ts`, `entry.ts`) is reached through `src/runtime/workerClient.ts`.
The worker hosts macro sequence construction, PrefixSpan mining and ONNX inference. The main
thread hosts DOM observation, event normalisation and window assignment.

The architectural principle from the brief is:

> UI-thread telemetry capture must remain lightweight and non-blocking.

## 2. Problem

Which stages belong on which side of the thread boundary, and what crosses it? A boundary is
only as good as the cost of what crosses it. Two known defects sit here:

1. `src/runtime/workerClient.ts` imports `RuntimeWorkerCore` statically, which pulls the worker
   core **and therefore the gates** into the main bundle. Tree-shaking cannot remove it.
2. The ONNX graph consumes an `(1, 8, 18)` float tensor per evaluation; the transfer and
   serialisation cost of that crossing has never been separated from inference cost.

## 3. Options considered

| Option | Description |
| --- | --- |
| **A. Current boundary** | Observe/normalise/window on main thread; macro/mine/infer in worker. Transfer typed arrays per window. |
| **B. Move windowing into the worker** | Main thread forwards raw events; worker owns windows and tensors. |
| **C. Run gates on the main thread** | Remove the worker; simpler, but blocks the UI thread. |

## 4. Evidence available

**Measured**

- `61 FPS`, `17.13 MB` resident memory, ONNX inference `~11 ms` under the full production
  condition suite (`target-testbed-implementation-record.md` §5).
- The adaptive runtime has `230` passing tests including a composed-pipeline suite.

**Not measured**

- Worker message/transfer cost per window. `NOT MEASURED`.
- Main-thread long tasks attributable to the boundary. `NOT MEASURED`.
- Main bundle size contribution of the static `RuntimeWorkerCore` import. `NOT MEASURED`
  (the payload statement in ADR-008 is a whole-`dist/` figure).

## 5. Decision required

Whether the current boundary remains as-is, and whether the static worker-core import is fixed
now or deferred.

## 6. Recommended option

**Retain Option A; fix the static import as a small, low-risk change (plan 1 task 3.1).**
Do **not** move windowing into the worker. Windowing is cheap, deterministic and depends on the
DOM clock and viewport geometry; moving it would put the geometry source on the wrong side of
the boundary for no measured gain.

Option C is rejected: it directly violates the standing architectural principle.

## 7. Consequences

- The worker boundary must stay transport-typed. Any new stage added to the worker needs its
  transfer cost measured, not assumed (plan 1 task 3.3).
- Making the fallback path a dynamic import keeps the gates out of the main bundle while
  preserving the in-process fallback used by tests.
- Every instrumentation record must label its side: `main`, `worker`, `wasm`, `model`,
  `transfer` (plan 1 task 3.2). Aggregating across sides is what produced unactionable numbers
  before.

## 8. What is being deferred

> **Decision:** Whether any stage should migrate across the boundary.
> **Deferred until:** Plan 1 task 3.3 provides per-stage, per-side measurements.
> **Reason:** Migrating a stage without knowing its cost on either side is guesswork.
> **Current workaround:** None needed; the current split is functional and tested.
> **Risk:** Low for correctness; the risk is mis-attributing latency in the thesis.
> **Evidence required to revisit:** Transfer cost as a share of total per-window latency, and
> main-thread long tasks attributable to boundary crossings.

## 9. Conditions that would force this decision to be revisited

- Transfer cost dominates per-window latency.
- A stage added to the worker requires a geometry or DOM source that only exists on the main
  thread.
- The payload work (ADR-008) removes the ORT WASM binary and changes what the worker must ship.
