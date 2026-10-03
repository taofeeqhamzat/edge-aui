# ADR-015: Supabase as the Initial Research Persistence Layer

- **Status:** Accepted — supersedes the persistence deferment in ADR-009
- **Date:** 2026-10-02
- **Related:** ADR-009, ADR-010, ADR-016, ADR-018, ADR-019, ADR-022

## 1. Context

The testbed held every trace in memory. A reload, a crash or a closed tab lost the whole session,
and the only exit was a manual JSON download from the developer panel (`ExperimentRecorder`,
assessment F-16). Session traces were also bounded by silent FIFO eviction at 10 000 records per
buffer, so a session at ~35 events/second lost its beginning after about five minutes — without a
counter and without a trace flag.

ADR-009 recommended Option B (local persistence, no upload path) and deferred the decision. The
supervisor-ready brief (§8, §17) requires the opposite: a durable collection path where a completed
session reaches a research store, so collection exists at all.

## 2. Problem

Where do completed sessions live, and what is the smallest durable design that makes the research
trace survive an interrupted session and be retrievable for dataset preparation?

## 3. Options considered

| Option | Description | Cost | Durability |
| --- | --- | --- | --- |
| **A. Manual JSON download only** | Current behaviour. | None | None |
| **B. Local IndexedDB only** | ADR-009's recommendation. | Low | Survives reload; lost with the device |
| **C. Local write-ahead + Supabase upload** | IndexedDB for liveness, Supabase as the store of record. | Low–medium | Survives reload and device loss |
| **D. Streaming upload during the session** | Events sent as they occur. | High | Partial traces on failure |

## 4. Evidence available

**Verified** — `grep` over `src/` found zero `localStorage`, `sessionStorage`, `indexedDB`, `fetch`,
`sendBeacon`, `XMLHttpRequest` or `WebSocket` usage before this change; the only export path was
`downloadTraceAsJSON()`. After this change, `ResearchCollection` implements Option C and
`tests/collection_persistence.test.ts` covers success, failure, retry, duplicate, incomplete and
unconfigured paths.

**Not measured** — trace payload size per completed task. Sizing for a storage quota is therefore
unknown, which is why the local store replaces the snapshot per session rather than accumulating.

## 5. Decision required

Whether traces are persisted, and in which store.

## 6. Decision

**Option C for this milestone — IndexedDB write-ahead plus Supabase upload, with the upload gated
by provenance.**

Rationale: Option B alone does not satisfy the brief's requirement that a completed session be
collected, and it leaves a failed device as total data loss. Option D would produce partial traces
on every failure and complicates the session model for no research benefit at this scale. Option C
adds one client that only inserts and keeps the local store as the liveness mechanism, so a failed
upload degrades to a locally retrievable trace rather than to nothing.

The upload path is gated on `provenance` (ADR-018), not merely annotated by it. See ADR-010 for the
amendments this forces to the privacy guarantee.

### Consequences

- Two failure surfaces instead of one: the local store and the network. Both are explicitly
  reported in the research panel as a `CollectionState`, never logged only.
- A duplicate upload is prevented by a client-generated `upload_token` plus `ON CONFLICT DO
  NOTHING`, because the anon role has no `SELECT` grant and an upsert would need one.
- Session status becomes a real state machine: `in_progress`, `completed`, `uploaded`,
  `upload_failed`, `incomplete`.
- A session interrupted by a reload is marked `incomplete` and never presented as a finished
  capture.

## 7. What is being deferred

> **Decision:** Any retention or deletion automation for collected traces.
> **Deferred until:** A retention policy is agreed with the supervisor.
> **Reason:** Retention is a data-protection decision, not an engineering one, and no participant
> data is collected in this milestone.
> **Current workaround:** Traces are collected and can be deleted manually through the Supabase
> dashboard.
> **Risk:** Low now (scripted traces only); high if participant collection is enabled before a
> retention policy exists.
> **Evidence required to revisit:** An approved project retention statement.

> **Decision:** Retrieval tooling inside the application.
> **Deferred until:** A supervisor or researcher requires browsing rather than export.
> **Reason:** The anon role is deliberately INSERT-only, so in-app retrieval would require either
> weakening RLS or adding authentication — both are larger decisions than this milestone.
> **Current workaround:** `scripts/export-traces.mjs` with a service-role key, outside the browser.
> **Risk:** Low — export covers the stated research need for this milestone.
> **Evidence required to revisit:** A requirement for in-app trace review.

## 8. Conditions that would force this decision to be revisited

- Participant collection is enabled, which requires a consent and retention workflow first.
- Supabase's free-tier row or JSON limits are exceeded.
- An institutional data-protection review requires a different storage location or retention.
