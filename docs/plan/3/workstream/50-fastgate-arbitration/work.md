# Workstream 50 — Fast Gate, PrefixSpan and Shared Arbitration

## Objective

Harden the deterministic Fast Gate and complete the shared gate/arbitration contract after the
participant collection and target-head preparation phases.

The intended project order is:
task/testbed → participant collection → target-head retraining → Fast Gate hardening →
intervention refinement. This workstream therefore starts after Phase 4B.

## Current state

- The Rust/WASM PrefixSpan miner enforces its own bounds (`max_pattern_length`,
  `max_patterns`), counts support per sequence, reports conditional confidence and returns a
  deterministic order. Quality Assessment 2 finding F-02 is resolved for the miner.
- The reported audit corpus (nine short sequences, support 2) at the old effective bounds
  returns **9 825 patterns** at p95 27.3 ms; the production bounds return **32 patterns** at
  p95 0.35 ms. Memory and the full case table:
  [`docs/benchmarks/fastgate-mining.md`](../../../benchmarks/fastgate-mining.md).
- The Fast Gate resolves a mined pattern through an application **declaration set**
  (`src/gates/fast/patternDeclaration.ts`) that carries the semantic outcome and the measured
  evidence. The testbed set is derived from the participant candidate report, not from the
  scripted canonical paths.
- Patterns map to semantic outcomes (`open_filter_section`, `apply_filter`, …); the testbed
  policy adapter turns an outcome into an adaptation, or records a decision-only verdict when
  the outcome has no declared adaptation.
- No-match is explicit: `matched: false` carries a `reason`, and arbitration reports the
  selected prediction with provenance (gate, pattern, gate version, mapping source, latency).
  A Slow Gate prediction is selected even when its compatibility command is `no_op`.
- The macro-layer defects from assessment limitation #6 remain open. They are handled here by
  **exclusion**: no declared pattern uses `SELECT_REGION`, `TABLE_ROW_SELECT`, `TABLE_SORT`,
  `TABLE_PAGE_*`, `SELECT_SEGMENT`, `BACKTRACK`, `IDLE_DWELL`, `RAPID_SCROLL` or
  `EXPAND_TOOLTIP`. The macro mapper fix stays a tracked follow-up (plan §2.8).

## Task index and order

| Order | Task | Description | Depends on | Scope | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | [50.1](tasks/50.1-prefixspan-correctness-and-bounds.md) | PrefixSpan correctness, bounded execution and deterministic tests | 30.1, 40.4 | Medium | Done |
| 2 | [50.2](tasks/50.2-pattern-semantics-and-semantic-mapping.md) | Pattern declaration, support/length, session isolation, semantic mapping, no-match | 50.1 | Medium | Done |
| 3 | [50.3](tasks/50.3-shared-arbitration-and-performance.md) | Shared arbitration, provenance, no-match/fallback, performance/memory | 50.2 | Medium | Done |

## Checkpoints

| After | Checkpoint | Result |
| --- | --- | --- |
| 50.2 | PrefixSpan correctness and pattern semantics tests pass; no false canonical-path matches | Pass |
| 50.3 | Both gates return the shared contract; arbitration provenance and performance evidence pass | Pass |

## Exit criteria

- [x] PrefixSpan correctness is covered by deterministic fixtures, including the F-02 cases.
  The failing cases are pinned against the committed WASM package: non-deterministic order
  (five distinct orderings across five runs before the fix), unbounded output (9 825 patterns
  against the old effective bounds), and the corpus/query double count.
- [x] Pattern support/length/boundary/session semantics are explicit and tested.
- [x] Patterns map to semantic outcomes, not only interventions.
- [x] No-match and fallback behavior are explicit; no false/noisy matches on canonical task
  paths. A miss carries a reason; a corpus that already contains the observed sequence is not
  counted twice; a session reset clears the mining corpus.
- [x] Both gates produce the normalized prediction contract; arbitration selects and preserves
  provenance; policy consumes the result.
- [x] Performance and memory on realistic sequences are measured and reported (see below).

## Verification

```bash
cd edge-aui-framework
npm test -- tests/prefixspan_fast_gate.test.ts tests/fast_gate.test.ts tests/gate_arbitration.test.ts
npm test -- tests/fast_gate_bounds.test.ts tests/pattern_declaration.test.ts tests/macro_fast_gate_wiring.test.ts
npm run typecheck
npm run parity:check
cargo test --manifest-path wasm-vectorizer/Cargo.toml
npm run benchmark:fastgate
```

## Measurement record

