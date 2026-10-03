/**
 * Supabase Research Collection Client
 *
 * A thin `fetch` client over the two research tables, deliberately without the Supabase SDK:
 * three operations do not justify ~100 kB in a bundle that has a 500 kB budget (ADR-008),
 * and a hand-rolled client makes the egress surface auditable in one file.
 *
 * The client can only INSERT. There is no read path, by design: the anon role has no SELECT
 * grant on the research tables (see `supabase/migrations`), so a public testbed cannot read
 * or modify other traces even if the anon key is public. Retrieval is a researcher action
 * performed with a service-role key outside the browser.
 */

import type { SupabaseCollectionConfig } from '../config/supabaseConfig';

export interface UploadSessionRecord {
  session_id: string;
  upload_token: string;
  experiment_id?: string | null;
  condition_id?: string | null;
  provenance: 'scripted' | 'participant';
  participant_id?: string | null;
  task_id?: string | null;
  trace_schema_version?: string | null;
  application_version?: string | null;
  model_version?: string | null;
  policy_version?: string | null;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UploadTraceRecord {
  session_id: string;
  upload_token: string;
  trace: unknown;
  trace_schema_version?: string | null;
}

export type UploadResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string };

export interface CollectionClientOptions {
  config: SupabaseCollectionConfig;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ResearchCollectionClient {
  private readonly config: SupabaseCollectionConfig;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;

  constructor(options: CollectionClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** True when a URL, an anon key and an upload-permitting mode are all present. */
  public isConfigured(): boolean {
    return this.config.configured;
  }

  /**
   * Inserts a session row.
   *
   * `Prefer: resolution=ignore-duplicates` makes a retry a no-op rather than a duplicate when
   * the table's unique constraint is hit, which is the only idempotency guarantee available
   * without a SELECT grant.
   */
  public async createSession(record: UploadSessionRecord): Promise<UploadResult> {
    return this.insert('research_sessions', record, 'resolution=ignore-duplicates');
  }

  public async uploadTrace(record: UploadTraceRecord): Promise<UploadResult> {
    return this.insert('research_traces', record, 'resolution=ignore-duplicates');
  }

  private async insert(
    table: string,
    body: unknown,
    prefer: string
  ): Promise<UploadResult> {
    if (!this.config.configured || !this.config.url || !this.config.anonKey) {
      return { ok: false, status: null, error: 'Collection is not configured for this build' };
    }
    if (!this.fetchImpl) {
      return { ok: false, status: null, error: 'No fetch implementation is available' };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller !== null
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;

    try {
      const response = await this.fetchImpl(`${this.config.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.config.anonKey,
          Authorization: `Bearer ${this.config.anonKey}`,
          // A failed upload must be visible to the caller; silently ignoring conflicts would
          // hide the difference between "already uploaded" and "never stored".
          Prefer: `${prefer},return=minimal`
        },
        body: JSON.stringify(body),
        signal: controller?.signal
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return {
          ok: false,
          status: response.status,
          error: `${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`
        };
      }
      return { ok: true, status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: null, error: `Network failure: ${message}` };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export function createResearchCollectionClient(
  options: CollectionClientOptions
): ResearchCollectionClient {
  return new ResearchCollectionClient(options);
}
