#!/usr/bin/env node
/**
 * Regenerates the Python ↔ TypeScript MicroTensor parity fixture.
 *
 * The assessment (§8.3) found that `tests/fixtures/syntheticEvents.json` is a static
 * checked-in file: nothing re-derives it from the model-preparation reference, so drift
 * in either repository after the fixture was created would go undetected. This script
 * runs the canonical Python extractor over the fixture's scenarios and refreshes only the
 * `expectedMicroTensor` values.
 *
 * Usage:
 *   node scripts/regenerate-parity-fixture.mjs            # rewrite the fixture
 *   node scripts/regenerate-parity-fixture.mjs --check    # fail if the fixture is stale
 *
 * The Python interpreter is resolved from, in order:
 *   --python <path>, $AUI_PYTHON, <model-preparation>/.venv/bin/python, python3
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'syntheticEvents.json');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');

function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

function resolvePython() {
  const explicit = argValue('--python') ?? process.env.AUI_PYTHON;
  if (explicit) return explicit;

  const candidates = [
    path.resolve(repoRoot, '..', 'model-preparation', '.venv', 'bin', 'python'),
    path.resolve(repoRoot, '..', '..', 'model-preparation', '.venv', 'bin', 'python')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'python3';
}

function resolveModelPreparation() {
  const explicit = argValue('--model-preparation') ?? process.env.AUI_MODEL_PREPARATION;
  if (explicit) return path.resolve(explicit);

  const candidates = [
    path.resolve(repoRoot, '..', 'model-preparation'),
    path.resolve(repoRoot, '..', '..', 'model-preparation')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'src', 'preprocessing.py'))) return candidate;
  }
  throw new Error(
    'Could not locate the model-preparation repository. Pass --model-preparation <path> ' +
      'or set AUI_MODEL_PREPARATION.'
  );
}

/**
 * Python program: reads a scenario JSON document on stdin and writes the reference
 * MicroTensor for each scenario to stdout as JSON.
 */
const PYTHON_DRIVER = String.raw`
import json, sys, numpy as np

model_prep_src = sys.argv[1]
sys.path.insert(0, model_prep_src)
from preprocessing import compute_window_microtensor   # noqa: E402

payload = json.load(sys.stdin)
out = {}

for scenario in payload["scenarios"]:
    events = []
    for ev in scenario["events"]:
        converted = {
            "timestamp_ms": ev["timestamp"],
            "event_type": ev["type"],
        }
        if "x" in ev:
            converted["x_norm"] = ev["x"]
        if "y" in ev:
            converted["y_norm"] = ev["y"]
        if "scrollY" in ev:
            converted["scroll_y"] = ev["scrollY"]
        if "componentId" in ev:
            converted["target_id"] = ev["componentId"]
        events.append(converted)

    mask = scenario["modalitySupport"]
    viewport = (float(scenario["viewport"]["width"]), float(scenario["viewport"]["height"]))
    document = (float(scenario["document"]["width"]), float(scenario["document"]["height"]))

    tensor = compute_window_microtensor(
        events,
        viewport=viewport,
        document=document,
        window_duration_ms=float(scenario["windowDurationMs"]),
        has_pointer_support=bool(mask["pointer"]),
        has_dom_support=bool(mask["dom"]),
        has_scroll_support=bool(mask["scroll"]),
    )

    out[scenario["name"]] = [round(float(v), 6) for v in np.asarray(tensor).tolist()]

print(json.dumps(out))
`;

function main() {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const python = resolvePython();
  const modelPreparation = resolveModelPreparation();

  let reference;
  try {
    const stdout = execFileSync(
      python,
      ['-c', PYTHON_DRIVER, path.join(modelPreparation, 'src')],
      { input: JSON.stringify(fixture), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    reference = JSON.parse(stdout.trim());
  } catch (err) {
    console.error('[parity-fixture] Failed to run the Python reference extractor.');
    console.error(err.stderr || err.message);
    process.exit(1);
  }

  let changed = 0;
  for (const scenario of fixture.scenarios) {
    const expected = reference[scenario.name];
    if (!expected) {
      console.error(`[parity-fixture] Python produced no tensor for scenario '${scenario.name}'`);
      process.exit(1);
    }

    const current = scenario.expectedMicroTensor ?? [];
    const differs =
      current.length !== expected.length ||
      current.some((value, i) => Math.abs(value - expected[i]) > 1e-6);

    if (differs) {
      changed++;
      if (!checkOnly) {
        scenario.expectedMicroTensor = expected;
      } else {
        console.error(
          `[parity-fixture] STALE: scenario '${scenario.name}' differs from the Python reference`
        );
      }
    }
  }

  if (checkOnly) {
    if (changed > 0) {
      console.error(
        `[parity-fixture] ${changed} scenario(s) are stale. Run without --check to refresh.`
      );
      process.exit(1);
    }
    console.log('[parity-fixture] Fixture matches the Python reference.');
    return;
  }

  if (changed === 0) {
    console.log('[parity-fixture] Fixture already matches the Python reference; nothing to write.');
    return;
  }

  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`[parity-fixture] Updated ${changed} scenario(s) from ${python}`);
}

main();
