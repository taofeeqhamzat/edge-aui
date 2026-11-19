# Workstream 50 — Fast Gate, PrefixSpan and Shared Arbitration

## Objective

Harden the deterministic Fast Gate and complete the shared gate/arbitration contract after the
participant collection and target-head preparation phases.

The intended project order is:
task/testbed → participant collection → target-head retraining → Fast Gate hardening →
intervention refinement. This workstream therefore starts after Phase 4B.

## Current state

- The Rust/WASM PrefixSpan miner exists, is bounded by configuration and is exercised by tests.
- Quality Assessment 2 finding F-02 (PrefixSpan correctness) remains to be resolved.
- Pattern declarations are a `patternKey -> intervention` map in the testbed composition.
- Fast Gate patterns do not yet map to semantic outcomes.
- No-match behavior and confidence/strength semantics need explicit definition.
- Fast and Slow gates do not yet return a shared normalized prediction contract (Workstream 20
  provides the contract; this workstream validates it end to end).
- Participant-derived candidate patterns now exist: 159 contiguous 2–4 symbol n-grams at
  ≥3-session support, extracted from 35 verified participant sessions after collapsing
  duplicate macro events and excluding unreachable/misleading symbols
  (`model-preparation/docs/experiments/participant-patterns/`). The pattern set must be
  validated from this evidence, not from the scripted canonical paths (open decision #9).
- Assessment limitation #6 is only partly resolved. The semantic layer's exact-ID rule is in
  place, but the **macro** mapper still classifies `tooltip-region` as `SELECT_REGION`, emits
  `TABLE_ROW_SELECT` on non-selectable row hover, and has no producer for `BACKTRACK`,
  `IDLE_DWELL` or `RAPID_SCROLL`; `TABLE_PAGE_*`/`TABLE_SORT` are unreachable and
  `EXPAND_TOOLTIP` expands nothing visible. `RESET_FILTERS` and `OPEN_REPORT` are now produced by
  the WS10 controls. Status detail: plan §2.8.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [50.1](tasks/50.1-prefixspan-correctness-and-bounds.md) | PrefixSpan correctness, bounded execution and deterministic tests | 30.1, 40.4 | Medium |
| 2 | [50.2](tasks/50.2-pattern-semantics-and-semantic-mapping.md) | Pattern declaration, support/length, session isolation, semantic mapping, no-match | 50.1 | Medium |
| 3 | [50.3](tasks/50.3-shared-arbitration-and-performance.md) | Shared arbitration, provenance, no-match/fallback, performance/memory | 50.2 | Medium |

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 50.2 | PrefixSpan correctness and pattern semantics tests pass; no false canonical-path matches |
| 50.3 | Both gates return the shared contract; arbitration provenance and performance evidence pass |

## Exit criteria

- [ ] PrefixSpan correctness is covered by deterministic fixtures, including the F-02 cases.
- [ ] Pattern support/length/boundary/session semantics are explicit and tested.
- [ ] Patterns map to semantic outcomes, not only interventions.
- [ ] No-match and fallback behavior are explicit; no false/noisy matches on canonical task paths.
- [ ] Both gates produce the normalized prediction contract; arbitration selects and preserves
      provenance; policy consumes the result.
- [ ] Performance and memory on realistic sequences are measured and reported.

## Verification

```bash
cd edge-aui-framework
npm test -- tests/prefixspan_fast_gate.test.ts tests/fast_gate.test.ts tests/gate_arbitration.test.ts
npm run typecheck
```

## Risks

| Risk | Mitigation |
| --- | --- |
| Optimising before evidence | Start only after traces/target prep; use real task sequences |
| Changing the WASM boundary | Keep the existing miner boundary; fix semantics/tests around it |
| Pattern overfitting/noise | Require support/confidence and canonical-path negative tests |
| Contract mismatch with Slow Gate | Shared `PredictionResult` tests in 50.3 |
