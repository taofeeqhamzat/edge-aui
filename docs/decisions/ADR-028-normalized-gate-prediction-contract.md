# ADR-028: Normalized Gate Prediction and Policy Contract

- **Status:** Proposed
- **Date:** 2026-11-16
- **Related:** ADR-002, ADR-006, ADR-011, ADR-012, ADR-020, ADR-025, ADR-026, ADR-027

## 1. Context

The current gate interfaces return a candidate `InterventionCommand` directly:

- `FastGate.evaluate()` returns `{ matched, intervention?, pattern? }`;
- `SlowGate.infer()` returns `{ outcome?, intervention?, probabilities?, ... }`;
- `AdaptiveInferenceEngine` short-circuits the Slow Gate when the Fast Gate returns a non-`no_op`
  intervention;
- `InterventionPolicy.accept()` consumes the command, then applies confidence/persistence/
  context/cooldown/TTL gates.

This cannot support the milestone requirement that both gates produce outcomes consumable by one
policy layer. It also prevents the policy from mapping an outcome to an intervention independently
of the gate, and couples gate tests to intervention tests.

Quality Assessment 2 also records that Fast Gate patterns are not aligned with the intended task
paths and that the learned head currently predicts interventions rather than task outcomes.

## 2. Problem

What is the shared result contract between Fast Gate, Slow Gate, arbitration and policy, and where
does the intervention decision live?

## 3. Options considered

| Option | Description | Problem |
| --- | --- | --- |
| A. Gates continue to return interventions | Policy only gates a command | No shared outcome contract; policy mapping lives in gates |
| **B. Normalized prediction + policy mapping** | Both gates return a predicted outcome/confidence; arbitration selects; testbed policy maps to a candidate intervention; generic policy gates it | Slight refactor; best fit with the requirement |
| C. Two separate policy paths | Fast and Slow have separate contracts | Duplication; no common arbitration/policy |

## 4. Evidence available

**Verified**

- The current interfaces and `AdaptiveInferenceEngine` are intervention-centric.
- The existing generic policy already handles confidence, persistence, cooldown, dismissal, TTL and
  context eligibility; it is reusable.
- The Slow Gate's ONNX output is currently a five-class intervention logits vector.
- The foundation head is seven-class generic; the semantic head does not exist yet.
- The testbed Fast Gate patterns map directly to intervention types.

**Not measured**

- Whether the semantic head's confidence calibration supports a 0.75 threshold; this is Phase 4B.
- Whether both gates can share one confidence scale (fast match strength vs slow probability); the
  contract allows different semantics but requires explicit provenance.

## 5. Decision required

The gate result contract, arbitration responsibilities, and the boundary between outcome prediction
and intervention policy.

## 6. Decision

**Adopt Option B.**

Define a gate-agnostic `PredictionResult`:

```ts
interface PredictionResult {
  predictionId: string;
  outcomeId: string;
  outcomeVocabularyVersion: string;
  confidence?: number;
  source: 'fast' | 'slow';
  matched: boolean;
  targetComponentId?: string;
  contextRef?: { route?: string; taskId?: string; taskStepId?: string };
  timestamp: number;
  pattern?: string[];
  mappingSource?: 'learned_head' | 'deterministic_mapping' | 'fast_gate_pattern';
}
```

- Fast Gate maps a matched pattern to an outcome prediction (application-supplied mapping) and
  carries pattern/confidence provenance.
- Slow Gate maps configured logits to the same outcome prediction and carries model/vocabulary
  provenance.
- Arbitration evaluates Fast first, Slow on miss, and returns the selected normalized result or a
  no-match result. It does not translate DOM selectors or task definitions.
- The testbed supplies an outcome→intervention policy: `(PredictionResult, UIContext) ->
  InterventionCommand | no_op`.
- The generic policy applies confidence/persistence/context/cooldown/dismissal/TTL/limit gates to
  the candidate command.
- The actuator consumes only the final intervention command.

The old intervention-head artifact remains loadable as a compatibility/ablation source. Its
intervention logits can be mapped to a candidate command through a configured compatibility policy;
it is not the semantic contract.

## 7. Consequences

- Gate tests and policy tests become independently testable.
- Fast Gate patterns can be evaluated as predictions even when the policy suppresses assistance.
- The Slow Gate's vocabulary/dimension is configuration/manifest-driven, not hardcoded.
- The policy gains a testbed-specific mapping module; the framework policy remains generic.
- Fast match strength and Slow probability are both called `confidence` but must carry provenance;
  do not compare them numerically without a calibration decision.
- The trace records the normalized predicted outcome in addition to the intervention command.

## 8. What is being deferred

> **Decision:** Whether the old five-class intervention head remains in production as a second
> candidate source after the semantic head is validated.
> **Deferred until:** Semantic-head evaluation and a payload/latency measurement with both graphs.
> **Reason:** Keeping both heads is useful for comparison but adds payload and a second decision
> path that could produce conflicting candidates.
> **Current workaround:** The old artifact remains loadable and reproducible; production selects the
> semantic head through configuration once validated.
> **Risk:** Medium — a dual-head production path could produce ambiguous policy input.
> **Evidence required to revisit:** Measured payload/latency and a semantic-head evaluation that
> supports a single production source.

## 9. Conditions that would force this decision to be revisited

- Fast Gate match strength and Slow Gate probability cannot be made comparable enough for one
  policy threshold.
- The testbed needs gate-specific policy behavior that the normalized result cannot express.
- The semantic head cannot be integrated without retaining the intervention head as the primary
  production path.
- Arbitration cannot preserve enough provenance for the analysis.
