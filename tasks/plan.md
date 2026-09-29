# Implementation Plan: Execution of Phases F, G, and I

Operationalizes Phases F, G, and I of `docs/plan/1/model-preparation-adaptive-intervention-integration-and-deployable-participant-pipeline-plan.md` for the `edge-aui-framework` repository.

## Overview

This plan details the implementation path for:
1. **Phase F — Runtime Integration of `TargetInterventionHead`**: Connecting the exported PyTorch/ONNX intervention head (`intervention_head_int8.onnx`) into the edge runtime, wiring `UIContext` securely to $R^6$ with automated privacy and redaction guarantees (ADR-010), bumping trace schema to version `1.2.0` with explicit attribution of intervention sources (`learned_head`, `deterministic_mapping`, `fast_gate_pattern`), and instrumenting independent per-gate latency tracking and causal routing verification.
2. **Phase G — Baseline / Adaptive Validation**: Building automated trace completeness and attribution verifiers (`verify-trace.mjs`), executing controlled condition comparisons (Baseline Condition A vs Adaptive Condition B) on identical task sequences (T1–T3), exporting verifiable traces (`baseline-trace.json`, `adaptive-trace.json`), and producing comparative analysis without unfounded usability claims.
3. **Phase I — Consolidation**: Performing a rigorous participant-readiness gap assessment across all brief §23 criteria with evidence labels, reconciling the Architecture Decision Record (ADR) register (`ADR-001` through `ADR-014`) with automated consistency tests, authoring the final 10-section project report, and rebasing `docs/architecture.md` onto the actual deployed architecture.

---

## Architectural Context & Decisions

- **Single Source of Truth:** `model-preparation/src/config.yaml` remains the single source of truth for windowing, feature order, scale constants, and outcome taxonomy.
- **Privacy by Construction (ADR-010):** No telemetry or form field values are egressed or stored on remote servers. Guarantees (no field values captured, zero network calls from telemetry) are enforced by automated test suites.
- **Attribution & Transparency (ADR-006):** Every intervention episode recorded in traces explicitly identifies its generative mechanism (`learned_head` vs `deterministic_mapping` vs `fast_gate_pattern`).
- **Separation of Concerns:** The deterministic Fast Gate (PrefixSpan pattern matcher) executes first. On cache miss, the probabilistic Slow Gate (ONNX GRU + `TargetInterventionHead`) evaluates. Gate latencies are recorded independently (ADR-003).
- **Evidence Discipline:** All performance, memory, and latency metrics must be measured with honest labels (`Measured`, `Verified by automated test`, `Deferred`, `Not measured`, `Blocked`). No fabricated benchmarks.

---

## Task Dependency Graph

```text
Phase F: Runtime Integration
  ├── Task F1 (5.2): UIContext wiring & redaction tests [Gated on ADR-010 Accepted]
  ├── Task F2 (5.3): Trace schema 1.2.0 & mapping attribution [Depends on 5.1, F1]
  └── Task F3 (6.1): Fast/Slow dual-gate routing & per-gate latency [Depends on F2]
         │
         ▼
Phase G: Baseline/Adaptive Validation
  ├── Task G1 (6.3): Trace attribution & completeness verifier [Depends on F2]
  └── Task G2 (6.2): Controlled baseline vs adaptive trace comparison [Depends on F3, G1]
         │
         ▼
Phase I: Consolidation
  ├── Task I1 (8.1): Participant-readiness gap report [Depends on G2]
  ├── Task I2 (8.2): ADR register reconciliation & consistency test [Depends on I1]
  └── Task I3 (8.3): Final report & architecture doc rebase [Depends on I2]
```

---

## Task List

### Phase F: Runtime Integration of `TargetInterventionHead`

