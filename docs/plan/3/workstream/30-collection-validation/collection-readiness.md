# Collection Readiness — Research Trace Path

- **Workstream:** 30 — Collection validation (Task 30.2)
- **Evidence date:** 2026-11-17
- **Framework commit:** `5f5f734`
- **Scope:** what the testbed can do today with a captured trace, and what still blocks
  participant collection.

**Evidence labels:** **Verified** (observed in this pass), **Historical** (recorded earlier in
this repository and not re-run here), **Blocked** (not observable in this environment).

---

## 1. Readiness summary

| Item | State | Basis |
| --- | --- | --- |
| Provenance is declared, never inferred | **Verified** | `scripted` on all eight captures; default and gate in code |
| Scripted egress is the only browser egress | **Verified** | `scripted` collection mode refuses participant provenance |
| Session persistence (IndexedDB write-ahead) | **Verified** | Tests cover save, pending, failure, retry and recovery |
| Participant identifier | **Blocked** | Field exists and defaults to `null`; no approved scheme (ADR-023) |
| Supabase configuration (anon key, RLS) | **Verified (structural)** | Config parsing and gate tested; live probe **Blocked** without credentials |
| Live Supabase write | **Historical** | A completed trial was observed committing on the deployed origin (2026-10-04) |
| Export path (in-browser and server-side) | **Verified** | Runtime export + `1.4.0` ingestion test; server export **Blocked** without `service_role` |
| Recovery after an interrupted session | **Verified** | Incomplete session surfaced, never uploaded as finished |
| Participant study protocol | **Blocked** | Consent, counterbalancing, sample size and withdrawal are out of scope |

**Verdict:** the engineering path is ready to collect and export **scripted** traces. It is
not ready to collect **participant** traces, and the missing pieces are protocol and
credentials, not code.

---

## 2. Provenance mode

