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
 * 6. **The research collection is configured — or the build log says plainly that it is not.**
 *    The `VITE_*` variables are optional, so their absence is reported rather than fatal by
 *    default; set `REQUIRE_COLLECTION=1` to make it fatal. This is the check that would have
 *    caught the deployed Worker that served the application correctly and uploaded nothing.
 *
 * A number is only accepted when it was measured here, not when it was asserted elsewhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `--dist <dir>` (or DIST_DIR) lets the gate be pointed at a fixture. That is how the research
// collection check below is tested without performing a full production build.
const distFlagIndex = process.argv.indexOf('--dist');
const distDir = path.resolve(
  (distFlagIndex !== -1 ? process.argv[distFlagIndex + 1] : undefined) ||
    process.env.DIST_DIR ||
    path.join(repoRoot, 'dist')
);

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

// 6. Research collection configuration — reported, and fatal only when explicitly required.
//
// The four `VITE_*` variables are optional by design, so a build without them is valid and must
// not fail. It must not be *silent* either: a research deployment whose entire purpose is trace
// collection can ship with `collection: local_only` and look perfectly healthy until someone
// completes a task and finds no rows. That happened — the deployed Worker served the application,
// passed every other check here, and had no Supabase URL inlined at all, because the build trigger
// carried no variables.
//
// Vite substitutes the values while bundling, so their presence in the emitted JavaScript is
// direct evidence that the build environment supplied them. Set `REQUIRE_COLLECTION=1` (for
// example on a production build trigger) to turn the warning into a build failure.
const jsAssets = files.filter(
  (file) => file.relative.startsWith('assets/') && file.relative.endsWith('.js')
);

let inlinedSupabaseUrl = null;
let inlinedAnonKey = false;
for (const asset of jsAssets) {
  const source = fs.readFileSync(path.join(distDir, asset.relative), 'utf8');
  if (!inlinedSupabaseUrl) {
    const urlMatch = source.match(/https:\/\/[a-z0-9-]+\.supabase\.(?:co|in)\b/i);
    if (urlMatch) inlinedSupabaseUrl = urlMatch[0];
  }
  // Either key format: the publishable key, or a legacy JWT anon key (`eyJ...`).
  if (
    !inlinedAnonKey &&
    (/sb_publishable_[A-Za-z0-9_-]{10,}/.test(source) || /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(source))
  ) {
    inlinedAnonKey = true;
  }
}

const collectionConfigured = Boolean(inlinedSupabaseUrl && inlinedAnonKey);
const collectionWarnings = [];
if (!inlinedSupabaseUrl) {
  collectionWarnings.push(
    'No Supabase URL is inlined in the bundle, so this build will report `collection: local_only` ' +
      'and upload no traces. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on the build trigger ' +
      'for the environment being deployed, then rebuild — a variable change only affects new builds. ' +
      'See docs/deploy/cloudflare-pages-setup.md §2.'
  );
} else if (!inlinedAnonKey) {
  collectionWarnings.push(
    `VITE_SUPABASE_URL (${inlinedSupabaseUrl}) is inlined but no anon key was found, so collection ` +
      'stays disabled. Set VITE_SUPABASE_ANON_KEY for the same environment and rebuild.'
  );
}

if (collectionWarnings.length > 0 && process.env.REQUIRE_COLLECTION === '1') {
  failures.push(...collectionWarnings.map((warning) => `Research collection is not configured: ${warning}`));
}

console.log('=== Deployment asset inventory ===');
console.log(`  Files in dist/: ${files.length}`);
console.log(`  Total size:     ${formatBytes(totalBytes)} (${totalBytes} B)`);
console.log(`  Largest asset:  ${largest ? `${largest.relative} (${formatBytes(largest.size)})` : 'n/a'}`);
console.log(`  Per-file limit: ${formatBytes(MAX_ASSET_BYTES)} (Cloudflare Pages)`);
if (collectionConfigured) {
  console.log(`  Collection:     uploads enabled (VITE_SUPABASE_URL ${inlinedSupabaseUrl} and an anon key inlined)`);
} else {
  console.log('  Collection:     NOT CONFIGURED — this build uploads no traces');
  for (const warning of collectionWarnings) {
    console.log(`                  ${warning}`);
  }
}
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