#### Task F1 (Plan Task 5.2): Runtime UIContext → Head Input Path and Redaction Tests
- **Repo:** `edge-aui-framework`
- **Description:** Wire `UIContext` from the integration adapter through the worker runtime to `OnnxSlowGate`, ensuring the normalized $R^6$ context tensor is passed to the ONNX session without data loss. Implement an automated redaction test suite proving ADR-010 guarantees: (1) no form field values or sentinel strings appear in serialized tensors, traces, logs, or exports; (2) no network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, external `postMessage`) are reachable or invoked during telemetry capture or trace export. Document identifier linkability in `docs/data_schemas.md`.
- **Acceptance Criteria:**
  - [ ] `UIContext` snapshot reaches the `OnnxSlowGate` and converts deterministically to the $R^6$ context vector matching `tests/context_vector.test.ts`.
  - [ ] A form fixture containing a unique sentinel string (`SENTINEL_SECRET_DO_NOT_LEAK_XYZ123`) is processed through full observation, windowing, inference, and trace export, with zero occurrences of the sentinel anywhere in output traces or logs.
  - [ ] No-egress test verifies that zero network calls occur across telemetry ingestion and trace generation.
  - [ ] `docs/data_schemas.md` documents all trace identifiers and their linkability.
- **Verification:**
  - [ ] `npm test tests/context_redaction.test.ts`
  - [ ] `npm test tests/context_vector.test.ts`
  - [ ] `npm test`
- **Dependencies:** Task 5.1 (completed), ADR-010 (accepted).
- **Files Touched:**
  - `src/runtime/adaptiveRuntime.ts`
  - `src/runtime/worker/core.ts`
  - `src/types/contextVector.ts`
  - `docs/data_schemas.md`
  - `tests/context_redaction.test.ts`
- **Estimated Scope:** Medium (5 files)

#### Task F2 (Plan Task 5.3): Trace Schema 1.2.0 Bump & Mapping Attribution
- **Repo:** `edge-aui-framework`
- **Description:** Extend the experiment trace schema to version `1.2.0` so each intervention episode explicitly records its `mappingSource` (`learned_head`, `deterministic_mapping`, or `fast_gate_pattern`). Record `modelVersion` and `contextEncodingVersion` on prediction events for provenance tracking. Ensure `validateExperimentTrace` supports schema `1.2.0` while gracefully handling `1.1.0` traces with clear migration guidance, rejecting unsupported versions with actionable errors. Provide programmatic distinction between learned and deterministic interventions.
- **Acceptance Criteria:**
  - [ ] Schema version constant updated to `1.2.0`.
  - [ ] `InterventionEvent` and `InterventionCommand` carry `mappingSource?: 'learned_head' | 'deterministic_mapping' | 'fast_gate_pattern'`.
  - [ ] `PredictionEvent` carries `modelVersion?: string` and `contextEncodingVersion?: string`.
  - [ ] `validateExperimentTrace` handles `1.2.0` traces and provides backwards compatibility or migration errors for `1.1.0`.
  - [ ] Programmatic test asserts traces with learned-head vs deterministic interventions are distinguishable.
  - [ ] `docs/data_schemas.md` documents the `1.2.0` schema updates and migration notes.
- **Verification:**
  - [ ] `npm test tests/trace_mapping_attribution.test.ts`
  - [ ] `npm test tests/telemetry_session_recorder.test.ts`
- **Dependencies:** Task 5.1, Task F1.
- **Files Touched:**
  - `src/telemetry/events.ts`
  - `src/telemetry/traceSchema.ts`
  - `src/telemetry/recorder.ts`
  - `src/intervention/types.ts`
  - `docs/data_schemas.md`
  - `tests/trace_mapping_attribution.test.ts`
- **Estimated Scope:** Medium (6 files)

