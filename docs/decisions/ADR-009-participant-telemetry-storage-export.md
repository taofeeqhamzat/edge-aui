# ADR-009: Participant Telemetry Storage and Export

- **Status:** Proposed — decision required before any participant-facing collection
- **Date:** 2026-09-24
- **Related:** ADR-010, ADR-011

## 1. Context

Today the system is in-memory only: raw events live in `src/telemetry/observer.ts`, the session
buffer in `src/telemetry/session.ts`, and the experiment trace in
`src/telemetry/recorder.ts`. Trace export is a local JSON download
(`docs/experiments/`). No telemetry is transmitted anywhere. This matches
`AGENTS.md` §2: "no telemetry may be transmitted to external servers".

Phase D of the brief requires the testbed to act as a **data-generation environment**, with raw
traces exported reproducibly and every derived artifact traceable back to its source session.
Phase H requires explicit privacy and storage controls.

## 2. Problem

In-memory-only collection does not survive a page reload, a crash, or a long session, and it
gives no durable provenance. But adding persistence is the first point at which the project
handles data that could identify a person, and it must not silently become egress.

## 3. Options considered

| Option | Description | Egress? | Survives reload? |
| --- | --- | --- | --- |
| **A. In-memory + manual download** | Current behaviour. | No | No |
| **B. Local persistence (IndexedDB / OPFS)** | Buffer traces locally; export on demand. | No | Yes |
| **C. Local persistence + optional researcher-controlled upload** | As B, plus an explicit opt-in endpoint. | **Yes, if enabled** | Yes |
| **D. Immediate streamed upload** | Send events as they occur. | Yes | N/A |

## 4. Evidence available

**Verified**

- `tests/telemetry_session_recorder.test.ts` and `tests/telemetry_observer.test.ts` pass.
- The trace is versioned (`schemaVersion 1.1.0`) and carries correlation identifiers
  (implementation record, step 7).
- `docs/experiments/` contains exported traces, including
  `experiment-trace-unknown-session-*.json` from before identity was fixed.

**Observed limitations**

- A single-participant scripted trial only; no multi-participant pooling has been exercised
  (implementation record §4.10).
- The condition switch is manual.

**Not measured**

- Trace size per completed task. `NOT MEASURED` — which means buffer sizing for Option B is
  unknown.

## 5. Decision required

Whether the participant pipeline persists telemetry locally, whether any upload path is
permitted, and what the retention and deletion behaviour is.

## 6. Recommended option

**Option B for the participant pipeline — local persistence, no upload path at all** — with
Option A retained for the current testbed until a participant study is actually scheduled.

Rationale: the brief requires attributed, reproducible traces (§8) and explicit privacy
behaviour (§23) but does not require a server. Adding an upload path introduces a data-controller
obligation, a consent surface, and a privacy-policy requirement that the project has no
infrastructure to honour. Local persistence plus researcher-mediated export keeps the existing
"no egress" property intact while gaining durability.

**Option C is explicitly not recommended at this time.** If it is ever adopted it must be a
separate, deliberate decision with a consent flow — not an incidental consequence of adding
storage.

## 7. Consequences

- Participant data stays on the participant's device; export is a deliberate researcher action.
- Deletion, retention and "clear my data" controls become user-facing requirements, not
  afterthoughts (ADR-010).
- Multi-session pooling requires an explicit, documented export/import workflow.
- The system still cannot report aggregate results without a manual collection step.

## 8. What is being deferred

> **Decision:** Implementing local persistence.
> **Deferred until:** A participant study is scheduled; the immediate milestone uses scripted
> testbed traces.
> **Reason:** The immediate milestone does not involve participants, and storage sizing depends
> on an unmeasured trace size.
> **Current workaround:** In-memory buffers plus manual JSON export.
> **Risk:** Low now; medium at study time if sizing is discovered late.
> **Evidence required to revisit:** Measured trace size per completed task and per session.

## 9. Conditions that would force this decision to be revisited

- A participant study is scheduled.
- Trace size per session exceeds what an in-memory buffer can hold comfortably.
- Institutional ethics or data-protection review requires a specific storage or retention
  behaviour.
