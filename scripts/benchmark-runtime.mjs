#!/usr/bin/env node
/**
 * Runtime benchmark harness.
 *
 * The assessment (§20) reported every performance budget as NOT MEASURED because the
 * pipeline never ran. With the pipeline composed, these numbers can now be produced
 * reproducibly instead of being asserted.
 *
 * Usage:
 *   node scripts/benchmark-runtime.mjs
 *
 * It starts the Vite dev server, drives a scripted interaction inside a real browser via
 * `agent-browser` when available, and prints a JSON report. If `agent-browser` is not
 * installed it exits with a clear message rather than inventing numbers.
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BENCH_PORT ?? 5199);
const URL = `http://localhost:${PORT}/`;

function hasAgentBrowser() {
  const probe = spawnSync('agent-browser', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function agent(session, args) {
  const result = spawnSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`agent-browser ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

const RUNNER = String.raw`
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (sel) => {
    const el = document.querySelector(sel);
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    return !!el;
  };
  const move = async (n) => {
    for (let i = 0; i < n; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: 150 + (i * 7) % 600, clientY: 200 + (i * 11) % 300
      }));
      await sleep(25);
    }
  };

  const baselineFrames = await new Promise((resolve) => {
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
      else resolve({ frames, elapsed: performance.now() - t0 }); };
    requestAnimationFrame(tick);
  });

  click('[data-aui-component="nav-Analytics"]');
  await sleep(250);
  click('[data-aui-component="btn-start-T1"]');
  await sleep(300);

  const start = performance.now();
  await move(60);
  for (let i = 0; i < 4; i++) {
    click('[data-aui-component="filter-Region"]');
    click('[data-aui-component="filter-Region"]');
    await move(25);
    click('[data-aui-component="btn-apply-filters"]');
    await move(80);
  }
  const interactionMs = performance.now() - start;

  const loadFrames = await new Promise((resolve) => {
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
      else resolve({ frames, elapsed: performance.now() - t0 }); };
    requestAnimationFrame(tick);
  });

  await sleep(2500);

  const h = window.__EDGE_AUI__;
  const trace = JSON.parse(h.trace());
  const mem = performance.memory
    ? { usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2),
        totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(2) }
    : null;

  return {
    baselineFps: Math.round(baselineFrames.frames / (baselineFrames.elapsed / 1000)),
    pipelineFps: Math.round(loadFrames.frames / (loadFrames.elapsed / 1000)),
    interactionMs: Math.round(interactionMs),
    domNodes: document.getElementsByTagName('*').length,
    jsHeap: mem,
    status: h.status(),
    counts: h.counts(),
    latency: {
      predictionLatenciesMs: trace.predictions.map((p) => p.latencyMs).filter((v) => typeof v === 'number'),
    },
    outcomes: trace.outcomes.reduce((a, o) => { a[o.outcome] = (a[o.outcome] || 0) + 1; return a; }, {}),
    outcomeCount: trace.outcomes.length,
    settledOutcomes: trace.outcomes.filter((o) => o.lookaheadComplete).length,
    windows: trace.microTensors.length,
    traceBytes: h.trace().length,
    userAgent: navigator.userAgent,
    webgpu: typeof navigator.gpu !== 'undefined',
  };
})()
`;

async function main() {
  if (!hasAgentBrowser()) {
    console.error(
      '[benchmark] agent-browser is not installed, so real browser measurements cannot be\n' +
        'produced. Install it (npm i -g agent-browser && agent-browser install) or run the\n' +
        'measurements manually. No numbers are fabricated.'
    );
    process.exit(1);
  }

  console.log(`[benchmark] starting dev server on port ${PORT}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const cleanup = () => {
    if (!server.killed) server.kill('SIGTERM');
  };
  process.on('exit', cleanup);

  if (!(await waitForServer(URL))) {
    cleanup();
    throw new Error(`Dev server did not become ready at ${URL}`);
  }

  const session = `aui-bench-${Date.now().toString(36)}`;
  try {
    agent(session, ['open', URL]);
    await new Promise((r) => setTimeout(r, 3000));
    const raw = agent(session, ['eval', '--stdin', RUNNER]);
    const result = JSON.parse(raw.trim());

    const latencies = result.latency.predictionLatenciesMs;
    if (latencies.length > 0) {
      const sorted = [...latencies].sort((a, b) => a - b);
      result.latency = {
        samples: latencies.length,
        meanMs: +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(3),
        p50Ms: +sorted[Math.floor(sorted.length * 0.5)].toFixed(3),
        p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3),
        maxMs: +Math.max(...latencies).toFixed(3)
      };
    } else {
      result.latency = { samples: 0 };
    }

    console.log('\n[benchmark] result');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try {
      agent(session, ['close', '--all']);
    } catch {
      /* best effort */
    }
    cleanup();
  }
}

main().catch((err) => {
  console.error('[benchmark] failed:', err.message);
  process.exit(1);
});