#### Task F3 (Plan Task 6.1): Dual-Gate Arbitration & Routing Verification
- **Repo:** `edge-aui-framework`
- **Description:** Implement independent gate latency measurement (`fastGateLatencyMs` and `slowGateLatencyMs`) in `AdaptiveInferenceEngine` (`src/gates/arbitration.ts`). Ensure prediction events capture all eight §13 fields: selected gate, gate latency, confidence, prediction, policy decision, intervention, actuator result, and task state. Verify that a Fast Gate match short-circuits the Slow Gate, while a Fast Gate miss invokes the Slow Gate. Confirm that the `useDeterministicMapping` ablation arm routes through the baseline fallback. Document evidence in `docs/assessments/gate-routing-evidence.md`.
- **Acceptance Criteria:**
  - [ ] Fast Gate match short-circuits Slow Gate (`matchedGate: 'fast'`, `fastGateLatencyMs` recorded, Slow Gate not evaluated).
  - [ ] Fast Gate miss invokes Slow Gate (`matchedGate: 'slow'`, both `fastGateLatencyMs` and `slowGateLatencyMs` recorded).
  - [ ] All eight §13 causal chain fields are populated and reconstructable.
  - [ ] Ablation arm (`useDeterministicMapping: true`) routes via `deterministic_mapping`.
  - [ ] Contract tests pass and assessment report is created with verified numbers.
- **Verification:**
  - [ ] `npm test tests/gate_arbitration.test.ts`
  - [ ] `npm test tests/gate_routing_evidence.test.ts`
  - [ ] `npm run build`
- **Dependencies:** Task F2.
- **Files Touched:**
  - `src/gates/arbitration.ts`
  - `src/runtime/adaptiveRuntime.ts`
  - `src/runtime/worker/core.ts`
  - `tests/gate_routing_evidence.test.ts`
  - `docs/assessments/gate-routing-evidence.md`
- **Estimated Scope:** Medium (5 files)

---

### Checkpoint F: Runtime Integration Complete
- [ ] Intervention-head graph executes with live $R^6$ context tensor in worker.
- [ ] Automated redaction tests prove zero form field leakages and zero telemetry egress.
- [ ] Trace schema `1.2.0` deployed with explicit intervention `mappingSource`.
- [ ] Dual-gate arbitration verified with independent latency metrics and causal logging.
- [ ] Full test suite green (`npm test`), types clean (`npm run typecheck`).

---

### Phase G: Baseline / Adaptive Validation

#### Task G1 (Plan Task 6.3): Trace Attribution and Completeness Verifiers
- **Repo:** `edge-aui-framework`
- **Description:** Finalize the reusable trace verifier in `src/telemetry/traceAttributionVerifier.ts` and CLI script `scripts/verify-trace.mjs` to validate schema `1.2.0` and the eight §14 structural and attribution properties. Ensure per-check defect reporting (`{ valid, checks, errors }`), support CLI execution (`node scripts/verify-trace.mjs <path>`), and write thorough tests covering valid traces as well as deliberate malformations for every check.
- **Acceptance Criteria:**
  - [ ] Verifier verifies: unbroken correlation IDs, expected task lifecycle events, window-to-outcome mapping, terminal intervention states, baseline zero adaptations, and schema `1.2.0` conformity.
  - [ ] CLI script outputs structured status and human-readable defect reports.
  - [ ] Unit test suite includes negative fixtures for each check proving checks fail when invariants are violated.
- **Verification:**
  - [ ] `npm test tests/trace_attribution_verifier.test.ts`
- **Dependencies:** Task F2.
- **Files Touched:**
  - `src/telemetry/traceAttributionVerifier.ts`
  - `scripts/verify-trace.mjs`
  - `tests/trace_attribution_verifier.test.ts`
- **Estimated Scope:** Medium (3 files)

