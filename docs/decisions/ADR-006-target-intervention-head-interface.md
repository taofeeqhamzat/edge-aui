# ADR-006: Target Intervention Head Interface

- **Status:** Proposed — awaiting human approval
- **Date:** 2026-09-24
- **Related:** ADR-004, ADR-007, ADR-011

## 1. Context

`model-preparation/src/training.py` defines two heads on one backbone:

- `FoundationOutcomeHead` — `hidden_dim (64) → foundation_classes (7)`.
- `TargetInterventionHead` — `(hidden_dim + context_dim) (64 + 6) → target_classes (5)`.

`EdgeAUIGRU.forward` accepts a `context` argument only when the attached head is a
`TargetInterventionHead`, and raises `ValueError("UI context tensor is mandatory...")` when it is
absent. The `R⁶` context vector already exists at runtime
(`src/types/contextVector.ts`, `tests/context_vector.test.ts`).

The shipped browser graph consumes only the MicroTensor sequence and emits seven foundation
outcomes. A deterministic `outcome → intervention` mapping stands in for the learned head.

## 2. Problem

What is the runtime contract for the learned intervention head, and does the foundation outcome
head stay in the hot path?

The brief requires the head to be **independently testable** and explicitly forbids hard-coding
`outcome → intervention` as the *final* architecture, while permitting it as a baseline,
fallback, ablation condition or deterministic Fast Gate policy.

## 3. Options considered

| Option | Interface | Notes |
| --- | --- | --- |
| **A. Separate graph** | A second ONNX graph: `(sequence, context) → intervention logits`. | Foundation graph unchanged and still loadable. |
| **B. Single combined graph** | One graph emitting both outcome logits and intervention logits. | Couples the two heads, which the brief warns against. |
| **C. In-browser head** | Keep the backbone graph; run the small head in JS/WASM. | Head is tiny, but adds a hand-written inference path. |
| **D. Replace the head** | Ship only the intervention head. | Loses outcome diagnostics, evaluation and ablation. |

## 4. Evidence available

**Verified by automated test**

- `tests/onnx_contract.test.ts` asserts input `(1, batch_size, seq_len, 18)` and output
  `(1, batch_size, 7)` for the current graph.
- `tests/context_vector.test.ts` verifies the `R⁶` encoding round-trips.
- `tests/slow_gate.test.ts` exercises the `SlowGate` interface.

**Measured**

- ONNX inference `~11 ms` for the current graph under the production suite.

**Observed blocker carried forward**

- The current graph's best-class probability sits at `~0.44–0.48` for `NO_OUTCOME`, below the
  policy's `0.75` threshold, because the head was never trained on target-domain data. No
  slow-gated intervention has been applied live
  (`target-testbed-implementation-record.md` §4.3).

## 5. Decision required

Which interface shape the runtime adopts, whether the `SlowGate` result contract changes, and how
the policy distinguishes an intervention prediction from an outcome prediction.

## 6. Recommended option

**Option A — a separate, versioned intervention-head graph.** It is the only option that keeps
the foundation graph intact for diagnostics and ablation while giving the learned head a clean,
independently testable contract, and it does not couple the two heads.

Concretely:

- Extend `SlowGateInput` to carry the already-present `context: UIContext` (it does today) and
  extend `SlowGateResult` with an explicit `interventionProbabilities` field alongside the
  existing `outcome` / `probabilities`.
- Keep the deterministic `outcome → intervention` mapping behind a configuration flag, as an
  explicit ablation arm, not as the production default once the head is exported.
- The runtime must record *which* mapping produced a command, so the trace can distinguish
  learned-head interventions from deterministic ones.

The `SlowGateResult` shape change is a contract change and must be versioned (ADR-012).

## 7. Consequences

- Two model artifacts must be loaded, versioned and reported in the trace. The payload cost is
  additive to an already-unmet budget (ADR-008).
- The policy layer needs a way to route on intervention confidence without silently reusing the
  outcome threshold. Reusing `0.75` for both is a *choice*, not a default, and must be
  configured explicitly.
- The ablation suite gains a clean arm: deterministic mapping versus learned head, same
  backbone, same data.

## 8. What is being deferred

> **Decision:** Whether the outcome head remains loaded in the production runtime once the
> intervention head is integrated.
> **Deferred until:** Plan 1 tasks 6.1–6.2 record gate routing and intervention outcomes with both
> heads loaded.
> **Reason:** Keeping both is diagnostic value at a payload cost that is not yet measured.
> **Current workaround:** The foundation head is the only head; the intervention mapping is
> deterministic.
> **Risk:** Low for correctness; medium for the payload target.
> **Evidence required to revisit:** Measured payload and latency with both graphs loaded versus
> intervention-head-only.

## 9. Conditions that would force this decision to be revisited

- The intervention head's validation metrics show it is unusable, and the diagnosis points at the
  head interface (missing context signal, wrong fusion point) rather than at the training data.
- The measured payload with both graphs loaded makes the two-graph approach untenable, forcing a
  single-graph decision.
- The policy layer cannot route on intervention confidence without conflating it with the outcome
  threshold, which would mean the `SlowGateResult` shape is wrong rather than the policy.
- The deterministic mapping is found to be required in production for a reason other than
  fallback — for example a regulatory or explainability requirement — which changes where it lives.