`npm run benchmark:fastgate` writes `docs/benchmarks/fastgate-mining.json` and `.md` from the
committed WASM package. Measured 2026-11-20 on an Apple M1, Node v26.13.1, commit `72424e8`:

| Case | Corpus | Bounds (support / length / patterns) | Patterns | p95 ms |
| --- | --- | --- | --- | --- |
| `live_pre_fix` | 9 × 18 | 2 / 8 / 1 000 000 | 9 825 | 27.331 |
| `bounded_production` | 35 × 18 | 2 / 4 / 32 | 32 (cap) | 0.351 |
| `bounded_evidence_floor` | 35 × 18 | 3 / 4 / 32 | 32 (cap) | 0.319 |
| `bounded_worst_corpus` | 40 × 60 | 2 / 4 / 32 | 32 (cap) | 1.159 |

The browser run of `npm run benchmark:runtime` independently measured `PrefixSpan mining` at
p95 **0.405 ms** over 84 in-session calls, so the Node measurement above is not the only
evidence. `NOT MEASURED`: Total Blocking Time as a Lab metric, the 20 MB browser memory
budget, worker head-of-line blocking and deployed end-to-end latency. No historical latency
value is reused.

## Decisions recorded by this workstream

1. **Miner bounds live in Rust, not in a gate-side filter.** A gate that filters an already
   materialised unbounded result has paid for it. `PatternMiningRequest` carries the bounds so
   the miner can stop early.
2. **Confidence is conditional.** `support(pattern) / support(prefix)`. The old
   `support / corpus_size` was corpus coverage, which misreported the strength of a
   continuation.
3. **A declaration without evidence is rejected.** Support, occurrences, task coverage,
   provenance and source are required, so a pattern cannot be declared on intuition.
4. **`SELECT_REGION` patterns are excluded, not silently accepted.** The macro mapper still
   misclassifies `tooltip-region`; the candidate report flags those patterns. Excluding them is
   honest until the macro fix lands.
5. **The declared outcome is the episode's resolved act**, not a next-action forecast. The
   pattern's final symbol has already happened when it matches, and the documentation says so.
6. **Adaptation policy is separate from pattern declarations.** The testbed maps semantic
   outcomes to adaptations in `policyAdapter.ts`; outcomes without an entry produce a recorded
   decision-only verdict rather than an invented adaptation.
7. **A Slow Gate prediction is a selection even with a `no_op` command.** The policy decides
   the adaptation; `matchedGate: 'none'` beside a matched prediction was a contract
   contradiction.

## Risks

| Risk | Mitigation |
| --- | --- |
| Optimising before evidence | Mining is measured on participant-shaped corpora; bounds come from the runtime configuration |
| Changing the WASM boundary | The boundary is unchanged (one module, same call path); the exported function gained two bound parameters and the package was rebuilt and committed |
| Pattern overfitting/noise | Declarations require measured participant evidence and exclude unreachable symbols; no declared pattern is scripted-only |
| Contract mismatch with Slow Gate | Shared `PredictionResult` tests in `gate_arbitration.test.ts` |
| Experimental-condition tests fail locally | Pre-existing: `tests/experiment_condition.test.ts` fails whenever `.env.local` sets `VITE_AUI_EXPERIMENT_CONDITION`, because Vite inlines the value before `vi.stubEnv` can override it. Reproduced unchanged at the pre-workstream commit. |

## Verification log

- Rust: `cargo test` — 11 miner tests pass (bounds, determinism, support, confidence,
  overlapping occurrences).
- WASM package rebuilt (`npm run build:wasm`); `wasm_vectorizer_bg.wasm` is 122 262 B and the
  export signature now requires both bounds.
- TypeScript: `npm run typecheck` clean.
- `npm run parity:check`: fixture matches the Python reference.
- `npm test` (627 passed): all suites pass except the pre-existing environment failure
  described above (7 tests in `experiment_condition.test.ts` with `.env.local` present;
  2 tests in `trial_completion_upload.test.ts` without it). Both sets reproduce at commit
  `72424e8`, so neither is caused by this workstream.
- `npm run benchmark:runtime`: succeeded. Browser `PrefixSpan mining` measured p95
  **0.405 ms** over 84 calls (mean 0.714 ms, max 22.745 ms); per-window pipeline p95
  **8.07 ms**; ONNX inference p95 1.395 ms; one long task (>50 ms) during the run. The
  refreshed report is `docs/benchmarks/runtime-benchmark.md`.
- `npm run benchmark:fastgate`: wrote `docs/benchmarks/fastgate-mining.{json,md}`; the table
  above is copied from it.
