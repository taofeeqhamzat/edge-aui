#!/usr/bin/env node
/**
 * Normalises the generated wasm-pack output.
 *
 * `wasm-pack build` writes `wasm-vectorizer/pkg/.gitignore` containing `*`, which makes the
 * compiled package invisible to git again. That is normally the right default for a build
 * artifact, but here the artifact is a deployment input: `src/gates/fast/prefixSpanMiner.ts`
 * imports it, so a clean clone (and therefore a Cloudflare Pages build) cannot compile
 * without it. Removing the generated file keeps the outer repository rule in charge.
 *
 * Run automatically by `npm run build:wasm`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedGitignore = path.join(repoRoot, 'wasm-vectorizer', 'pkg', '.gitignore');

if (fs.existsSync(generatedGitignore)) {
  fs.rmSync(generatedGitignore);
  console.log('[normalize-wasm-pkg] Removed generated wasm-vectorizer/pkg/.gitignore');
} else {
  console.log('[normalize-wasm-pkg] No generated .gitignore present; nothing to do.');
}
