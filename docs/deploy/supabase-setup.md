# Supabase Setup — Research Collection Store

Supabase is the initial research-trace persistence layer. It is a **collection store**, not an
analytics warehouse: two tables, one view, no normalisation beyond what an export needs.

Neither Supabase nor Cloudflare Pages existed when this milestone was implemented, so follow
this document to stand the project up. Everything the database needs is in
`supabase/migrations/`, which is the reproducible source of truth — the database is not
configured by hand (deployment brief §18).

---

## 1. Create the project

1. Create a Supabase project at <https://supabase.com/dashboard>.
2. Note the **Project URL** and the **anon/public** key (Project Settings → API).
3. Note the **service_role** key as well, but keep it out of the browser entirely: it bypasses
   Row Level Security and is used only for researcher export from a shell.

## 2. Apply the migrations

Migrations are plain SQL and are applied in filename order.

**Option A — Supabase CLI (recommended):**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — SQL editor:**

Run these three files in order in the dashboard's SQL editor:

```
supabase/migrations/0001_research_schema.sql
supabase/migrations/0002_rls_policies.sql
supabase/migrations/0003_export_view.sql
```

**Option C — `psql` with the connection string:**

```bash
for f in supabase/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Each file is idempotent (`create ... if not exists`, `drop policy if exists`), so re-running is
safe.

## 3. Verify the schema

```sql
-- Two tables and one view, with RLS enabled on both tables.
select tablename, rowsecurity from pg_tables where schemaname = 'public';
select policyname, cmd, roles from pg_policies where schemaname = 'public';
```

Expected: `research_sessions` and `research_traces` both `rowsecurity = true`, each with a
single `INSERT` policy for `anon` and no `SELECT`/`UPDATE`/`DELETE` policy at all.

## 4. Configure the testbed

Add the URL and anon key to `.env.local` (local) and to the Cloudflare Pages environment
variables (deployed). See [`.env.example`](../../.env.example).

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_AUI_COLLECTION_MODE=scripted
```

## 5. Verify the write path

Run the testbed, complete a task, then:

```sql
-- Counts only; the researcher has the service role.
select session_id, provenance, condition_id, status, created_at
from public.research_sessions
order by created_at desc
limit 10;

select session_id, jsonb_array_length(trace -> 'policyDecisions') as policy_decisions,
       jsonb_array_length(trace -> 'predictions') as predictions
from public.research_traces
order by inserted_at desc
limit 10;
```

## 6. Export collected traces

The browser cannot read back what it wrote (see below), so export is a shell action.
`scripts/export-traces.mjs` reads through the `research_export` view:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/export-traces.mjs --out ./.data/collected
```

The service-role key is required and must not be committed, put in `.env.local`, or set as a
Cloudflare Pages variable.

Then feed the export into the dataset pipeline:

```bash
cd ../model-preparation
python3 -m src.data --ingest-traces <export-dir>
```

---

## Security model — and its one deliberate limitation

The deployed testbed is public, so its anon key is public. The security model therefore does
not depend on keeping the key secret; it depends on what the key can do.

```
anon  →  INSERT on research_sessions and research_traces.   No SELECT. No UPDATE. No DELETE.
```

Consequences, stated rather than worked around:

1. **The browser cannot read back its own writes.** An anonymous writer that can also read the
   table can enumerate every other session. This is the intended posture.
2. **Duplicate protection cannot use `upsert`**, because an upsert requires `SELECT`. It uses a
   client-generated `upload_token` plus `ON CONFLICT DO NOTHING`, which is a pure insert. A
   retried upload therefore presents the same token and becomes a no-op.
3. **A hostile insert cannot corrupt an existing row**, because no `UPDATE` or `DELETE` grant
   exists.
4. **Retrieval and export require the service-role key.** That is a real operational cost: a
   researcher cannot casually browse the collected traces without a shell and a key.

This limitation is recorded rather than resolved by granting `SELECT` to `anon`, which would
expose all research telemetry to anyone who views the page source (deployment brief §11:
"If the current architecture cannot safely support this anonymously, document the limitation
rather than weakening the database security model").

### What is NOT in this milestone

- No participant authentication. No participant identifier scheme has been approved (ADR-023),
  and `research_sessions.participant_id` is nullable and never populated by the testbed.
- No consent or withdrawal workflow.
- No retention/deletion automation. ADR-022 records the retention question as open.
- No dashboard or analytics surface.

---

## Known caveat: the ingestion path does not read `config.yaml`

In `model-preparation`, `load_config` is imported but never called on the trace-ingestion path,
and `trace_ingestion.py` never reads `src/config.yaml` at all — its `ts_ms // 250` fallback is a
bare literal. The effective values are the hard-coded defaults in function signatures. This is
documented, not changed: altering it would move windowing and label semantics, which is a
methodology decision rather than a bug fix. See `model-preparation/docs/data_schemas.md` §7.
