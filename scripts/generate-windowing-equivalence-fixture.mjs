#!/usr/bin/env node
/**
 * Generates tests/fixtures/windowingEquivalenceStream.json using canonical Python logic
 * from model-preparation/src/preprocessing.py.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'windowingEquivalenceStream.json');

const PYTHON_DRIVER = String.raw`
import json, sys
import numpy as np

sys.path.insert(0, sys.argv[1])
from preprocessing import compute_window_microtensor, extract_session_microtensors

scenarios = [
    {
        "name": "scenario_a_boundary_event_on_edge",
        "description": "Event at t=250 lies exactly on boundary: half-open [0, 250) vs [250, 500)",
        "viewport": {"width": 1920, "height": 1080},
        "document": {"width": 1920, "height": 3000},
        "windowDurationMs": 500,
        "strideMs": 250,
        "events": [
            {"timestamp": 0, "type": "mousemove", "x": 0.1, "y": 0.1},
            {"timestamp": 100, "type": "mousemove", "x": 0.2, "y": 0.2},
            {"timestamp": 200, "type": "mousemove", "x": 0.3, "y": 0.3},
            {"timestamp": 250, "type": "mousemove", "x": 0.35, "y": 0.35},
            {"timestamp": 350, "type": "mousemove", "x": 0.45, "y": 0.45},
            {"timestamp": 450, "type": "mousemove", "x": 0.55, "y": 0.55}
        ],
        "slot0_events": [
            {"timestamp_ms": 0, "event_type": "mousemove", "x_norm": 0.1, "y_norm": 0.1},
            {"timestamp_ms": 100, "event_type": "mousemove", "x_norm": 0.2, "y_norm": 0.2},
            {"timestamp_ms": 200, "event_type": "mousemove", "x_norm": 0.3, "y_norm": 0.3}
        ],
        "slot1_events": [
            {"timestamp_ms": 250, "event_type": "mousemove", "x_norm": 0.35, "y_norm": 0.35},
            {"timestamp_ms": 350, "event_type": "mousemove", "x_norm": 0.45, "y_norm": 0.45},
            {"timestamp_ms": 450, "event_type": "mousemove", "x_norm": 0.55, "y_norm": 0.55}
        ]
    },
    {
        "name": "scenario_b_inactive_interval",
        "description": "Dense slot followed by 1000ms inactivity, then resumed interaction",
        "viewport": {"width": 1920, "height": 1080},
        "document": {"width": 1920, "height": 3000},
        "windowDurationMs": 500,
        "strideMs": 250,
        "events": [
            {"timestamp": 0, "type": "mousemove", "x": 0.1, "y": 0.1},
            {"timestamp": 100, "type": "mousemove", "x": 0.2, "y": 0.15},
            {"timestamp": 200, "type": "mousemove", "x": 0.25, "y": 0.2},
            {"timestamp": 1250, "type": "mousemove", "x": 0.3, "y": 0.3},
            {"timestamp": 1350, "type": "mousemove", "x": 0.4, "y": 0.4},
            {"timestamp": 1450, "type": "mousemove", "x": 0.5, "y": 0.5}
        ],
        "slot0_events": [
            {"timestamp_ms": 0, "event_type": "mousemove", "x_norm": 0.1, "y_norm": 0.1},
            {"timestamp_ms": 100, "event_type": "mousemove", "x_norm": 0.2, "y_norm": 0.15},
            {"timestamp_ms": 200, "event_type": "mousemove", "x_norm": 0.25, "y_norm": 0.2}
        ],
        "slot_resume_events": [
            {"timestamp_ms": 1250, "event_type": "mousemove", "x_norm": 0.3, "y_norm": 0.3},
            {"timestamp_ms": 1350, "event_type": "mousemove", "x_norm": 0.4, "y_norm": 0.4},
            {"timestamp_ms": 1450, "event_type": "mousemove", "x_norm": 0.5, "y_norm": 0.5}
        ]
    },
    {
        "name": "scenario_c_delayed_settlement_sparse_recovery",
        "description": "Slot sparse at nominal boundary that receives late event during settlement delay",
        "viewport": {"width": 1920, "height": 1080},
        "document": {"width": 1920, "height": 3000},
        "windowDurationMs": 500,
        "strideMs": 250,
        "events": [
            {"timestamp": 50, "type": "mousemove", "x": 0.1, "y": 0.1},
            {"timestamp": 100, "type": "mousemove", "x": 0.15, "y": 0.12},
            {"timestamp": 240, "type": "mousemove", "x": 0.2, "y": 0.18}
        ],
        "settled_events": [
            {"timestamp_ms": 50, "event_type": "mousemove", "x_norm": 0.1, "y_norm": 0.1},
            {"timestamp_ms": 100, "event_type": "mousemove", "x_norm": 0.15, "y_norm": 0.12},
            {"timestamp_ms": 240, "event_type": "mousemove", "x_norm": 0.2, "y_norm": 0.18}
        ]
    },
    {
        "name": "scenario_d_distribution_shifted_geometry",
        "description": "Shifted viewport dimensions (1280x720) and deep scroll to test normalisation",
        "viewport": {"width": 1280, "height": 720},
        "document": {"width": 1280, "height": 3600},
        "windowDurationMs": 500,
        "strideMs": 250,
        "events": [
            {"timestamp": 0, "type": "mousemove", "x": 0.05, "y": 0.95},
            {"timestamp": 100, "type": "mousemove", "x": 0.45, "y": 0.55},
            {"timestamp": 200, "type": "scroll", "scrollY": 0.8},
            {"timestamp": 220, "type": "scroll", "scrollY": 0.85}
        ],
        "slot_events": [
            {"timestamp_ms": 0, "event_type": "mousemove", "x_norm": 0.05, "y_norm": 0.95},
            {"timestamp_ms": 100, "event_type": "mousemove", "x_norm": 0.45, "y_norm": 0.55},
            {"timestamp_ms": 200, "event_type": "scroll", "scroll_y": 0.8},
            {"timestamp_ms": 220, "event_type": "scroll", "scroll_y": 0.85}
        ]
    },
    {
        "name": "scenario_e_session_start_end_partial",
        "description": "Anchored origin at t=1000, 2 dense slots, partial slot past stream end",
        "viewport": {"width": 1920, "height": 1080},
        "document": {"width": 1920, "height": 3000},
        "windowDurationMs": 500,
        "strideMs": 250,
        "events": [
            {"timestamp": 1000, "type": "mousemove", "x": 0.1, "y": 0.1},
            {"timestamp": 1100, "type": "mousemove", "x": 0.2, "y": 0.2},
            {"timestamp": 1200, "type": "mousemove", "x": 0.3, "y": 0.3},
            {"timestamp": 1260, "type": "mousemove", "x": 0.32, "y": 0.32},
            {"timestamp": 1360, "type": "mousemove", "x": 0.42, "y": 0.42},
            {"timestamp": 1460, "type": "mousemove", "x": 0.52, "y": 0.52},
            {"timestamp": 1550, "type": "mousemove", "x": 0.6, "y": 0.6}
        ],
        "slot0_events": [
            {"timestamp_ms": 1000, "event_type": "mousemove", "x_norm": 0.1, "y_norm": 0.1},
            {"timestamp_ms": 1100, "event_type": "mousemove", "x_norm": 0.2, "y_norm": 0.2},
            {"timestamp_ms": 1200, "event_type": "mousemove", "x_norm": 0.3, "y_norm": 0.3}
        ],
        "slot1_events": [
            {"timestamp_ms": 1260, "event_type": "mousemove", "x_norm": 0.32, "y_norm": 0.32},
            {"timestamp_ms": 1360, "event_type": "mousemove", "x_norm": 0.42, "y_norm": 0.42},
            {"timestamp_ms": 1460, "event_type": "mousemove", "x_norm": 0.52, "y_norm": 0.52}
        ]
    }
]

out = []
for sc in scenarios:
    vp = (float(sc["viewport"]["width"]), float(sc["viewport"]["height"]))
    doc = (float(sc["document"]["width"]), float(sc["document"]["height"]))
    dur = float(sc["windowDurationMs"])
    
    tensors = {}
    for k, v in sc.items():
        if k.endswith("_events") and isinstance(v, list) and len(v) > 0:
            t = compute_window_microtensor(v, viewport=vp, document=doc, window_duration_ms=dur)
            tensors[k] = [round(float(x), 6) for x in np.asarray(t).tolist()]
            
    sc["expectedMicroTensors"] = tensors
    out.append(sc)

print(json.dumps({"scenarios": out}, indent=2))
`;

function resolvePython() {
  const candidates = [
    path.resolve(repoRoot, '..', 'model-preparation', '.venv', 'bin', 'python'),
    path.resolve(repoRoot, '..', '..', 'model-preparation', '.venv', 'bin', 'python')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'python3';
}

function resolveModelPrep() {
  const candidates = [
    path.resolve(repoRoot, '..', 'model-preparation'),
    path.resolve(repoRoot, '..', '..', 'model-preparation')
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'src', 'preprocessing.py'))) return c;
  }
  throw new Error('Could not locate model-preparation repo');
}

const python = resolvePython();
const modelPrep = resolveModelPrep();

const stdout = execFileSync(
  python,
  ['-c', PYTHON_DRIVER, path.join(modelPrep, 'src')],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
);

fs.writeFileSync(fixturePath, stdout.trim() + '\n', 'utf8');
console.log(`[generate-windowing-equivalence-fixture] Successfully wrote ${fixturePath}`);
