-- Research collection schema (v0.1)
--
-- Supabase is the initial research-trace persistence layer and is deliberately a *research
-- collection store*, not an analytics warehouse (deployment brief §2). Two tables, one
-- relation, no normalisation beyond what an export needs.
--
-- The browser can only INSERT (see 0002_rls_policies.sql). Reads are a researcher action
-- performed with a service-role key outside the browser, which is why nothing here is
-- optimised for query patterns the testbed does not have.

create table if not exists public.research_sessions (
  session_id            text primary key,
  -- Idempotency key for retries. A retried upload presents the same token, so
  -- `on conflict do nothing` makes the retry a no-op instead of a duplicate. This is the only
  -- duplicate protection available to a role that cannot SELECT.
  upload_token          text not null,
  experiment_id         text,
  condition_id          text check (condition_id in ('baseline', 'adaptive')),
  -- Machine-readable origin. This is the field that decides whether a trace may be reasoned
  -- about as participant data; it is never inferred (ADR-018).
  provenance            text not null check (provenance in ('scripted', 'participant')),
  -- Opaque participant reference. Nullable and never populated by the testbed: no participant
  -- identifier scheme has been approved (ADR-023).
  participant_id        text,
  task_id               text,
  -- Version identity of the software that produced the trace, so a record can always be
  -- attributed to an exact build (deployment brief §9).
  trace_schema_version  text,
  application_version   text,
  model_version         text,
  policy_version        text,
  status                text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  -- Session-level research metadata: clock, integrity warnings, eviction evidence, mining
  -- counters. jsonb because these are read as a whole during export, never queried by key.
  metadata              jsonb not null default '{}'::jsonb
);

create table if not exists public.research_traces (
  session_id            text primary key references public.research_sessions (session_id) on delete cascade,
  upload_token          text not null,
  trace_schema_version  text,
  -- The complete exported trace, one row per session. A single jsonb column is intentional:
  -- the trace is a self-describing document with a versioned contract, and shredding it into
  -- tables would create a second interpretation of the same data to keep in step.
  trace                 jsonb not null,
  inserted_at           timestamptz not null default now()
);

-- Supports the researcher export path: "all traces from experiment X, condition Y".
create index if not exists research_sessions_experiment_idx
  on public.research_sessions (experiment_id, condition_id);

-- Supports pruning or analysis by provenance, which is the primary split for this milestone.
create index if not exists research_sessions_provenance_idx
  on public.research_sessions (provenance, created_at desc);

comment on table public.research_sessions is
  'One row per completed or interrupted research session. Written by the testbed with an anon key; read only with a service-role key.';
comment on table public.research_traces is
  'One exported experiment trace per session (schema 1.3.0). Uploaded from the browser; exportable for model-preparation ingestion.';
comment on column public.research_sessions.provenance is
  'scripted = synthetic/automated; participant = human, requires an approved protocol. Never inferred.';
