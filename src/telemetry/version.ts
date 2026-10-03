/**
 * Version Identity for Research Provenance
 *
 * Every persisted trace must be attributable to the exact software that produced it
 * (supervisor-ready deployment §9 / §28). These constants exist so the values in a trace
 * are the values the code actually ran, rather than a literal typed into a report.
 */

/**
 * Application version. Kept in step with `package.json` `version`; asserted by
 * `tests/version_identity.test.ts` so the two cannot drift silently.
 */
export const APPLICATION_VERSION = '0.1.0';

/**
 * Policy version. Mirrors `LABEL_POLICY_VERSION` in
 * `model-preparation/src/intervention_label_policy.py` — the version of the deterministic
 * teacher that generated the synthetic intervention supervision.
 */
export const POLICY_VERSION = '1.0.0';

/** Trace contract version, re-exported here so provenance metadata has a single import. */
export { EXPERIMENT_TRACE_SCHEMA_VERSION } from './traceSchema';
