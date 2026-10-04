/**
 * Collection client request shape
 *
 * The testbed's uploads were impossible for a reason that no amount of reading the SQL explained:
 * the client sent `Prefer: resolution=ignore-duplicates`, PostgREST rendered it as
 * `INSERT ... ON CONFLICT DO NOTHING`, and PostgreSQL applies the table's **`SELECT`** policies
 * while looking for a conflicting row. The `anon` role holds no `SELECT` grant by design, so every
 * insert was refused with `42501 new row violates row-level security policy` — a message that reads
 * like a broken policy and is not one.
 *
 * These tests pin the request shape so it cannot come back, and pin the replacement idempotency
 * mechanism (a 409 is the row already being there, which is the desired end state).
 */

import { describe, it, expect, vi } from 'vitest';
import { ResearchCollectionClient } from '../src/telemetry/collectionClient';

const config = {
  url: 'https://example.supabase.co',
  anonKey: 'anon-key',
  mode: 'scripted' as const,
  configured: true
};

function clientWith(fetchImpl: typeof fetch) {
  return new ResearchCollectionClient({ config, fetchImpl });
}

function response(status: number, body = '') {
  return new Response(body, { status, statusText: String(status) });
}

const sessionRecord = {
  session_id: 's-1',
  upload_token: 's-1:token',
  provenance: 'scripted' as const,
  status: 'Completed'
};

describe('collection client request shape', () => {
  it('never sends resolution=ignore-duplicates', async () => {
    const fetchImpl = vi.fn(async () => response(201));
    await clientWith(fetchImpl as unknown as typeof fetch).createSession(sessionRecord);

    const headers = fetchImpl.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Prefer).toBe('return=minimal');
    expect(headers.Prefer).not.toContain('resolution=ignore-duplicates');
    // The preference is the only thing that changed; authentication must be untouched.
    expect(headers.apikey).toBe('anon-key');
    expect(headers.Authorization).toBe('Bearer anon-key');
  });

  it('never sends it on the trace upload either', async () => {
    const fetchImpl = vi.fn(async () => response(201));
    await clientWith(fetchImpl as unknown as typeof fetch).uploadTrace({
      session_id: 's-1',
      upload_token: 's-1:token',
      trace: { schemaVersion: '1.3.0' }
    });

    const headers = fetchImpl.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Prefer).toBe('return=minimal');
    expect(headers.Prefer).not.toContain('resolution=ignore-duplicates');
  });

  it('treats a 409 as success, which is what replaces the old duplicate handling', async () => {
    // A retry presents the same primary key. The row it wanted to write already exists, so the
    // upload has reached its intended end state and must not be reported as a failure.
    const fetchImpl = vi.fn(async () => response(409, '{"code":"23505"}'));
    const result = await clientWith(fetchImpl as unknown as typeof fetch).createSession(sessionRecord);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(409);
  });

  it('still reports a genuine rejection with its reason', async () => {
    const fetchImpl = vi.fn(async () => response(401, '{"code":"42501","message":"denied"}'));
    const result = await clientWith(fetchImpl as unknown as typeof fetch).createSession(sessionRecord);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('401');
    expect(result.error).toContain('42501');
  });

  it('reports a 400 constraint violation as a failure, not as a stored row', async () => {
    const fetchImpl = vi.fn(async () => response(400, '{"code":"23514","message":"check violated"}'));
    const result = await clientWith(fetchImpl as unknown as typeof fetch).createSession(sessionRecord);

    expect(result.ok).toBe(false);
  });

  it('does not call the network at all when collection is unconfigured', async () => {
    const fetchImpl = vi.fn(async () => response(201));
    const client = new ResearchCollectionClient({
      config: { ...config, anonKey: null, configured: false },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const result = await client.createSession(sessionRecord);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
