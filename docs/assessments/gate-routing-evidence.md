# Empirical Assessment: Fast Gate / Slow Gate Routing Evidence & Causal Chain Verification

- **Date:** 2026-09-29
- **Task:** Phase F Task 6.1 ([`docs/plan/1/tasks/6.1.md`](../plan/1/tasks/6.1.md))
- **Decision Informs:** [ADR-002: Dual-Gate Arbitration](../decisions/ADR-002-dual-gate-arbitration.md), [ADR-003: Sub-50ms Inference Budget](../decisions/ADR-003-sub-50ms-inference-budget.md), [ADR-006: TargetInterventionHead Interface](../decisions/ADR-006-target-intervention-head-interface.md)
- **Status:** Complete — Verified by Automated Tests

---

## 1. Executive Summary

This assessment provides empirical and programmatic evidence for the Dual-Gate Hybrid Extraction Model mandated by Brief §13. In this architecture:
1. **The Fast Route (Deterministic Gate):**
   ```text
   Macro sequence → PrefixSpan → known behavioural pattern → Fast intervention
   ```
2. **The Slow Route (Probabilistic Gate):**
   ```text
   No matching macro pattern → GRU + UIContext (R^6) → TargetInterventionHead → Slow intervention
   ```

Using `tests/gate_routing_evidence.test.ts` and `tests/gate_arbitration.test.ts`, both routing pathways have been verified end-to-end. Crucially, the implementation ensures full reconstructability of the 8-field causal chain (`gate selected → prediction → policy decision → intervention → actuator result → task state`), records per-gate latencies independently, and maintains precise attribution of the adaptation source (`mappingSource`).

---

## 2. The 8 Brief §13 Fields & Causal Reconstruction

Brief §13 requires that for every intervention episode, an observer or auditor can determine *why* an intervention occurred. The framework records all 8 essential fields across `PredictionEvent` and `InterventionEvent`:

| # | Brief §13 Field | Telemetry Event | Field Name | Example Value |
|---|---|---|---|---|
| 1 | **Selected Gate** | `PredictionEvent` | `matchedGate` | `'fast'` or `'slow'` |
| 2 | **Gate Latency** | `PredictionEvent` | `fastGateLatencyMs`, `slowGateLatencyMs` | `3.2 ms` (fast), `16.1 ms` (slow) |
| 3 | **Confidence** | `PredictionEvent` & `InterventionEvent` | `confidence` | `0.95` |
| 4 | **Prediction** | `PredictionEvent` | `outcome`, `interventionType` | `'BACKTRACK'`, `'offer_assistance'` |
| 5 | **Policy Decision** | `PolicyDecision` | `accepted`, `reason` | `true`, `'Candidate met persistence requirement'` |
| 6 | **Intervention Command** | `InterventionEvent` | `intervention`, `mappingSource` | `'offer_assistance'`, `'learned_head'` |
| 7 | **Actuator Result** | `InterventionEvent` | `type` | `'applied'`, `'reverted'`, `'dismissed'` |
| 8 | **Task State** | Trace Session Metadata | `task.currentTaskId`, `status` | `'T1'`, `'In Progress'` |

### The Causal Chain
Every intervention episode recorded in `ExperimentTrace` reconstructs the linear causal chain:
$$\text{Gate Selected} \longrightarrow \text{Prediction} \longrightarrow \text{Policy Decision} \longrightarrow \text{Intervention Issued} \longrightarrow \text{Actuator Result}$$

- If `matchedGate == 'fast'`, the candidate command originates from exact sequential pattern matching (`mappingSource: 'fast_gate_pattern'`).
- If `matchedGate == 'slow'`, the candidate command originates from `TargetInterventionHead` evaluating the concatenated GRU hidden state and UI context $R^6$ vector (`mappingSource: 'learned_head'`).
- In the deterministic ablation arm (`useDeterministicMapping: true`), the candidate originates from rule-based mapping (`mappingSource: 'deterministic_mapping'`).

---

## 3. End-to-End Routing Evidence

### Route A: Fast Gate Match (Short-Circuit)
When the incoming macro-interaction stream contains a frequent sequential pattern (indexed by PrefixSpan):
- **Execution:** Fast Gate matches in $O(1)$ lookup time ($< 5\text{ ms}$).
- **Short-Circuit:** Slow Gate is **not called**. `MockSlowGate.infer` spy confirms zero invocations.
- **Latency Accounting:** `fastGateLatencyMs` is recorded independently; `slowGateLatencyMs` is `undefined`.
- **Attribution:** `mappingSource` is marked as `'fast_gate_pattern'`.

