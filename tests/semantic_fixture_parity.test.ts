/**
 * Cross-language semantic fixture parity (Task 40.2)
 *
 * `model-preparation/tests/fixtures/semantic_outcome_fixtures.json` is the shared contract for
 * the Python semantic target generator. This test proves the TypeScript testbed vocabulary
 * derives the same ID for every fixture event, so the two implementations cannot drift.
 *
 * The sibling repository is required; the test skips when it is absent (standalone checkout).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalActionFor } from '../src/outcome/canonical';
import { createTestbedSemanticRules } from '../src/testbed/config/semanticOutcomes';
import type { BehaviourEvent } from '../src/telemetry/events';

const fixturePath = path.resolve(
  __dirname,
  '../../model-preparation/tests/fixtures/semantic_outcome_fixtures.json'
);

interface FixtureCase {
  name: string;
  event: Record<string, unknown>;
  expected: string | null;
}

const fixture = fs.existsSync(fixturePath)
  ? (JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as { cases: FixtureCase[] })
  : null;

const rules = createTestbedSemanticRules();

/** The deriver's rule path, without route backtracking (fixtures are single events). */
function deriveOutcome(event: Record<string, unknown>): string | null {
  const action = canonicalActionFor(event as BehaviourEvent);
  if (!action || action.systemInitiated) return null;
  for (const rule of rules) {
    const match = rule.match(action);
    if (match) return match.outcomeId;
  }
  return null;
}

describe.skipIf(!fixture)('Semantic fixture parity with model-preparation', () => {
  it('derives the same semantic ID for every shared fixture', () => {
    for (const testCase of fixture!.cases) {
      expect(deriveOutcome(testCase.event), testCase.name).toBe(testCase.expected);
    }
  });

  it('declares inspect_help so the fixture vocabulary stays honest', () => {
    expect(deriveOutcome({ type: 'click', componentId: 'tooltip-region', componentRole: 'tooltip' }))
      .toBe('inspect_help');
  });
});
