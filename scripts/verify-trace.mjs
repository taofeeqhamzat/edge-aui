#!/usr/bin/env node
/**
 * Trace Verification CLI
 *
 * Applies the framework's single trace-verification contract to an exported ExperimentTrace.
 * The rules live in `src/telemetry/traceAttributionVerifier.ts`; this file is the command-line
 * front end, not a second implementation.
 *
 * Verification checks structural validity, one canonical clock, correlation IDs, task
 * lifecycle consistency, outcome settlement, intervention terminal states, policy-decision
 * attribution, prediction→window attribution, baseline invariance and provenance.
 *
 * Legacy `1.1.0`–`1.3.0` captures are accepted and *reported* with the guarantees they cannot
 * satisfy. A capture whose `schemaVersion` is unknown is rejected.
 *
 * Usage:
 *   node scripts/verify-trace.mjs <trace.json> [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadVerificationModule } from './lib/load-verifier.mjs';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const positional = args.filter((argument) => argument !== '--json');

if (positional.length === 0) {
  console.error('Usage: node scripts/verify-trace.mjs <trace-file.json> [--json]');
  process.exit(1);
}

const tracePath = path.resolve(process.cwd(), positional[0]);
if (!fs.existsSync(tracePath)) {
  console.error(`Trace file not found: ${tracePath}`);
  process.exit(1);
}

let traceData;
try {
  traceData = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
} catch (error) {
  console.error(`Failed to parse trace JSON from ${tracePath}:`, error.message);
  process.exit(1);
}

let verificationModule;
try {
  verificationModule = await loadVerificationModule();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const report = verificationModule.verifyTraceCompleteness(traceData);

if (jsonOutput) {
  console.log(
    JSON.stringify(
      {
        file: path.basename(tracePath),
        valid: report.valid,
        checks: report.checks
      },
      null,
      2
    )
  );
} else {
  console.log(`\nVerifying trace: ${path.basename(tracePath)}`);
  console.log('='.repeat(64));
  console.log(`Schema: ${String(traceData?.schemaVersion)}`);

  for (const check of report.checks) {
    const symbol = check.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${symbol}] ${check.check}`);
    if (check.message) {
      const stream = check.passed ? console.log : console.error;
      stream(`       ${check.message}`);
    }
  }

  console.log('='.repeat(64));
  if (report.valid) {
    console.log('Trace is structurally complete, attributable, and verified.\n');
  } else {
    console.error('Trace verification FAILED.\n');
  }
}

process.exit(report.valid ? 0 : 1);