#### Task G2 (Plan Task 6.2): Controlled Baseline vs Adaptive Trace Comparison
- **Repo:** `edge-aui-framework`
- **Description:** Execute controlled comparative trials for Condition A (Baseline) and Condition B (Adaptive) over identical task sequences (T1–T3). Export traces to `docs/experiments/baseline-trace.json` and `docs/experiments/adaptive-trace.json`. Build CLI comparison utility `scripts/compare-condition-traces.mjs` to evaluate trace structural parity, event completeness, and adaptation divergence. Author `docs/experiments/condition-comparison.md` documenting trial order, baseline zero mutations, and adaptive intervention episodes, explicitly disclaiming usability conclusions.
- **Acceptance Criteria:**
  - [ ] Exported traces exist for baseline and adaptive conditions with identical task sets, same build, and schema `1.2.0`.
  - [ ] Baseline trace has zero actuator mutations / applied interventions; adaptive trace contains valid intervention episodes.
  - [ ] Both traces pass `scripts/verify-trace.mjs`.
  - [ ] `scripts/compare-condition-traces.mjs` produces side-by-side metric comparison.
  - [ ] `docs/experiments/condition-comparison.md` documents trial order and avoids unsubstantiated usability claims.
  - [ ] `tests/condition_trace_comparison.test.ts` automates comparison script validation.
- **Verification:**
  - [ ] `node scripts/compare-condition-traces.mjs --baseline docs/experiments/baseline-trace.json --adaptive docs/experiments/adaptive-trace.json`
  - [ ] `npm test tests/condition_trace_comparison.test.ts`
- **Dependencies:** Task F3, Task G1.
- **Files Touched:**
  - `scripts/compare-condition-traces.mjs`
  - `docs/experiments/baseline-trace.json`
  - `docs/experiments/adaptive-trace.json`
  - `docs/experiments/condition-comparison.md`
  - `tests/condition_trace_comparison.test.ts`
- **Estimated Scope:** Medium (5 files)

---

### Checkpoint G: Controlled Comparison Complete
- [ ] Reusable verifier validates trace integrity and attribution for both conditions.
- [ ] Controlled comparison script executed on real exported traces.
- [ ] Baseline condition proves zero DOM mutation; Adaptive condition proves active interventions.
- [ ] No usability improvement claimed from this engineering check.

---

### Phase I: Consolidation

#### Task I1 (Plan Task 8.1): Participant-Readiness Gap Report
- **Repo:** `edge-aui-framework`
- **Description:** Produce the comprehensive gap assessment report in `docs/assessments/participant-readiness.md` evaluating all 18 readiness conditions from brief §23. Label each condition strictly using the six standard tags (`Measured`, `Verified by automated test`, `Inferred`, `Not measured`, `Deferred`, `Blocked`). Report the three standing architectural targets (`< 500 KB` payload, `< 20 MB` memory, `< 50 ms` latency) as `Met` or `Not met` using measured figures from Phase C runtime benchmarks (`docs/benchmarks/runtime-benchmark.md`) and bundle inspections. Identify all deferred participant deployment items (ADR-014 D1–D7) without overclaiming.
- **Acceptance Criteria:**
  - [ ] All 18 brief §23 conditions appear in `docs/assessments/participant-readiness.md` with explicit verdicts and labels.
  - [ ] Standing targets (`< 500 KB` payload, `< 20 MB` memory, `< 50 ms` latency) evaluated against real measurements and marked `Met` or `Not met`.
  - [ ] Every deferred item links to its corresponding ADR and closure condition.
  - [ ] Honest verdict stated regarding participant-readiness status.
- **Verification:**
  - [ ] Manual inspection of `docs/assessments/participant-readiness.md` verifying all §23 items and evidence citations.
- **Dependencies:** Task G2.
- **Files Touched:**
  - `docs/assessments/participant-readiness.md`
- **Estimated Scope:** Small (1 file)

