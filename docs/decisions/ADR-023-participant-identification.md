# ADR-023: Participant Identification Strategy

- **Status:** Accepted — **deferred**; no participant identifier scheme is adopted
- **Date:** 2026-10-02
- **Related:** ADR-010, ADR-018, ADR-019, ADR-022

## 1. Context

The deployment brief (§24) requires that every collected session be distinguishable as `scripted` or
`participant`, that participant traces eventually carry the participant provenance **without
unnecessary personal information**, and states plainly:

> "Do not invent participant identifiers or demographic fields."

> "Do not implement participant-study metadata unless required by the approved research protocol."

Today nothing identifies a participant. `SessionContext` carries an anonymous UUID
(`generateAnonymousSessionId()`, `crypto.randomUUID()`), which is generated per session and is not
stable across sessions. `research_sessions.participant_id` is nullable and is never populated by the
testbed.

No research protocol is approved, no consent workflow exists, and no participant study is scheduled.

## 2. Problem

How does the project know that two sessions came from the same participant — without collecting
personal data it has no basis to collect?

## 3. Options considered

| Option | Description | Personal data created |
| --- | --- | --- |
| **A. Adopt a participant token now** | A researcher-issued opaque code entered per session | A stable pseudonymous identifier linking all of one person's sessions |
| **B. Session-scoped anonymity; defer the scheme** | Anonymous UUID per session, no linkage | None |
| **C. Derive linkage from environment** | Browser or device fingerprint | High, and covert |

## 4. Evidence available

**Verified:** `generateAnonymousSessionId()` is the only identifier; `participantId` is `null`
throughout; no demographic or personal field exists in `SessionContext`, the trace contract or the
Supabase schema; the egress gate refuses participant provenance in the default collection mode.

**Not applicable:** no participant sessions exist to characterise.

## 5. Decision required

Whether to adopt a participant identifier scheme, and if so in what form.

## 6. Decision

**Option B is adopted for this milestone: session-scoped anonymity, with the scheme explicitly
deferred.**

No participant identifier is introduced. Concretely:

- `participantId` exists, is optional, is nullable, and is **never** populated by the testbed.
- No field is derived from behaviour, timing, device, network or environment. A behavioural
  fingerprint would be a covert identifier, which is a worse outcome than a declared one.
- `provenance: 'participant'` is a value the record can hold. Setting it is a deliberate act, not a
  default, and the egress gate refuses it in the default collection mode (ADR-018).

The reason for deferral is not caution about effort. A participant identifier's legal weight follows
from the protocol: whether two sessions must be linked, whether longitudinal analysis is required,
and what the consent text says all determine whether a stable pseudonym is *necessary*. Choosing its
shape before the protocol is known risks creating a re-identification surface the study never needed
— which is exactly what §24 forbids.

### What the two provenances mean operationally

| Provenance | Produced by | May be uploaded | Contains personal data |
| --- | --- | --- | --- |
| `scripted` | Automated/scripted browser sessions driven by the deterministic teacher policy | Yes, by default | No |
| `participant` | A human, under an approved protocol | Only if the build explicitly opts into `all` mode, which requires a consent workflow first | Possibly — hence the gate |

## 7. What is being deferred

> **Decision:** Whether a stable participant identifier exists, and if so what form it takes (researcher-issued token, per-participant code, participant-chosen pseudonym).
> **Deferred until:** A research protocol is approved that states whether sessions must be linked.
> **Reason:** Brief §24 forbids inventing participant identifiers; the linkage requirement is a
> protocol property, and collecting a stable pseudonym "just in case" creates personal data with no
> approved purpose.
> **Current workaround:** Session-scoped anonymous UUIDs; sessions are not linkable to a person, and
> this is stated rather than assumed.
> **Risk:** Low for scripted collection. If a study requires within-subject comparison, the linkage
> requirement will be discovered at protocol design time — which is when it should be decided.
> **Evidence required to revisit:** An approved protocol stating the linkage requirement and the
> consent text it implies.

> **Decision:** The consent, withdrawal and deletion workflow.
> **Deferred until:** A participant study is approved.
> **Reason:** The brief's scope boundary defers the participant consent system; a consent mechanism
> without an approved protocol would have nothing to describe.
> **Current workaround:** Participant collection is refused by the egress gate, so there is no
> participant data without consent by construction.
> **Risk:** Low while collection is scripted-only.
> **Evidence required to revisit:** Written protocol and ethics approval.

> **Decision:** Any demographic or participant-level metadata field.
> **Deferred until:** The protocol requires a specific field.
> **Reason:** Brief §24: "Do not implement participant-study metadata unless required by the approved
> research protocol."
> **Current workaround:** None; no such field exists.
> **Risk:** None.
> **Evidence required to revisit:** A named field with a stated analysis purpose.

## 8. Conditions that would force this decision to be revisited

- A protocol requires linking sessions to the same participant.
- Participant collection is enabled (`VITE_AUI_COLLECTION_MODE=all`), which is the recorded
  condition for revisiting this ADR and ADR-022.
- Any artifact claims participant-derived evidence — the boundary has failed and the claim must be
  withdrawn rather than redefined.
