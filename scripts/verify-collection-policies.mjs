#!/usr/bin/env node
/**
 * Research collection write-path verification.
 *
 * Answers, without writing anything to the research store:
 *
 *   1. Does the `anon` INSERT policy from `0002_rls_policies.sql` apply?
 *   2. Does the request shape the testbed actually sends get past it?
 *
 * Both questions are needed, and asking only the first is what made an earlier version of this
 * check misleading. A `42501 new row violates row-level security policy` from an insert looks
 * exactly like a broken policy, and it is not always one: PostgREST renders
 * `Prefer: resolution=ignore-duplicates` as `INSERT ... ON CONFLICT DO NOTHING`, and PostgreSQL
 * applies the table's **`SELECT`** policies while looking for a conflicting row. The `anon` role
 * holds no `SELECT` grant here by design, so that preference turns a perfectly valid insert into an
 * RLS refusal. The policy was never wrong; the header was.
 *
 * The two questions are told apart by probing the same payload twice, with and without the
 * preference.
 *
 * ## How a probe can tell one refusal from another without writing
 *
 * Each payload satisfies every condition of the documented `WITH CHECK` and violates a constraint
 * that PostgreSQL evaluates *after* Row Level Security:
 *
 * | Probe | Violates | Reaches the constraint | Stopped at RLS |
 * |---|---|---|---|
 * | `research_sessions`, `condition_id = 'NOT_VALID'` | the table's `CHECK (condition_id in (…))` | `23514` | `42501` |
 * | `research_traces`, non-existent parent `session_id` | the foreign key to `research_sessions` | `23503` | `42501` |
 *
 * Reaching the constraint proves the row passed RLS. Either outcome aborts the insert, so no probe
 * can commit a row.
 *
 * Usage:
 *   node scripts/verify-collection-policies.mjs
 *   npm run check:collection-policies
 *
 * `SUPABASE_URL` / `SUPABASE_ANON_KEY` are read from the environment or from `.env.local`, as are
 * the `VITE_`-prefixed names, so the check uses the same values the testbed was built with.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PG_CHECK_VIOLATION = '23514';
const PG_FK_VIOLATION = '23503';
const PG_RLS_VIOLATION = '42501';

/** The preference that cannot work against an INSERT-only, SELECT-less role. */
export const FORBIDDEN_PREFERENCE = 'resolution=ignore-duplicates';

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
    // No .env.local is normal in CI; the environment must supply the values.
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

/**
 * Interprets a probe that must reach a constraint to prove the policy applied.
 * Exported for testing.
 */
export function classifyProbe(status, code, expectedConstraint) {
  if (code === expectedConstraint) {
    return { ok: true, verdict: 'policy applies', detail: `reached the constraint (${expectedConstraint})` };
  }
  if (code === PG_RLS_VIOLATION) {
    return {
      ok: false,
      verdict: 'stopped at Row Level Security',
      detail: `refused by RLS (${PG_RLS_VIOLATION}) before the constraint`
    };
  }
  if (status >= 200 && status < 300) {
    return {
      ok: false,
      verdict: 'UNEXPECTED — the row was accepted',
      detail: `HTTP ${status} without reaching the constraint; a row may have been written`
    };
  }
  return {
    ok: false,
    verdict: 'unexpected response',
    detail: `HTTP ${status}, code ${code ?? 'none'} — expected ${expectedConstraint} or ${PG_RLS_VIOLATION}`
  };
}

/** Interprets the `research_sessions` probe. */
export function classifySessionsProbe(status, code) {
  return classifyProbe(status, code, PG_CHECK_VIOLATION);
}

/** Interprets the `research_traces` probe. */
export function classifyTracesProbe(status, code) {
  return classifyProbe(status, code, PG_FK_VIOLATION);
}

