/**
 * Research collection write-path verifier
 *
 * Two things have to stay true about this script, and both have already been wrong once:
 *
 * 1. **No probe can commit a row.** Every probe satisfies the policy and violates a constraint
 *    evaluated afterwards, so the insert aborts either way.
 * 2. **It distinguishes a broken policy from a broken request shape.** An earlier version asked
 *    only the first question, so it reported "the policy does not apply" when the policy was fine
 *    and the `resolution=ignore-duplicates` preference was the real cause — and that wrong answer
 *    nearly led to a needless change to a live security policy.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyProbe,
  classifySessionsProbe,
  classifyTracesProbe,
  runPolicyChecks,
  readConfig,
  FORBIDDEN_PREFERENCE
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
  prefer: string | undefined;
}

/** Stubs fetch, routing each call to a canned reply and recording every POST. */
function stubFetch(handlers: {
  sessionsPost: (prefer: string | undefined) => unknown;
  tracesPost: () => unknown;
  get?: () => unknown;
}) {
  const captured: CapturedRequest[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (init.method === 'POST') {
      captured.push({ url: String(url), body, prefer: headers.Prefer });
    }
    if (String(url).includes('research_traces')) return handlers.tracesPost() as never;
    if (init.method === 'POST') return handlers.sessionsPost(headers.Prefer) as never;
    return (handlers.get?.() ?? reply(200, null)) as never;
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, captured };
}

const base = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon-key' };

describe('probe verdicts', () => {
  it('treats reaching the constraint as proof the policy applied', () => {
    expect(classifyProbe(400, '23514', '23514').ok).toBe(true);
    expect(classifyProbe(409, '23503', '23503').ok).toBe(true);
  });

  it('treats an RLS refusal as proof the policy did not apply', () => {
    const verdict = classifyProbe(401, '42501', '23514');
    expect(verdict.ok).toBe(false);
    expect(verdict.verdict).toBe('stopped at Row Level Security');
  });

  it('does not treat an accepted row as a pass', () => {
    const verdict = classifyProbe(201, null, '23514');
    expect(verdict.ok).toBe(false);
    expect(verdict.verdict).toContain('row was accepted');
  });

  it('does not mistake any other response for a passing policy', () => {
    for (const code of ['23502', '42P01', 'PGRST204', null]) {
      expect(classifySessionsProbe(400, code).ok).toBe(false);
      expect(classifyTracesProbe(400, code).ok).toBe(false);
    }
  });
});

describe('runPolicyChecks', () => {
  it('passes when the app shape reaches both constraints', async () => {
    const { fetchImpl } = stubFetch({
      sessionsPost: () => reply(400, '23514'),
      tracesPost: () => reply(409, '23503')
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });

    expect(report.sessionsProbe.ok).toBe(true);
    expect(report.tracesProbe.ok).toBe(true);
  });

  it('separates a passing policy from the preference that cannot work', async () => {
    // The live shape observed on this project: the app's own request is accepted, and the same
    // insert carrying `resolution=ignore-duplicates` is stopped at RLS.
    const { fetchImpl } = stubFetch({
      sessionsPost: (prefer) => (prefer?.includes(FORBIDDEN_PREFERENCE) ? reply(401, '42501') : reply(400, '23514')),
      tracesPost: () => reply(409, '23503')
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });

    expect(report.sessionsProbe.ok).toBe(true);
    expect(report.tracesProbe.ok).toBe(true);
    expect(report.ignoreDuplicatesProbe.ok).toBe(false);
  });

  it('reports the policy as not applying when the app shape is also refused', async () => {
    const { fetchImpl } = stubFetch({
      sessionsPost: () => reply(401, '42501'),
      tracesPost: () => reply(401, '42501')
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });

    expect(report.sessionsProbe.ok).toBe(false);
    expect(report.tracesProbe.ok).toBe(false);
    expect(report.sessionsProbe.detail).toContain('42501');
  });

  it('never sends the forbidden preference on the app-shape probes', async () => {
    const { fetchImpl, captured } = stubFetch({
      sessionsPost: () => reply(400, '23514'),
      tracesPost: () => reply(409, '23503')
    });

    await runPolicyChecks({ ...base, fetchImpl });

    const appShape = captured.filter((request) => !request.prefer?.includes(FORBIDDEN_PREFERENCE));
    expect(appShape).toHaveLength(2);
    for (const request of appShape) {
      expect(request.prefer).toBe('return=minimal');
      expect(request.prefer).not.toContain(FORBIDDEN_PREFERENCE);
    }
    // Exactly one probe demonstrates the trap, so the script keeps documenting why.
    expect(captured.filter((request) => request.prefer?.includes(FORBIDDEN_PREFERENCE))).toHaveLength(1);
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

    // Traces: satisfies the policy's WITH CHECK, references a parent that cannot exist, so the
    // foreign key aborts the insert.
    expect(traces?.body.trace).toBeTypeOf('object');
    expect(String(traces?.body.session_id)).toMatch(/-nonexistent$/);
  });

  it('probes the export view with a real column, so a rejection is the grant being absent', async () => {
    const { fetchImpl } = stubFetch({
      sessionsPost: () => reply(400, '23514'),
      tracesPost: () => reply(409, '23503'),
      get: () => reply(401, null)
    });

    const report = await runPolicyChecks({ ...base, fetchImpl });
    expect(report.exportResponse.status).toBe(401);
  });
});

describe('readConfig', () => {
  it('prefers the non-prefixed names the export script documents', () => {
    const config = readConfig({
      SUPABASE_URL: 'https://a.supabase.co',
      VITE_SUPABASE_URL: 'https://b.supabase.co',
      SUPABASE_ANON_KEY: 'k'
    });
    expect(config.supabaseUrl).toBe('https://a.supabase.co');
  });

  it('accepts the VITE_-prefixed names the testbed is built with', () => {
    const config = readConfig({ VITE_SUPABASE_URL: 'https://b.supabase.co', VITE_SUPABASE_ANON_KEY: 'k2' });
    expect(config.supabaseUrl).toBe('https://b.supabase.co');
    expect(config.anonKey).toBe('k2');
  });

  it('ignores blank values rather than treating them as configured', () => {
    const config = readConfig({ SUPABASE_URL: '   ', VITE_SUPABASE_URL: '', SUPABASE_ANON_KEY: 'k' });
    expect(config.supabaseUrl).not.toBe('');
  });
});
