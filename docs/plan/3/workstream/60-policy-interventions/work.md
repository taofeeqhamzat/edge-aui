# Workstream 60 — Policy and Intervention Refinement

## Objective

Turn normalized semantic predictions into conservative, correctly targeted, non-disruptive
interventions, and verify them functionally and visually.

The outcome→intervention mapping is testbed configuration. The framework policy remains generic
(confidence, persistence, context eligibility, cooldown, dismissal, TTL, limits).

## Current state

- Generic policy and actuator exist with five intervention types.
- The policy consumes an intervention command, not a normalized predicted outcome (Workstream 20
  changes this).
- The testbed has no outcome→intervention mapping for the semantic vocabulary.
- `simplify_options` hardcodes `filter-drawer`; target resolution is permissive/fallback-prone.
- Verification exists for some unit/actuator paths but not a complete visual matrix for TD1–TD4.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [60.1](tasks/60.1-outcome-policy-and-target-resolution.md) | Testbed policy mapping, generic gates, target resolver, missing-target behavior | 20.1, 20.4, 40.4, 50.3 | Medium |
| 2 | [60.2](tasks/60.2-intervention-verification-and-refinement.md) | Functional/visual verification for all in-scope interventions | 60.1 | Medium |

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 60.1 | Outcome policy/target resolver tests pass; baseline inert; missing target safe |
| 60.2 | Every in-scope intervention functionally and visually verified; evidence report complete |

## Exit criteria

- [ ] Outcome→intervention mapping is conservative and testbed-owned.
- [ ] Confidence/persistence/context/cooldown/dismissal/TTL/limits prevent repetitive or
      inappropriate assistance.
- [ ] Targets resolve through the application resolver; missing target records failure and mutates
      nothing.
- [ ] All in-scope intervention types are functionally and visually verified; baseline is inert.
- [ ] No layout shift, focus theft or accessibility-tree damage.
- [ ] The report distinguishes visually verified from source/unit-only claims.
- [ ] No claim of user benefit or improved task performance without a study.

## Verification

```bash
cd edge-aui-framework
npm test -- tests/intervention_policy.test.ts tests/actuator.test.ts tests/policy_cooldown_ttl.test.ts
npm run typecheck
```

Visual checks use the deployed/preview app and screenshots; record viewport and browser.

## Risks

| Risk | Mitigation |
| --- | --- |
| Over-intervention | Conservative mapping; confidence/context/cooldown/TTL; per-task limit |
| Subtle highlight not noticeable | Visual verification at target viewport; consistent styling |
| Layout shift/focus theft | Functional assertions for focus/geometry; screenshot comparison |
| Wrong/missing target fallback | Validated resolver; fail safely; no random target |
