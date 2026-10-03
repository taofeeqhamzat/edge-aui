# ADR-017: Canonical Research Trace Contract and the Single Clock

- **Status:** Accepted — trace schema 1.3.0
- **Date:** 2026-10-02
- **Related:** ADR-005, ADR-006, ADR-009, ADR-015, ADR-018

## 1. Context

Three defects in trace schema 1.2.0 made the research record unusable as evidence:

1. **Two clocks in one trace (F-01, Critical).** `BehaviourEvent`, `MicroTensorWindow`,
   `MacroInteraction` and `OutcomeEvent` carried `performance.now()`; `PredictionEvent`,
   `InterventionEvent` and `TaskEvent` carried `Date.now()`. `reconstructReplayStream` sorted all of
   them together, so the "strictly chronological" stream placed every behaviour event before every
   decision. Task completion time could not be derived from a trace, prediction→window links could
   not be verified, and the offline `wstart <= ts <= wend` correlation could never match.
2. **Policy decisions were not recorded (F-07, High).** A `PredictionEvent` was written for every
   evaluation, but an intervention record was written **only for accepted, applied decisions** in
   the adaptive condition. Rejection reasons existed only as transient debug strings. A baseline
   session recorded seven predictions and zero interventions, making "did it decide but not apply?"
   unanswerable from the record.
3. **Prediction→window attribution was unreliable (F-18, Medium).** The prediction's `windowId` was
   read from a mutable "latest window" field after an `await`, while the evaluated tensor came from
   the worker's sequence builder. Live traces showed consecutive predictions naming one window while
   evaluating different sequences.

4. **Cross-repository interface drift (F-09, Critical, blocking).** The runtime emitted 1.2.0;
   `model-preparation/src/trace_ingestion.py` accepted only 1.1.0 with a strict `!=`, and
   `ingest_trace_directory` **silently skipped** rejected files. A real 1.2.0 capture had been
   dropped while the suite reported success.

## 2. Problem

What is the canonical trace contract, which clock does it use, and which side of the repository
boundary owns its version?

## 3. Options considered

**Clock:**

| Option | Description | Problem |
| --- | --- | --- |
| A. Monotonic everywhere + session anchor | `performance.now()` on every record | Not durable: monotonic resets on navigation, so two page loads are not comparable |
| B. Epoch everywhere | Epoch milliseconds on every record | Wall-clock steps could reorder within a session |
| C. Explicit `clock` tag per record | Both clocks tagged | Two clocks to reconcile at analysis time; consumers can silently mis-sort |

**Schema ownership:**

| Option | Description |
| --- | --- |
| A. Edge runtime downgrades to 1.1.0-compatible output | No Python change; drops the new evidence |
| B. Ingestion accepts the runtime's version via a version-keyed allow-list | Runtime stays author; ingestion declares what it accepts |
| C. One generated schema checked into both repositories | Strongest guarantee; the most machinery |

## 4. Evidence available

**Verified:** the mixed-clock split in a live export and in a committed trace; the completed live
absence of policy records for a baseline session; three consecutive predictions sharing one
`windowId`; the Python-side `1.1.0` pin and the silent-skip path; and that after the change, an
executed acceptance run produces a 1.3.0 trace that passes the project's own verifier.

## 5. Decision required

The canonical clock, the record additions, the version number, and which repository owns the version
constant.

## 6. Decision

**Clock: option B, epoch milliseconds on every record, produced by `getWallClockTimestamp()`.**

`performance.now()` is anchored to the session's epoch start at session creation, so the value keeps
monotonic accuracy (immune to wall-clock steps within a session) while landing on the epoch timeline
that persistence requires. `metadata.clock = 'epoch_ms'` states the choice, so the format is
self-describing and a future change is detectable rather than inferred. Option A fails the
persistence requirement; option C leaves two clocks for every consumer to reconcile by hand, which
is how the defect arose.

**New record types and fields in 1.3.0:**

