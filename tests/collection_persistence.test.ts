/**
 * Research Trace Collection (supervisor-ready deployment §10 / §11 — assessment F-16)
 *
 * Verifies the properties the milestone actually depends on, not the mechanism:
 * - a completed session is stored durably and survives a reload;
 * - a failed upload is visible, counted and retryable;
 * - a duplicate retry does not create a second record;
 * - an interrupted session is reported incomplete, never complete;
 * - an unconfigured build attempts no network call at all;
 * - provenance gates egress, so participant telemetry never leaves the client in the
 *   default `scripted` collection mode.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResearchCollection, buildSessionRecord } from '../src/telemetry/collection';
import { LocalSessionStore, createMemoryBackend } from '../src/telemetry/localStore';
import {
  resolveSupabaseCollectionConfig,
  mayUploadProvenance
} from '../src/config/supabaseConfig';
import { ExperimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { experimentRecorder } from '../src/telemetry/recorder';

/** Minimal valid trace for the upload path. */
function seedRecorder(provenance: 'scripted' | 'participant' = 'scripted'): string {
  sessionManager.startSession({
    experimentId: 'exp-test',
    conditionId: 'adaptive',
    provenance
  });
  const session = sessionManager.getActiveSession()!;
  experimentRecorder.clear();
  experimentRecorder.bindSession(session);
  experimentRecorder.recordBehaviourEvent({ timestamp: Date.now(), type: 'click' });
  return session.sessionId;
}

const configured = { url: 'https://example.supabase.co', anonKey: 'anon-key' };

function jsonResponse(status = 201): Response {
  return new Response('', { status, statusText: status === 201 ? 'Created' : 'Error' });
}

describe('Supabase collection configuration', () => {
  it('treats a missing URL or key as unconfigured rather than failing', () => {
    expect(resolveSupabaseCollectionConfig({ url: null, anonKey: null }).configured).toBe(false);
    expect(resolveSupabaseCollectionConfig({ url: configured.url, anonKey: null }).configured).toBe(false);
  });

  it('treats a malformed URL as unconfigured instead of passing it to fetch', () => {
    const config = resolveSupabaseCollectionConfig({ url: 'not a url', anonKey: 'k' });
    expect(config.url).toBeNull();
    expect(config.configured).toBe(false);
  });

  it('falls back to the safer mode when the configured mode is unrecognised', () => {
    const config = resolveSupabaseCollectionConfig({
      url: configured.url,
      anonKey: configured.anonKey,
      mode: 'unrecognised' as never
    });
    expect(config.mode).toBe('scripted');
  });

  it('refuses participant provenance in scripted mode and permits it in all mode', () => {
    expect(mayUploadProvenance('participant', 'scripted')).toBe(false);
    expect(mayUploadProvenance('participant', 'off')).toBe(false);
    expect(mayUploadProvenance('scripted', 'scripted')).toBe(true);
    expect(mayUploadProvenance('participant', 'all')).toBe(true);
  });
});

