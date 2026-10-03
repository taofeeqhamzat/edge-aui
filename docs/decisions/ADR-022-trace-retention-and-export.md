# ADR-022: Trace Retention and Export Policy

- **Status:** Accepted — retention decision deferred, export path implemented
- **Date:** 2026-10-02
- **Related:** ADR-009, ADR-010, ADR-013, ADR-015, ADR-018, ADR-019, ADR-023

## 1. Context

This milestone introduces three places a research trace can exist, where previously it existed only
in memory:

1. the in-memory recorder buffers (unchanged, bounded at 10 000 records per buffer);
2. an IndexedDB write-ahead snapshot per session (ADR-019);
3. `research_traces` in Supabase (ADR-015).

Each has a different retention question. ADR-010 previously guaranteed "no unmanaged local storage",
which this milestone supersedes, so the retention question is now live rather than hypothetical.

Two facts constrain the answer:

- **No participant data is collected in this milestone.** Every trace carries
  `provenance: 'scripted'`, and the egress gate refuses participant provenance in the default
  collection mode (ADR-018).
- **Retrieval requires a service-role key.** The anon role has `INSERT` and no `SELECT`
  (`supabase/migrations/0002_rls_policies.sql`), so the browser cannot read back what it wrote and
  neither can anyone holding only the anon key.

## 2. Problem

How long do collected traces live, who can read them, how are they exported, and what happens to a
trace when it is no longer needed?

## 3. Options considered

| Option | Description | Assessment |
| --- | --- | --- |
| **A. Keep everything indefinitely** | Never delete | Simple, and wrong the moment participant data exists |
| **B. Retain scripted traces indefinitely; defer the participant retention policy** | Scripted data is not personal data; decide retention before participant collection | Matches the current data reality |
| **C. A short automatic retention window now** | Delete after N days | Removes evidence before the research question is settled, for a dataset with no personal data in it |

## 4. Evidence available

**Verified:** the egress gate refuses participant provenance unless the build explicitly opts into
`all`; the anon role cannot read the tables; `scripts/export-traces.mjs` exports through the
`research_export` view with a service-role key; traces carry integrity warnings and eviction evidence
so a partial capture is identifiable after export.

**Not measured:** trace payload size per session, and therefore total store growth per session and
per study. This is the one number a retention policy would be sized against, and it is recorded as
`NOT MEASURED`.

## 5. Decision required

A retention period, a deletion mechanism, and an export/read path.

## 6. Decision

**Option B.**

- **Scripted traces are retained until deliberately deleted.** They are synthetic, contain no
  personal data, and destroying them before the research question is settled would remove evidence
  for no benefit.
- **The participant retention policy is not decided here.** Collection of participant data is
  refused by the egress gate until a protocol, consent flow and retention statement exist
  (ADR-018, ADR-023). Deciding a retention period for data that does not exist and has no lawful
  basis would be a false formality.
- **Retention is a decision that must precede participant collection, not accompany it.** The
  condition to revisit this ADR is enabling `'all'` collection mode.

### Read and export path

```
Supabase (service-role key, outside the browser)
        ↓
scripts/export-traces.mjs  →  one JSON file per session (+ integrity evidence)
        ↓
model-preparation: python3 -m src.data --ingest-traces <dir>
        ↓
canonical Parquet → MicroTensor → target dataset
```

The export runs through the `research_export` view, which flattens the session metadata, the
clock/provenance columns and the integrity evidence alongside the trace body, so a consumer can tell
a whole capture from a truncated one without re-deriving it.

Parquet conversion stays in `model-preparation`. The browser produces a compact JSON trace; it does
not attempt Parquet.

### Deletion

There is no automated deletion. Deletion is a manual, deliberate act:

```sql
delete from public.research_traces where session_id = '<id>';
delete from public.research_sessions where session_id = '<id>';
```

and locally, `LocalSessionStore.discard(sessionId)` / `clearAll()`, exposed as a discard control in
the research panel. The `on delete cascade` on `research_traces.session_id` means removing the
session removes its trace.

### Consequences

- Two stores with different lifetimes exist, and neither is automatically reconciled. A local
  snapshot remains after a successful upload unless it is discarded. The upload is recorded
  (`uploaded: true`, session status `uploaded`), so a later pruning pass can identify it.
- The store grows without bound until someone acts. For scripted traces on a free tier this is
  acceptable for the milestone and is recorded as a known operational condition rather than
  discovered as an outage.
- No trace is anonymised because no participant information is present. The only identifier is an
  anonymous session UUID.

## 7. What is being deferred

> **Decision:** A retention period and an automated deletion mechanism for participant traces.
> **Deferred until:** A participant study is approved, or institutional review requires it.
> **Reason:** The retention period follows from the data-protection position, which follows from the
> protocol. No participant data exists, and the egress gate prevents it from existing by accident.
> **Current workaround:** All traces are scripted; deletion is manual and documented.
> **Risk:** Low now. High if participant collection is enabled without this clause being resolved —
> which is why enabling it is the recorded condition for revisiting.
> **Evidence required to revisit:** Written protocol approval and a retention statement.

> **Decision:** Local store pruning after a successful upload.
> **Deferred until:** Measured local storage growth shows a need.
> **Reason:** Trace payload size per session is `NOT MEASURED`, so a pruning threshold would be a
> guess. The snapshot replaces rather than appends, so a single session's footprint is already
> bounded.
> **Current workaround:** Sessions can be discarded from the research panel; `uploaded` status is
> recorded so a prune list is derivable.
> **Risk:** Low — a lab machine accumulating scripted traces.
> **Evidence required to revisit:** A measured per-session local footprint, or a reported storage
> limit.

## 8. Conditions that would force this decision to be revisited

- Participant collection is enabled — the retention policy must exist first.
- Institutional review imposes a retention or deletion requirement.
- Measured store growth makes the free-tier limits a constraint.