| Concern | Behaviour | Evidence |
| --- | --- | --- |
| Default | `session.provenance` and `metadata.provenance` default to `'scripted'` | [session.ts:112](../../../../../src/telemetry/session.ts#L112); all eight captures |
| Allowed values | `'scripted' \| 'participant'`; anything else is rejected | [supabaseConfig.ts](../../../../../src/config/supabaseConfig.ts); [collection.ts](../../../../../src/telemetry/collection.ts) |
| Browser upload modes | `off` (local only), `scripted` (default), `all` | [supabaseConfig.ts:14](../../../../../src/config/supabaseConfig.ts#L14) |
| Participant traces in `scripted` mode | Recorded and exported locally; **never uploaded** | [collection.ts:244](../../../../../tests/collection_persistence.test.ts#L244) test |
| Participant traces in `all` mode | Uploaded | [collection_persistence.test.ts:261](../../../../../tests/collection_persistence.test.ts#L261) |

Configuration:

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_AUI_COLLECTION_MODE=scripted   # off | scripted | all
```

Only the public `anon` key is read by the browser. The `service_role` key is refused by the
design and is required only by the server-side export script. An unrecognised mode falls back
to `scripted`, so a typo cannot widen egress
([supabaseConfig.ts:41](../../../../../src/config/supabaseConfig.ts#L41)).

**Verified:** the eight scripted captures are labelled `scripted` in both `session` and
`metadata`, and `verify-trace.mjs` fails a trace with an invalid or inconsistent provenance.

---

## 3. Session persistence and recovery

| Concern | Behaviour |
| --- | --- |
| Store | IndexedDB (`sessions` and `traces` stores) via [localStore.ts](../../../../../src/telemetry/localStore.ts) |
| Write-ahead | The session record is written, then the trace snapshot, then upload is attempted |
| Periodic snapshot | The current trace is flushed locally on a timer while a session is open |
| Failure | Status becomes `failed` with the reason; the record stays locally retrievable and retryable |
| Interrupted session | A session left open by a previous load is reported `incomplete` with a reason, never as a finished capture |
| Rotation | A finished trial is persisted under its own session id before the next trial starts |

**Verified** by the persistence suite:
[pending/unuploaded](../../../../../tests/collection_persistence.test.ts#L110),
[failed upload keeps the record](../../../../../tests/collection_persistence.test.ts#L162),
[retry preserves the upload token](../../../../../tests/collection_persistence.test.ts#L182),
[incomplete session is not complete](../../../../../tests/collection_persistence.test.ts#L75),
[no backend degrades without throwing](../../../../../tests/collection_persistence.test.ts#L119).

**Verified in the capture run:** completing a trial rotated the session, and the harness
retrieved the finished trial's export from the runtime rather than racing the rotation
(`lastCompletedTrial` in [diagnostics.ts](../../../../../src/runtime/diagnostics.ts)).

---

## 4. Participant identity

`session.participantId` exists in the schema and in the upload payload
([session.ts:41](../../../../../src/telemetry/session.ts#L41),
[collection.ts:88](../../../../../src/telemetry/collection.ts#L88)). It is deliberately
optional and is **never auto-populated**:

- no participant identifier scheme has been approved (ADR-023);
- generating one in the browser would create a re-identification surface nobody agreed to;
- a `null` participant id is the honest state for a scripted capture.

**Blocked:** while `participantId` is `null`, participant traces can be captured locally but
cannot be linked to a participant or pooled across sessions. Assigning the ID, and the
consent text that explains it, remain study-protocol decisions.

---

## 5. Supabase configuration

| Check | State |
| --- | --- |
| Missing URL/key reported as `unconfigured`, not a failure | **Verified** ([collection_persistence.test.ts:46](../../../../../tests/collection_persistence.test.ts#L46)) |
| Malformed URL disables collection | **Verified** ([collection_persistence.test.ts:51](../../../../../tests/collection_persistence.test.ts#L51)) |
| Unrecognised mode falls back to `scripted` | **Verified** ([collection_persistence.test.ts:57](../../../../../tests/collection_persistence.test.ts#L57)) |
| No request is attempted when unconfigured | **Verified** ([collection_persistence.test.ts:228](../../../../../tests/collection_persistence.test.ts#L228)) |
| `Prefer: resolution=ignore-duplicates` is never sent | **Verified** ([collection_client_headers.test.ts:41](../../../../../tests/collection_client_headers.test.ts#L41)) |
| A `409` duplicate is treated as stored | **Verified** ([collection_client_headers.test.ts:66](../../../../../tests/collection_client_headers.test.ts#L66)) |
| Live RLS probe reaches the constraint | **Blocked** — needs a project and the anon key; run `npm run check:collection-policies` |
| Rows committed to the live project | **Historical** — observed 2026-10-04; see [verification-runbook.md](../../../../deploy/verification-runbook.md) |

`npm run check:collection-policies` probes the policy without writing a row. It is the
command to run before a collection session; it is not re-run in this pass.

---

## 6. Export path

There are three ways a trace leaves the runtime, and they serve different purposes:

| Path | Who can use it | State |
| --- | --- | --- |
| `experimentRecorder.exportJSON()` / `downloadTraceAsJSON()` | page or automation | **Verified** — the harness uses the retained export; the Export Report button produced real JSON files during the runs |
| `window.__EDGE_AUI__.trace()` / `.lastCompletedTrial()` | diagnostics-enabled build | **Verified** — used by every scripted capture |
| `scripts/export-traces.mjs` (Supabase → files) | researcher with `service_role` | **Blocked** here; **Historical** verified write path |
| `parse_experiment_trace` ingestion | model-preparation | **Verified** — a real `1.4.0` capture ingests; unknown versions fail loudly |

The ingestion smoke test now reads real `1.4.0` captures rather than a hand-built dict
(`test_real_140_capture_ingests`, [test_trace_ingestion.py:295](../../../../../../model-preparation/tests/test_trace_ingestion.py#L295)).

---

## 7. Deferred study items (explicitly out of scope)

| Item | Why it is deferred |
| --- | --- |
| Consent and information sheet | Requires ethics/approval text and a participant-facing flow |
| Participant ID scheme | ADR-023 has no approved scheme; a placeholder ID would be a re-identification surface |
| Counterbalancing and task order | Study-design decision; the runtime supports a declared trial order but the protocol is not approved |
| Sample size and stopping rule | Protocol decision; no participant data is collected in this milestone |
| Withdrawal and deletion procedure | Needs a researcher-side runbook and a store-level deletion path |
| Pilot session | Should follow the protocol approval |

The runtime already supports what these items need structurally: a declared trial order
([experiment.ts](../../../../../src/testbed/config/experiment.ts)), explicit abandonment and
provenance, local retention on failure, and recovery. They are deferred because the study
decisions are not made, not because the code cannot carry them.

---

## 8. Pre-collection checklist

Run in this order before a participant session:

1. `cd edge-aui-framework && npm run check:collection-policies` — the live RLS probe returns
   `policy applies` for both tables.
2. Build with `VITE_AUI_COLLECTION_MODE=all` only if participant upload is approved; leave
   `scripted` for every other run.
3. Confirm the panel reports `collection: configured` and the intended
   `provenance: scripted|participant`.
4. Complete one trial and confirm the panel rotates the session id and reports `uploaded`.
5. Export with `scripts/export-traces.mjs` and ingest the result with
   `python3 -m src.data --ingest-traces <dir>`.
6. Record the run in the study log with the framework and model-preparation commits.

Items 1, 3–6 are **Blocked** in this environment until a Supabase project and a
`service_role` key are available for the session.