- `policyDecisions[]` — one `PolicyDecisionEvent` per evaluation, including refusals
  (`'rejected'`, with a `rejectionCategory`), the baseline decision-only branch (`'decision_only'`)
  and the absence of a candidate (`'no_prediction'`). `policyReason` is never empty.
- `PredictionEvent.predictionId` and `evaluatedWindowIds[]` — the sequence actually evaluated,
  captured before the inference call.
- `InterventionEvent.predictionId` and `reason` — so an episode is attributable and its termination
  is typed (`'ttl'`, `'user_dismissal'`, `'session_end'`, `'reset'`, `'replaced'`).
- `metadata.provenance`, `applicationVersion`, `modelVersion`, `executionProvider`, `policyVersion`.
- `metadata.mining`, `metadata.evictions`, `metadata.integrityWarnings` — evidence that bounded
  execution counts, buffer truncation and orphaned windows are never silent.
- `session.provenance`, `session.participantId`.

**Schema ownership: option B.** The runtime stays the schema author; `model-preparation` declares a
`TRACE_KEY_ALLOWLIST` keyed by version so each version's accepted key set is explicit. The silent
skip was **replaced by a loud failure**: `ingest_trace_directory` now raises
`UnsupportedTraceSchemaError` (carrying `.skipped = [{path, schema_version, reason}]`) and the CLI
exits non-zero unless `--allow-unsupported-trace-versions` is passed. Documentation may silently
lag; a build must not.

### Consequences

- Legacy 1.2.0 and 1.1.0 captures remain readable, and the verifier **reports** rather than fails the
  checks those versions cannot satisfy (single clock, policy decisions, prediction attribution,
  provenance). A legacy capture cannot be retro-fixed, and failing it would reject exactly the
  historical captures the verifier exists to audit — the failure mode that let real traces fail
  while fixture-only checks stayed green (F-13).
- Orphaned-window detection is defined once, in `findOrphanedWindows`, and shared by the recorder's
  integrity warnings and the trace verifier. A window is orphaned only once it outlives its whole
  settlement allowance (`lookahead + grace + tolerance`); windows still inside it are in flight. A
  healthy live session always has ~13 such windows, which is why the earlier check rejected every
  real capture.
- The cross-repository contract test exercises a real exported capture, not a hand-built dict.

## 7. What is being deferred

> **Decision:** Treating the trace's recorded `outcomes` as authoritative in the offline pipeline.
> **Deferred until:** A supervisor decision on which side owns outcome labels.
> **Reason:** MicroTensor generation re-derives outcomes from events (`extract_lookahead_outcome`)
> while the target-dataset path reads the trace's own `outcomes`. Both currently exist; reconciling
> them changes label semantics and therefore training data.
> **Current workaround:** The re-derivation is retained and the two are not silently merged.
> **Risk:** Medium — a divergence between the two label sources would be invisible in the dataset.
> **Evidence required to revisit:** A measured agreement rate between trace outcomes and re-derived
> outcomes on the same captures.

> **Decision:** Threading policy-decision evidence into the MicroTensor, sequence and target-dataset
> Parquet schemas.
> **Deferred until:** After supervisor feedback establishes which policy questions the analysis
> needs to answer.
> **Reason:** The ingestion layer accepts `policyDecisions` but does not yet consume it. Adding
> columns without a defined analysis would fix a schema before the question is known.
> **Current workaround:** Policy decisions are collected, exported and included in the JSON trace and
> in the Supabase record, so no evidence is lost.
> **Risk:** Low — the data is retained; only the relational projection is missing.
> **Evidence required to revisit:** A concrete analysis requirement over policy refusals.

## 8. Conditions that would force this decision to be revisited

- A consumer requires a second clock, or a durable clock other than epoch milliseconds.
- The diverging outcome-label paths are shown to disagree on real captures.
- A schema change is needed that cannot be expressed as an additive bump.
