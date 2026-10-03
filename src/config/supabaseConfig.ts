/**
 * Supabase Research Collection Configuration
 *
 * The research collection store is optional by design. A build with no Supabase
 * configuration must still run the testbed, record traces and export them locally — it
 * simply has nowhere to upload them, and it says so instead of failing silently.
 *
 * Only a public/anon key is ever read here. A service-role key is deliberately not
 * supported in the browser: it bypasses Row Level Security, so embedding one would hand
 * every visitor full read/write access to the research tables (deployment brief §11).
 */

/** How much telemetry this build is permitted to upload. */
export type CollectionMode =
  /** No upload, ever. Local recording and manual export only. */
  | 'off'
  /** Upload only traces whose provenance is `scripted`. The default. */
  | 'scripted'
  /** Upload any trace whose provenance permits collection. */
  | 'all';

export interface SupabaseCollectionConfig {
  url: string | null;
  anonKey: string | null;
  mode: CollectionMode;
  /** True when a URL and anon key are both present and the mode permits upload. */
  configured: boolean;
}

function readEnv(key: string): string | null {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const value = env?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

function parseMode(raw: string | null): CollectionMode {
  if (raw === 'off' || raw === 'all' || raw === 'scripted') return raw;
  if (raw !== null) {
    // An unrecognised mode is not silently treated as permissive. Falling back to the safer
    // default keeps a typo from enabling upload nobody intended.
    console.warn(
      `[SupabaseCollection] Unrecognised collection mode '${raw}'; falling back to 'scripted'.`
    );
  }
  return 'scripted';
}

/**
 * Reads the collection configuration from the build environment.
 *
 * A malformed URL is treated as unconfigured rather than passed to `fetch`, so a bad build
 * variable produces a visible "not configured" state instead of failing requests.
 */
export function resolveSupabaseCollectionConfig(
  overrides: Partial<SupabaseCollectionConfig> = {}
): SupabaseCollectionConfig {
  const rawUrl = overrides.url !== undefined ? overrides.url : readEnv('VITE_SUPABASE_URL');
  const anonKey = overrides.anonKey !== undefined ? overrides.anonKey : readEnv('VITE_SUPABASE_ANON_KEY');
  const rawMode =
    overrides.mode !== undefined ? (overrides.mode as string) : readEnv('VITE_AUI_COLLECTION_MODE');
  // Parsed after the override is applied, so an invalid explicit mode is caught too.
  const mode = parseMode(rawMode ?? null);

  let url: string | null = rawUrl ?? null;
  if (url !== null) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('unsupported protocol');
      }
      url = parsed.toString().replace(/\/+$/, '');
    } catch {
      console.warn(
        `[SupabaseCollection] VITE_SUPABASE_URL is not a valid absolute URL; collection is disabled.`
      );
      url = null;
    }
  }

  return {
    url,
    anonKey,
    mode,
    configured: url !== null && anonKey !== null && mode !== 'off'
  };
}

/**
 * Whether a trace with this provenance may be uploaded.
 *
 * This is the enforcement point, not a label: the egress boundary for this milestone is
 * "scripted traces only" (ADR-018), and the mode is what makes that boundary configurable
 * rather than implicit.
 */
export function mayUploadProvenance(
  provenance: 'scripted' | 'participant',
  mode: CollectionMode
): boolean {
  if (mode === 'off') return false;
  if (provenance === 'scripted') return true;
  // Participant telemetry requires an approved protocol and a consent workflow that does
  // not exist in this milestone, so `'scripted'` mode refuses it outright.
  return mode === 'all';
}
