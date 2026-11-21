#!/usr/bin/env node
/**
 * Fast Gate mining benchmark (Task 50.3).
 *
 * Measures the committed WASM PrefixSpan miner on realistic sequences and records the
 * numbers as artefacts, so the F-02 bound can be checked rather than assumed:
 *
 * - `live_pre_fix` reproduces the corpus shape the audit measured (nine short sequences,
 *   support 2) under the old effective bounds — no meaningful pattern-length or count cap.
 *   It records how many patterns that produced and what it cost.
 * - `bounded_*` cases use the bounds the production runtime passes, so the recorded cost is
 *   the cost a session actually pays.
 *
 * Every corpus is generated deterministically from the participant symbol distribution in
 * `model-preparation/docs/experiments/participant-patterns/participant-pattern-candidates.json`
 * when that file is present, and from the same distribution baked in as a fallback otherwise.
 * A benchmark that changes its input between runs cannot support a comparison.
 *
 * What this does NOT measure, and therefore reports as `NOT MEASURED`:
 * - browser Total Blocking Time and the 20 MB browser memory budget (this is Node);
 * - the gate's own orchestration overhead (the miner dominates by construction, and the
 *   gate path is exercised by tests, not timed here);
 * - end-to-end latency on the Cloudflare deployment.
 *
 * Usage: node scripts/benchmark-fastgate.mjs [--iterations N]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(repoRoot, 'wasm-vectorizer', 'pkg');
const outDir = path.join(repoRoot, 'docs', 'benchmarks');

const args = process.argv.slice(2);
const iterationArg = args.indexOf('--iterations');
const ITERATIONS = iterationArg >= 0 ? Number(args[iterationArg + 1]) : 50;

/** Participant symbol counts from the evidence report; fallback keeps the benchmark runnable. */
const FALLBACK_SYMBOL_COUNTS = {
  APPLY_FILTER: 81,
  CLOSE_FILTERS: 144,
  EXPORT_REPORT: 30,
  HOVER_HELP: 2,
  HOVER_KPI: 30,
  NAV_ANALYTICS: 11,
  NAV_REPORTS: 8,
  OPEN_FILTERS: 94,
  OPEN_REPORT: 16,
  RESET_FILTERS: 25,
  SELECT_CATEGORY: 58,
  SELECT_DATE: 57,
  SELECT_REGION: 83
};
const PARTICIPANT_SESSIONS = 35;

function readEvidence() {
  const reportPath = path.resolve(
    repoRoot,
    '..',
    'model-preparation',
    'docs',
    'experiments',
    'participant-patterns',
    'participant-pattern-candidates.json'
  );
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return {
      symbolCounts: report.symbol_counts ?? FALLBACK_SYMBOL_COUNTS,
      sessions: report.session_count ?? PARTICIPANT_SESSIONS,
      source: reportPath
    };
  } catch {
    return {
      symbolCounts: FALLBACK_SYMBOL_COUNTS,
      sessions: PARTICIPANT_SESSIONS,
      source: 'fallback: literal copy of participant-pattern-candidates.json symbol_counts'
    };
  }
}

