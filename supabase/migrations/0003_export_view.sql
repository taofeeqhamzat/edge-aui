-- Researcher export surface
--
-- A plain view over the two collection tables, flattened for export. It exists so the export
-- script and any future dashboard read one definition instead of duplicating joins.
--
-- Access: this view is NOT granted to anon. It is read with a service-role key, which
-- bypasses RLS. The grant below is therefore to `service_role` only — the point of the view
-- is convenience for the researcher, not exposure to the public testbed.

create or replace view public.research_export as
select
  s.session_id,
  s.experiment_id,
  s.condition_id,
  s.provenance,
  s.participant_id,
  s.task_id,
  s.trace_schema_version,
  s.application_version,
  s.model_version,
  s.policy_version,
  s.status,
  s.started_at,
  s.completed_at,
  s.created_at,
  -- Integrity evidence travels with the export so a consumer can separate a whole capture
  -- from a truncated one without re-deriving it from the trace body.
  s.metadata ->> 'clock'                as trace_clock,
  s.metadata -> 'evictions'             as evictions,
  s.metadata -> 'integrityWarnings'     as integrity_warnings,
  s.metadata -> 'mining'                as mining,
  t.trace,
  t.inserted_at
from public.research_sessions s
left join public.research_traces t on t.session_id = s.session_id;

comment on view public.research_export is
  'Flattened researcher export surface. Read with a service-role key; not granted to anon.';

-- Explicitly revoke any inherited access, then grant only to the service role.
revoke all on public.research_export from anon;
revoke all on public.research_export from authenticated;
grant select on public.research_export to service_role;
