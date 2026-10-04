#!/usr/bin/env node
/**
 * Research collection policy verification.
 *
 * Answers one question without writing anything to the research store:
 *
 *     Does the `anon` INSERT policy in `supabase/migrations/0002_rls_policies.sql`
 *     actually apply to this project right now?
 *
 * It exists because "the migration is recorded as applied" turned out not to mean "the policy is in
 * force". `supabase migration list` reports what was recorded, not the current schema, so a policy
 * dropped — or never created — after the migration ran leaves no trace there. The only reliable
 * check is to observe the policy's behaviour, and this does that with payloads that cannot be
 * committed.
 *
 * ## How a non-writing probe can tell the two cases apart
 *
 * Both payloads below satisfy every condition of the documented `WITH CHECK`, and each violates a
 * constraint that is evaluated *after* Row Level Security:
 *
 * | Probe | Violates | Policy applies | Policy does not apply |
 * |---|---|---|---|
 * | `research_sessions` with `condition_id = 'NOT_VALID'` | the table's `CHECK (condition_id in (...))` | `23514` check-constraint violation | `42501` row-level security |
 * | `research_traces` with a non-existent `session_id` | the foreign key to `research_sessions` | `23503` foreign-key violation | `42501` row-level security |
 *
 * Reaching the constraint proves the row passed RLS; being stopped at RLS proves it did not. Neither
 * outcome can commit a row: the constraint aborts the insert in the first case, and RLS aborts it in
 * the second.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<anon key> \
 *     node scripts/verify-collection-policies.mjs
 *
 * Both may also be supplied as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, read from the environment
 * or from `.env.local`, so the check uses the same values the testbed was built with.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PG_CHECK_VIOLATION = '23514';
const PG_FK_VIOLATION = '23503';
const PG_RLS_VIOLATION = '42501';

/** Reads a key from the environment, falling back to `.env.local`. */
export function readConfig(env = process.env) {
  const fromFile = {};
  try {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !match[1].startsWith('#')) {
        fromFile[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env.local is a normal case for CI; the environment must supply the values.
  }

  const pick = (names) => {
    for (const name of names) {
      const value = env[name] ?? fromFile[name];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return null;
  };

  return {
    supabaseUrl: pick(['SUPABASE_URL', 'VITE_SUPABASE_URL']),
    anonKey: pick(['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'])
  };
}

/** Interprets the `research_sessions` probe. Exported for testing. */
export function classifySessionsProbe(status, code) {
  if (code === PG_CHECK_VIOLATION) {
    return { ok: true, verdict: 'policy applies', detail: `reached the table CHECK (${PG_CHECK_VIOLATION})` };
  }
  if (code === PG_RLS_VIOLATION) {
    return {
      ok: false,
      verdict: 'policy does NOT apply',
      detail: `stopped at Row Level Security (${PG_RLS_VIOLATION}) before the table CHECK`
    };
  }
  return {
    ok: false,
    verdict: 'unexpected response',
    detail: `HTTP ${status}, code ${code ?? 'none'} — expected ${PG_CHECK_VIOLATION} or ${PG_RLS_VIOLATION}`
  };
}

/** Interprets the `research_traces` probe. Exported for testing. */
export function classifyTracesProbe(status, code) {
  if (code === PG_FK_VIOLATION) {
    return { ok: true, verdict: 'policy applies', detail: `reached the foreign key (${PG_FK_VIOLATION})` };
  }
  if (code === PG_RLS_VIOLATION) {
    return {
      ok: false,
      verdict: 'policy does NOT apply',
      detail: `stopped at Row Level Security (${PG_RLS_VIOLATION}) before the foreign key`
    };
  }
  return {
    ok: false,
    verdict: 'unexpected response',
    detail: `HTTP ${status}, code ${code ?? 'none'} — expected ${PG_FK_VIOLATION} or ${PG_RLS_VIOLATION}`
  };
}

async function post(fetchImpl, url, anonKey, body) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      // Deliberately the same preference the testbed sends, so the probe exercises the real shape.
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(body)
  });
  let code = null;
  try {
    code = (await response.json()).code ?? null;
  } catch {
    code = null;
  }
  return { status: response.status, code };
}

