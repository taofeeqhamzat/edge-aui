# Cloudflare Pages Setup

Creates the Pages project that serves the React testbed from GitHub. The deployment is
reproducible from the repository: everything it needs is either tracked or set as an
environment variable here (deployment brief §17).

---

## 1. Connect the repository

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorise GitHub and select this repository.
3. Configure the build:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None (do **not** pick Vite — the preset overrides the build command) |
| Build command | `npm run build:ci` |
| Build output directory | `dist` |
| Root directory | *(leave blank)* |

`npm run build:ci` is `check:wasm-pkg && tsc && vite build && check:deploy-assets`. It
deliberately does **not** run `build:wasm`, because a Pages build image has no Rust toolchain.
The compiled WASM package is committed for exactly this reason — see
[`README.md`](./README.md#the-compiled-wasm-package-is-committed).

## 2. Set environment variables

Workers & Pages → your project → **Settings** → **Environment variables**. Add to
**Production** (and to **Preview** if you want preview builds to collect traces too):

| Variable | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | Optional |
| `VITE_SUPABASE_ANON_KEY` | the **anon/public** key | Optional — never `service_role` |
| `VITE_AUI_COLLECTION_MODE` | `scripted` | Default. Do not use `all` before a consent workflow exists |
| `VITE_AUI_DIAGNOSTICS` | `1` | Optional; exposes the research panel in the production build |

All four are optional. With none set, the testbed runs and records locally, exports traces from
the research panel, and reports `collection: local_only`.

Vite inlines `VITE_*` values at build time, so **changing an environment variable requires a
new deployment.** The build does not read them at runtime.

## 3. Confirm the build passed

The build log must end with the asset gate reporting OK:

```
=== Deployment asset inventory ===
  Files in dist/: 20
  Total size:     14.17 MiB (14856477 B)
  Largest asset:  assets/ort-wasm-simd-threaded-<hash>.wasm (12.86 MiB)
  Per-file limit: 25.00 MiB (Cloudflare Pages)
  ORT WASM binary: assets/ort-wasm-simd-threaded-<hash>.wasm (13479978 B)
  Headroom:       every asset is within the per-file limit

[check-deploy-assets] OK — asset inventory satisfies the deployment requirements.
```

If instead you see `FAILED`, the deployment will be broken at runtime or rejected by
Cloudflare. The two failures worth knowing about in advance:

- **`Asset exceeds Cloudflare Pages' 25 MiB limit`** — the WebGPU/JSEP ONNX Runtime binary has
  been pulled back in. Check that `src/gates/slow/onnxSlowGate.ts` still loads
  `onnxruntime-web/wasm` and still defaults to the `wasm`/`cpu` providers (ADR-016).
- **`dist/_headers is missing Cross-Origin-Embedder-Policy`** — the ONNX Runtime threaded build
  will fail to construct a session in the deployed origin. Restore `public/_headers`.

## 4. Confirm the deployed origin

Open the deployment URL and check, in order:

1. The page renders the analytics dashboard.
2. `?auiDiagnostics=1` shows the research panel; **Model** reads `loaded [wasm]`.
3. Completing a task produces a trace (the panel's buffer counts increase) and the **Collection**
   row shows `uploaded` (if Supabase is configured) or `local_only` (if not).

Full sequence: [`verification-runbook.md`](./verification-runbook.md).

### Cross-origin isolation

`public/_headers` sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` on every route. ONNX Runtime Web's threaded WASM
build needs a cross-origin isolated context (`SharedArrayBuffer`). Without those headers the
runtime loads but fails when constructing the session, so the Slow Gate silently degrades to
the mock — **in the deployed origin only**, because `vite.config.ts` sets the same headers for
the local dev server. The asset gate checks for them so this cannot ship unnoticed.

Verify from a shell:

```bash
curl -sI https://<your-deployment>/ | grep -i cross-origin
```

## 5. Custom domain (optional)

Workers & Pages → your project → **Custom domains** → add. Not required for the supervisor
walkthrough; the `*.pages.dev` URL is sufficient and shorter to read out.

---

## What this deployment does not include

- No Pages Functions, no server-side rendering, no API layer. The output is static assets.
- No authentication. The testbed is public by design for this milestone.
- No secret values in the build environment beyond the anon key, which is public by design.

If a requirement appears that needs a server (participant authentication, consent capture,
server-side trace retrieval), that is an explicit architectural decision to take to the
supervisor rather than a quiet addition — see the "Operational simplicity" constraint in the
deployment brief.
