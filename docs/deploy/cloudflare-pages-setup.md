# Cloudflare Deployment Setup

Creates the Worker that serves the React testbed from GitHub. The deployment is reproducible from
the repository: everything it needs is either tracked or set as an environment variable here
(deployment brief §17).

> **Platform note.** Cloudflare's current **Workers & Pages → Create** flow creates a **Worker with
> static assets**, and its Git integration is **Workers Builds**. That is what this project uses.
> A Workers Build has no "Build output directory" field: the published directory is declared in
> [`wrangler.jsonc`](../../wrangler.jsonc) as `assets.directory`, so it is tracked rather than
> entered by hand. Classic Pages projects use the same build command and the same `_headers` file;
> only the configuration surface differs.

---

## 1. Connect the repository

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Workers** →
   **Connect to Git** (import a repository).
2. Authorise GitHub and select this repository.
3. Configure the build:

| Setting | Value | Where the field is |
|---|---|---|
| Production branch | `main` | Build trigger settings |
| Build command | `npm run build:ci` | Build trigger settings — **not** the default `npm run build` |
| Deploy command | `npx wrangler deploy` | Build trigger settings. Wrangler reads the asset directory from `wrangler.jsonc` |
| Build output directory | *(does not exist)* | Declared in `wrangler.jsonc` as `assets.directory: "./dist"` |
| Root directory | *(leave blank)* | The repository root |

`wrangler.jsonc` is the deploy contract. It sets `assets.directory` to `dist/` and `name` to
`edge-aui`, so a build updates that Worker in place. There is deliberately no `main`: the testbed
has no server-side code, so every response is a static-asset response — which is what `_headers`
applies to.

> **The published directory is `dist`, not `public`.**
>
> This repository also contains a `public/` directory (`public/_headers` and the ONNX graphs).
> `public/` is Vite's *source* directory for assets copied verbatim into the build; `dist/` is the
> build output that contains the application. Publishing `public/` does not fail loudly — it serves
> a directory with no application in it. Because the directory is declared in `wrangler.jsonc`,
> that mistake cannot be made from the dashboard, and a review of the file is the whole check.

### Why `build:ci` and not `build`

`npm run build:ci` is `check:wasm-pkg && tsc && vite build && check:deploy-assets`. It deliberately
does **not** run `build:wasm`, which `npm run build` does: that step needs `wasm-pack` and a Rust
toolchain, and **no Cloudflare build image has either**. Leaving the build command at its default
is the most common way this deployment fails — the build log stops inside `build:wasm`.

The compiled WASM package is committed for exactly this reason — see
[`README.md`](./README.md#the-compiled-wasm-package-is-committed).

## 2. Set environment variables

**For this application they must be set as build-time variables on the build trigger, not as
runtime variables.** Workers do support runtime variables and secrets, but this app never reads
them: Vite resolves `import.meta.env.VITE_*` while bundling, so the value is a literal inside the
deployed JavaScript by the time the Worker exists.

```
Cloudflare build-trigger variables ──► `vite build` (build time) ──► inlined literal in dist/*.js
Cloudflare runtime variables       ──► available to Worker code only: read by nothing here
```

Cloudflare's own wording for build-trigger variables is that they are "build-time environment
variables, available only during the build process" — which is precisely what Vite needs.

Two consequences:

- **Changing a variable requires a new build.** The already-deployed version has the old value
  compiled in. Push a commit, or trigger a build, afterwards.
- **A variable added after a build only affects builds that start later.** A build already running,
  or a version already deployed, keeps the values it was built with.

Set them on the build trigger: **Workers & Pages → edge-aui → Settings → Builds → Build
configuration → Environment variables**, scoped to **Production** (and to **Preview** if preview
builds should collect traces — they are separate triggers with separate variables). The same fields
also appear during project creation, under **Environment variables**. The equivalent API is
`PATCH /accounts/{account_id}/builds/triggers/{trigger_uuid}/environment_variables`.

| Variable | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | Optional |
| `VITE_SUPABASE_ANON_KEY` | the **anon/public** key | Optional — never `service_role` |
| `VITE_AUI_COLLECTION_MODE` | `scripted` | Default. Do not use `all` before a consent workflow exists |
| `VITE_AUI_DIAGNOSTICS` | `1` | Optional; exposes the research panel in the production build |

All four are optional. With none set, the testbed runs and records locally, exports traces from
the research panel, and reports `collection: local_only`.

**Verify that the inlining actually happened** — this is the check that catches a variable set on
the wrong environment, or set after the build ran. Fetch the deployed bundle and look for the
project ref inside it:

```bash
# Replace with your Worker URL and Supabase project ref.
curl -s https://<your-worker-host>/ | grep -o 'assets/index-[^"]*\.js' | head -1
curl -s https://<your-worker-host>/assets/index-<hash>.js | grep -c '<project-ref>'
# expect: a non-zero count
```

A zero count means the build ran without `VITE_SUPABASE_URL`; the app will report
`local_only` and upload nothing, without any error.

## 3. Confirm the build passed

The build log must end with the asset gate reporting OK:

```
=== Deployment asset inventory ===
  Files in dist/: 20
  Total size:     14.18 MiB (14872949 B)
  Largest asset:  assets/ort-wasm-simd-threaded-<hash>.wasm (12.86 MiB)
  Per-file limit: 25.00 MiB (Cloudflare Pages)
  ORT WASM binary: assets/ort-wasm-simd-threaded-<hash>.wasm (13479978 B)
  Headroom:       every asset is within the per-file limit

[check-deploy-assets] OK — asset inventory satisfies the deployment requirements.
```

The script's message says "Cloudflare Pages" because that was the original target; the same 25 MiB
per-asset ceiling applies to Workers static assets, so the gate is still the right check for either
platform.

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

Workers & Pages → **edge-aui** → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
Not required for the supervisor walkthrough; the `*.workers.dev` URL is sufficient and shorter to
read out.

---

## What this deployment does not include

- No Worker script, no server-side rendering, no API layer. The output is static assets served
  from a Worker that contains no code.
- No authentication. The testbed is public by design for this milestone.
- No secret values in the build environment beyond the anon key, which is public by design.

If a requirement appears that needs a server (participant authentication, consent capture,
server-side trace retrieval), that is an explicit architectural decision to take to the
supervisor rather than a quiet addition — see the "Operational simplicity" constraint in the
deployment brief.
