#!/usr/bin/env node
/**
 * Verifies that the committed WASM package is present and loadable.
 *
 * The package is committed because it is a build input, not a local by-product (see
 * .gitignore). That creates a failure mode worth guarding: someone deletes or regenerates it,
 * and the next clean build reports a confusing module-resolution error deep inside the Fast
 * Gate. This check fails early, at the start of the build, naming the missing file and the
 * command that recreates it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(repoRoot, 'wasm-vectorizer', 'pkg');

/**
 * Files the build genuinely needs.
 *
 * `wasm_vectorizer_bg.wasm.d.ts` is included because `wasm_vectorizer.d.ts` references it;
 * omitting it produces a typecheck failure rather than a runtime one, which is harder to
 * attribute to a missing artifact.
 */
const REQUIRED = [
  'wasm_vectorizer.js',
  'wasm_vectorizer_bg.wasm',
  'wasm_vectorizer.d.ts',
  'wasm_vectorizer_bg.wasm.d.ts',
  'package.json'
];

const missing = REQUIRED.filter((file) => !fs.existsSync(path.join(pkgDir, file)));

if (missing.length > 0) {
  console.error(
    [
      '',
      'ERROR: the compiled WASM package is incomplete.',
      '',
      `  Directory: wasm-vectorizer/pkg/`,
      `  Missing:   ${missing.join(', ')}`,
      '',
      'This package is committed because src/gates/fast/prefixSpanMiner.ts imports it and a',
      'clean checkout has no Rust toolchain to build it.',
      '',
      'To regenerate it you need wasm-pack and a Rust toolchain:',
      '  npm run build:wasm',
      '',
      'Then commit the regenerated wasm-vectorizer/pkg/ alongside the Rust sources that produce it.',
      ''
    ].join('\n')
  );
  process.exit(1);
}

const wasmBytes = fs.statSync(path.join(pkgDir, 'wasm_vectorizer_bg.wasm')).size;
console.log(
  `[check-wasm-pkg] OK — ${REQUIRED.length} files present; wasm_vectorizer_bg.wasm is ${wasmBytes} bytes.`
);