describe('Research collection: local durability', () => {
  it('marks a session left open by a previous load as incomplete, not complete', async () => {
    const backend = createMemoryBackend();
    const store = new LocalSessionStore(backend);

    await store.beginSession({
      sessionId: 'sess-interrupted',
      provenance: 'scripted',
      startedAtEpochMs: 1000
    });
    await store.saveTrace('sess-interrupted', { schemaVersion: '1.3.0' });

    // A new page load finds it still open.
    const recoverable = await store.findRecoverableSession();
    expect(recoverable?.sessionId).toBe('sess-interrupted');

    await store.markIncomplete(recoverable!.sessionId, 'Page reloaded while in progress');

    const after = await store.getSession('sess-interrupted');
    expect(after?.status).toBe('incomplete');
    expect(after?.incompleteReason).toContain('reloaded');
    // It must no longer be offered as in-progress work.
    expect(await store.findRecoverableSession()).toBeNull();
  });

  it('keeps the trace snapshot retrievable after the session is recorded', async () => {
    const backend = createMemoryBackend();
    const store = new LocalSessionStore(backend);
    await store.beginSession({ sessionId: 's1', provenance: 'scripted', startedAtEpochMs: 1 });
    await store.saveTrace('s1', { schemaVersion: '1.3.0', session: { sessionId: 's1' } });

    const stored = await store.getTrace('s1');
    expect(stored?.sessionId).toBe('s1');
    expect(stored?.uploaded).toBe(false);
  });

  it('reports a completed-but-unuploaded session as pending', async () => {
    const backend = createMemoryBackend();
    const store = new LocalSessionStore(backend);
    await store.beginSession({ sessionId: 's2', provenance: 'scripted', startedAtEpochMs: 1 });
    await store.markCompleted('s2');

    expect((await store.listPendingUploads()).map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('degrades to non-durable without throwing when no backend exists', async () => {
    const store = new LocalSessionStore(null);
    expect(store.durable).toBe(false);
    await expect(
      store.beginSession({ sessionId: 's3', provenance: 'scripted', startedAtEpochMs: 1 })
    ).resolves.toBeDefined();
    expect(await store.getSession('s3')).toBeNull();
  });
});

describe('Research collection: upload path', () => {
  beforeEach(() => {
    experimentRecorder.clear();
    sessionManager.resetSession();
  });

  it('uploads the session record then the trace, and records success', async () => {
    const sessionId = seedRecorder();
    const fetchImpl = vi.fn(async () => jsonResponse(201));

    const collection = new ResearchCollection({
      config: { ...configured, mode: 'scripted', configured: true },
      store: new LocalSessionStore(createMemoryBackend()),
      fetchImpl
    });

    const status = await collection.completeSession();

    expect(status.state).toBe('uploaded');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [sessionCall, traceCall] = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(sessionCall[0]).toContain('/rest/v1/research_sessions');
    expect(traceCall[0]).toContain('/rest/v1/research_traces');
    // The anon key travels as a header, never in the body or the URL.
    expect((sessionCall[1].headers as Record<string, string>).apikey).toBe('anon-key');
    expect(sessionCall[0]).not.toContain('anon-key');

    const body = JSON.parse(sessionCall[1].body as string);
    expect(body.session_id).toBe(sessionId);
    expect(body.provenance).toBe('scripted');
    expect(body.upload_token).toBeTruthy();
  });

  it('surfaces a failed upload with its reason and keeps the session for retry', async () => {
    seedRecorder();
    const backend = createMemoryBackend();
    const fetchImpl = vi.fn(async () => jsonResponse(403));

    const collection = new ResearchCollection({
      config: { ...configured, mode: 'scripted', configured: true },
      store: new LocalSessionStore(backend),
      fetchImpl
    });

    const status = await collection.completeSession();

    expect(status.state).toBe('failed');
    expect(status.lastError).toContain('403');
    const sessions = await collection.listSessions();
    expect(sessions[0].status).toBe('upload_failed');
    expect(sessions[0].uploadAttempts).toBe(1);
  });

  it('retries a failed upload and preserves the same upload token', async () => {
    seedRecorder();
    const backend = createMemoryBackend();
    let attempt = 0;
    const tokens: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.body as string)?.includes('"research_sessions"') === false) {
        // no-op
      }
      attempt++;
      tokens.push(JSON.parse(init!.body as string).upload_token);
      return attempt === 1 ? jsonResponse(500) : jsonResponse(201);
    });

    const collection = new ResearchCollection({
      config: { ...configured, mode: 'scripted', configured: true },
      store: new LocalSessionStore(backend),
      fetchImpl
    });

    const first = await collection.completeSession();
    expect(first.state).toBe('failed');

    const retried = await collection.retryPendingUploads();
    expect(retried.state).toBe('uploaded');
    // Same token on retry: this is what makes the retry idempotent rather than a duplicate.
    expect(new Set(tokens).size).toBe(1);
  });

  it('records the network failure reason rather than throwing', async () => {
    seedRecorder();
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    });

    const collection = new ResearchCollection({
      config: { ...configured, mode: 'scripted', configured: true },
      store: new LocalSessionStore(createMemoryBackend()),
      fetchImpl
    });

    const status = await collection.completeSession();
    expect(status.state).toBe('failed');
    expect(status.lastError).toContain('connection refused');
  });

  it('attempts no network call at all when collection is not configured', async () => {
    seedRecorder();
    const fetchImpl = vi.fn(async () => jsonResponse(201));

    const collection = new ResearchCollection({
      config: { url: null, anonKey: null, mode: 'scripted', configured: false },
      store: new LocalSessionStore(createMemoryBackend()),
      fetchImpl
    });

    const status = await collection.completeSession();

    expect(status.state).toBe('local_only');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses participant provenance in scripted mode without attempting upload', async () => {
    seedRecorder('participant');
    const fetchImpl = vi.fn(async () => jsonResponse(201));

    const collection = new ResearchCollection({
      config: { ...configured, mode: 'scripted', configured: true },
      store: new LocalSessionStore(createMemoryBackend()),
      fetchImpl
    });

    const status = await collection.completeSession();

    expect(status.state).toBe('local_only');
    expect(status.lastError).toContain('not permitted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uploads participant provenance only when the mode explicitly permits it', async () => {
    seedRecorder('participant');
    const fetchImpl = vi.fn(async () => jsonResponse(201));

    const collection = new ResearchCollection({
      config: { ...configured, mode: 'all', configured: true },
      store: new LocalSessionStore(createMemoryBackend()),
      fetchImpl
    });

    const status = await collection.completeSession();
    expect(status.state).toBe('uploaded');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports `off` mode as local-only with no requests', async () => {
    seedRecorder();
    const fetchImpl = vi.fn(async () => jsonResponse(201));

    const collection = new ResearchCollection({
      config: { url: configured.url, anonKey: configured.anonKey, mode: 'off', configured: false },
      store: new LocalSessionStore(createMemoryBackend()),
      fetchImpl
    });

    const status = await collection.completeSession();
    expect(status.state).toBe('local_only');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Upload payload mapping', () => {
  it('carries provenance, version identity and integrity evidence', () => {
    seedRecorder();
    const recorder = new ExperimentRecorder();
    recorder.bindSession(sessionManager.getActiveSession()!);
    recorder.recordBehaviourEvent({ timestamp: 1, type: 'click' });

    const trace = recorder.exportSerializable();
    const record = buildSessionRecord(trace, 'token-1');

    expect(record.provenance).toBe('scripted');
    expect(record.trace_schema_version).toBe(trace.schemaVersion);
    expect(record.application_version).toBeTruthy();
    expect(record.policy_version).toBeTruthy();
    expect(record.metadata?.clock).toBe('epoch_ms');
    // Truncation evidence must travel with the record so a consumer can tell a whole
    // capture from a partial one.
    expect(record.metadata?.evictions).toBeDefined();
    expect(Array.isArray(record.metadata?.integrityWarnings)).toBe(true);
  });
});