#### Task I2 (Plan Task 8.2): ADR Register Reconciliation & Consistency Test
- **Repo:** `edge-aui-framework`
- **Description:** Reconcile all Architecture Decision Records (`ADR-001` through `ADR-014`) in `docs/decisions/` to reflect their actual current status (`Accepted`, `Superseded`, `Deprecated`, `Proposed`) and decision dates. Ensure all deferment blocks conform to the standard 6-field format (Decision, Deferred until, Reason, Current workaround, Risk, Evidence required to revisit). Implement an automated test `tests/adr_register_consistency.test.ts` to parse all ADRs, verify status validity, check internal link integrity, and cross-reference deferments against `ADR-014`.
- **Acceptance Criteria:**
  - [ ] All 14 ADRs have accurate statuses, dates, and decision records.
  - [ ] Every deferment block across all ADRs contains all 6 required fields.
  - [ ] `tests/adr_register_consistency.test.ts` validates that all ADR files parse, statuses are valid, and deferments match ADR-014.
- **Verification:**
  - [ ] `npm test tests/adr_register_consistency.test.ts`
- **Dependencies:** Task I1.
- **Files Touched:**
  - `docs/decisions/*.md`
  - `tests/adr_register_consistency.test.ts`
- **Estimated Scope:** Medium (ADR files + 1 test file)

#### Task I3 (Plan Task 8.3): Final Report and Architecture Doc Rebase
- **Repo:** `edge-aui-framework`
- **Description:** Author the definitive 10-section final report in `docs/assessments/final-report.md` adhering to brief §24. Update and rebase `docs/architecture.md` onto the actual implemented system, detailing the delayed-settlement windowing (Task 1.2), TypeScript vectorizer (Task 2.5), UI adapter boundary (Task 3.4/4.1), TargetInterventionHead dual-graph execution (Task 5.1/5.2), schema `1.2.0` attribution (Task 5.3), and dual-gate arbitration (Task 6.1). Record exact test counts, benchmark measurements, and python parity validation.
- **Acceptance Criteria:**
  - [ ] `docs/assessments/final-report.md` contains all 10 required sections without placeholders.
  - [ ] `docs/architecture.md` reflects all implemented components, interface contracts, and architectural divergences.
  - [ ] Full test suite passes (`npm test`), parity check passes (`npm run parity:check`), types clean (`npm run typecheck`).
  - [ ] All internal documentation links resolve.
- **Verification:**
  - [ ] `npm test`
  - [ ] `npm run typecheck`
  - [ ] `npm run parity:check`
  - [ ] `npm run build`
- **Dependencies:** Task I2.
- **Files Touched:**
  - `docs/assessments/final-report.md`
  - `docs/architecture.md`
- **Estimated Scope:** Medium (2 files)

---

### Checkpoint I: Consolidation Complete
- [ ] Participant-readiness gap report completed with truthful labels.
- [ ] ADR register fully reconciled and validated by automated test.
- [ ] Final 10-section report completed.
- [ ] Architecture documentation rebased and fully aligned with implementation.
- [ ] Ready for human review.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Form field data leaks into telemetry or trace | High (Privacy/Ethics violation) | Task F1 introduces strict sentinel-string redaction tests in `tests/context_redaction.test.ts` asserting 0 occurrences across all outputs. |
| Schema bump breaks existing trace analysis | Medium (Backwards incompatibility) | Task F2 implements backward compatibility in `validateExperimentTrace` for schema `1.1.0` with actionable error diagnostics. |
| Slow Gate inference confidence remains below policy threshold | Medium (Intervention does not fire live) | Task F3/6.1 captures the raw logits distribution; Task 6.1 logs the exact confidence vs threshold comparison without artificially lowering thresholds. |
| Baseline trace inadvertently mutates DOM | High (Invalidates experimental contrast) | Task G1/G2 verifier strictly asserts 0 actuator events / DOM modifications for baseline condition traces. |
| Overclaiming participant deployment readiness | High (Academic rigor violation) | Task I1 enforces strict brief §18 labeling (`Measured`, `Verified by automated test`, `Deferred`, `Not measured`, `Blocked`) and cites ADR-014 for all deferred items. |
