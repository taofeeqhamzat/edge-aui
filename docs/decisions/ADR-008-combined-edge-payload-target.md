# ADR-008: Combined Edge Payload Target

- **Status:** Accepted as an unmet target — reported honestly, not claimed
- **Date:** 2026-09-24
- **Related:** ADR-003, ADR-007

## 1. Context

`edge-aui-framework/AGENTS.md` §2 states two standing constraints:

- Storage payload: combined WASM binary and quantized GRU model `< 500 KB`.
- Active memory: `< 20 MB`.

The brief (§16) states these are **architectural targets, not measurements**, and forbids
claiming them unless verified.

## 2. Problem

The target is currently missed by roughly two orders of magnitude, and the plan adds a second
model artifact (ADR-006). There is a risk that the target is quietly restated as met, or that
engineering effort is spent chasing it before the intervention-head milestone works.

## 3. Options considered

| Option | Description |
| --- | --- |
| **A. Keep the target, report the gap** | Continue development; state the measured number and the gap at every report. |
| **B. Restate or relax the target** | Change the constraint to match the measurement. |
| **C. Chase the target now** | Stop feature work and reduce the payload first. |

## 4. Evidence available

**Measured**

- Last production `dist/`: `26.31 MB` total; ORT JSEP WASM `26.8 MB`.
- `model.onnx` `169 356 B`; `model_int8.onnx` `170 206 B`.
- Resident memory `17.13 MB` in the production condition suite — within the `< 20 MB` target,
  but measured on a desktop browser, not a constrained device.

**Not measured**

- Total transferred payload on a cold load (i.e. what a participant's browser actually
  downloads). The `dist/` directory size is not the transferred size.
- Runtime library size isolated from model and WASM (see ADR-007).
- Memory and payload on a memory-constrained or GPU-less device.

## 5. Decision required

Whether the `< 500 KB` target remains a project constraint for the participant-facing milestone,
and what the plan commits to measuring.

## 6. Recommended option

**Option A.** Keep the target as a stated architectural constraint and report it as **NOT MET**
with the measured figure. Do **not** relax it to match the measurement — the constraint is a
design goal, and relaxing it would remove the pressure that produced the Rust/WASM toolchain
discipline in the first place. Do not chase it before the intervention-head milestone works
(brief §20: "Prioritise a complete vertical slice over broad framework generalisation").

The plan commits to *measuring* rather than *meeting*: isolated runtime size, model size, WASM
size, and cold-load transferred payload (plan 1 task 7.1).

## 7. Consequences

- Every report must carry the measured payload and the gap. "Under 500 KB" must never appear as
  an unqualified claim.
- The larger-project definition of done (§23) is **not** satisfied on this axis, and the final
  report must say so.
- A hand-written GRU runtime (ADR-007 Option B) becomes the likely route to the target if it is
  ever treated as hard.

## 8. What is being deferred

> **Decision:** Any payload-reduction engineering.
> **Deferred until:** The intervention-head experiment works end to end and task 7.1 produces
> the isolated ORT measurement.
> **Reason:** Payload work is not on the critical path to the immediate milestone and its premise
> is unmeasured.
> **Current workaround:** None — the payload is reported as unmet.
> **Risk:** High for the deployment goal; the participant-ready package (Phase H) may not be
> deliverable within the payload constraint.
> **Evidence required to revisit:** A measured cold-load transferred payload and an isolated ORT
> contribution.

## 9. Conditions that would force this decision to be revisited

- The participant study requires deployment over a constrained network.
- The combined payload grows substantially with the second model artifact.
- A supervisor or reviewer treats `< 500 KB` as a hard acceptance criterion.
