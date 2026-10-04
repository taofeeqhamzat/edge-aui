/**
 * Research collection policy verifier
 *
 * The verifier exists because "the migration is recorded as applied" stopped being sufficient
 * evidence that the INSERT policy is in force. Its whole value rests on one property: **no probe can
 * commit a row**. These tests hold it to that property as well as to its verdicts, because a probe
 * that could write would be worse than no probe at all.
 */

import { describe, it, expect } from 'vitest';
import {
  classifySessionsProbe,
  classifyTracesProbe,
  runPolicyChecks,
  readConfig
} from '../scripts/verify-collection-policies.mjs';

/** Minimal Response stand-in: the script reads `status` and, for POSTs, `json().code`. */
function reply(status: number, code: string | null) {
  return {
    status,
    json: async () => (code === null ? {} : { code, message: 'stub' })
  };
}

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

/** Stubs fetch, routing each call to a canned reply and recording every POST body. */
function stubFetch(handlers: {
  sessionsPost: () => unknown;
  tracesPost: () => unknown;
  get?: () => unknown;
}) {
  const captured: CapturedRequest[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (init.method === 'POST') captured.push({ url: String(url), body });
    if (String(url).includes('research_traces')) return handlers.tracesPost() as never;
    if (init.method === 'POST') return handlers.sessionsPost() as never;
    return (handlers.get?.() ?? reply(200, null)) as never;
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, captured };
}

const base = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon-key' };

describe('policy probe verdicts', () => {
  it('treats a reached table CHECK as proof the sessions policy applied', () => {
    const verdict = classifySessionsProbe(401, '23514');
    expect(verdict.ok).toBe(true);
    expect(verdict.verdict).toBe('policy applies');
  });

  it('treats an RLS refusal as proof the sessions policy did not apply', () => {
    const verdict = classifySessionsProbe(401, '42501');
    expect(verdict.ok).toBe(false);
    expect(verdict.verdict).toBe('policy does NOT apply');
  });

  it('treats a reached foreign key as proof the traces policy applied', () => {
    const verdict = classifyTracesProbe(401, '23503');
    expect(verdict.ok).toBe(true);
    expect(verdict.verdict).toBe('policy applies');
  });

  it('treats an RLS refusal as proof the traces policy did not apply', () => {
    const verdict = classifyTracesProbe(401, '42501');
    expect(verdict.ok).toBe(false);
  });

  it('does not mistake any other response for a passing policy', () => {
    for (const code of ['23502', '42P01', 'PGRST204', null]) {
      expect(classifySessionsProbe(400, code).ok).toBe(false);
      expect(classifyTracesProbe(400, code).ok).toBe(false);
    }
  });
});

describe('runPolicyChecks', () => {
  it('reports both policies as applying when the constraints are reached', async () => {
    const { fetchImpl } = stubFetch({
      sessionsPost: () => reply(401, '23514'),
      tracesPost: () => reply(401, '23503')
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });

    expect(report.sessionsProbe.ok).toBe(true);
    expect(report.tracesProbe.ok).toBe(true);
  });

  it('reports the observed failure when RLS refuses both probes', async () => {
    const { fetchImpl } = stubFetch({
      sessionsPost: () => reply(401, '42501'),
      tracesPost: () => reply(401, '42501')
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });

    expect(report.sessionsProbe.ok).toBe(false);
    expect(report.tracesProbe.ok).toBe(false);
    expect(report.sessionsProbe.detail).toContain('42501');
  });

  it('sends probe payloads that cannot commit a row', async () => {
    const { fetchImpl, captured } = stubFetch({
      sessionsPost: () => reply(401, '42501'),
      tracesPost: () => reply(401, '42501')
    });

    await runPolicyChecks({ ...base, fetchImpl });

    const sessions = captured.find((request) => request.url.endsWith('/research_sessions'));
    const traces = captured.find((request) => request.url.endsWith('/research_traces'));

    // Sessions: satisfies the policy's WITH CHECK, violates the table's condition_id CHECK.
    expect(sessions?.body.provenance).toBe('scripted');
    expect(String(sessions?.body.session_id)).not.toBe('');
    expect(String(sessions?.body.upload_token)).not.toBe('');
    expect(sessions?.body.condition_id).toBe('NOT_VALID');

    // Traces: satisfies the policy's WITH CHECK, references a parent that cannot exist.
    expect(traces?.body.trace).toBeTypeOf('object');
    expect(String(traces?.body.session_id)).toMatch(/-nonexistent$/);
    expect(traces?.body.session_id).not.toBe(sessions?.body.session_id);
  });

  it('probes the export view, whose revocation is part of the security posture', async () => {
    const { fetchImpl } = stubFetch({
      sessionsPost: () => reply(401, '23514'),
      tracesPost: () => reply(401, '23503'),
      get: () => reply(401, null)
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });
    expect(report.exportResponse.status).toBe(401);
  });
});

describe('readConfig', () => {
  it('prefers the non-prefixed names, which are what the export script documents', () => {
    const config = readConfig({ SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_URL: 'https://b.supabase.co', SUPABASE_ANON_KEY: 'k' });
    expect(config.supabaseUrl).toBe('https://a.supabase.co');
  });

  it('accepts the VITE_-prefixed names the testbed is built with', () => {
    const config = readConfig({ VITE_SUPABASE_URL: 'https://b.supabase.co', VITE_SUPABASE_ANON_KEY: 'k2' });
    expect(config.supabaseUrl).toBe('https://b.supabase.co');
    expect(config.anonKey).toBe('k2');
  });

  it('ignores blank values rather than treating them as configured', () => {
    const config = readConfig({ SUPABASE_URL: '   ', VITE_SUPABASE_URL: '', SUPABASE_ANON_KEY: 'k' });
    // Falls through to .env.local or null; either way it must not be a blank string.
    expect(config.supabaseUrl === null || config.supabaseUrl.length > 0).toBe(true);
    expect(config.supabaseUrl).not.toBe('');
  });
});
