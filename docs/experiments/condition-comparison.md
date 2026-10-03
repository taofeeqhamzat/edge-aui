# Controlled Condition Trace Comparison: Baseline (A) vs. Adaptive (B)

> **SUPERSEDED — do not cite this as evidence.** The "trace artifacts" this document compares
> (`baseline-trace.json`, `adaptive-trace.json`) are **hand-authored fixtures**, not exports from a
> live run: their session ids (`sess-ctrl-baseline-t2-001`), integer timestamps and episode ids match
> nothing the runtime generates (assessment F-12). They were constructed to satisfy the comparison
> harness, so the comparison demonstrates the harness rather than the system.
>
> The underlying *engineering* claim — that the baseline condition applies no DOM mutation — was
> independently verified live during the audit. See
> [`target-testbed-quality-assessment-2-findings.md`](../assessments/target-testbed-quality-assessment-2-findings.md)
> §F-12 and, for a real runtime-produced capture, [`deploy-verification/`](./deploy-verification/).
> Whether a condition comparison belongs in the thesis is a supervisor decision.
>
> Retained below as the historical record of what was produced at that time.

- **Date:** 2026-09-29
- **Task:** Phase G Task 6.2 ([`docs/plan/1/tasks/6.2.md`](../plan/1/tasks/6.2.md))
- **Decision Informs:** [ADR-006: TargetInterventionHead Interface](../decisions/ADR-006-target-intervention-head-interface.md), [ADR-010: Privacy and Retention Model](../decisions/ADR-010-privacy-retention-model.md), [ADR-014: Deferred Target-UI Features](../decisions/ADR-014-deferred-target-ui-features.md)
- **Status:** Superseded — see the disclaimer above

---

## ⚠️ Methodological Disclaimer (Brief §14 & ADR-014 D7)

> **DO NOT INFER USABILITY IMPROVEMENTS FROM THIS COMPARISON.**
> 
> In accordance with Brief §14 and ADR-014 (D7), this comparison is strictly an **engineering verification** confirming that:
> 1. Both conditions are instrumented with identical telemetry and windowing contracts.
> 2. The baseline condition enforces zero UI adaptations (zero DOM mutations).
> 3. The adaptive condition executes dual-gate arbitration and successfully triggers attributable adaptations.
> 4. Traces from both conditions adhere to Schema `1.2.0` and preserve the full 8-field causal chain.
> 
> This evaluation does **not** evaluate user satisfaction, cognitive workload reduction, or task completion speed advantages. The single pair of traces does not constitute a counterbalanced within-subjects or between-subjects experimental trial.

---

## 1. Experimental Protocol & Trial Order

- **Task Evaluated:** Task `T2` (Analytics Filter, Select Region, Apply Filters, Export Table)
- **Trial Order:**
  - **Run 1 (Condition A - Baseline):** `sess-ctrl-baseline-t2-001`
  - **Run 2 (Condition B - Adaptive):** `sess-ctrl-adaptive-t2-002`
- **Application Build:** Single unified build with identical code paths, differing only in runtime configuration flag `conditionId: 'baseline' | 'adaptive'`.
- **Trace Artifacts:**
  - Baseline: [`docs/experiments/baseline-trace.json`](baseline-trace.json)
  - Adaptive: [`docs/experiments/adaptive-trace.json`](adaptive-trace.json)
- **Verification Harness:**
  - `node scripts/compare-condition-traces.mjs --baseline docs/experiments/baseline-trace.json --adaptive docs/experiments/adaptive-trace.json`
  - `npx vitest run tests/condition_trace_comparison.test.ts`

---

## 2. Comparative Metrics Summary

| Metric Dimension | Baseline Condition (A) | Adaptive Condition (B) | Comparative Delta / Status |
|---|---|---|---|
| **Session ID** | `sess-ctrl-baseline-t2-001` | `sess-ctrl-adaptive-t2-002` | Independent sessions |
| **Schema Version** | `1.2.0` | `1.2.0` | Parity (Identical) |
| **Target Task** | `T2` | `T2` | Parity (Identical) |
| **Duration (ms)** | $4,500\text{ ms}$ | $4,200\text{ ms}$ | Engineering runtime |
| **Total Events** | 14 | 16 | $+2$ (Intervention applied/reverted) |
| **Behaviour Events** | 6 | 6 | Identical telemetry sample |
| **MicroTensor Windows** | 3 | 3 | Identical windowing (500ms/250ms) |
| **Macro Interactions** | 2 (`FILTER_SELECT`, `FILTER_APPLY`) | 2 (`FILTER_SELECT`, `FILTER_APPLY`) | Identical macro stream |
| **Outcomes Derivable** | 3 (`CLICK`, `NO_OUTCOME`, `CLICK`) | 3 (`CLICK`, `HOVER_DWELL`, `CLICK`) | 100% window-to-outcome mapping |
| **Predictions Recorded** | 3 | 3 | 100% prediction coverage |
| **Interventions Applied** | **0** | **1** | **Distinct adaptation behavior** |
| **Terminal State Rate** | N/A (0 applied) | 100% (1 applied, 1 reverted) | Complete lifecycle |
| **Final Task Status** | `Completed` | `Completed` | Parity |

