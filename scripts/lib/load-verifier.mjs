/**
 * Loads the TypeScript verification contracts for the command-line scripts.
 *
 * `scripts/verify-trace.mjs` and `scripts/compare-condition-traces.mjs` must apply the same
 * rules the runtime and the test suite apply. Re-implementing those rules in JavaScript is how
 * the CLI verifier came to accept `1.2.0` (and reject `1.4.0`) while the TypeScript verifier
 * had already moved on: two definitions of "valid" drift apart silently.
 *
 * Vite's SSR module loader evaluates the TypeScript source directly, so there is exactly one
 * implementation. The dev dependency is already required for tests and the build.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached = null;

/** Absolute path to the framework root (this file lives in `scripts/lib/`). */
export function frameworkRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Loads the trace verifier and the intervention vocabulary.
 *
 * The returned object exposes `verifyTraceCompleteness`, `canonicalContractApplies` and
 * `isInterventionType` from the framework source.
 */
export async function loadVerificationModule() {
  if (cached) return cached;

  let createServer;
  try {
    ({ createServer } = await import('vite'));
  } catch (error) {
    throw new Error(
      'The trace scripts load the TypeScript verifier through Vite. Run `npm install` in ' +
        `edge-aui-framework first (vite could not be imported: ${error.message}).`
    );
  }

  const server = await createServer({
    configFile: false,
    root: frameworkRoot(),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
  });

  try {
    const verifier = await server.ssrLoadModule('/src/telemetry/traceAttributionVerifier.ts');
    const interventions = await server.ssrLoadModule('/src/intervention/types.ts');
    cached = {
      verifyTraceCompleteness: verifier.verifyTraceCompleteness,
      canonicalContractApplies: verifier.canonicalContractApplies,
      isInterventionType: interventions.isInterventionType
    };
    return cached;
  } finally {
    // The modules are evaluated; the dev server is no longer needed.
    await server.close();
  }
}
