# Task List: Phases F, G, and I Implementation

Tracks the implementation of Phases F, G, and I from `docs/plan/1/model-preparation-adaptive-intervention-integration-and-deployable-participant-pipeline-plan.md`.

---

## Phase F: Runtime Integration of `TargetInterventionHead`

- [x] **Task F1 (5.2): Runtime UIContext → Head Input Path and Redaction Tests**
  - Wire `UIContext` from adapter through worker to `OnnxSlowGate` as normalized $R^6$ tensor.
  - Implement form fixture with sentinel string (`SENTINEL_SECRET_DO_NOT_LEAK_XYZ123`) proving zero field value leakage in tensors, traces, or logs (ADR-010 Guarantee 1).
  - Implement test proving zero network primitives are reachable or called during telemetry processing (ADR-010 Guarantee 2).
  - Document identifier linkability in `docs/data_schemas.md`.
  - *Verification:* `npm test tests/context_redaction.test.ts` & `npm test tests/context_vector.test.ts`.

- [x] **Task F2 (5.3): Trace Schema 1.2.0 Bump & Mapping Attribution**
  - Bump trace schema version to `1.2.0` in `src/telemetry/traceSchema.ts`, `src/telemetry/events.ts`, and `docs/data_schemas.md`.
  - Add `mappingSource` (`learned_head`, `deterministic_mapping`, `fast_gate_pattern`) to `InterventionEvent` and `InterventionCommand`.
  - Add `modelVersion` and `contextEncodingVersion` to `PredictionEvent`.
  - Add backward compatibility in `validateExperimentTrace` for schema `1.1.0`.
  - Add programmatic distinction tests between learned and deterministic interventions.
  - *Verification:* `npm test tests/trace_mapping_attribution.test.ts` & `npm test tests/telemetry_session_recorder.test.ts`.

- [x] **Task F3 (6.1): Dual-Gate Arbitration & Routing Verification**
  - Implement independent gate latency tracking (`fastGateLatencyMs`, `slowGateLatencyMs`) in `AdaptiveInferenceEngine` (`src/gates/arbitration.ts`).
  - Capture all eight §13 causal chain fields in prediction events.
  - Verify Fast Gate match short-circuits Slow Gate, and Fast Gate miss invokes Slow Gate.
  - Verify ablation arm (`useDeterministicMapping: true`) routes via `deterministic_mapping`.
  - Document evidence in `docs/assessments/gate-routing-evidence.md`.
  - *Verification:* `npm test tests/gate_arbitration.test.ts` & `npm test tests/gate_routing_evidence.test.ts`.

### Checkpoint F: Runtime Integration Complete
- [x] Dual-model execution operational with live $R^6$ context tensor.
- [x] Zero form leakage and zero network egress verified by test.
- [x] Schema `1.2.0` traces attribute intervention mapping source.
- [x] Fast / Slow gate arbitration verified with per-gate latencies and causal chain.
- [x] `npm test` and `npm run typecheck` passing.

---

## Phase G: Baseline / Adaptive Validation

- [x] **Task G1 (6.3): Trace Attribution and Completeness Verifiers**
  - Implement reusable trace verifier in `src/telemetry/traceAttributionVerifier.ts` and CLI script `scripts/verify-trace.mjs`.
  - Support schema `1.2.0` and verify the eight §14 structural and attribution invariants.
  - Provide detailed check-by-check failure reporting.
  - Create comprehensive tests with valid traces and deliberate negative fixtures in `tests/trace_attribution_verifier.test.ts`.
  - *Verification:* `npm test tests/trace_attribution_verifier.test.ts`.

- [x] **Task G2 (6.2): Controlled Baseline vs Adaptive Trace Comparison**
  - Execute controlled runs for Baseline (Condition A) and Adaptive (Condition B) over tasks T1–T3.
  - Export trace artifacts `docs/experiments/baseline-trace.json` and `docs/experiments/adaptive-trace.json`.
  - Create CLI comparison script `scripts/compare-condition-traces.mjs --baseline <path> --adaptive <path>`.
  - Author comparison report `docs/experiments/condition-comparison.md` affirming baseline zero-mutation and adaptive intervention execution without unwarranted usability claims.
  - Implement automated test `tests/condition_trace_comparison.test.ts`.
  - *Verification:* `node scripts/compare-condition-traces.mjs ...` & `npm test tests/condition_trace_comparison.test.ts`.

### Checkpoint G: Controlled Comparison Complete
- [x] Trace attribution verifier validates both baseline and adaptive traces.
- [x] Controlled comparison demonstrates zero DOM adaptation in baseline and active adaptations in adaptive.
- [x] Trace schemas and event structures match across conditions.
- [x] Report completed without usability overclaims.

---

## Phase I: Consolidation

- [x] **Task I1 (8.1): Participant-Readiness Gap Report**
  - Author `docs/assessments/participant-readiness.md` evaluating all 18 readiness conditions from brief §23.
  - Assign strict evidence labels (`Measured`, `Verified by automated test`, `Inferred`, `Not measured`, `Deferred`, `Blocked`).
  - Report standing targets (`< 500 KB` payload, `< 20 MB` memory, `< 50 ms` latency) as `Met` or `Not met` using real measured figures from runtime benchmarks.
  - Document all deferred deployment items (ADR-014 D1–D7) honestly.
  - *Verification:* Review `docs/assessments/participant-readiness.md`.

- [x] **Task I2 (8.2): ADR Register Reconciliation & Consistency Test**
  - Audit and reconcile `ADR-001` through `ADR-014` in `docs/decisions/` with current statuses, dates, and decision records.
  - Standardize all deferment blocks into the required 6-field structure.
  - Implement `tests/adr_register_consistency.test.ts` to enforce register integrity and cross-reference with ADR-014.
  - *Verification:* `npm test tests/adr_register_consistency.test.ts`.

- [x] **Task I3 (8.3): Final Report and Architecture Doc Rebase**
  - Author the 10-section final project report in `docs/assessments/final-report.md`.
  - Rebase `docs/architecture.md` onto the actual implemented architecture (delayed settlement, TS vectorizer, UI adapter boundary, TargetInterventionHead execution, schema 1.2.0, dual-gate arbitration).
  - Verify full automated suite, test counts, type safety, and parity checks.
  - *Verification:* `npm test`, `npm run typecheck`, `npm run parity:check`, `npm run build`.

### Checkpoint I: Complete
- [x] All acceptance criteria met across Phases F, G, and I.
- [x] Gap report, ADR register, final report, and architecture docs fully aligned.
- [x] All tests passing with zero regressions (451/451 total tests passing).
- [x] Ready for human review.