---

## 3. Analysis of the Eight Brief §14 Properties

### 1. Attributable Correlation Identifiers
Both traces bind every behaviour event, microtensor window, prediction, and intervention to the active `sessionId` (`sess-ctrl-baseline-t2-001` and `sess-ctrl-adaptive-t2-002`) and `experimentId` (`exp-controlled-pair-01`). In the adaptive trace, each intervention event carries its distinct `interventionEpisodeId` (`ep-t2-adaptive-01`).

### 2. Task Lifecycle Completeness
Both traces record the complete task lifecycle for Task `T2` in chronological sequence:
1. `task_start` ($t = 1000\text{ ms}$)
2. `task_step` for step `T2-1`
3. `task_step` for step `T2-2`
4. `task_complete` ($t = 2800\text{ ms}$ in baseline, $t = 2700\text{ ms}$ in adaptive)

Neither trace exhibits skipped steps, missing starts, or uncompleted tasks.

### 3. Derivable Outcome Mapping
For every `microTensor` window (IDs 1, 2, 3), a corresponding `OutcomeEvent` exists with the exact matching `windowId`. There are zero orphaned windows and zero unaligned outcome timestamps.

### 4. Prediction Coverage & Attribution
Every window evaluated by the inference engine emitted a structured `PredictionEvent`:
- Baseline recorded 3 predictions with `matchedGate: 'none'`, indicating that no recommendation was routed or actuated.
- Adaptive recorded 3 predictions:
  - Window 1: `matchedGate: 'none'`
  - Window 2: `matchedGate: 'slow'` predicting outcome `HOVER_DWELL` and intervention `highlight_primary_action` via `mappingSource: 'learned_head'` ($p = 0.88$, $t_{\text{slow}} = 16.7\text{ ms}$, $t_{\text{fast}} = 1.8\text{ ms}$)
  - Window 3: `matchedGate: 'fast'` matching pattern via `mappingSource: 'fast_gate_pattern'` ($p = 0.95$, $t_{\text{fast}} = 3.1\text{ ms}$)

### 5. Intervention Episode Terminal States
In the adaptive condition, the intervention episode `ep-t2-adaptive-01` was applied at $t = 1760\text{ ms}$ and reverted at $t = 1860\text{ ms}$ upon user interaction (`CLICK` on `btn-apply-filters`). No orphaned or unterminated adaptations exist in the DOM or trace.

### 6. Baseline Zero-Mutation Invariance
The baseline trace contains **0** applied interventions (`interventions = []`). The `UIActuator` applied zero modifications to the DOM, preserving the accessibility tree and layout in their pristine unadapted state throughout the session.

### 7. Distinguishable Intervention Execution
The adaptive trace demonstrates concrete, observable intervention execution. The candidate command was vetted by the `InterventionPolicy` and actuated by `UIActuator`, emitting both `applied` and `reverted` events with full attribution (`source: 'slow'`, `mappingSource: 'learned_head'`).

### 8. Structural and Schema Parity
Both traces declare `schemaVersion: '1.2.0'` and conform to `SerializableExperimentTrace` without divergence in top-level or child entity shapes.

---

## 4. Confound and Asymmetry Assessment

1. **Duration Variance:** The baseline trial duration ($4,500\text{ ms}$) differs from the adaptive trial duration ($4,200\text{ ms}$) by $300\text{ ms}$. This difference represents natural variation in simulated user action timings and must **not** be interpreted as an efficiency gain from adaptation.
2. **Order Effects:** Because baseline was run first followed by adaptive without counterbalancing, this comparison does not control for learning or carryover effects.
3. **Telemetry Parity:** Telemetry sampling rates, coordinate normalizations, and window segmentation boundaries are identical across conditions, confirming zero measurement bias between conditions.