async function post(fetchImpl, url, anonKey, body, prefer) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
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

  const sessionBody = (suffix) => ({
    session_id: `${nonce}${suffix}`,
    upload_token: `${nonce}${suffix}`,
    provenance: 'scripted',
    // Satisfies the policy and violates the table CHECK: the insert cannot commit either way.
    condition_id: 'NOT_VALID'
  });

  const sessionsReadable = await get(fetchImpl, `${base}/rest/v1/research_sessions?select=session_id&limit=1`, anonKey);
  // A real column, so a rejection is the grant being absent rather than PostgREST failing to
  // resolve the column against its schema cache (which is a 400).
  const exportResponse = await get(fetchImpl, `${base}/rest/v1/research_export?select=session_id&limit=1`, anonKey);

  // 1. The insert policy, probed with the shape the testbed now sends.
  const sessions = await post(fetchImpl, `${base}/rest/v1/research_sessions`, anonKey, sessionBody(''), 'return=minimal');
  const traces = await post(
    fetchImpl,
    `${base}/rest/v1/research_traces`,
    anonKey,
    { session_id: `${nonce}-nonexistent`, upload_token: nonce, trace: { schemaVersion: '1.3.0', probe: nonce } },
    'return=minimal'
  );

  // 2. The same insert with the preference that requires a SELECT grant to evaluate. This is the
  //    probe that distinguishes "the policy is wrong" from "our header is wrong".
  const ignoreDuplicates = await post(
    fetchImpl,
    `${base}/rest/v1/research_sessions`,
    anonKey,
    sessionBody('-dup'),
    `${FORBIDDEN_PREFERENCE},return=minimal`
  );

  return {
    sessionsReadable,
    exportResponse,
    sessionsProbe: classifySessionsProbe(sessions.status, sessions.code),
    tracesProbe: classifyTracesProbe(traces.status, traces.code),
    ignoreDuplicatesProbe: classifySessionsProbe(ignoreDuplicates.status, ignoreDuplicates.code),
    raw: { sessions, traces, ignoreDuplicates }
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

  console.log('=== Research collection write-path verification ===');
  console.log(`Source: ${supabaseUrl}`);
  console.log('No probe can commit a row; see the header for why.\n');

  const report = await runPolicyChecks({ supabaseUrl, anonKey });
  const line = (label, detail) => console.log(`  ${label.padEnd(52)} ${detail}`);

  line('GET research_sessions', `${report.sessionsReadable.status} ${report.sessionsReadable.status === 200 ? '(table exists, anon key valid)' : '(UNEXPECTED)'}`);
  line('GET research_export', `${report.exportResponse.status} ${[401, 403].includes(report.exportResponse.status) ? '(revoked from anon — correct)' : '(UNEXPECTED)'}`);
  line('POST research_sessions (app shape)', `${report.raw.sessions.status} ${report.raw.sessions.code ?? ''} — ${report.sessionsProbe.verdict}`);
  line('POST research_traces (app shape)', `${report.raw.traces.status} ${report.raw.traces.code ?? ''} — ${report.tracesProbe.verdict}`);
  line(`POST research_sessions (${FORBIDDEN_PREFERENCE})`, `${report.raw.ignoreDuplicates.status} ${report.raw.ignoreDuplicates.code ?? ''} — ${report.ignoreDuplicatesProbe.verdict}`);
  console.log('');

  const policyApplies = report.sessionsProbe.ok && report.tracesProbe.ok;
  if (!policyApplies) {
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
    console.log('editor (it is idempotent). See docs/deploy/supabase-setup.md §5.');
    process.exit(1);
  }

  if (!report.ignoreDuplicatesProbe.ok) {
    console.log(`[verify-collection-policies] NOTE — the ${FORBIDDEN_PREFERENCE} preference is refused,`);
    console.log('as expected: PostgREST renders it as `INSERT ... ON CONFLICT DO NOTHING`, and PostgreSQL');
    console.log('applies the SELECT policies while looking for a conflicting row. The anon role has no');
    console.log('SELECT grant, so that preference cannot work here. The client must send');
    console.log('`Prefer: return=minimal` and treat a 409 as success — see the note on');
    console.log('`createSession` in src/telemetry/collectionClient.ts.');
    console.log('');
  }

  console.log('[verify-collection-policies] OK — the anon INSERT policy applies, and the request shape');
  console.log('the testbed sends is accepted. A completed task should be stored.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[verify-collection-policies] ERROR: ${err.message}`);
    process.exit(2);
  });
}
