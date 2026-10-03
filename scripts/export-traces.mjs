#!/usr/bin/env node
/**
 * Research Trace Export
 *
 * Reads collected traces from Supabase and writes one JSON file per session, ready for
 * `model-preparation` ingestion:
 *
 *   Supabase ──► scripts/export-traces.mjs ──► one JSON file per session
 *                                                    │
 *                                python3 -m src.data --ingest-traces <dir>
 *
 * ## Why this runs outside the browser
 *
 * The browser can only INSERT into the research tables. The anon role has no SELECT grant, by
 * design: an anonymous writer that can also read the table can enumerate every other session.
 * Export therefore requires the **service-role** key, which bypasses Row Level Security.
 *
 * That key must never reach a browser bundle, `.env.local`, or a Cloudflare Pages variable. Supply
 * it in the environment for this command only.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     node scripts/export-traces.mjs --out ./.data/collected
 *
 * Options:
 *   --out <dir>       Output directory (default ./.data/collected)
 *   --provenance <p>  Export only `scripted` or only `participant`
 *   --experiment <id> Export only one experiment
 *   --limit <n>       Maximum sessions to export
 *   --include-body    Also write the flattened metadata alongside each trace (default: yes)
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flagValue = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const outDir = path.resolve(flagValue('--out', './.data/collected'));
const provenance = flagValue('--provenance');
const experimentId = flagValue('--experiment');
const limit = flagValue('--limit');

function fail(message, hint) {
  console.error(`\n[export-traces] ERROR: ${message}`);
  if (hint) console.error(`               ${hint}`);
  process.exit(1);
}

if (!supabaseUrl) {
  fail('SUPABASE_URL is not set.', 'Example: SUPABASE_URL=https://<ref>.supabase.co');
}
if (!serviceRoleKey) {
  fail(
    'SUPABASE_SERVICE_ROLE_KEY is not set.',
    'Export requires the service-role key: the anon role has no SELECT grant on the research tables.\n' +
      '               Never commit this key or expose it to a browser.'
  );
}

/** Builds the PostgREST query for the export view. */
function buildUrl() {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', 'created_at.asc');
  if (provenance) params.set('provenance', `eq.${provenance}`);
  if (experimentId) params.set('experiment_id', `eq.${experimentId}`);
  if (limit) params.set('limit', String(limit));
  return `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/research_export?${params.toString()}`;
}

async function main() {
  console.log('=== Research trace export ===');
  console.log(`Source:   ${supabaseUrl}`);
  console.log(`Output:   ${outDir}`);
  console.log(`Filter:   provenance=${provenance ?? 'any'} experiment=${experimentId ?? 'any'}`);
  console.log('');

  const response = await fetch(buildUrl(), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    fail(
      `Request failed: ${response.status} ${response.statusText}`,
      detail.slice(0, 400) ||
        'Check that the migrations in supabase/migrations have been applied and that the key is the service-role key.'
    );
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No sessions matched. Nothing to export.');
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  let exported = 0;
  let skippedNoTrace = 0;
  const summary = [];

  for (const row of rows) {
    if (!row.trace) {
      // A session row with no trace means the second insert failed. Reported, not silently
      // treated as an empty session.
      skippedNoTrace++;
      console.warn(`  - ${row.session_id}: no trace payload stored (session record only)`);
      continue;
    }

    const trace = typeof row.trace === 'string' ? JSON.parse(row.trace) : row.trace;
    const file = path.join(outDir, `experiment-trace-${row.session_id}.json`);
    fs.writeFileSync(file, JSON.stringify(trace, null, 2));
    exported++;

    summary.push({
      sessionId: row.session_id,
      provenance: row.provenance,
      conditionId: row.condition_id,
      taskId: row.task_id,
      traceSchemaVersion: row.trace_schema_version ?? trace.schemaVersion,
      clock: row.trace_clock,
      behaviourEvents: trace.behaviourEvents?.length ?? 0,
      microTensors: trace.microTensors?.length ?? 0,
      predictions: trace.predictions?.length ?? 0,
      policyDecisions: trace.policyDecisions?.length ?? 0,
      interventions: trace.interventions?.length ?? 0,
      truncated: Boolean(row.evictions?.truncated),
      integrityWarnings: row.integrity_warnings ?? []
    });
  }

  const manifestPath = path.join(outDir, 'export-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        source: supabaseUrl,
        filter: { provenance: provenance ?? null, experimentId: experimentId ?? null },
        counts: { sessions: rows.length, exported, skippedNoTrace },
        sessions: summary
      },
      null,
      2
    )
  );

  console.log(`\nExported ${exported} trace(s) to ${outDir}`);
  if (skippedNoTrace > 0) {
    console.log(`Skipped ${skippedNoTrace} session(s) with no stored trace payload.`);
  }
  const truncated = summary.filter((s) => s.truncated).length;
  if (truncated > 0) {
    console.log(
      `\nWARNING: ${truncated} exported trace(s) are marked truncated by buffer eviction.` +
        '\n         They are missing their earliest records and must not be analysed as whole.' +
        '\n         See metadata.evictions in each trace.'
    );
  }
  console.log(`Manifest: ${manifestPath}`);
  console.log('\nNext:  cd ../model-preparation');
  console.log(`       python3 -m src.data --ingest-traces ${outDir}`);
}

main().catch((err) => {
  fail(String(err));
});
