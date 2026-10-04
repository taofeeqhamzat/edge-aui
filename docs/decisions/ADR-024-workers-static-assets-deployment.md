# ADR-024: Workers Static Assets as the Deployment Target

- **Status:** Accepted
- **Date:** 2026-10-04
- **Related:** ADR-015, ADR-016

## 1. Context

ADR-016 chose "GitHub → Cloudflare Pages → the React testbed" and settled everything the
*application* needed in order to be deployable: the committed WASM package, `build:ci`, the
WASM-only ONNX Runtime entry point, and the asset gate. It did not describe how the Cloudflare
project itself would be created, because it was written before any Cloudflare account existed.

When the project was created, Cloudflare's **Workers & Pages → Create application** flow produced
a **Worker with static assets**, and its Git integration is **Workers Builds**. The deployment
check on each commit is `Workers Builds: edge-aui`, and its details resolve under
`workers/services/view/edge-aui`. There is no classic Pages project.

Two setup questions follow from that mismatch, and both were unanswerable from the documentation
as written:

1. The docs specify a **Build output directory** of `dist`. A Workers Build has no such field.
2. The docs say the environment variables are build-time. That is true, but a Worker also supports
   *runtime* variables, so the statement needed to be specific to this app rather than to the
   platform.

The first build failed. The build command was correct, but `npx wrangler deploy` had no
configuration telling it what to publish, because the repository contained no Wrangler file —
classic Pages needs none, a Worker does.

## 2. Problem

How does this testbed deploy on the Cloudflare product the project actually uses, without
re-opening the packaging decisions ADR-016 settled and without weakening the cross-origin
isolation that the Slow Gate depends on?

## 3. Options considered

| Option | Description | Effect |
| --- | --- | --- |
| **A. Recreate the project as a classic Pages project** | Delete the Worker; create Pages via **Connect to Git** | Matches ADR-016's wording and the existing docs verbatim; discards a working Git connection and goes against the flow Cloudflare currently presents |
| **B. Deploy as a Worker with static assets** | Add `wrangler.jsonc` declaring `assets.directory = ./dist`; keep `build:ci` | No application change; the published directory becomes a tracked, reviewable file instead of a dashboard field |
| **C. Deploy by direct upload from CI** | Build and `wrangler deploy` from a GitHub Action | Adds a credential and a workflow to maintain, and removes the deploy from the reviewed repository state |

## 4. Evidence available

**Observed in this repository's environment:**

| Observation | Evidence |
| --- | --- |
| The project is a Worker, not classic Pages | Commit check name `Workers Builds: edge-aui`; details URL under `workers/services/view/edge-aui` |
| The build failed without a Wrangler file | `conclusion=failure` on commit `c45834d`, with no Wrangler configuration in the tree |
| The build succeeds with `wrangler.jsonc` + the deploy command | `conclusion=success` on `fc40b79` and again on `7f2727d` |
| Workers static assets honours `_headers` | [Cloudflare: Headers](https://developers.cloudflare.com/workers/static-assets/headers/) — `_headers` in the asset directory overrides default response headers for static-asset responses |
| The published directory is declared in the repository | [`wrangler.jsonc`](../../wrangler.jsonc) `assets.directory` |

**Not verified at the time of writing:** the deployed Worker's response headers and its runtime
behaviour — session construction under the WASM provider, `_headers`-supplied cross-origin
isolation, and a trace reaching Supabase from the deployed origin. These remain `NOT VERIFIED` in
`docs/deploy/verification-runbook.md` and are what the acceptance sequence exists to close.

## 5. Decision required

Whether to keep the Worker that exists and declare its deployment in the repository, or to
recreate the deployment as a classic Pages project.

## 6. Decision

**Option B — deploy as a Worker with static assets, declared by `wrangler.jsonc`.**

Rationale: the Worker is the product Cloudflare's current flow creates, and the only thing it was
missing was a declaration of what to publish. That declaration belongs in the repository, where it
is reviewed and versioned, rather than in a dashboard field that no reviewer sees. Option A would
trade a working connection for wording; Option C would add a credential and move the deploy out of
the reviewed state.

### What this decision does and does not change

**Does not change:** the build command (`npm run build:ci`), the WASM-only ONNX Runtime entry
point, the committed WASM package, the asset gate and its five properties, the trace contract, or
the Supabase collection path. ADR-016's substantive decisions stand.

**Does change:** the platform object is a Worker rather than a Pages project, and the published
directory is `assets.directory` in `wrangler.jsonc` rather than a dashboard setting. `_headers`
continues to supply `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`; this is safe
precisely because the Worker contains no script, so every response is a static-asset response, and
`_headers` is documented not to apply to Worker-generated responses.

**Resolves:** the two documentation ambiguities above. The pages-vs-workers wording in
`docs/deploy/` now describes the Worker.

### Consequences

- `wrangler.jsonc` is part of the deployment contract. `name` must match the existing Worker
  (`edge-aui`) or a build creates a second service instead of updating the first.
- There is deliberately no `main` entry. Adding Worker code later would move responses out of
  `_headers`' scope and require the isolation headers to be attached in code.
- The `_headers` check in `npm run check:deploy-assets` remains the guard against shipping without
  cross-origin isolation, which is invisible locally because `vite.config.ts` sets the same headers
  for the dev server.
- The asset gate's console message still reads "Cloudflare Pages"; the same 25 MiB per-asset limit
  applies to Workers static assets, so the check is unchanged in substance.

## 7. What is being deferred

> **Decision:** Renaming `docs/deploy/cloudflare-pages-setup.md` and ADR-016 to reflect the
> Workers target.
> **Deferred until:** After the acceptance sequence passes against the deployed origin, so the
> rename is one coherent edit rather than a second round of churn.
> **Reason:** The filename is referenced from three documents and is the name the deployment
> brief's reader already has; renaming it now would obscure the platform note at the top of the
> file without changing any behaviour.
> **Current workaround:** The file is titled "Cloudflare Deployment Setup" and carries a platform
> note explaining the Worker/Pages distinction.
> **Risk:** Low — a reader looking for Pages-specific dashboard fields is redirected in the first
> paragraph.
> **Evidence required to revisit:** A passing acceptance sequence, or a second contributor
> mistaking the document for classic-Pages instructions.

## 8. Conditions that would force this decision to be revisited

- Cloudflare changes the per-asset limit for Workers static assets below the 12.86 MiB ORT binary,
  or below the 14.18 MiB total.
- The deployment needs server-side code — participant authentication, consent capture, or
  server-side trace retrieval — which would introduce a Worker script and move responses out of
  `_headers`' scope.
- Cloudflare retires Workers static assets in favour of another mechanism.
