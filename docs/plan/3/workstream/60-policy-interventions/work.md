# Workstream 60 — Policy and Intervention Refinement

## Objective

Turn normalized semantic predictions into conservative, correctly targeted, non-disruptive
interventions, and verify them functionally and visually.

The outcome→intervention mapping is testbed configuration. The framework policy remains generic
(confidence, persistence, context eligibility, cooldown, dismissal, TTL, limits).

## Current state

Recorded before the work, and updated after it.

| Before | After |
| --- | --- |
| Generic policy and actuator exist with five intervention types. | Unchanged in shape; one policy gate added (one adaptation per observed act). |
| The policy consumes an intervention command, not a normalized predicted outcome (Workstream 20 was to change this). | The policy consumes `PredictionResult`; the testbed adapter turns an outcome into a candidate command. |
| The testbed has no outcome→intervention mapping for the semantic vocabulary. | `src/testbed/config/policyAdapter.ts` declares a conservative semantic map; unmapped outcomes are decision-only `no_op`. |
| `simplify_options` has no configured target; target resolution is permissive/fallback-prone. | `src/testbed/config/interventionTargets.ts` declares the targets; the resolver is authoritative and permissive fallbacks are removed. |
| Verification exists for some unit/actuator paths but not a complete visual matrix. | Functional coverage for all five types on the rendered app, plus a 1440 × 900 visual matrix and a real-pipeline trace. See [`verification-report.md`](verification-report.md). |

## Task index and order

| Order | Task | Description | Depends on | Scope | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | [60.1](tasks/60.1-outcome-policy-and-target-resolution.md) | Testbed policy mapping, generic gates, target resolver, missing-target behavior | 20.1, 20.4, 40.4, 50.3 | Medium | Done |
| 2 | [60.2](tasks/60.2-intervention-verification-and-refinement.md) | Functional/visual verification for all in-scope interventions | 60.1 | Medium | Done |

## Checkpoints

| After | Checkpoint | Result |
| --- | --- | --- |
| 60.1 | Outcome policy/target resolver tests pass; baseline inert; missing target safe | Pass |
| 60.2 | Every in-scope intervention functionally and visually verified; evidence report complete | Pass — see [`verification-report.md`](verification-report.md) |

## Exit criteria

- [x] Outcome→intervention mapping is conservative and testbed-owned.
      `src/testbed/config/policyAdapter.ts`; unmapped outcomes are recorded as decision-only
      `no_op`.
- [x] Confidence/persistence/context/cooldown/dismissal/TTL/limits prevent repetitive or
      inappropriate assistance. The live run in the report found and fixed a gap: one act was
      re-adapted every cooldown period. `already_adapted` now suppresses it until a new act.
- [x] Targets resolve through the application resolver; missing target records failure and mutates
      nothing. Framework fallbacks removed; the actuator refuses an undeclared or unresolvable
      target and the runtime records `actuation_failed`.
- [x] All in-scope intervention types are functionally and visually verified; baseline is inert.
- [x] No layout shift, focus theft or accessibility-tree damage. Measured geometry and live focus
      checks in the report §5; rendered-app assertions in `tests/intervention_verification.test.tsx`.
- [x] The report distinguishes visually verified from source/unit-only claims.
- [x] No claim of user benefit or improved task performance without a study.

## Verification

```bash
cd edge-aui-framework
npm test -- tests/intervention_policy.test.ts tests/actuator.test.ts tests/policy_cooldown_ttl.test.ts
npm test -- tests/testbed_intervention_targets.test.ts tests/policy_adapter_wiring.test.ts
npm test -- tests/intervention_verification.test.tsx tests/trace_schema_1_4.test.ts
npm run typecheck
npx vitest run   # full suite; only the pre-existing experiment_condition environment failure remains
```

Visual checks used the preview dev build at 1440 × 900 in Chrome 157 (headless, CDP), with
screenshots and a trace capture recorded in
[`verification-report.md`](verification-report.md) and [`evidence/`](evidence/).

## What this workstream changed

| File | Change |
| --- | --- |
| `src/testbed/config/interventionTargets.ts` (new) | Declares the application targets (`primary-action`, `filter-options`), validates that an element can accept the adaptation, and refuses everything else. |
| `src/testbed/config/policyAdapter.ts` | Conservative semantic map; target from configuration or the prediction, never `activeComponentId`; no candidate when a required target is absent; participant-facing banner text. |
| `src/intervention/actuator.ts` | Every element-changing adaptation must declare a target; role/first-match fallbacks removed; `simplify_options` scoped to the declared surface; `expand_tooltip` requires the target's own text. |
| `src/intervention/policy.ts` | One adaptation per observed act (`already_adapted`); `notifyUserAction` re-arms the policy. |
| `src/intervention/styles.css` | Visible simplified-surface marker; tooltip anchored to its trigger, typography reset, pointer above the bubble. |
| `src/runtime/adaptiveRuntime.ts`, `src/runtime/boot.ts`, `src/main.tsx` | `targetResolver` threaded through the composition root; macro interactions notify the policy. |
| `src/telemetry/events.ts` | `already_adapted` rejection category. |
| `docs/architecture.md`, `docs/data_schemas.md` | The policy gate order, the target contract and the new rejection category. |
| Tests | `tests/testbed_intervention_targets.test.ts`, `tests/intervention_verification.test.tsx` (new); `tests/policy_cooldown_ttl.test.ts`, `tests/policy_adapter_wiring.test.ts`, `tests/actuator.test.ts`, `tests/trace_schema_1_4.test.ts` updated. |

## Verification record

- **Functional:** 30 new test cases across the two new files (19 policy/target, 11 rendered-UI),
  plus the updated policy/actuator suites. All pass.
- **Visual:** four intervention types captured at 1440 × 900 on the rendered testbed; exact
  restoration after dismissal measured at **0 differing pixels**; geometry and focus measured
  before/during/after.
- **Real pipeline:** one Fast Gate-driven `simplify_options` episode (`ep_1`, prediction
  `pred_6`) with `accepted → applied → reverted (ttl)` and no repeat while idle. Trace summary:
  [`evidence/real-pipeline-trace-summary.json`](evidence/real-pipeline-trace-summary.json).
- **Gaps:** CLS/TBT are **NOT MEASURED**; three visual captures used a synthetic prediction
  through the real decision chain; one browser and viewport. See the report §12.

## Risks

| Risk | Mitigation |
| --- | --- |
| Over-intervention | Conservative mapping; confidence/context/cooldown/TTL; per-task limit |
| Subtle highlight not noticeable | Visual verification at target viewport; consistent styling |
| Layout shift/focus theft | Functional assertions for focus/geometry; screenshot comparison |
| Wrong/missing target fallback | Validated resolver; fail safely; no random target |
