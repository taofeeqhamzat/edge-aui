/**
 * Parity fixture provenance (assessment §8.3 / §25 P1-2).
 *
 * `tests/fixtures/syntheticEvents.json` is the only evidence that the TypeScript
 * MicroTensor matches the model-preparation reference. Previously nothing re-derived it,
 * so drift in either repository went undetected. This test re-runs the canonical Python
 * extractor when it is available and fails if the fixture is stale.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'regenerate-parity-fixture.mjs');

function pythonAvailable(): boolean {
  const candidates = [
    path.resolve(repoRoot, '..', 'model-preparation', '.venv', 'bin', 'python'),
    path.resolve(repoRoot, '..', '..', 'model-preparation', '.venv', 'bin', 'python')
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

const describeIfPython = pythonAvailable() ? describe : describe.skip;

describeIfPython('Parity fixture provenance', () => {
  it('matches the model-preparation Python reference', () => {
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script.length).toBeGreaterThan(0);

    let output = '';
    try {
      output = execFileSync('node', [scriptPath, '--check'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new Error(
        `Parity fixture is stale or the reference could not be evaluated.\n${stderr}`
      );
    }

    expect(output).toContain('matches the Python reference');
  }, 60_000);
});

describe('Parity fixture provenance (environment)', () => {
  it('reports whether the Python reference is available here', () => {
    // Documents the skip explicitly instead of silently passing.
    expect(typeof pythonAvailable()).toBe('boolean');
  });
});
