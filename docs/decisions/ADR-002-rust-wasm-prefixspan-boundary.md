# ADR-002: Rust/WASM PrefixSpan Boundary

- **Status:** Accepted
- **Date:** 2026-09-24
- **Related:** ADR-003, ADR-005

## 1. Context

The Fast Gate is a deterministic frequent-sequential-pattern miner over macro-interaction
symbols. It runs inside the runtime Web Worker. The miner is implemented in Rust and compiled
with `wasm-pack` (`wasm-vectorizer/src/prefix_span.rs`), exposed to JS as `mine_macro_patterns`.

An earlier design loaded the module through a nested worker hop via a main-thread RPC client.
That design failed entirely inside the runtime worker: `Worker` is undefined in a dedicated
worker scope, and `window.setTimeout` does not exist there, so the client silently took a
"workers unsupported" branch and never mined.

## 2. Problem

Where should the Rust/WASM miner boundary sit so that the same mining code works on the main
thread and inside a worker, without a nested worker hop and without a `window` dependency?

## 3. Options considered

| Option | Description |
| --- | --- |
| **A. Nested worker RPC** | Main thread owns a `WasmGateClient`; worker asks main thread to mine. |
| **B. Direct in-scope module load** | The miner loads the WASM module itself and exposes a `PatternMiner`; no worker hop, no `window`. |
| **C. Reimplement PrefixSpan in TypeScript** | Remove the Rust dependency for mining. |

## 4. Evidence available

**Verified by automated test**

- `tests/prefixspan_fast_gate.test.ts`, `tests/macro_fast_gate_wiring.test.ts`,
  `tests/gate_arbitration.test.ts` pass against the real WASM miner.

**Measured (live trial, recorded in the implementation record)**

- `gateHits: { fast: 20, none: 52 }` over one scripted trial, with the real WASM miner mining a
  worker-side corpus of 12 sequences.

**Not measured**

- Mining latency as a function of corpus size and support threshold. `NOT MEASURED`.
- WASM linear-memory growth across a long session. `NOT MEASURED`.

## 5. Decision required

None outstanding — Option B is implemented. This record exists so the boundary is not
re-litigated, and to state the conditions under which it would change.

## 6. Recommended option

**Option B — Accepted and already implemented.**
`src/gates/fast/prefixSpanMiner.ts` loads the Rust/WASM module directly and exposes a
`PatternMiner` with no nested worker hop and no `window` dependency.

Option C is rejected: the Rust implementation is real, tested, and working, and replacing it
would add no measured benefit.

## 7. Consequences

- The miner executes identically on the main thread and inside a worker. This property is what
  made the earlier defect diagnosable.
- Rust and `wasm-pack` remain mandatory in the build (`npm run build:wasm`), independently of
  the ADR-001 vectorisation outcome.
- The WASM module is loaded inside the worker, so its payload is counted in the worker bundle,
  not the main bundle.

## 8. What is being deferred

> **Decision:** Online-support tuning of the miner (how `min_support` adapts as the corpus grows).
> **Deferred until:** The Fast/Slow routing experiment (plan 1 task 6.1) produces per-gate outcome
> data.
> **Reason:** Support is currently a fixed configured value; there is no evidence yet about what
> a session-length corpus requires.
> **Current workaround:** `support` is a configuration field (plan 1 task 4.2).
> **Risk:** Low — a mis-set support changes gate hit rate, not correctness; it is observable via
> `gateHits`.
> **Evidence required to revisit:** Gate hit/miss ratios and false-match rate over several
> complete tasks.

## 9. Conditions that would force this decision to be revisited

- The WASM module's payload or instantiation cost becomes a dominant share of worker startup.
- Mining latency grows non-linearly with the live corpus and blocks window processing.
- A future Fast Gate must run outside a worker, where a nested hop would be reconsidered.