async function get(fetchImpl, url, anonKey) {
  const response = await fetchImpl(url, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: 'application/json' }
  });
  return { status: response.status };
}

/**
 * Runs every probe and returns a structured report. Exported so it can be tested with a stubbed
 * `fetch` rather than against a live project.
 */
export async function runPolicyChecks({ supabaseUrl, anonKey, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/+$/, '');
  const nonce = `policy-probe-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const sessionsReadable = await get(fetchImpl, `${base}/rest/v1/research_sessions?select=session_id&limit=1`, anonKey);
  const exportResponse = await get(fetchImpl, `${base}/rest/v1/research_export?select=session_id&limit=1`, anonKey);

  const sessions = await post(fetchImpl, `${base}/rest/v1/research_sessions`, anonKey, {
    session_id: nonce,
    upload_token: nonce,
    provenance: 'scripted',
    // Satisfies the policy, violates the table CHECK: the insert cannot commit either way.
    condition_id: 'NOT_VALID'
  });

  const traces = await post(fetchImpl, `${base}/rest/v1/research_traces`, anonKey, {
    // Satisfies the policy, violates the foreign key: the insert cannot commit either way.
    session_id: `${nonce}-nonexistent`,
    upload_token: nonce,
    trace: { schemaVersion: '1.3.0', probe: nonce }
  });

  return {
    sessionsReadable,
    exportResponse,
    sessionsProbe: classifySessionsProbe(sessions.status, sessions.code),
    tracesProbe: classifyTracesProbe(traces.status, traces.code),
    raw: { sessions, traces }
  };
}

async function main() {
  const { supabaseUrl, anonKey } = readConfig();

  if (!supabaseUrl || !anonKey) {
    console.error(
      '[verify-collection-policies] ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required.\n' +
        '                           They are read from the environment or from .env.local.'
    );
    process.exit(2);
  }

  console.log('=== Research collection policy verification ===');
  console.log(`Source: ${supabaseUrl}`);
  console.log('No row can be written by any probe below; see the header for why.\n');

  const report = await runPolicyChecks({ supabaseUrl, anonKey });

  const line = (label, detail) => console.log(`  ${label.padEnd(42)} ${detail}`);
  line('GET research_sessions', `${report.sessionsReadable.status} ${report.sessionsReadable.status === 200 ? '(table exists, anon key valid)' : '(UNEXPECTED)'}`);
  line('GET research_export', `${report.exportResponse.status} ${report.exportResponse.status === 401 || report.exportResponse.status === 403 ? '(revoked from anon — correct)' : '(UNEXPECTED)'}`);
  line('POST research_sessions (invalid condition)', `${report.raw.sessions.status} ${report.raw.sessions.code ?? ''} — ${report.sessionsProbe.verdict}`);
  line('POST research_traces (missing parent)', `${report.raw.traces.status} ${report.raw.traces.code ?? ''} — ${report.tracesProbe.verdict}`);

  const policyApplies = report.sessionsProbe.ok && report.tracesProbe.ok;

  console.log('');
  if (policyApplies) {
    console.log('[verify-collection-policies] OK — the anon INSERT policy applies to both research tables.');
    console.log('The testbed can upload. A completed task should be accepted.');
    return;
  }

  console.log('[verify-collection-policies] FAILED — the anon INSERT policy does not apply.');
  console.log('');
  console.log('The tables exist and the key is valid, so the refusal is Row Level Security with no');
  console.log('matching policy for the requesting role. An applied migration does not prove the policy');
  console.log('exists; verify it with:');
  console.log('');
  console.log('  select tablename, policyname, cmd, roles, with_check');
  console.log("  from pg_policies where schemaname = 'public' order by tablename, policyname;");
  console.log('');
  console.log('If it is missing, paste supabase/migrations/0002_rls_policies.sql into the dashboard SQL');
  console.log('editor (it is idempotent). If it is present with roles = {anon}, the request is not');
  console.log('running as anon — use the legacy anon JWT key instead of an sb_publishable_… key.');
  console.log('See docs/deploy/supabase-setup.md §5.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[verify-collection-policies] ERROR: ${err.message}`);
    process.exit(2);
  });
}