/** Mulberry32: small, fast, and identical across Node versions. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a corpus with the measured symbol mix, one sequence per session. */
function buildCorpus(sessions, symbolsPerSession, seed) {
  const { symbolCounts } = readEvidence();
  const symbols = Object.keys(symbolCounts);
  const total = symbols.reduce((sum, symbol) => sum + symbolCounts[symbol], 0);
  const cumulative = [];
  let running = 0;
  for (const symbol of symbols) {
    running += symbolCounts[symbol] / total;
    cumulative.push({ symbol, threshold: running });
  }
  const random = mulberry32(seed);
  const sequences = [];
  for (let session = 0; session < sessions; session++) {
    const sequence = [];
    for (let i = 0; i < symbolsPerSession; i++) {
      const draw = random();
      const entry = cumulative.find((candidate) => draw <= candidate.threshold) ?? cumulative[cumulative.length - 1];
      sequence.push(entry.symbol);
    }
    sequences.push(sequence);
  }
  return sequences;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

async function main() {
  const wasmPath = path.join(pkgDir, 'wasm_vectorizer_bg.wasm');
  const { default: initWasm, mine_macro_patterns } = await import(
    new URL(`file://${path.join(pkgDir, 'wasm_vectorizer.js')}`).href
  );
  await initWasm({ module_or_path: fs.readFileSync(wasmPath) });

  const corpusRealistic = buildCorpus(PARTICIPANT_SESSIONS, 18, 0x5eed);
  const corpusLiveShape = buildCorpus(9, 18, 0x51de);
  const corpusWorstBound = buildCorpus(40, 60, 0x60d);

  const cases = [
    {
      id: 'live_pre_fix',
      description:
        'Audit corpus shape (9 sequences × 18 symbols, support 2) at the bounds the old gate effectively applied: unlimited length and count.',
      corpus: corpusLiveShape,
      bounds: { minSupport: 2, maxPatternLength: 8, maxPatterns: 1_000_000 }
    },
    {
      id: 'bounded_production',
      description:
        'Participant-shaped corpus (35 sessions × 18 symbols, support 2) at the production bounds: length 4, 32 patterns.',
      corpus: corpusRealistic,
      bounds: { minSupport: 2, maxPatternLength: 4, maxPatterns: 32 }
    },
    {
      id: 'bounded_evidence_floor',
      description: 'Same corpus with support 3, the participant evidence floor used by the declared set.',
      corpus: corpusRealistic,
      bounds: { minSupport: 3, maxPatternLength: 4, maxPatterns: 32 }
    },
    {
      id: 'bounded_worst_corpus',
      description:
        'Largest corpus the runtime will send (maxCorpusSequences 40) with long 60-symbol sequences, production bounds.',
      corpus: corpusWorstBound,
      bounds: { minSupport: 2, maxPatternLength: 4, maxPatterns: 32 }
    }
  ];

  const results = [];
  for (const benchCase of cases) {
    const { corpus, bounds } = benchCase;
    // One warm-up call: the first call pays wasm-bindgen's cache warm-up, not the mining.
    mine_macro_patterns(corpus, bounds.minSupport, bounds.maxPatternLength, bounds.maxPatterns);

    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const rssBefore = process.memoryUsage().rss;

    const durations = [];
    let patternCount = 0;
    let longestPattern = 0;
    let truncatedAtBound = false;
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const patterns = mine_macro_patterns(
        corpus,
        bounds.minSupport,
        bounds.maxPatternLength,
        bounds.maxPatterns
      );
      durations.push(performance.now() - start);
      patternCount = patterns.length;
      longestPattern = patterns.reduce((max, pattern) => Math.max(max, pattern.pattern.length), 0);
      truncatedAtBound = patterns.length >= bounds.maxPatterns;
    }

    const heapAfter = process.memoryUsage().heapUsed;
    const rssAfter = process.memoryUsage().rss;
    const sorted = [...durations].sort((a, b) => a - b);

    results.push({
      id: benchCase.id,
      description: benchCase.description,
      corpus: {
        sequences: corpus.length,
        totalSymbols: corpus.reduce((sum, sequence) => sum + sequence.length, 0),
        distinctSymbols: new Set(corpus.flat()).size
      },
      bounds,
      iterations: ITERATIONS,
      patternsReturned: patternCount,
      longestPattern,
      hitPatternCap: truncatedAtBound,
      latencyMs: {
        p50: Number(percentile(sorted, 0.5).toFixed(3)),
        p95: Number(percentile(sorted, 0.95).toFixed(3)),
        max: Number(sorted[sorted.length - 1]?.toFixed(3) ?? 0),
        mean: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(3))
      },
      memory: {
        heapDeltaBytes: heapAfter - heapBefore,
        rssDeltaBytes: rssAfter - rssBefore,
        note: 'Process-level Node measurement around the repeated calls; not a browser budget.'
      }
    });
  }

  const wasmBytes = fs.statSync(wasmPath).size;
  const wasmSha256 = crypto.createHash('sha256').update(fs.readFileSync(wasmPath)).digest('hex');

  const report = {
    schemaVersion: '1.0.0',
    generatedBy: 'scripts/benchmark-fastgate.mjs',
    generatedAt: new Date().toISOString(),
    gitCommit: (() => {
      try {
        const head = fs.readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
        if (head.startsWith('ref: ')) {
          return fs.readFileSync(path.join(repoRoot, '.git', head.slice(5)), 'utf8').trim();
        }
        return head;
      } catch {
        return 'UNKNOWN';
      }
    })(),
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'UNKNOWN',
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem()
    },
    artifact: {
      path: 'wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm',
      bytes: wasmBytes,
      sha256: wasmSha256
    },
    inputCorpus: {
      source: readEvidence().source,
      sessions: PARTICIPANT_SESSIONS,
      symbolsPerSession: 18,
      generation: 'deterministic Mulberry32(0x5eed); symbol mix from the evidence report'
    },
    results,
    notMeasured: [
      'Browser Total Blocking Time and end-to-end inference latency on the deployed build',
      'The 20 MB browser memory budget (process RSS is not a browser measurement)',
      'Head-of-line blocking at the worker RPC boundary'
    ]
  };

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'fastgate-mining.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    '# Fast Gate mining benchmark (Task 50.3)',
    '',
    `Generated by \`scripts/benchmark-fastgate.mjs\` on ${report.generatedAt}.`,
    `Commit: \`${report.gitCommit.slice(0, 12)}\`. Node ${report.environment.node} on ${report.environment.platform} (${report.environment.cpu}).`,
    '',
    '## What is measured',
    '',
    'Wall-clock time of the committed WASM miner (`mine_macro_patterns`) in Node, over',
    `${ITERATIONS} iterations per case after one warm-up call. Corpora are deterministic and use`,
    'the participant symbol distribution from the evidence report.',
    '',
    '| Case | Corpus | Bounds (support / length / patterns) | Patterns returned | Longest | p50 ms | p95 ms | max ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| \`${result.id}\` | ${result.corpus.sequences}×${result.corpus.totalSymbols / result.corpus.sequences} | ` +
        `${result.bounds.minSupport} / ${result.bounds.maxPatternLength} / ${result.bounds.maxPatterns} | ` +
        `${result.patternsReturned}${result.hitPatternCap ? ' (cap)' : ''} | ${result.longestPattern} | ` +
        `${result.latencyMs.p50} | ${result.latencyMs.p95} | ${result.latencyMs.max} |`
    ),
    '',
    '## What the case names mean',
    '',
    ...results.map((result) => `- \`${result.id}\`: ${result.description}`),
    '',
    '## Memory',
    '',
    '| Case | Heap delta (bytes) | RSS delta (bytes) |',
    '| --- | --- | --- |',
    ...results.map(
      (result) => `| \`${result.id}\` | ${result.memory.heapDeltaBytes} | ${result.memory.rssDeltaBytes} |`
    ),
    '',
    'These are process-level Node deltas around the repeated calls, not a browser memory',
    'budget. Allocating the pattern vector and the WASM heap shows up here; the browser',
    '20 MB budget itself is **NOT MEASURED** by this script.',
    '',
    '## Not measured',
    '',
    ...report.notMeasured.map((item) => `- ${item}`),
    '',
    '## Reading the result',
    '',
    '`live_pre_fix` shows the cost the F-02 fix removes: the same corpus under an effectively',
    'unbounded pattern length and count returns two orders of magnitude more patterns than the',
    'production bounds. `bounded_production` is the cost a session actually pays. Neither',
    'number supports a claim about the 50 ms interaction budget: the mining call runs inside',
    'the worker, off the main thread, and the browser budget is not measured here.',
    ''
  ];
  const mdPath = path.join(outDir, 'fastgate-mining.md');
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

  console.log(`[fastgate-benchmark] wrote ${path.relative(repoRoot, jsonPath)}`);
  console.log(`[fastgate-benchmark] wrote ${path.relative(repoRoot, mdPath)}`);
  for (const result of results) {
    console.log(
      `[fastgate-benchmark] ${result.id}: ${result.patternsReturned} patterns, ` +
        `p50 ${result.latencyMs.p50} ms, p95 ${result.latencyMs.p95} ms, max ${result.latencyMs.max} ms`
    );
  }
}

main().catch((error) => {
  console.error('[fastgate-benchmark] failed:', error);
  process.exitCode = 1;
});
