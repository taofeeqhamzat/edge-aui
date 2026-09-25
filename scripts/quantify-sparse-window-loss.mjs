#!/usr/bin/env node
/**
 * Sparse-Window Loss Quantification Harness (Plan 1 Task 1.1)
 *
 * Replays recorded interaction traces through:
 * 1. Live RollingWindowBuffer with drop-once semantics (flushDelayMs = 0)
 * 2. Live RollingWindowBuffer with delayed-settlement semantics (flushDelayMs = 250)
 * 3. Canonical Python reference segmenter (model-preparation/src/preprocessing.py)
 *
 * Reports:
 * 1. events-per-slot distribution;
 * 2. count and percentage of slots sparse (< 3 events) at emission time;
 * 3. count of sparse slots that cross threshold with delayed arrival (lateEvents tail);
 * 4. fraction of emitted windows that are all-zero / inactivity windows;
 * 5. resulting window counts across all paths.
 *
 * Usage:
 *   node scripts/quantify-sparse-window-loss.mjs [--trace <path>] [--python <python-bin>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
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
  return null;
}

/**
 * Calculates distribution percentiles from an array of numbers.
 */
function calculateDistribution(numbers) {
  if (numbers.length === 0) {
    return { count: 0, min: 0, p25: 0, median: 0, mean: 0, p75: 0, p90: 0, p95: 0, max: 0 };
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;

  const percentile = (p) => {
    const idx = (p / 100) * (sorted.length - 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    const weight = idx - low;
    return sorted[low] * (1 - weight) + sorted[high] * weight;
  };

  return {
    count: sorted.length,
    min: sorted[0],
    p25: percentile(25),
    median: percentile(50),
    mean: Number(mean.toFixed(2)),
    p75: percentile(75),
    p90: percentile(90),
    p95: percentile(95),
    max: sorted[sorted.length - 1]
  };
}

/**
 * Simulates the live RollingWindowBuffer online grid processing.
 */
function simulateLiveRollingBuffer(events, options = {}) {
  const windowDurationMs = options.windowDurationMs ?? 500;
  const strideMs = options.strideMs ?? 250;
  const minEventsPerWindow = options.minEventsPerWindow ?? 3;
  const emitInactiveWindows = options.emitInactiveWindows ?? true;
  const flushDelayMs = options.flushDelayMs ?? 0;

  if (events.length === 0) {
    return {
      emittedTotal: 0,
      activeWindows: 0,
      inactiveWindows: 0,
      skippedSparse: 0,
      lateEvents: 0,
      windows: []
    };
  }

  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let lastWindowEnd = sortedEvents[0].timestamp;
  let skippedSparse = 0;
  let lateEvents = 0;
  const emittedWindows = [];

  // Replay timeline by simulating monotonic clock ticks
  const finalTime = sortedEvents[sortedEvents.length - 1].timestamp;
  const tickInterval = 50; // 50ms tick cadence matching typical browser rAF / timer

  let eventCursor = 0;
  const buffer = [];

  for (let now = lastWindowEnd; now <= finalTime + strideMs + flushDelayMs + tickInterval; now += tickInterval) {
    // Feed events that have arrived up to current time
    while (eventCursor < sortedEvents.length && sortedEvents[eventCursor].timestamp <= now) {
      buffer.push(sortedEvents[eventCursor]);
      eventCursor++;
    }

    // Process all eligible slots whose threshold has passed
    while (now - lastWindowEnd >= strideMs + flushDelayMs) {
      const windowStart = lastWindowEnd;
      const windowEnd = windowStart + strideMs;

      // HALF-OPEN slot [windowStart, windowEnd)
      const slotEvents = buffer.filter(
        (ev) => ev.timestamp >= windowStart && ev.timestamp < windowEnd
      );

      const isInactive = slotEvents.length === 0;
      const meetsMinimum = slotEvents.length >= minEventsPerWindow;

      if (!meetsMinimum && !(isInactive && emitInactiveWindows)) {
        skippedSparse++;
        lastWindowEnd = windowEnd;
      } else {
        emittedWindows.push({
          windowStart,
          windowEnd,
          eventCount: slotEvents.length,
          inactive: isInactive
        });
        lastWindowEnd = windowEnd;
      }
    }
  }

  const inactiveWindows = emittedWindows.filter((w) => w.inactive).length;
  const activeWindows = emittedWindows.length - inactiveWindows;

  return {
    emittedTotal: emittedWindows.length,
    activeWindows,
    inactiveWindows,
    skippedSparse,
    lateEvents,
    windows: emittedWindows
  };
}

/**
 * Runs Python reference segmentation on the event list.
 */
function runPythonReferenceExtractor(events, modelPrepPath, pythonBin) {
  if (!modelPrepPath) {
    return { available: false, count: 0, error: 'model-preparation repository not found' };
  }

  const pyEvents = events.map((ev) => ({
    timestamp_ms: Math.round(ev.timestamp),
    event_type: ev.type,
    x_norm: Number(ev.x ?? 0),
    y_norm: Number(ev.y ?? 0),
    viewport_w: Number(ev.viewport?.width ?? 1920),
    viewport_h: Number(ev.viewport?.height ?? 1080),
    doc_w: Number(ev.document?.width ?? 1920),
    doc_h: Number(ev.document?.height ?? 1080),
    target_id: String(ev.componentId ?? ''),
    scroll_y: Number(ev.scrollY ?? 0)
  }));

  const pythonScript = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
from preprocessing import extract_session_microtensors

events = json.load(sys.stdin)
tensors = extract_session_microtensors(
    events,
    window_size_ms=500,
    stride_ms=250,
    min_events_per_window=3
)
print(json.dumps({"count": int(len(tensors)), "shape": list(tensors.shape)}))
`;

  try {
    const stdout = execFileSync(
      pythonBin,
      ['-c', pythonScript, path.join(modelPrepPath, 'src')],
      {
        input: JSON.stringify(pyEvents),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      }
    );
    const result = JSON.parse(stdout.trim());
    return { available: true, count: result.count, shape: result.shape };
  } catch (err) {
    return { available: false, count: 0, error: err.stderr || err.message };
  }
}

/**
 * Analyzes a single trace file.
 */
function analyzeTrace(tracePath, modelPrepPath, pythonBin) {
  const content = fs.readFileSync(tracePath, 'utf8');
  const trace = JSON.parse(content);
  const traceName = path.basename(tracePath);
  const rawEvents = (trace.behaviourEvents || []).sort((a, b) => a.timestamp - b.timestamp);

  if (rawEvents.length === 0) {
    return null;
  }

  const t0 = rawEvents[0].timestamp;
  const tEnd = rawEvents[rawEvents.length - 1].timestamp;
  const durationMs = tEnd - t0;
  const numSlots = Math.floor(durationMs / 250);

  // 1. Events per 250ms slot distribution
  const slotCounts = [];
  let slotsSparseAtEmission = 0;
  let slotsZero = 0;
  let slotsDense = 0;

  for (let k = 0; k < numSlots; k++) {
    const start = t0 + k * 250;
    const end = start + 250;
    const count = rawEvents.filter((ev) => ev.timestamp >= start && ev.timestamp < end).length;
    slotCounts.push(count);

    if (count === 0) {
      slotsZero++;
    } else if (count < 3) {
      slotsSparseAtEmission++;
    } else {
      slotsDense++;
    }
  }

  // 2. Late arrivals / 1-stride lookahead crossing:
  // How many slots with 1-2 events would cross >= 3 if events from the immediate next stride [end, end+250) were considered?
  // (i.e. if the window is 500ms sliding window covering [start, start+500))
  let sparseCrossingThresholdIn500ms = 0;
  let sparseRemainingSparseIn500ms = 0;
  for (let k = 0; k < numSlots; k++) {
    const start = t0 + k * 250;
    const count250 = rawEvents.filter((ev) => ev.timestamp >= start && ev.timestamp < start + 250).length;
    if (count250 > 0 && count250 < 3) {
      const count500 = rawEvents.filter((ev) => ev.timestamp >= start && ev.timestamp < start + 500).length;
      if (count500 >= 3) {
        sparseCrossingThresholdIn500ms++;
      } else {
        sparseRemainingSparseIn500ms++;
      }
    }
  }

  // 3. Live simulation (flushDelayMs = 0, drop-once)
  const liveDropOnce = simulateLiveRollingBuffer(rawEvents, { flushDelayMs: 0 });

  // 4. Live simulation (flushDelayMs = 250, delayed settlement)
  const liveDelayed = simulateLiveRollingBuffer(rawEvents, { flushDelayMs: 250 });

  // 5. Python reference segmentation
  const pyRef = runPythonReferenceExtractor(rawEvents, modelPrepPath, pythonBin);

  const slotDist = calculateDistribution(slotCounts);

  return {
    traceName,
    sessionId: trace.session?.sessionId ?? 'unknown',
    conditionId: trace.session?.conditionId ?? 'unknown',
    durationMs: Math.round(durationMs),
    totalEvents: rawEvents.length,
    numSlots,
    slotDistribution: slotDist,
    slotsZero,
    slotsSparseAtEmission,
    slotsDense,
    sparseCrossingThresholdIn500ms,
    sparseRemainingSparseIn500ms,
    liveDropOnce,
    liveDelayed,
    pythonReference: pyRef
  };
}

function main() {
  const explicitTrace = argValue('--trace');
  const pythonBin = resolvePython();
  const modelPrepPath = resolveModelPreparation();

  let traceFiles = [];
  if (explicitTrace) {
    traceFiles = [path.resolve(explicitTrace)];
  } else {
    const tracesDir = path.join(repoRoot, 'docs', 'experiments', 'random', 'traces');
    if (fs.existsSync(tracesDir)) {
      traceFiles = fs
        .readdirSync(tracesDir)
        .filter((f) => f.endsWith('.json') && !f.includes('unknown'))
        .map((f) => path.join(tracesDir, f));
    }
  }

  if (traceFiles.length === 0) {
    console.error('No trace files found to analyze.');
    process.exit(1);
  }

  console.log(`\n================================================================================`);
  console.log(`Sparse-Window Loss Quantification Harness (Plan 1 Task 1.1)`);
  console.log(`Traces analyzed: ${traceFiles.length}`);
  console.log(`Python runtime: ${pythonBin} (Model Preparation: ${modelPrepPath ?? 'NOT FOUND'})`);
  console.log(`================================================================================\n`);

  const results = [];
  for (const file of traceFiles) {
    const res = analyzeTrace(file, modelPrepPath, pythonBin);
    if (res) results.push(res);
  }

  if (results.length === 0) {
    console.error('No valid traces with behaviour events.');
    process.exit(1);
  }

  // Pre-declared materiality threshold
  const MATERIALITY_THRESHOLD_PCT = 5.0; // > 5.0% loss of interaction windows = material

  // Summary aggregation across all traces
  let aggEvents = 0;
  let aggSlots = 0;
  let aggZeroSlots = 0;
  let aggSparseSlots = 0;
  let aggDenseSlots = 0;
  let aggSparseCrossing500ms = 0;
  let aggLiveDropOnceEmitted = 0;
  let aggLiveDropOnceInactive = 0;
  let aggLiveDropOnceSkipped = 0;
  let aggLiveDelayedEmitted = 0;
  let aggLiveDelayedSkipped = 0;
  let aggPythonEmitted = 0;
  const allSlotCounts = [];

  for (const r of results) {
    aggEvents += r.totalEvents;
    aggSlots += r.numSlots;
    aggZeroSlots += r.slotsZero;
    aggSparseSlots += r.slotsSparseAtEmission;
    aggDenseSlots += r.slotsDense;
    aggSparseCrossing500ms += r.sparseCrossingThresholdIn500ms;
    aggLiveDropOnceEmitted += r.liveDropOnce.emittedTotal;
    aggLiveDropOnceInactive += r.liveDropOnce.inactiveWindows;
    aggLiveDropOnceSkipped += r.liveDropOnce.skippedSparse;
    aggLiveDelayedEmitted += r.liveDelayed.emittedTotal;
    aggLiveDelayedSkipped += r.liveDelayed.skippedSparse;
    aggPythonEmitted += r.pythonReference.count;
    allSlotCounts.push(...r.slotDistribution ? [] : []);
  }

  console.log(`--- PER-TRACE RESULTS ---`);
  for (const r of results) {
    const sparsePct = ((r.slotsSparseAtEmission / r.numSlots) * 100).toFixed(1);
    const zeroPct = ((r.slotsZero / r.numSlots) * 100).toFixed(1);
    const densePct = ((r.slotsDense / r.numSlots) * 100).toFixed(1);
    const activeSlots = r.slotsSparseAtEmission + r.slotsDense;
    const activeSparseLossPct = activeSlots > 0 ? ((r.slotsSparseAtEmission / activeSlots) * 100).toFixed(1) : '0.0';

    console.log(`\nTrace: ${r.traceName}`);
    console.log(`  Session: ${r.sessionId} (${r.conditionId}) | Duration: ${(r.durationMs / 1000).toFixed(1)}s | Events: ${r.totalEvents}`);
    console.log(`  250ms Slots: ${r.numSlots} | Dense (>=3): ${r.slotsDense} (${densePct}%) | Sparse (1-2): ${r.slotsSparseAtEmission} (${sparsePct}%) | Zero (0): ${r.slotsZero} (${zeroPct}%)`);
    console.log(`  Active-slot sparse loss rate: ${activeSparseLossPct}% (sparse / (dense + sparse))`);
    console.log(`  Slots crossing threshold in 500ms span: ${r.sparseCrossingThresholdIn500ms} / ${r.slotsSparseAtEmission}`);
    console.log(`  Live (delay=0):  emitted=${r.liveDropOnce.emittedTotal} (active=${r.liveDropOnce.activeWindows}, inactive=${r.liveDropOnce.inactiveWindows}), skippedSparse=${r.liveDropOnce.skippedSparse}`);
    console.log(`  Live (delay=250): emitted=${r.liveDelayed.emittedTotal} (active=${r.liveDelayed.activeWindows}, inactive=${r.liveDelayed.inactiveWindows}), skippedSparse=${r.liveDelayed.skippedSparse}`);
    console.log(`  Python Reference: emitted=${r.pythonReference.count} (static segmentation)`);
  }

  const aggActiveSlots = aggSparseSlots + aggDenseSlots;
  const aggSparseRateOverall = ((aggSparseSlots / aggSlots) * 100).toFixed(2);
  const aggActiveSparseLossPct = ((aggSparseSlots / aggActiveSlots) * 100).toFixed(2);
  const aggZeroPct = ((aggZeroSlots / aggSlots) * 100).toFixed(2);
  const aggCrossingPct = aggSparseSlots > 0 ? ((aggSparseCrossing500ms / aggSparseSlots) * 100).toFixed(2) : '0.0';

  console.log(`\n================================================================================`);
  console.log(`AGGREGATE SUMMARY (Measured over ${results.length} traces, ${aggEvents} events, ${aggSlots} slots):`);
  console.log(`================================================================================`);
  console.log(`1. Events-per-slot distribution:`);
  console.log(`   - Inactive slots (0 events): ${aggZeroSlots} (${aggZeroPct}%)`);
  console.log(`   - Sparse slots (1-2 events): ${aggSparseSlots} (${aggSparseRateOverall}%)`);
  console.log(`   - Dense slots (>= 3 events): ${aggDenseSlots} (${((aggDenseSlots / aggSlots) * 100).toFixed(2)}%)`);
  console.log(`2. Slots sparse at emission time:`);
  console.log(`   - Total sparse slots: ${aggSparseSlots}`);
  console.log(`   - Active-slot sparse loss rate: ${aggActiveSparseLossPct}% (sparse / [sparse + dense])`);
  console.log(`3. Late arrivals / Lookahead crossing:`);
  console.log(`   - Sparse slots that cross threshold in 500ms window: ${aggSparseCrossing500ms} (${aggCrossingPct}%)`);
  console.log(`4. Fraction of inactivity windows in live emission:`);
  console.log(`   - Inactivity windows: ${aggLiveDropOnceInactive} / ${aggLiveDropOnceEmitted} (${((aggLiveDropOnceInactive / aggLiveDropOnceEmitted) * 100).toFixed(2)}%)`);
  console.log(`5. Resulting window counts:`);
  console.log(`   - Live drop-once (flushDelayMs=0):   ${aggLiveDropOnceEmitted} emitted (${aggLiveDropOnceSkipped} skipped sparse)`);
  console.log(`   - Live delayed (flushDelayMs=250):    ${aggLiveDelayedEmitted} emitted (${aggLiveDelayedSkipped} skipped sparse)`);
  console.log(`   - Python reference (static):         ${aggPythonEmitted} emitted (no inactivity windows)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Pre-declared materiality threshold: ${MATERIALITY_THRESHOLD_PCT}% of active slots`);
  const isMaterial = parseFloat(aggActiveSparseLossPct) > MATERIALITY_THRESHOLD_PCT;
  console.log(`Measured active sparse loss rate:    ${aggActiveSparseLossPct}%`);
  console.log(`Materiality evaluation:              ${isMaterial ? 'MATERIAL' : 'NEGLIGIBLE'} (${aggActiveSparseLossPct}% ${isMaterial ? '>' : '<='} ${MATERIALITY_THRESHOLD_PCT}%)`);
  console.log(`================================================================================\n`);

  return { results, aggregate: { aggEvents, aggSlots, aggZeroSlots, aggSparseSlots, aggDenseSlots, aggActiveSparseLossPct, isMaterial } };
}

main();