```typescript
// Verified in tests/gate_routing_evidence.test.ts:
expect(result.matchedGate).toBe('fast');
expect(slowInferSpy).not.toHaveBeenCalled();
expect(result.fastGateLatencyMs).toBeGreaterThanOrEqual(0);
expect(result.slowGateLatencyMs).toBeUndefined();
```

### Route B: Fast Gate Miss (Slow Gate Invocation)
When the macro sequence does not match any indexed frequent pattern:
- **Execution:** Fast Gate returns `null` after searching PrefixSpan patterns.
- **Invocation:** Dual-gate arbitration automatically falls back to Slow Gate, passing the 144-dimensional MicroTensor sequence and current `UIContext`.
- **Latency Accounting:** Both `fastGateLatencyMs` and `slowGateLatencyMs` are recorded independently. The sum forms `latencyMs`.
- **Attribution:** `mappingSource` is marked as `'learned_head'` (or `'deterministic_mapping'` in ablation mode).

```typescript
// Verified in tests/gate_routing_evidence.test.ts:
expect(result.matchedGate).toBe('slow');
expect(slowInferSpy).toHaveBeenCalledTimes(1);
expect(result.fastGateLatencyMs).toBeGreaterThanOrEqual(0);
expect(result.slowGateLatencyMs).toBeGreaterThanOrEqual(0);
expect(result.bothGatesEvaluated).toBe(false); // Cascading fallback, not concurrent evaluation
```

---

## 4. Latency Independence (ADR-003 Compliance)

In accordance with ADR-003, gate latencies must never be aggregated into an opaque scalar without preserving the individual execution components. 

The `AdaptiveInferenceEngine` measures timing via `performance.now()` surrounding each gate invocation:

```typescript
// Fast gate timing
const t0 = performance.now();
const fastMatch = await this.fastGate.match(context.macroSequence);
const fastGateLatencyMs = performance.now() - t0;

// Slow gate timing (only on fast gate miss)
const tSlow0 = performance.now();
const slowResult = await this.slowGate.infer(context.microTensorSequence, context.uiContext);
const slowGateLatencyMs = performance.now() - tSlow0;
```

This ensures that downstream telemetry and analysis pipelines (`scripts/verify-trace.mjs`) can audit whether the Fast Gate consistently meets its $< 10\text{ ms}$ budget and the Slow Gate meets its $< 40\text{ ms}$ budget, totaling $< 50\text{ ms}$ Total Blocking Time (TBT).

---

## 5. Slow-Gated Actuation & Policy Threshold Analysis

Historically, Slow-gated interventions in browser tests were rarely observed because the uncalibrated, untrained prototype head produced diffuse confidence scores below `confidenceThreshold = 0.75` (or persistence requirements were unfulfilled).

With the integration of `TargetInterventionHead` (Task 5.1):
1. **Model Confidence:** Softmax probabilities over the 5 output classes (`simplify_options`, `highlight_primary_action`, `offer_assistance`, `expand_tooltip`, `no_op`) require a dominant logit ($z_{\text{top}} - z_{\text{second}} \ge 1.5$) to exceed a 0.75 threshold.
2. **Policy Verification:** The test suite verifies that when the model outputs a confident prediction ($\ge 0.75$, or $\ge 0.50$ depending on configured policy), the candidate passes through:
   - Cooldown gate (not in refractory period)
   - Dismissal check (not recently dismissed)
   - UI Context eligibility check (e.g. `primaryActionAvailable == true` for `highlight_primary_action`)
   - Persistence gate (`candidateCount >= requiredConsecutiveWindows`)
3. **Actuator Execution:** The non-destructive `UIActuator` applies the adaptation to the DOM and emits an `InterventionEvent` with status `'applied'`.

---

## 6. Verification Summary

| Test Case | Test File | Result | Verified Property |
|---|---|---|---|
| `Fast Gate match short-circuit` | `tests/gate_routing_evidence.test.ts` | ✅ PASS | Slow gate uncalled, fast latency isolated |
| `Fast Gate miss invokes Slow Gate` | `tests/gate_routing_evidence.test.ts` | ✅ PASS | Both latencies isolated, microtensors forwarded |
| `8-field causal chain (Fast Gate)` | `tests/gate_routing_evidence.test.ts` | ✅ PASS | Full chain reconstructable from trace |
| `8-field causal chain (Slow Gate)` | `tests/gate_routing_evidence.test.ts` | ✅ PASS | Full chain reconstructable from trace |
| `Deterministic ablation arm` | `tests/gate_routing_evidence.test.ts` | ✅ PASS | Routes through `deterministic_mapping` |
| `ADR-002 Arbitration Rules` | `tests/gate_arbitration.test.ts` | ✅ PASS (8/8) | Dual-gate error handling & flag toggling |
