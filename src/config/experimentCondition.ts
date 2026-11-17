/**
 * Production Experiment Condition Control
 *
 * The condition is the independent variable of the baseline/adaptive contrast: it decides
 * whether the intervention actuator is permitted to mutate the DOM. It is therefore resolved
 * from configuration once, before the participant session starts, and then held fixed.
 *
 * The controls deliberately mirror `VITE_AUI_DIAGNOSTICS` / `?auiDiagnostics=1` in
 * `src/runtime/diagnostics.ts`: a build-time environment default, a query-string override
 * that wins when it is valid, and a safe fallback when neither is usable.
 */

import type { ExperimentalCondition } from '../telemetry/events';

/** Name of the build-time environment variable. */
export const EXPERIMENT_CONDITION_ENV_KEY = 'VITE_AUI_EXPERIMENT_CONDITION';

/** Name of the URL query parameter that overrides the build-time default. */
export const EXPERIMENT_CONDITION_QUERY_KEY = 'auiCondition';

/**
 * Condition used when neither control supplies a supported value.
 *
 * `adaptive` preserves the behaviour every existing build had before this control existed,
 * and it is the condition the testbed is designed around. A missing or malformed value must
 * not silently turn the adaptive pipeline off.
 */
export const DEFAULT_EXPERIMENT_CONDITION: ExperimentalCondition = 'adaptive';

/** Exact accepted values. A value is validated, never inferred. */
export function parseExperimentCondition(
  raw: string | null | undefined
): ExperimentalCondition | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === 'adaptive' || value === 'baseline') return value;
  return null;
}

/**
 * Raw configuration inputs.
 *
 * Both fields are optional so the production path reads the environment and the page URL,
 * while a test or embedding application can supply the values directly. `undefined` means
 * "read the real source"; an explicit `null` means "this source supplied nothing".
 */
export interface ExperimentConditionSources {
  /** Value of `VITE_AUI_EXPERIMENT_CONDITION`. */
  envCondition?: string | null;
  /** Page query string, including the leading `?`. */
  search?: string | null;
}

/** A trimmed, non-empty string, or `null` when the source supplied nothing usable. */
function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readEnvCondition(): string | null {
  try {
    const env = (import.meta as ImportMeta & {
      env?: { VITE_AUI_EXPERIMENT_CONDITION?: string };
    }).env;
    const value = readString(env.VITE_AUI_EXPERIMENT_CONDITION);
    if (value) return value;
  } catch {
    // Fall through to the Node-style environment, which the test runner and an embedding
    // server use. A browser build has no `process`.
  }
  try {
    return typeof process !== 'undefined'
      ? readString(process.env[EXPERIMENT_CONDITION_ENV_KEY])
      : null;
  } catch {
    return null;
  }
}

function readPageSearch(): string {
  try {
    if (typeof window === 'undefined') return '';
    return window.location.search;
  } catch {
    return '';
  }
}

function resolveSearchSource(sources: ExperimentConditionSources): string {
  if (sources.search === undefined) return readPageSearch();
  if (sources.search === null) return '';
  return sources.search;
}

function readQueryCondition(search: string): string | null {
  try {
    return new URLSearchParams(search).get(EXPERIMENT_CONDITION_QUERY_KEY);
  } catch {
    return null;
  }
}

function warnIgnored(source: string, raw: string): void {
  console.warn(
    `[ExperimentCondition] Ignoring unsupported ${source} value '${raw}'. ` +
      `Supported values are 'adaptive' and 'baseline'.`
  );
}

/**
 * Returns the first supported candidate, warning about any non-empty value that was ignored.
 * Keeping the precedence as a list means each source is validated the same way.
 */
function firstSupported(
  candidates: Array<{ source: string; raw: string | null }>
): ExperimentalCondition | null {
  for (const { source, raw } of candidates) {
    const value = readString(raw);
    if (value === null) continue;
    const parsed = parseExperimentCondition(value);
    if (parsed) return parsed;
    warnIgnored(source, value);
  }
  return null;
}

/**
 * Resolves the experiment condition for a new session.
 *
 * Precedence matches the diagnostics control: a valid URL value overrides a valid
 * environment value, and an unusable value at one level falls through to the next. An
 * invalid URL value therefore cannot suppress a valid configured default, and neither can
 * fail initialization.
 */
export function resolveExperimentCondition(
  sources: ExperimentConditionSources = {}
): ExperimentalCondition {
  const rawEnv =
    sources.envCondition !== undefined ? sources.envCondition : readEnvCondition();
  const search = resolveSearchSource(sources);
  const resolved = firstSupported([
    {
      source: `query parameter '${EXPERIMENT_CONDITION_QUERY_KEY}'`,
      raw: readQueryCondition(search)
    },
    { source: EXPERIMENT_CONDITION_ENV_KEY, raw: rawEnv }
  ]);
  if (resolved) return resolved;
  return DEFAULT_EXPERIMENT_CONDITION;
}
