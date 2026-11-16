# Workstream 20 — Framework Contracts, Semantic Outcomes and Trace 1.4

## Objective

Make Edge-AUI interface-agnostic while adding the shared semantic outcome contract:

- both gates produce the same normalized prediction contract;
- application macro vocabulary, context encoding, pattern maps, outcome vocabulary and target
  resolution are supplied by integration/configuration;
- canonical event normalization and semantic outcome derivation are separated from generic event
  collection;
- trace schema 1.4.0 carries semantic task outcomes and task-definition version additively.

The testbed must remain one integration of the framework, not its definition.

## Current state

- `src/macro/symbols.ts` hardcodes testbed IDs and symbols.
- `src/types/contextVector.ts` hardcodes five routes and T1–T3 step counts.
- `src/runtime/boot.ts` owns testbed Fast Gate patterns.
- `src/gates/slow/onnxSlowGate.ts` hardcodes generic outcome order and five-class intervention
  order.
- Fast/Slow gates return intervention commands; arbitration short-circuits on an intervention;
  policy consumes the command directly.
- `OutcomeDeriver` ignores `change`/`input`/`submit`, labels button clicks as `FORM_SUBMIT` and
  `blur` as `BACKTRACK`.
- `src/intervention/actuator.ts` hardcodes the `filter-drawer` simplify target.
- Trace schema is 1.3.0 with no semantic outcome or task-definition version.

## Task index and order

| Order | Task | Description | Depends on | Scope |
| --- | --- | --- | --- | --- |
| 1 | [20.1](tasks/20.1-normalized-prediction-contract.md) | Normalized prediction/gate/policy contract | 10.1 | Medium |
| 2 | [20.2](tasks/20.2-application-vocabulary-boundary.md) | Macro mapper, context encoding, boot pattern injection | 10.1, 10.2 | Medium |
| 3 | [20.3](tasks/20.3-configurable-gate-vocabularies.md) | Configurable Slow Gate vocabulary; Fast Gate pattern→outcome map | 20.1, 20.2 | Medium |
| 4 | [20.4](tasks/20.4-semantic-derivation-and-canonicalization.md) | Canonical actions, semantic outcome rules, backtracking | 10.6, 20.1 | Medium |
| 5 | [20.5](tasks/20.5-trace-schema-1.4-and-actuator-resolver.md) | Trace 1.4 fields/validation/recorder; actuator target resolver | 20.1, 20.2, 20.4 | Medium |

## Dependency notes

- 20.1 can start once 10.1 stabilises IDs; it is independent of the UI task work.
- 20.2 must not break the existing testbed; keep a compatibility adapter while moving vocabularies.
- 20.3 depends on the configuration surface from 20.2.
- 20.4 reuses the canonical action rules from 10.6; do not implement a second dedupe path.
- 20.5 is last so the schema captures the final field names (Decision 6) and the resolution contract.

## Checkpoints

| After | Checkpoint |
| --- | --- |
| 20.2 | Second-adapter boundary test passes; no testbed route/task/macro vocabulary remains in core |
| 20.5 | Gate contract, semantic derivation and schema 1.4 round-trip pass; 1.3 remains readable |

## Exit criteria

- [ ] A second mock adapter with a different route/task/outcome vocabulary works without editing
      framework core source.
- [ ] Framework core contains no `Analytics`, `Reports`, `TD1`–`TD4`, `btn-export`, `filter-drawer`
      or semantic outcome ID as a required value.
- [ ] Both gates return the normalized prediction contract; arbitration/policy consume it.
- [ ] Semantic outcomes are derived from committed/canonical events, not hover/substring heuristics.
- [ ] Backtracking is route-level, seeded from the starting page, and does not classify blur,
      accordion collapse or filter edits.
- [ ] Trace 1.4 validates, 1.3 remains readable, and the recorder carries semantic outcomes/task
      version.
- [ ] Actuator resolves application-provided targets; missing target fails safely.
- [ ] Existing tests still pass; new contract/second-adapter tests pass.

## Verification

```bash
cd edge-aui-framework
npm test
npm run typecheck
npm run parity:check
```

## Risks

| Risk | Mitigation |
| --- | --- |
| Cross-cutting refactor breaks the 1.3.0 runtime | Keep compatibility shims; run the existing suite per task |
| Boundary move creates a second vocabulary source | One `MacroMapper`/`ContextEncodingConfig` supplied by the testbed |
| Semantic rule duplicates task logic | Derive from canonical events; task predicates consume the resulting state |
| Schema 1.4 breaks ingestion | Additive fields, versioned allowlist, legacy tests |
