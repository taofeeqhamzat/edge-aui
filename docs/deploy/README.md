# Deploying the Edge-AUI Research Testbed

The deployment target is deliberately simple (v0.1):

```
GitHub ──► Cloudflare Worker (static assets) ──► React testbed (dist/)
   │
   └────► Supabase ──► research traces
```

No container registry, no API server, no queue, no object storage. The browser is the whole
runtime; Supabase is a write-only research collection store.

| Document | Purpose |
|---|---|
| This file | Build, deploy, and local development procedure |
| [`supabase-setup.md`](./supabase-setup.md) | Creating the database and applying migrations |
| [`cloudflare-pages-setup.md`](./cloudflare-pages-setup.md) | Creating the Worker, its build trigger and its variables |
| [`verification-runbook.md`](./verification-runbook.md) | The acceptance sequence, and what has actually been verified |

---

## Build configuration

| Setting | Value |
|---|---|
| Build command | `npm run build:ci` |
| Deploy command | `npx wrangler deploy` |
| Output directory | `dist` — declared in [`wrangler.jsonc`](../../wrangler.jsonc) as `assets.directory`, not a dashboard field |
| Root directory | repository root |
| Node version | 18 or later (no `.nvmrc`; the build image default is sufficient) |
| Deployment branch | `main` (production); every other branch gets a preview deployment |

### Why `build:ci` rather than `build`

`npm run build` runs `build:wasm` first, which needs `wasm-pack` and a Rust toolchain. A
Cloudflare build image has neither, so `build:ci` skips it and instead verifies that the
compiled WASM package is already present:

```bash
npm run build:ci
#  = check:wasm-pkg → tsc → vite build → check:deploy-assets
```

### The compiled WASM package is committed

`wasm-vectorizer/pkg/` is tracked, which is unusual for a build output. It is a **build
input**: `src/gates/fast/prefixSpanMiner.ts` imports
`wasm-vectorizer/pkg/wasm_vectorizer.js`, so a clean checkout cannot compile without it. The
Rust sources under `wasm-vectorizer/src/` remain the source of truth.

After changing any Rust file:

```bash
npm run build:wasm      # rebuilds the package and removes the generated nested .gitignore
npm run parity:check    # confirms the microtensor parity fixture is unaffected
git add wasm-vectorizer/pkg wasm-vectorizer/src
```

`npm run check:wasm-pkg` fails the build loudly if the package is incomplete, instead of
letting a confusing module-resolution error surface from inside the Fast Gate.

### The asset gate

`npm run check:deploy-assets` runs as the last step of `build:ci` and fails the build when any
of the following stops being true:

1. no file in `dist/` is 25 MiB or larger (Cloudflare Pages' hard per-asset limit);
2. no JSEP/WebGPU ONNX Runtime binary is emitted;
3. the WASM-only ONNX Runtime binary is present;
4. `dist/_headers` carries `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`;
5. the ONNX model graphs and the committed WASM vectoriser are present in `dist/`.

**Point 1 is not hypothetical.** The pre-deployment build emitted
`ort-wasm-simd-threaded.jsep-*.wasm` at **26,827,543 bytes**. That is 160 KiB over the limit,
and Cloudflare rejects the deployment rather than the file. The fix was to load ONNX Runtime
Web's WASM-only entry point (`onnxruntime-web/wasm`) and to stop requesting the WebGPU
execution provider. The measured effect:

| | Before | After |
|---|---|---|
| ONNX Runtime WASM asset | 26,827,543 B (JSEP) | 13,479,978 B (`ort-wasm-simd-threaded`) |
| Total `dist/` | ~28.8 MB | 14,856,477 B (14.17 MiB) |
| Largest asset | 25.6 MiB — **rejected** | 12.86 MiB — accepted |

This is a runtime/backend and packaging change only. Model architecture, weights, the target
intervention head, the intervention policy and the trace contract are unchanged (ADR-016).

---

## Required environment variables

Set these on the Cloudflare **build trigger** (Workers & Pages → edge-aui → Settings → Builds —
they are build-time values) and in `.env.local` for local development. `.env.example` is the
tracked template.

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | No | Supabase project URL. Unset ⇒ local-only collection. |
| `VITE_SUPABASE_ANON_KEY` | No | Public anon key. Unset ⇒ local-only collection. |
| `VITE_AUI_COLLECTION_MODE` | No | `off` \| `scripted` (default) \| `all` |
| `VITE_AUI_DIAGNOSTICS` | No | `1` to expose the research panel in a production build |

**All four are optional.** A build with none of them set is a valid, supported configuration:
the testbed runs, records sessions locally, exports traces from the research panel, and
reports `collection: local_only` instead of attempting an upload. Collection degrades visibly,
never silently.

**Never set a `service_role` key.** It bypasses Row Level Security, so in a browser bundle it
would grant every visitor read/write access to all research telemetry. The anon key is safe
precisely because the migrations grant it `INSERT` and nothing else.

---

## Local development

```bash
npm install
cp .env.example .env.local     # then fill in the Supabase values, or leave them blank
npm run dev                    # http://localhost:5173
```

The dev server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` itself
(`vite.config.ts`), which is why the threaded ONNX Runtime build works locally. The deployed
origin needs the same headers from `public/_headers`; that asymmetry is the reason the asset
gate checks for them.

Verify a production build locally before deploying:

```bash
npm run build:ci
npm run preview                # serves dist/ at http://localhost:4173
```

Other useful commands:

```bash
npm test              # vitest; syncs pipeline config first
npm run typecheck     # tsc --noEmit
npm run parity:check  # microtensor parity against the Python reference
```

---

## Deploying

1. Push to `main`. The Workers Build trigger runs automatically.
2. The build runs `npm run build:ci`, then `npx wrangler deploy` publishes `dist/` from
   `wrangler.jsonc`. If the asset gate fails, the deployment fails and the reason is printed in
   the build log — check it before retrying.
3. Confirm the deployment URL loads, then complete the acceptance sequence in
   [`verification-runbook.md`](./verification-runbook.md).

Supabase migrations are applied separately and deliberately are **not** part of the Cloudflare
build: a schema change should be a reviewed, deliberate act rather than a side effect of
deploying front-end code. See [`supabase-setup.md`](./supabase-setup.md).

---

## Operational notes

- **Retrieval requires a service-role key.** The anon role has no `SELECT` grant, so the
  browser cannot read back what it wrote, and neither can anyone holding only the anon key.
  Export is a researcher action performed outside the browser.
- **Duplicate uploads are prevented by an `upload_token`, not by an upsert.** An upsert needs
  `SELECT`, which is exactly the grant withheld from `anon`.
- **The developer panel is absent from a production build by default.** Add
  `?auiDiagnostics=1` to the URL or set `VITE_AUI_DIAGNOSTICS=1` for a researcher build.
- **Deployment branch:** `main` is production. Advisory only — Cloudflare Pages controls the
  actual mapping.
