# ADR-029: Trace Schema 1.4.0, Semantic Outcomes and Task-Definition Versioning

- **Status:** Proposed
- **Date:** 2026-11-16
- **Related:** ADR-017, ADR-018, ADR-025, ADR-026, ADR-027, ADR-028

## 1. Context

Trace schema 1.3.0 provides a single epoch clock, policy decisions, prediction/window attribution,
provenance and bounded-execution evidence. It does not carry:

- a semantic task outcome;
- a semantic-outcome vocabulary version;
- a task-definition version;
- a `task_fail`/timeout lifecycle;
- a normalized predicted outcome (the prediction currently records the selected intervention and a
  generic `outcome`);
- a target context/contract version for the normalized gate result.

The approved milestone adds TD1–TD4, state-verified completion, timeout/failure, a semantic
outcome layer and a semantic target head. Model-preparation ingestion must accept the resulting
traces without silently changing the meaning of existing fields.

## 2. Problem

How does the trace carry the new evidence additively, how is the version owned cross-repository, and
how are old captures kept readable?

## 3. Options considered

| Option | Description | Problem |
| --- | --- | --- |
| A. Replace 1.3.0 fields | Repurpose `outcome`/target fields | Breaks legacy meaning and analysis |
| **B. Additive 1.4.0** | Add semantic/task/prediction fields; keep 1.3.0 readable | Two fields during transition; clean compatibility |
| C. Separate sidecar file | Semantic outcomes in a second file | Correlation burden; easy to lose; not a self-contained trace |

## 4. Evidence available

**Verified**

- 1.3.0 is the current runtime schema and model-preparation accepts it.
- 1.2.0/1.1.0 are supported as legacy with explicit reporting.
- Model-preparation's ingestion uses a version-keyed allow-list and rejects unknown versions.
- The recorder, validator, verifier, collection and model-preparation all consume the same schema.
- The assessment and planning directive require semantic outcomes and a task-definition version.

**Not measured**

- The final semantic field names/vocabulary version (Decision 6).
- Whether every consumer needs every new field; the fields are optional/additive.

## 5. Decision required

The schema version, the additive field set, backward compatibility, and which repository owns the
version constant.

## 6. Decision

**Adopt Option B — additive schema 1.4.0.**

Proposed additions:

| Record | Field | Type | Required |
| --- | --- | --- | --- |
| `OutcomeEvent` | `taskOutcome` | string | optional |
| `OutcomeEvent` | `taskOutcomeVocabularyVersion` | string | optional |
| `OutcomeEvent` | `taskOutcomeSource` | string | optional |
| `TaskEvent` | `taskDefinitionVersion` | string | optional |
| `TaskEvent` | `task_fail` lifecycle type | enum | optional |
| `TaskEvent` | extended `reason` (`timeout`, `replaced`, `condition_change`, `interrupted`) | enum | optional |
| `PredictionEvent` | `predictedOutcome` | string | optional |
| `PredictionEvent` | `predictionContractVersion` | string | optional |
| `PredictionEvent` | `targetContext` | object | optional |
| `metadata` | `taskDefinitionVersion` | string | optional |
| `metadata` | `semanticOutcomeVocabularyVersion` | string | optional |

Compatibility rules:

- 1.3.0/1.2.0/1.1.0 remain readable; the validator reports legacy limitations rather than failing a
  legacy capture.
- 1.4.0 is additive; no existing field changes meaning.
- A 1.4.0 trace without semantic fields is valid for a legacy/scripted session but must not be
  reported as semantic evidence.
- The runtime remains the schema author; model-preparation declares an explicit version-keyed
  allow-list and rejects unknown versions loudly.
- The schema version and `docs/data_schemas.md` must move together.
- `model-preparation` ingestion must accept a real exported 1.4.0 capture, not only a fixture.

## 7. Consequences

- The trace can carry generic and semantic outcomes simultaneously.
- Model-preparation can ingest semantic labels while preserving legacy analysis.
- Consumers must declare whether they read `outcome` or `taskOutcome`; they must not silently
  combine them.
- Task-definition version prevents TD-v2 traces from being pooled with legacy T1–T3 traces.
- Schema/documentation/index updates are part of the task, not optional cleanup.
- The field names are not final until Decision 6; renaming after collection would create two trace
  dialects, so the decision is required before Phase 2.5/4.1.

## 8. What is being deferred

> **Decision:** Whether `policyDecisions` and semantic outcome evidence are projected into the
> relational Parquet tables (rather than retained only in the canonical JSON trace).
> **Deferred until:** A defined analysis question requires those columns.
> **Reason:** Adding columns without an analysis fixes a schema prematurely; the evidence is
> retained in the trace and can be projected later.
> **Current workaround:** `policyDecisions` and semantic outcomes are accepted and retained in the
> trace; the target dataset carries the semantic target fields needed for training.
> **Risk:** Low — no evidence is lost; only the relational projection is deferred.
> **Evidence required to revisit:** A concrete analysis of policy refusals or semantic outcome
> distributions that requires tabular columns.

## 9. Conditions that would force this decision to be revisited

- Decision 6 changes the field names or vocabulary in a way that cannot be additive.
- A consumer requires breaking changes to existing field meanings.
- The schema cannot be validated across both repositories without a generated schema.
- A 1.4.0 trace cannot be ingested without dropping legacy fields.
