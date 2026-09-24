# ADR-010: Privacy and Retention Model

- **Status:** Proposed — decision required before any participant-facing collection
- **Date:** 2026-09-24
- **Related:** ADR-009, ADR-011

## 1. Context

The system records high-resolution pointer trajectories, dwell behaviour, scroll dynamics and
viewport geometry, correlated with task, session and experiment identity. This is behavioural
telemetry. Even though no affect or identity is inferred, fine-grained pointer kinematics are
widely treated as personal data because they can be re-identifying and can reveal more than the
task at hand.

Current state: no egress, no storage, in-memory only, local trace export
(`docs/architecture.md` §11 Privacy). `AGENTS.md` §2 forbids transmitting telemetry to external
servers.

## 2. Problem

The project needs a stated, defensible retention and minimisation position *before* it collects
from participants — not after. Two specific gaps exist today:

1. There is no defined retention period, deletion path, or "clear my data" control, because
   nothing persists.
2. The telemetry captures **text-entry-adjacent** behaviour. `blur`, `focus`, form interaction and
   `FORM_SUBMIT` are in the outcome taxonomy. The observer must be proven not to capture field
   *values*. This has not been verified in this plan's evidence base.

## 3. Options considered

| Option | Description |
| --- | --- |
| **A. Minimal collection, no persistence** | Current. Session-scoped, memory-only, researcher-mediated export. |
| **B. Minimal collection, local persistence, explicit retention** | Local store with a documented retention window and a deletion control. |
| **C. Pseudonymised collection with upload** | Requires consent, controller obligations, and a legal basis. |

## 4. Evidence available

**Verified**

- No network egress path exists for telemetry in the current source.
- `docs/architecture.md` §11 records "no egress, no storage, in-memory only".

**Not verified — and this is the gap**

- That the observer **cannot** capture input field values. No test asserts this. The claim rests
  on code reading, not on a test.
- That exported traces contain no free-text content from the target UI.
- What identifiers exist in a trace and whether they are linkable across sessions.

## 5. Decision required

The retention model, the minimisation guarantees the project commits to, and which of those
guarantees must be enforced by an automated test rather than asserted in prose.

## 6. Recommended option

**Option A now, Option B at study time**, plus one non-negotiable addition: **a redaction and
minimisation test suite**. Specifically, the project should commit to these four guarantees and
prove the first two:

1. **No field values are recorded.** Enforced by a test that drives a form with a known sentinel
   value and asserts the sentinel appears nowhere in the serialised trace. *Must be implemented
   in this plan (task 5.2).*
2. **No network egress.** Enforced by a test that fails if telemetry serialisation invokes a
   network primitive. *Must be implemented in this plan (task 5.2).*
3. **Retention is bounded and deletion is available.** To be implemented when persistence lands
   (ADR-009).
4. **Identifiers are session-scoped and documented.** Correlation ids exist; their
   linkability must be documented in the data schema.

Guarantee 1 is the highest-value item here. It is cheap to test and its absence is the single
most likely way this project creates an ethics problem by accident.

## 7. Consequences

- The data schema documentation must state every identifier and its linkability.
- Anyone adding a new observed event type must add it to the redaction test's coverage list.
- Exported traces remain the researcher's responsibility once downloaded; this must be stated in
  the integration documentation rather than implied.

## 8. What is being deferred

> **Decision:** A formal retention period and deletion control.
> **Deferred until:** Local persistence is implemented (ADR-009) or a study is scheduled.
> **Reason:** There is nothing to retain or delete while collection is in-memory only.
> **Current workaround:** Session scope is the retention period.
> **Risk:** Low now; high if persistence is added without this ADR being reopened.
> **Evidence required to revisit:** An ethics application or a persistence implementation.

## 9. Conditions that would force this decision to be revisited

- Any persistence or upload path is added.
- Institutional ethics review imposes a retention period or a data-protection impact assessment.
- The redaction test reveals that free text or field values can reach the trace.
