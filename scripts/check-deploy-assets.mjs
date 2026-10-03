#!/usr/bin/env node
/**
 * Deployment asset inventory gate.
 *
 * This is the local equivalent of the supervisor's deployment acceptance steps 1–3:
 *
 *     ORT WASM entry point → production build → asset inventory
 *
 * It fails the build when any of the properties the deployment depends on no longer hold,
 * because every one of them was previously discovered by reading the built output by hand:
 *
 * 1. **No asset is 25 MiB or larger.** Cloudflare Pages rejects the whole deployment if a
 *    single asset exceeds that limit. The previous build emitted
 *    `ort-wasm-simd-threaded.jsep-*.wasm` at 26,827,543 bytes and would have been rejected.
 * 2. **No JSEP/WebGPU WASM binary is emitted.** Its presence means the slow gate would try to
 *    load the WebGPU provider, which is no longer the deployment configuration (ADR-016).
 * 3. **The WASM-only ORT binary is the one present.**
 * 4. **`_headers` carries COOP and COEP.** The threaded ORT build requires a cross-origin
 *    isolated context; without these headers it fails at runtime in the deployed origin while
 *    working locally, because the Vite dev server sets them itself.
 * 5. **The model graphs and the commited WASM vectoriser are in `dist/`.** A build that omits
 *    them produces an application that loads and then cannot infer.
 *
 * A number is only accepted when it was measured here, not when it was asserted elsewhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');

/** Cloudflare Pages' hard limit for a single site asset. */
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MiB

const REQUIRED_FILES = [
  'index.html',
  '_headers',
  'models/model_int8.onnx',
  'models/intervention_head_int8.onnx'
];

const failures = [];
const notes = [];

/** Recursively lists every file under a directory with its byte size. */
function inventory(dir) {
  const entries = [];
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile()) {
        entries.push({
          relative: path.relative(dir, full),
          size: fs.statSync(full).size
        });
      }
    }
  };
  walk(dir);
  return entries;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

if (!fs.existsSync(distDir)) {
  console.error('[check-deploy-assets] ERROR: dist/ does not exist. Run `vite build` first.');
  process.exit(1);
}

const files = inventory(distDir);

// 1. Per-asset size limit.
const oversized = files.filter((file) => file.size >= MAX_ASSET_BYTES);
for (const file of oversized) {
  failures.push(
    `Asset exceeds Cloudflare Pages' 25 MiB limit: ${file.relative} (${formatBytes(file.size)}, ${file.size} B)`
  );
}

// 2. No JSEP/WebGPU binary.
const jsepAssets = files.filter((file) => /jsep/i.test(file.relative));
for (const file of jsepAssets) {
  failures.push(
    `JSEP/WebGPU WASM asset was emitted: ${file.relative} (${formatBytes(file.size)}). ` +
      'The deployment uses the WASM execution provider (ADR-016).'
  );
}

// 3. The WASM-only ORT binary must be present.
//
// Vite content-hashes the asset filename and the hash itself contains a hyphen
// (`ort-wasm-simd-threaded-Cpm-ox6i.wasm`), so the basename is matched by prefix and suffix
// rather than by an exact name.
const wasmVariant = files.find(
  (file) =>
    path.basename(file.relative).startsWith('ort-wasm-simd-threaded') &&
    path.basename(file.relative).endsWith('.wasm')
);
if (!wasmVariant) {
  const ortAssets = files.filter((file) => /^ort-.*\.wasm$/.test(path.basename(file.relative)));
  failures.push(
    'The WASM-only ONNX Runtime binary (ort-wasm-simd-threaded*.wasm) is missing from dist/. ' +
      `Present ORT wasm assets: ${ortAssets.map((a) => a.relative).join(', ') || 'none'}`
  );
} else {
  notes.push(`ORT WASM binary: ${wasmVariant.relative} (${wasmVariant.size} B)`);
}

// 4. Cross-origin isolation headers.
const headersPath = path.join(distDir, '_headers');
if (fs.existsSync(headersPath)) {
  const headers = fs.readFileSync(headersPath, 'utf8');
  if (!/Cross-Origin-Opener-Policy:\s*same-origin/i.test(headers)) {
    failures.push('dist/_headers is missing `Cross-Origin-Opener-Policy: same-origin`');
  }
  if (!/Cross-Origin-Embedder-Policy:\s*require-corp/i.test(headers)) {
    failures.push('dist/_headers is missing `Cross-Origin-Embedder-Policy: require-corp`');
  }
}

// 5. Required runtime assets.
for (const required of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(distDir, required))) {
    failures.push(`Required deployment asset is missing: dist/${required}`);
  }
}

// The commited WASM vectoriser must have been bundled, or the Fast Gate cannot mine.
const vectoriserBundled = files.some((file) => /wasm_vectorizer_bg.*\.wasm$/.test(file.relative));
if (!vectoriserBundled) {
  failures.push(
    'The WASM vectoriser binary (wasm_vectorizer_bg*.wasm) is missing from dist/. ' +
      'The Fast Gate cannot mine without it.'
  );
}

const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
const largest = [...files].sort((a, b) => b.size - a.size)[0];

console.log('=== Deployment asset inventory ===');
console.log(`  Files in dist/: ${files.length}`);
console.log(`  Total size:     ${formatBytes(totalBytes)} (${totalBytes} B)`);
console.log(`  Largest asset:  ${largest ? `${largest.relative} (${formatBytes(largest.size)})` : 'n/a'}`);
console.log(`  Per-file limit: ${formatBytes(MAX_ASSET_BYTES)} (Cloudflare Pages)`);
for (const note of notes) {
  console.log(`  ${note}`);
}

if (oversized.length === 0) {
  console.log('  Headroom:       every asset is within the per-file limit');
}

if (failures.length > 0) {
  console.error('\n[check-deploy-assets] FAILED:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    '\nThe deployment would be rejected or would fail at runtime. Fix the above before deploying.'
  );
  process.exit(1);
}

console.log('\n[check-deploy-assets] OK — asset inventory satisfies the deployment requirements.');
