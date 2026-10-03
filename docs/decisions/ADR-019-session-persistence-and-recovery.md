# ADR-019: Session Persistence and Recovery Model

- **Status:** Accepted — supersedes ADR-010's "No Local Persistence" clause
- **Date:** 2026-10-02
- **Related:** ADR-009, ADR-010, ADR-015, ADR-018

## 1. Context

The testbed was in-memory only. The consequences were measured rather than assumed:

- Each recorder buffer evicted by silent FIFO `shift()` at 10 000 records, with no counter and no
  trace flag. A session at ~35 events/second — measured in a committed capture — lost its first
  events after about five minutes (assessment F-16).
- Nothing survived a reload, a crash or a closed tab. There was no partial-session handling, no
  duplicate-submission handling and no session status, because there was no submission.
- ADR-010 consequently guaranteed "No Local Persistence: no unmanaged localStorage, sessionStorage
  or IndexedDB storage. All state is retained in-memory only."

The brief (§10) requires the opposite for collection: a stable session id, uploaded completed
traces, visible upload failure, retryable failure, no silent discard on reload, no silent
truncation, and incomplete sessions represented as incomplete.

## 2. Problem

What is the minimum durability model that survives a reload and a failed upload, without becoming a
synchronisation system?

## 3. Options considered

| Option | Description | Survives reload | Failure visibility |
| --- | --- | --- | --- |
| **A. In-memory only** | Current behaviour | No | None |
| **B. IndexedDB write-ahead per session** | One snapshot per session, replaced on each flush | Yes | Explicit status per session |
| **C. Append-only local journal** | Every event appended to storage | Yes | Explicit, but far more I/O and state |

## 4. Evidence available

**Verified:** before this change, `grep` found zero storage usage in `src/`. After it,
`tests/collection_persistence.test.ts` covers: a session left open by a previous load is found and
marked `incomplete` (and is no longer offered as in-progress work); a trace snapshot is retrievable;
a completed-but-unuploaded session is pending; and the store degrades to non-durable **without
throwing** when no backend exists.

**Not measured:** trace payload size per completed task. This is why option C was rejected — the
snapshot design's storage bound is one session's trace, independent of the size question.

## 5. Decision required

Whether and how locally recorded sessions persist, and what happens to an interrupted one.

## 6. Decision

**Option B — a single write-ahead snapshot per session in IndexedDB, replaced on each flush.**

The snapshot is written on a timer (default 5 s) and again at completion. It replaces the previous
snapshot rather than appending, so local storage cannot grow without bound inside a session and the
design does not depend on an unmeasured trace size.

### Session status is a real state machine

```
in_progress ──► completed ──► uploaded
     │               │
     │               └──► upload_failed ──► (retry) ──► uploaded
     │
     └──► incomplete   (page unloaded while still in progress)
```

- `incomplete` is set when a session is found still `in_progress` on the next load. It is a distinct
  state precisely so an interrupted session can never be presented, exported or uploaded as a
  finished capture.
- Recovery is **reported, never automatic**. Silently resuming would merge two page loads' telemetry
  into one record and call it complete. The research panel surfaces the recoverable session and its
  reason, and the researcher decides.
- `upload_failed` records the attempt count and the error, so a failure is visible and retryable
  with no hidden retries.

### Truncation became observable

`ExperimentRecorder` now counts every FIFO eviction per buffer and exposes
`EvictionCounters { total, byBuffer, truncated }`. A truncated trace carries
`metadata.evictions.truncated = true` **and** an integrity warning naming the affected buffers, so a
consumer cannot analyse a partial capture as if it were whole. The panel shows the count too. The
brief's requirement — "storage limits do not silently truncate telemetry" — is met by making the
truncation loud, not by eliminating the bound, which would trade a memory guarantee for a storage
one.

### Consequences

- ADR-010's "No Local Persistence" guarantee is superseded. Session traces, session metadata and an
  upload token are stored on the participant's device. Session identity, trace content and retention
  therefore need a retention decision (ADR-022).
- The store is behind a narrow injectable backend port, so the logic is testable without a browser
  and a non-browser environment degrades to "no local durability" rather than throwing.
- The flow is not an offline-sync system: one session, one snapshot, one status, one explicit retry.

## 7. What is being deferred

> **Decision:** A "clear my data" control exposed to the session owner.
> **Deferred until:** Participant data is collected, or a pilot asks for it.
> **Reason:** The brief defers the consent and withdrawal workflow, and a withdrawal control without
> a consent flow would be a partial mechanism.
> **Current workaround:** `LocalSessionStore.clearAll()` / `discard(sessionId)` exist and are
> exercised by tests; the researcher panel can discard a session.
> **Risk:** Low while all data is scripted; medium the moment a participant session exists.
> **Evidence required to revisit:** A protocol requiring participant-facing deletion.

> **Decision:** Cross-device or cross-browser session recovery.
> **Deferred until:** A study design requires it.
> **Reason:** IndexedDB is per-origin and per-profile. Extending recovery across devices is a
> synchronisation problem, not a durability one.
> **Current workaround:** None; a session is recovered on the device that recorded it.
> **Risk:** Low for a lab study on a controlled machine.
> **Evidence required to revisit:** A remote or multi-device study design.

## 8. Conditions that would force this decision to be revisited

- A participant session's trace exceeds a practical local storage quota.
- Institutional review requires participant-visible deletion or a storage limit.
- The local write-ahead is shown to affect measured runtime performance.
