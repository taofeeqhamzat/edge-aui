-- Row Level Security for the research collection tables
--
-- The deployed testbed is public. Its Supabase anon key is therefore public by definition,
-- so the security model cannot rest on keeping the key secret — it has to rest on what that
-- key is permitted to do (deployment brief §11).
--
-- The policy is deliberately INSERT-only:
--
--   anon  → INSERT on research_sessions and research_traces.  No SELECT, no UPDATE, no DELETE.
--
-- Consequences, stated plainly rather than worked around:
--
-- 1. The browser cannot read back what it wrote. That is the intended posture: an anonymous
--    writer that can also read the table can enumerate every other session.
-- 2. Duplicate protection therefore cannot use `upsert`, which requires SELECT. An earlier
--    revision of this comment claimed the same of `on conflict do nothing`; that was wrong, and
--    it cost real debugging time. PostgreSQL applies the table's SELECT policies while it looks
--    for a conflicting row, so `INSERT ... ON CONFLICT DO NOTHING` is refused here with
--    `42501 new row violates row-level security policy` — before it can insert anything, and
--    even when there is no conflict at all. PostgREST emits that clause for
--    `Prefer: resolution=ignore-duplicates`, so the client must not send it. The collection
--    client instead presents the same primary key on a retry and treats the resulting `409`
--    as success, which is the required end state and needs no SELECT grant.
--    Measurement: the identical insert reaches the table CHECK (`23514`) with
--    `Prefer: return=minimal` and stops at RLS (`42501`) with the ignore-duplicates preference.
-- 3. A malformed or hostile insert cannot corrupt an existing row, because no UPDATE or
--    DELETE grant exists.
-- 4. Retrieval and export are researcher actions performed with a service-role key, which
--    bypasses RLS by design. See 0003_export_view.sql and docs/deploy/supabase-setup.md.
--
-- This limitation is recorded rather than resolved by granting SELECT to anon, which would
-- expose all research telemetry to anyone who views source.

alter table public.research_sessions enable row level security;
alter table public.research_traces enable row level security;

-- Default-deny is the baseline: with RLS enabled and no policy, no role can do anything.
-- Only the grants below open anything, and they open exactly one verb.

-- Anonymous write-only access for the deployed testbed.
drop policy if exists "anon can insert research sessions" on public.research_sessions;
create policy "anon can insert research sessions"
  on public.research_sessions
  for insert
  to anon
  with check (
    -- Structural sanity only. A CHECK constraint cannot inspect provenance semantics, but it
    -- can refuse a row that claims nothing about where it came from.
    provenance in ('scripted', 'participant')
    and session_id <> ''
    and upload_token <> ''
  );

drop policy if exists "anon can insert research traces" on public.research_traces;
create policy "anon can insert research traces"
  on public.research_traces
  for insert
  to anon
  with check (
    session_id <> ''
    and upload_token <> ''
    -- `jsonb_typeof` guards against a scalar or array being stored where the trace contract
    -- expects an object; a consumer would otherwise fail at export time instead of insert.
    and jsonb_typeof(trace) = 'object'
  );

-- Authenticated users get no additional research-table access. This milestone has no
-- authentication system (deployment brief §3), and leaving the grant absent keeps that
-- absence explicit rather than accidental.
drop policy if exists "authenticated read research sessions" on public.research_sessions;
drop policy if exists "authenticated read research traces" on public.research_traces;

comment on policy "anon can insert research sessions" on public.research_sessions is
  'Insert-only for the public testbed. No SELECT is granted: see 0002 header for why.';
comment on policy "anon can insert research traces" on public.research_traces is
  'Insert-only for the public testbed. Trace must be a jsonb object.';
