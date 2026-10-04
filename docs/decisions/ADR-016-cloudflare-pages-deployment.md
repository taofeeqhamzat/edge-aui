# ADR-016: Cloudflare Pages Deployment and the ONNX Runtime WASM Entry Point

- **Status:** Accepted — the ORT entry switch is accepted as a deployment unblocker, subject to the validation below
- **Date:** 2026-10-02
- **Related:** ADR-007, ADR-008, ADR-015, ADR-018
- **Amended by:** ADR-024 — the Cloudflare project is a Worker with static assets rather than a classic Pages project. The ONNX Runtime entry point, the committed WASM package, `build:ci` and the asset gate decided below are unchanged.

## 1. Context

The deployment target is GitHub → Cloudflare Pages → the React testbed (brief §2, §17, §26). Two
facts discovered while preparing it made the existing build undeployable:

1. **The compiled WASM package was not committed.** `src/gates/fast/prefixSpanMiner.ts` imports
   `wasm-vectorizer/pkg/wasm_vectorizer.js`, but `wasm-vectorizer/pkg/` was gitignored. A clean
   clone — which is what every Pages build is — could not compile. `npm run build` only worked for
   someone who had already run a local Rust build.
2. **A single asset exceeded Cloudflare Pages' limit.** Cloudflare Pages rejects a site with any
   asset at or above 25 MiB ([Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)).
   The build emitted `ort-wasm-simd-threaded.jsep-*.wasm` at **26,827,543 bytes** — 160 KiB over.
   That binary is loaded when ONNX Runtime Web is asked for the **WebGPU** execution provider,
   which `onnxSlowGate.ts` requested by default (`['webgpu', 'wasm', 'cpu']`).

## 2. Problem

How does the testbed deploy through Cloudflare Pages from a clean checkout, without redesigning the
model, changing its weights, or weakening the trace contract?

## 3. Options considered

| Option | Description | Effect |
| --- | --- | --- |
| **A. Keep WebGPU, host the JSEP binary elsewhere** | Serve the 26.8 MB asset from R2 or a custom domain | Adds an infrastructure dependency the brief explicitly discourages; splits assets across origins, which conflicts with COEP `require-corp` |
| **B. Commit the WASM package; switch ORT to the WASM-only entry and drop the WebGPU provider** | `onnxruntime-web/wasm`, providers `['wasm','cpu']` | 13.5 MB asset; no new infrastructure; loses GPU acceleration |
| **C. Ship a fully custom ONNX runtime build** | Tree-shake a minimal ORT | Large scope for a payload that is already inside the limit after B |

## 4. Evidence available

**Measured in this repository:**

| | Before | After (Option B) |
| --- | --- | --- |
| ONNX Runtime WASM asset | `ort-wasm-simd-threaded.jsep-*.wasm` 26,827,543 B | `ort-wasm-simd-threaded-*.wasm` 13,479,978 B |
| Total `dist/` | ~28.8 MB | 14,856,477 B (14.17 MiB) |
| Largest asset vs 25 MiB limit | **Over — deployment rejected** | 12.86 MiB — inside the limit |
| JSEP asset emitted | Yes | No |

**Verified:** every existing ONNX test passes with the WASM provider, and `ort.env.wasm.numThreads`
is already `1`, so the threaded-JSEP path was never the exercised configuration.

**Not verified at the time of writing:** inference through the WASM provider **from the deployed
Cloudflare Pages origin**. No such origin exists yet. This is recorded as `NOT VERIFIED` in
`docs/deploy/verification-runbook.md` rather than assumed.

## 5. Decision required

Whether to keep the WebGPU provider and pay for it in infrastructure, or use the WASM provider and
accept the loss of GPU acceleration.

## 6. Decision

**Option B, accepted as a deployment unblocker rather than as a settled outcome.**

Accepted by the supervisor on the explicit condition that it is validated end to end, in this order:

```
ORT WASM entry point → production build → asset inventory → Cloudflare Pages deployment
   → browser loads model + WASM → real sequence + context inference → TargetInterventionHead
   → policy → visible intervention → persistent research trace
```

### What this decision does and does not change

**Does not change:** model architecture, model weights, the target intervention head, the
intervention policy, the intervention taxonomy, or the trace contract. This is a runtime/backend
and packaging decision.

**Does change:** the reported `executionProvider` is now `wasm`. In the audit's terms this is an
honesty improvement — the previous value could echo the *requested* provider rather than the one
that served inference (assessment F-10) — but it is a behavioural change and is disclosed as one.

**Invalidates:** every latency figure previously obtained under WebGPU as a statement about
deployment performance. Those numbers must be relabelled rather than reused. Post-change numbers
come from a re-measurement, not from the old artifact.

### Consequences

- The compiled WASM package is committed. `npm run check:wasm-pkg` fails loudly if it is absent, and
  `npm run build:wasm` regenerates it from the Rust sources, which remain the source of truth.
- `npm run check:deploy-assets` runs as the final step of `build:ci` and fails the build when any of
  the five deployment properties regress, so a rejected inventory cannot ship silently.
- `public/_headers` supplies `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. The
  Vite dev server sets these itself, so their absence in the deployed origin would present as
  "works locally, degrades in production" — the asset gate checks for them for that reason.

## 7. What is being deferred

> **Decision:** Reintroducing the WebGPU execution provider.
> **Deferred until:** After supervisor feedback on the v0.1 deployment, and only if measured WASM
> latency is shown to be a problem.
> **Reason:** The supervisor's instruction is to defer reintroduction and ORT size optimisation
> until after feedback. The WASM path is inside the asset limit and passes the existing ONNX tests.
> **Current workaround:** WASM execution provider with `numThreads = 1`.
> **Risk:** Slow-gate latency may be higher than under WebGPU. This is `NOT MEASURED` for the
> deployed origin and must be measured before any performance claim is made.
> **Evidence required to revisit:** A measured deployed-origin inference latency that fails the
> research workflow's needs.

> **Decision:** Reducing the ONNX Runtime payload below 13.5 MB.
> **Deferred until:** Distribution to participants becomes a requirement.
> **Reason:** ADR-008's 500 KB combined-payload target remains unmet, but it does not block a lab
> deployment and is already tracked as an outstanding deferment.
> **Current workaround:** None; the payload is accepted as-is for lab use.
> **Risk:** Low for a lab study on a local network; medium for remote participant distribution.
> **Evidence required to revisit:** A decision to distribute to participants over consumer networks.

## 8. Conditions that would force this decision to be revisited

- Deployed-origin inference fails or is unusably slow under the WASM provider — in which case the
  correct response is to report the failure and re-open the payload question, not to relax the
  acceptance criteria.
- Cloudflare Pages changes its per-asset limit.
- A requirement appears for GPU-accelerated inference in the deployed testbed.
