# ADR-020: Fast Gate Execution Bounds

- **Status:** Accepted
- **Date:** 2026-10-02
- **Related:** ADR-002, ADR-003, ADR-012

## 1. Context

The Fast Gate's PrefixSpan miner had **no bound on corpus size, pattern length, pattern count, or
recursion nodes**, and the runtime worker handles messages in a strictly serial loop
(`entry.ts` awaits each request before reading the next). Measured live (assessment F-02):

| Measurement | Value |
| --- | --- |
| `PrefixSpan mining [wasm]` p95 | **2 943 ms** (max 3 149 ms) |
| Corpus size at that measurement | **≤ 9 sequences** |
| `worker message/transfer` p95 | **4 030 ms** |
| Observed console errors | `Worker request EVALUATE timed out after 5000ms`, `… PUSH_WINDOW timed out…` |

The failure mode was not slow inference: it was **lost telemetry**. A multi-second mine blocked
every queued `PUSH_WINDOW`, so requests were rejected at the 5 000 ms transport timeout and the
windows were dropped on the floor during exactly the interaction-dense moments that matter. In one
committed capture the same failure reduced a 190-second session to a single prediction.

Additionally, three configuration keys existed but were never consumed: `fastGate.maxPatternLength`,
`fastGate.rankingStrategy`, and the runtime's effective `minSupport` had three competing defaults
(`config` = 1, `AdaptiveRuntime` fallback = 2, `boot.ts` = 1) — assessment F-17, F-23.

## 2. Problem

What is the minimum change that makes the current Fast Gate usable and reproducible, without
redesigning PrefixSpan?

## 3. Options considered

| Option | Description | Assessment |
| --- | --- | --- |
| **A. Repair the miner to standard PrefixSpan semantics** | Fix per-sequence vs per-position counting and first-occurrence projection | Changes what "Fast Gate match" means and therefore the results — a research-methodology change, explicitly out of the brief's scope |
| **B. Keep the algorithm; bound its inputs and outputs, and make every evaluation's outcome observable** | Corpus cap, pattern-length cap, pattern-count cap, a mining deadline, backpressure, counters | Bounds the cost without changing semantics |
| **C. Move mining off the critical path** | Periodic, cached mining | Larger architectural change than the milestone allows |

## 4. Evidence available

**Verified:** the unbounded Rust recursion; the serial worker loop; the measurable multi-second p95;
the transport timeouts; the dropped windows; the three dead configuration keys with three competing
`minSupport` defaults.

**Verified after the change:** `tests/fast_gate_bounds.test.ts` covers the corpus cap (and that the
current session is always retained in it), the pattern-length cap, the pattern-count cap, a timed-out
mining call reported as `timed_out`, a miner failure reported as `failed`, a normal evaluation
reported as `executed`, listener-failure isolation, and that an empty sequence does not call the
miner at all.

## 5. Decision required

Whether to change the miner's semantics, bound it, replace it, or move it off the critical path.

## 6. Decision

**Option B. Bound the work and make every evaluation's outcome observable. Do not change the
algorithm.**

Explicit bounds, all configurable and validated:

| Bound | Default | Purpose |
| --- | --- | --- |
| `fastGate.maxCorpusSequences` | 40 | The dominant cost input. The most recent sequences are kept and the current session is always appended, so a bound cannot silence the session being measured. |
| `fastGate.maxPatternLength` | 4 | Patterns longer than this are discarded *before* matching; an over-long pattern is never actionable. Consumes the previously dead key. |
| `fastGate.maxPatterns` | 32 | Caps how many patterns are considered per evaluation. |
| `fastGate.miningTimeoutMs` | 1500 | The caller's mining deadline. |
| `fastGate.rpcTimeoutMs` | 3000 | Transport budget, validated to be ≥ the mining deadline so the transport cannot give up before the bounded deadline reports a reason. |

Backpressure: `maybeEvaluate` counts a suppressed evaluation as `superseded` instead of returning
silently, and a failed `dispatchWindow` increments `droppedWindows`.

Counter set published on `trace.metadata.mining` and the diagnostics handle:
`executed`, `skipped`, `superseded`, `timedOut`, `droppedWindows`, `observedMaxMiningMs`.

### An honest limitation, stated rather than papered over

**The deadline cannot cancel the WASM call.** The miner runs synchronously inside the worker, so a
deadline that expires cannot preempt it; what the deadline changes is that the caller stops waiting
and the pipeline **records why** instead of losing the window to a transport timeout. The only true
hard bound on mining time is a recursion/node bound inside `prefix_span.rs`, which this decision does
not add.

Consequently `maxNodes` — bound (1) of the audit's recommendation — is **not implemented**. The
Rust recursion remains unbounded in node count. The practical bound comes from capping the corpus and
the symbol alphabet's repetition, not from bounding the search.

## 7. What is being deferred

> **Decision:** A node/prefix bound inside the Rust miner (`maxNodes`), making mining time bounded by construction rather than by input size.
> **Deferred until:** The corpus cap is measured to be insufficient on realistic session lengths.
> **Reason:** It requires a change to the WASM interface and a re-measurement of the bounded miner's
> latency, pattern counts and Fast Gate hit rate. The brief prohibits optimising beyond what a
> credible deployed testbed needs, and this milestone's requirement is that the gate is *bounded and
> observable*, which the caps plus counters achieve.
> **Current workaround:** Corpus cap plus deadline plus counters; a timed-out mine is recorded rather
> than silently dropped.
> **Risk:** Medium — on a very long session with a highly repetitive symbol stream, mining could
> still take multiple seconds and supersede evaluations. The counters make that visible, but they do
> not prevent it.
> **Evidence required to revisit:** A measured post-change mining latency distribution on a realistic
> session that shows `timedOut` or `superseded` counts large enough to bias the trace.

> **Decision:** Repairing the miner's PrefixSpan semantics.
> **Deferred until:** A supervisor decision on what "Fast Gate match" should mean.
> **Reason:** The current implementation counts each item once per sequence and projects only on the
> first occurrence, so its pattern semantics differ from the literature. Changing it changes which
> patterns match and therefore the experimental results.
> **Current workaround:** The miner is bounded and its behaviour is measured; findings that depend on
> pattern semantics are labelled as depending on this variant.
> **Risk:** High for any claim of the form "the Fast Gate recognised a known pattern" — such a claim
> is not currently defensible.
> **Evidence required to revisit:** A bounded benchmark of corpus size vs latency vs pattern count,
> plus a decision on the intended pattern semantics.

## 8. Conditions that would force this decision to be revisited

- `superseded` or `timedOut` counts are large enough to bias a real capture.
- A research claim depends on the Fast Gate's pattern semantics.
- A session length is reached where the corpus cap discards history that mining needs.
