/**
 * Deployment asset gate — research collection check
 *
 * The gate exists so that a deployment property which was previously discovered by reading the
 * built output by hand fails the build instead. The property added here was found the hard way:
 * the deployed Worker served the application, satisfied every other check, and inlined **no**
 * Supabase configuration at all, because its build trigger carried no `VITE_*` variables. It was
 * only found by fetching the deployed bundle and grepping it.
 *
 * These tests run the real script against fixture directories, so they cover the check as it
 * actually executes rather than a re-implementation of it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'scripts', 'check-deploy-assets.mjs');

/** The files the other five checks require, so only the collection check varies. */
function writeSatisfyingDist(assets: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-assets-'));
  const write = (relative: string, content: string | Buffer) => {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  write('index.html', '<!doctype html><div id="root"></div>');
  write(
    '_headers',
    '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n'
  );
  write('models/model_int8.onnx', Buffer.alloc(8));
  write('models/intervention_head_int8.onnx', Buffer.alloc(8));
  write('assets/ort-wasm-simd-threaded-abc123.wasm', Buffer.alloc(16));
  write('assets/wasm_vectorizer_bg-abc123.wasm', Buffer.alloc(16));
  for (const [name, content] of Object.entries(assets)) {
    write(path.join('assets', name), content);
  }
  return dir;
}

function runGate(distDir: string, env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, '--dist', distDir], {
      encoding: 'utf8',
      // Capture stderr rather than inheriting it, so the deliberate failure case does not print
      // its expected error banner into this suite's output.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    return { status: 0, stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

const created: string[] = [];
function fixture(assets: Record<string, string> = {}): string {
  const dir = writeSatisfyingDist(assets);
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe('check-deploy-assets: research collection configuration', () => {
  it('still passes, but reports loudly, when the bundle has no Supabase configuration', () => {
    const result = runGate(fixture({ 'index-abc.js': 'console.log("no backend configured")' }));

    // Optional by design: the absence is a warning, not a failure.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Collection:     NOT CONFIGURED');
    expect(result.stdout).toContain('local_only');
    expect(result.stdout).toContain('cloudflare-pages-setup.md');
  });

  it('reports uploads enabled when the URL and an anon key are both inlined', () => {
    const result = runGate(
      fixture({
        'index-abc.js':
          'const u="https://abcdefghijklm.supabase.co";const k="sb_publishable_oxw1e3ilf29T0lqiV0xGwQ";'
      })
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Collection:     uploads enabled');
    expect(result.stdout).toContain('https://abcdefghijklm.supabase.co');
    expect(result.stdout).not.toContain('NOT CONFIGURED');
  });

  it('accepts a legacy JWT anon key as well as the publishable-key format', () => {
    const result = runGate(
      fixture({
        'index-abc.js':
          'const u="https://abcdefghijklm.supabase.co";const k="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.abc";'
      })
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Collection:     uploads enabled');
  });

  it('warns when the URL is inlined but the anon key is missing', () => {
    const result = runGate(
      fixture({ 'index-abc.js': 'const u="https://abcdefghijklm.supabase.co";' })
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('fails the build when REQUIRE_COLLECTION=1 and collection is unconfigured', () => {
    const result = runGate(fixture({ 'index-abc.js': 'console.log("nothing")' }), {
      REQUIRE_COLLECTION: '1'
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Research collection is not configured');
  });

  it('does not fail a configured build when REQUIRE_COLLECTION=1', () => {
    const result = runGate(
      fixture({
        'index-abc.js':
          'const u="https://abcdefghijklm.supabase.co";const k="sb_publishable_oxw1e3ilf29T0lqiV0xGwQ";'
      }),
      { REQUIRE_COLLECTION: '1' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-deploy-assets] OK');
  });
});
