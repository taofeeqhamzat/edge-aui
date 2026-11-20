# Edge-AUI Target Testbed — Architecture and Contracts

This document describes the system **as implemented**. Every claim here is checkable against
source. For the audit that produced the current design and the list of known gaps, see
[`assessments/`](./assessments/).

---

## 1. Purpose

The testbed is a browser-only research instrument. It passively observes interaction, reduces
it to a fixed-length behavioural representation, matches it against deterministic macro
patterns and a learned model, and applies **non-destructive, reversible** interface
adaptations — recording enough context for the resulting traces to be replayed and evaluated
offline.

It exists to supply the target environment for the model-preparation pipeline
([`edge-aui-model-preparation`](https://github.com/taofeeqhamzat/edge-aui-model-preparation)).

---

## 2. Pipeline

```
                     ┌──────────────────────── main thread ────────────────────────┐
                     │                                                             │
  DOM events ──► TelemetryObserver ──► BehaviourEvent ──┬─► RollingWindowBuffer ──┤
                     │                                  │      (500/250 ms grid)  │
                     │                                  │            │            │
                     │                                  │            ▼            │
                     │                                  │  computeWindowMicroTensor
                     │                                  │      18-D [X⊙M, M]      │
                     │                                  │            │            │
                     │                                  ├─► OutcomeDeriver ──► OutcomeEvent
                     │                                  │            │            │
                     │                                  └─► MacroInteractionStream │
                     │                                               │             │
                     │                     ┌─────────────────────────┘             │
                     │                     ▼                                       │
                     │            RuntimeWorkerClient  (typed postMessage)          │
                     │                     │                                       │
                     │                     ▼                                       │
                     │            UIActuator.apply(command) ◄── InterventionPolicy  │
                     │                     │                                       │
                     │                     ▼                                       │
                     │                DOM classes / ARIA attributes                │
                     │                                                             │
                     └──────────── ExperimentRecorder (single trace) ◄──────────────┘

                     ┌──────────────────────── dedicated worker ───────────────────┐
                     │  SequenceBuilder (T = 8 windows)                            │
                     │            │                                                │
                     │            ▼                                                │
                     │  AdaptiveInferenceEngine                                    │
                     │     ├── FastGate  (PrefixSpan over macro symbols, WASM)      │
                     │     └── SlowGate  (INT8 GRU, ONNX Runtime Web, WebGPU)       │
                     │            │                                                │
                     │            ▼                                                │
                     │      InferenceResult { intervention?, matchedGate, latency }│
                     └─────────────────────────────────────────────────────────────┘
```

**Composition root:** `src/runtime/boot.ts` → `src/runtime/adaptiveRuntime.ts`. The runtime is
started from `src/main.tsx`. It owns exactly one of each stage.

---

## 3. Windowing contract

| Property | Value | Source |
|---|---|---|
| Window duration | 500 ms | `config.yaml` → `PREPROCESSING_CONFIG` |
| Stride | 250 ms | same |
| Settlement delay | 250 ms (1 stride) | `config.yaml` → `PREPROCESSING_CONFIG.settlement_delay_ms` (ADR-005) |
| Minimum events per window | 3 | same |
| Interval semantics | half-open `[start, end)` | `src/microtensor/window.ts` |
| Grid | fixed monotonic grid; `anchor(origin)` | same |
| Inactivity | windows are emitted with `inactive: true` | same |

Key architectural properties:

- **Half-open slots** so an event on a boundary is counted exactly once. This matches
  `model-preparation/src/preprocessing.py`, which uses `searchsorted(..., side="left")`.
- **A fixed grid, not an event-anchored one**, so a given timestamp always falls in the same
  window regardless of when the first interaction happened. This makes windows
  comparable between sessions.
- **Delayed settlement (ADR-005 Option B):** each slot is held open for `settlement_delay_ms` (250 ms)
  before final settlement. This bounds Slow Gate reaction latency to an added 250 ms while recovering
  66.2% of sparse slots straddling window boundaries (`settledSparseWindows`).
- **Observable accounting:** the buffer records `lateEvents` (events arriving after slot eviction),
  `skippedSparseWindows` (slots remaining below threshold after delay), and `settledSparseWindows`
  (slots rescued by delayed arrival). `settlementDelayMs` is exported in the trace metadata.

---

## 4. MicroTensor (18-D)

`X̃ = [X ⊙ M, M]`, nine kinematic features followed by nine binary modality-mask flags.

| # | Feature | Unit | Source | Normalisation |
|---|---|---|---|---|
| 0 | `meanVelocity` | px/ms | pointer deltas / dt | ÷ 10 |
| 1 | `maxVelocity` | px/ms | pointer deltas / dt | ÷ 10 |
| 2 | `meanAcceleration` | px/ms² | absolute Δv / dt | ÷ 1 |
| 3 | `hesitationCount` | count | turns where Δθ > π/4 | ÷ 25 |
| 4 | `totalTrajectoryLength` | px | sum of segment lengths | ÷ 2000 |
| 5 | `dwellTimeMs` | ms | qualifying DOM events × 40 ms | ÷ window |
| 6 | `trajectoryEntropy` | [0,1] | 8-bin angle histogram, Shannon ÷ log2(8) | — |
| 7 | `scrollDepthPercentage` | [0,1] | `count × 80 / max(docH − vpH, 1)` | — |
| 8 | `scrollVelocity` | [0,1] | `count × 100 / duration` | ÷ 5 |
| 9–17 | modality mask | {0,1} | recording **capability**, not occurrence | — |

Mask bits: pointer → `{0,1,2,3,4,6}`, DOM → `{5}`, scroll → `{7,8}`.

Feature order, scale constants, and mask semantics are pinned by
`src/config/pipelineConfig.json`, which is **generated** from
`model-preparation/src/config.yaml` by `npm run sync-config`.

Parity with the Python reference is verified two ways:

- `tests/parity.test.ts` — five scenarios against frozen expectations at `1e-4`;
- `npm run parity:check` — re-derives those expectations by running the Python extractor, so
  drift in either repository fails.

### Vectorisation Implementation Boundary (ADR-001)

- MicroTensor construction on the live runtime path is executed in **TypeScript** (`src/microtensor/features.ts`),
  per [ADR-001](decisions/ADR-001-rust-wasm-microtensor-vectorisation.md) Option A (Accepted 2026-09-26).
- Empirical benchmarking ([`docs/benchmarks/vectoriser-benchmark.md`](benchmarks/vectoriser-benchmark.md)) demonstrated
  that TypeScript executes in **`8.26 µs`** mean (\(0.0083\text{ ms}\)), consuming \(0.003\%\) of the 250 ms window stride budget
  with zero long tasks, and is \(4.04\times\) faster than Rust/WASM (\(33.41\ \mu\text{s}\)) by avoiding JS-to-WASM memory
  serialization across `serde_wasm_bindgen`.
- The Rust/WASM vectoriser (`wasm-vectorizer/src/kinematics.rs`) is retained as an offline parity test oracle
  (`tests/vectorizer_parity.test.ts`), verifying exact numerical parity (\(\Delta \le 10^{-4}\)) on canonical streams.
- Rust/WASM in production is dedicated to PrefixSpan frequent pattern mining (`src/gates/fast/prefixSpanMiner.ts`),
  where projected sequential pattern growth benefits from native execution ([ADR-002](decisions/ADR-002-rust-wasm-prefixspan-boundary.md)).

---

## 5. Macro interaction vocabulary

The **framework** defines a `MacroMapper` contract (`src/macro/mapper.ts`): an event in, one
symbol out, or `null` when the event carries no macro intent. It buffers, orders and
correlates symbols; it knows no symbol names.

The **application** supplies the vocabulary. The testbed's thirty symbols live in
`src/testbed/config/macroVocabulary.ts` and are derived from the semantic DOM annotations
(`data-aui-component`, `data-aui-role`, `data-aui-action`):

```
Navigation   NAV_OVERVIEW NAV_ANALYTICS NAV_REPORTS NAV_CUSTOMERS NAV_SETTINGS NAV_GENERAL
Filters      OPEN_FILTERS CLOSE_FILTERS SELECT_DATE SELECT_REGION SELECT_CATEGORY
             SELECT_SEGMENT APPLY_FILTER RESET_FILTERS
Reports      OPEN_REPORT EXPORT_REPORT
Table        TABLE_PAGE_NEXT TABLE_PAGE_PREV TABLE_SORT TABLE_ROW_SELECT
Help         HOVER_KPI HOVER_HELP EXPAND_TOOLTIP
Behavioural  BACKTRACK IDLE_DWELL RAPID_SCROLL
```

`BACKTRACK`, `RAPID_SCROLL` and `IDLE_DWELL` are framework-detected behavioural markers, so
every integration shares them. The rest is application vocabulary: a second application
supplies its own mapper, and `tests/framework_boundary.test.ts` proves a checkout flow can
do so without importing a testbed module.

When no mapper is registered, `createAnnotationMacroMapper()` derives mechanical symbols
from the annotation contract (`CLICK_BTN_SUBMIT`, `SELECT_QUANTITY_INPUT`, …). That is a
deterministic convention for an unconfigured application, not a curated vocabulary.

Symbols are `string`s because that is the wire shape the Rust PrefixSpan miner consumes.

For pattern mining, interactions are grouped into **time slots** of 2000 ms
(`MACRO_SEQUENCE_SLOT_MS`) rather than individual 250 ms windows. Consecutive macro actions
usually fall in different windows at that granularity, which would reduce the corpus to
single-symbol sequences and make every multi-symbol pattern unmineable.

---

## 6. Gates

### Fast Gate — `src/gates/fast/prefixSpanFastGate.ts`

- Mines frequent symbol sequences with the Rust/WASM PrefixSpan implementation
  (`src/gates/fast/prefixSpanMiner.ts` — the single WASM boundary in the framework).
- The miner enforces its own bounds: a hard `max_pattern_length` and `max_patterns`, both
  passed with the request, and support counted per **sequence**, not per occurrence. It ranks
  candidate continuations by support so a bounded budget is spent on the strongest patterns,
  and it returns a deterministic order, so the same corpus and bounds always produce the same
  result. Confidence is the conditional probability `support(pattern) / support(prefix)`:
  a length-1 pattern reports corpus coverage, a longer pattern reports continuation strength.
- Resolves a mined pattern through the application's **declared pattern set**
  (`validatePatternDeclarations` in `src/gates/fast/patternDeclaration.ts`;
  `TESTBED_FAST_GATE_DECLARATIONS` in `src/testbed/config/fastGatePatterns.ts`). A
  declaration carries its sequence, the **semantic outcome** it resolves to, and the measured
  evidence (support, occurrences, task coverage, provenance). Declarations are validated at
  composition time: unknown symbols, outcomes outside the gate vocabulary, or evidence below
  the declared support floor fail loudly instead of becoming a silent miss. The framework
  default map is empty.
- Ranks deterministically: support desc, then length desc, then lexicographic.
- Matches a pattern as an **in-order subsequence** of the recent sequence
  (`suffixMatchOnly: false`). Strict suffix matching was tried first and proved too strict
  here, because consecutive actions frequently straddle the window stride.
- Does not count the observed sequence twice. When the composition supplies the corpus and
  the evaluated sequence from the same macro history, the sequence is not appended again;
  otherwise one occurrence would satisfy a support threshold of 2 and the gate would "match"
  a pattern it has only seen once.
- Fails safe and explains itself: a miner error, a deadline, an undeclared pattern or no
  matching pattern yields `matched: false` with a `reason` (`mining_timeout`,
  `no_frequent_pattern`, `no_declared_target`, `no_matching_pattern`, …), never a fabricated
  prediction.

### Slow Gate — `src/gates/slow/onnxSlowGate.ts`

- Implements dual-graph inference ([ADR-006](decisions/ADR-006-target-intervention-head-interface.md) Option A):
  1. Foundation graph (`public/models/model_int8.onnx`): classifies the observable outcome.
  2. Target Intervention Head graph (`public/models/intervention_head_int8.onnx`): evaluates 5
     uncalibrated logits (`simplify_options`, `highlight_primary_action`, `offer_assistance`,
     `expand_tooltip`, `no_op`).
  3. Semantic task-outcome head (`public/models/task_outcome_head_v2_int8.onnx`, Task 40.5):
     `sequence_input (batch, seq, 18)` + `context_input (batch, 6)` →
     `task_outcome_logits (batch, 14)`. A v2 bundle manifest
     (`public/models/task_outcome_head_v2.bundle.json`) supplies the ordered 14-ID target
     vocabulary, its version and the artifact hash. The parser maps this graph into the
     foundation slot — it replaces the outcome head by path and vocabulary, not by a new runtime
     branch — and the gate feeds both tensors when the session declares two inputs. It reports
     the semantic artifact version and provider; the legacy five-class head remains available
     for compatibility.
- **The deployed ONNX input topology is a dual-input encoder, not a hidden-state-only interface.**
  The graphs accept `sequence_input (batch, seq, 18)` and `context_input (batch, 6)` and produce
  `intervention_logits (batch, 5)`; the head concatenates the encoded sequence with the context
  **inside** the exported graph (`head.fc.0.weight` is `[64, 70]`, i.e. 64 encoded features + 6
  context features). The runtime therefore feeds the raw `[1, 8, 18]` sequence tensor and never reads
  or surfaces \(h_T\). Earlier revisions of this document described the fusion as
  \(h_T \oplus R^6\), which is the conceptual training architecture and was never the deployed
  interface (assessment F-24, [ADR-016](decisions/ADR-016-cloudflare-pages-deployment.md)).
- Operates on INT8-quantized ONNX graphs loaded and warmed during worker `INIT` using **ONNX Runtime
  Web's WASM-only entry point** (`onnxruntime-web/wasm`) with providers `['wasm','cpu']` and
  `numThreads = 1`. WebGPU is not requested: it loads a 26,827,543-byte WASM binary that exceeds
  Cloudflare Pages' 25 MiB per-asset limit
  ([ADR-016](decisions/ADR-016-cloudflare-pages-deployment.md)).
- In ablation arm (`useDeterministicMapping: true`), candidate command is produced via heuristic outcome mapping (`mappingSource: 'deterministic_mapping'`).
- Reports the **execution provider that actually served the session** (`wasm` for this deployment).
- Fails visibly when no session exists: `NO_OUTCOME` at confidence 0, no probabilities.
- Fast Gate execution is bounded and observable: corpus size, pattern length, pattern count and a
  mining deadline are configurable, and `trace.metadata.mining` records
  `executed` / `skipped` / `superseded` / `timedOut` / `droppedWindows`
  ([ADR-020](decisions/ADR-020-fast-gate-execution-bounds.md)).

### Arbitration — `src/gates/arbitration.ts`

Implements Fast Gate precedence ([ADR-002](decisions/ADR-002-rust-wasm-prefixspan-boundary.md)): the Slow Gate is invoked only when the Fast Gate returns
`matched: false`, or a match without an actionable prediction. Both gate calls are
individually guarded, and per-gate wall-clock latencies (`fastGateLatencyMs` and
`slowGateLatencyMs`) are measured independently
([ADR-003](decisions/ADR-003-worker-main-thread-boundary.md)).

Both gates emit the same normalized `PredictionResult`, and arbitration is its only producer:
it stamps `predictionId`, `timestamp` and `contractVersion`, merges the UI target, and reports
`PredictionProvenance` (gate, gate version, mapping source, latency). A Slow Gate prediction is
selected even when its compatibility command is `no_op`, because the policy — not the gate —
decides the adaptation; selecting only on the command would report `matchedGate: 'none'`
beside a matched Slow prediction. When neither gate asserts a prediction the result carries
`matchedGate: 'none'` and a `noMatchReason`, which the trace records instead of an unexplained
absence.

---

## 7. Policy and actuation

`InterventionPolicy` gates a candidate command on, in order:

1. task-change reset;
2. `no_op` pass-through;
3. **cooldown** — refractory period after an accepted intervention (default 5 s);
4. **dismissal feedback** — a dismissed intervention type is suppressed (default 15 s);
5. **confidence threshold** (default 0.75, an uncalibrated engineering baseline);
6. **UI-context eligibility** — e.g. `highlight_primary_action` requires a primary action;
7. **persistence** — the identical candidate must appear in 2 consecutive windows.

`UIActuator` applies four declarations non-destructively, each with a precise reversal
closure, and enforces `ttlMs`:

| Intervention | Mechanism | Reversal |
|---|---|---|
| `no_op` | no DOM change; emits an event | n/a |
| `highlight_primary_action` | `edge-aui-highlight` class + data attribute | restores the exact prior `class` |
| `simplify_options` | collapses expanded accordions, tags the target surface | re-expands; restores focus and class |
| `expand_tooltip` | inserts a `role="tooltip"` bubble, links `aria-describedby` | removes the bubble; restores attributes |
| `offer_assistance` | appends a `role="status" aria-live="polite"` banner | removes the node and listeners |

`targetComponentId` is escaped before selector interpolation, and focus is never stolen.
A `targetResolver` supplied in `UIActuator` options is authoritative: it turns the declared
target reference into an element, and a declared target it cannot resolve is a recorded
actuation failure rather than a fallback to some other control (Task 20.5). Without a
resolver the framework falls back to the `data-aui-component` annotation contract.

---

## 8. Experimental conditions

`conditionId` is `'baseline'` or `'adaptive'` and gates **only** `UIActuator.apply`.

In `baseline` the pipeline still observes, windows, mines, derives outcomes, records
predictions and *decides* interventions — it simply never mutates the DOM. This is what makes
a like-for-like telemetry comparison between conditions possible.

The condition is resolved **before** the participant session starts, from
`VITE_AUI_EXPERIMENT_CONDITION` (`adaptive` by default) with a valid `?auiCondition=` query
parameter taking precedence, and it is immutable for that session
(`src/config/experimentCondition.ts`, `src/runtime/boot.ts`). A new session resolves it again.
There is no participant-facing condition selector, so navigation or a component interaction
cannot change the independent variable mid-session.

---

## 9. Schemas

All behavioural schemas live in `src/telemetry/events.ts`.

```typescript
interface BehaviourEvent {
  timestamp: number;            // monotonic (performance.now())
  type: BehaviourEventType;     // mousemove | click | submit | scroll | wheel | focus |
                                // blur | popstate | hashchange | navigation | pagehide |
                                // beforeunload | unload | ...
  x?: number; y?: number;       // normalised [0,1] to viewport
  scrollX?: number; scrollY?: number; scrollTopPx?: number;
  componentId?: string; componentRole?: string; targetTag?: string;
  route?: string; action?: string;
  taskId?: string; taskStepId?: string;
  viewport?: { width: number; height: number };
  document?: { width: number; height: number; scrollableWidth: number; scrollableHeight: number };
}

interface MicroTensorWindow {
  windowId: number;             // correlation id
  windowStart: number; windowEnd: number;
  values: Float32Array;         // length 18
  eventCount?: number;
  inactive?: boolean;           // true when emitted during verified inactivity
}

interface MacroInteraction {
  timestamp: number; symbol: string;
  componentId?: string; action?: string; route?: string;
  sessionId?: string; windowId?: number;
  experimentId?: string; conditionId?: ExperimentalCondition;
}

interface UIContext {
  route: string;
  activeComponentId?: string; componentRole?: string;
  taskId?: string; taskStepId?: string;
  availableActions: string[];
  primaryActionAvailable: boolean; helpAvailable: boolean; expandable: boolean;
  viewport?: { width: number; height: number };
  document?: { width: number; height: number };
  scrollState?: ScrollState;
  conditionId?: ExperimentalCondition;
  uiVersion?: string;
}

interface OutcomeEvent {
  timestamp: number;
  outcome: 'NO_OUTCOME' | 'CLICK' | 'FORM_SUBMIT' | 'BACKTRACK'
         | 'RAPID_SCROLL' | 'HOVER_DWELL' | 'ABANDON';
  sessionId?: string; windowId?: number;
  experimentId?: string; conditionId?: string;
  sourceEventTimestamp?: number; sourceEventType?: BehaviourEventType;
  componentId?: string; taskId?: string; taskStepId?: string; route?: string;
  lookaheadComplete?: boolean;      // false = label is still provisional
  derivation?: OutcomeDerivationMetadata;
  // Schema 1.4.0: the application semantic outcome, alongside the generic class above.
  taskOutcome?: string;                    // e.g. 'apply_filter'
  taskOutcomeVocabularyVersion?: string;
  taskOutcomeSource?: 'backtrack' | 'application_rule' | 'none';
  taskOutcomeRuleId?: string;
}

interface PredictionEvent {
  timestamp: number; windowId?: number;
  matchedGate: 'fast' | 'slow' | 'none';
  outcome?: OutcomeType; interventionType?: string; confidence?: number;
  latencyMs?: number; fastGateLatencyMs?: number; slowGateLatencyMs?: number;
  bothGatesEvaluated: boolean;
  sessionId?: string; experimentId?: string; conditionId?: ExperimentalCondition;
  modelVersion?: string; contextEncodingVersion?: string;
  mappingSource?: 'learned_head' | 'deterministic_mapping' | 'fast_gate_pattern';
  // Schema 1.4.0: the normalized prediction the gates asserted.
  predictedOutcome?: string;
  predictedOutcomeVocabularyVersion?: string;
  predictionContractVersion?: string;
  targetContext?: { route?: string; taskId?: string; taskStepId?: string; componentId?: string };
}

interface TaskEvent {
  timestamp: number;
  type: 'task_start' | 'task_step' | 'task_complete' | 'task_error'
      | 'task_reset' | 'task_abandon' | 'task_fail';
  taskId: string | null; taskStepId?: string;
  status: 'Idle' | 'In Progress' | 'Completed' | 'Abandoned' | 'Failed';
  errors: number; durationMs?: number;
  reason?: 'reset' | 'timeout' | 'navigation' | 'wrong_action' | 'state_mismatch'
          | 'step_exhausted' | 'interrupted' | 'replaced' | 'condition_change';
  taskDefinitionVersion?: string;   // schema 1.4.0
}

interface InterventionCommand {
  type: 'no_op' | 'highlight_primary_action' | 'simplify_options'
      | 'expand_tooltip' | 'offer_assistance';
  targetComponentId?: string;
  confidence?: number;
  source: 'fast' | 'slow' | 'rule';
  mappingSource?: 'learned_head' | 'deterministic_mapping' | 'fast_gate_pattern';
  issuedAt: number; ttlMs?: number; reason?: string;
}
```

### Experiment trace (`schemaVersion 1.4.0`)

`ExperimentRecorder` produces one `SerializableExperimentTrace` per session conforming to
Schema `1.4.0`. `1.3.0`, `1.2.0` and `1.1.0` remain readable; the 1.4.0 fields are additive
(semantic outcome, task-definition version, normalized prediction, and their versions in
`metadata`).

```typescript
{
  schemaVersion: '1.4.0';
  exportedAt: string;                       // ISO 8601
  session: SessionContext;                  // sessionId, startedAt, startedAtEpochMs,
                                            // experimentId, conditionId, taskId
  task?: TaskState;
  metadata: { durationMs, totalEvents, behaviourCount, microTensorCount, macroCount,
              outcomeCount, predictionCount, interventionCount, taskEventCount,
              finalTaskStatus, experimentId, conditionId, uiVersion,
              // schema 1.4.0 version attribution
              taskDefinitionVersion, semanticOutcomeVocabularyVersion,
              predictionContractVersion,
              clock, provenance, applicationVersion, policyVersion,
              modelVersion, executionProvider, mining, evictions, integrityWarnings };
  behaviourEvents: BehaviourEvent[];
  microTensors: { windowId, windowStart, windowEnd, values: number[], eventCount?, inactive? }[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  predictions: PredictionEvent[];
  interventions: InterventionEvent[];       // includes mappingSource and interventionEpisodeId
  taskEvents: TaskEvent[];
}
```

- `metadata.durationMs` is derived from `startedAtEpochMs` only. Subtracting the monotonic
  `startedAt` from `Date.now()` produced meaningless values.
- `validateExperimentTrace()` checks structure across schemas `1.4.0`, `1.3.0`, `1.2.0` and
  `1.1.0`, requiring valid correlation IDs (`sessionId`, `experimentId`, `conditionId`,
  `windowId`) and task completeness. From 1.4.0 it also requires consistency between a record
  and its versions: a semantic outcome names its vocabulary version, a normalized prediction
  names its contract version, and `metadata` carries the version of every record kind present.
- `reconstructReplayStream()` flattens behaviour, macro, outcome, prediction, intervention and
  task records into one chronological stream.
- Export is a client-side `Blob` download. Nothing leaves the browser.

---

## 10. Outcome derivation

`src/outcome/derive.ts` is a TypeScript port of
`model-preparation/src/target_generation.py`:

- lookahead horizon `[windowEnd + 500 ms, windowEnd + 1500 ms]`;
- the **earliest** qualifying event wins; the priority hierarchy
  (`FORM_SUBMIT > CLICK > BACKTRACK > RAPID_SCROLL > HOVER_DWELL > ABANDON > NO_OUTCOME`) is
  applied **only** to break ties within 1 ms;
- a qualifying event is a committed `click`/`change`/`submit` → `CLICK`/`FORM_SUBMIT`, a
  lifecycle event → `ABANDON`, the 4th scroll → `RAPID_SCROLL`, the 2nd `mouseover` →
  `HOVER_DWELL`;
- `FORM_SUBMIT` comes from the *canonical* classification of the control (its annotation
  declares a submit action, or the event is a `submit`), not from an id substring, so an
  export button is `CLICK`;
- `BACKTRACK` is **not** inferred from `blur`, `popstate` or `hashchange`. It is decided by
  the route tracker (below) and applied to the settled outcome;
- `ABANDON` requires an observable termination signal, never mere absence of activity.

### Canonical actions and semantic outcomes (Task 20.4)

`src/outcome/canonical.ts` classifies every canonical event into one action
(`click`, `change`, `input`, `submit`, `focus`, `blur`, `hover`, `scroll`, `navigate`,
`lifecycle`) and owns the single *companion* rule: a `change` step is committed by `change`
(its click/input are companions), and a submit control's click is committed by `click` (the
form `submit` is its companion). The task bridge and semantic derivation both use that rule,
so they cannot disagree about which event was the act. The raw event is never deleted; the
action carries it as evidence.

`src/outcome/semantic.ts` defines the application contract: an ordered
`SemanticOutcomeRule[]` plus a `SemanticOutcomeVocabulary` (id, version, declared outcomes,
backtrack ID, no-outcome ID). A rule receives a classified action and returns an outcome ID.
`src/outcome/backtracking.ts` supplies route-level backtracking: the visited list is seeded
with the session's starting page, and only a deliberate move to a previously visited,
different page is a reversal.

`src/testbed/config/semanticOutcomes.ts` is the testbed's implementation of that contract.
Core imports none of its outcome IDs. The derived outcome is recorded next to the generic
one on the same `OutcomeEvent` (`taskOutcome` + vocabulary version + source + rule id).

The testbed **records** 15 outcome IDs, and the model's **target vocabulary is the approved 14**
([ADR-030](decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)). The extra ID,
`inspect_help`, is recorded evidence: it exists because exact-ID checks run before substring
checks, so `tooltip-region` is never classified as `select_region` (assessment limitation #6).
Model-preparation excludes windows labelled `inspect_help` from training targets rather than
relabelling them; the excluded count is reported. The recorded/target split is versioned and is
described in [data_schemas.md](data_schemas.md). The residual macro-symbol defects from that same
limitation are tracked in the milestone plan §2.8 and are not fixed by this split.

**Derivation is deferred.** A window is queued on emission and settled only once the observed
stream has advanced past its horizon, with a 2 s idle grace period. Labelling immediately
(before post-window activity exists) is what prevented `CLICK` and `FORM_SUBMIT` from ever
being produced.

---

## 11. Privacy

In accordance with [ADR-010](decisions/ADR-010-privacy-retention-model.md), as amended by
[ADR-018](decisions/ADR-018-scripted-vs-participant-provenance.md) and
[ADR-019](decisions/ADR-019-session-persistence-and-recovery.md):

- **Guarantee 1 (Zero Form/PII Leakage):** Free-text inputs, typed values, and form values are
  strictly redacted at the observation boundary. Tests (`tests/context_redaction.test.ts`) assert
  that sentinel input strings never leak into serialized traces, tensors, or console logs.
- **Guarantee 2 (Zero Network Egress):** No network primitives (`fetch`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon`) are reachable or called during telemetry processing or model inference.
- **No Local Persistence:** No unmanaged `localStorage`, `sessionStorage`, or IndexedDB storage.
  All state is retained in-memory only and flushed upon tab close or task reset.
- Raw pixel coordinates are never stored in the trace; only normalised values and derived
  tensors.
- Buffers are bounded (`RollingWindowBuffer` capacity and retention, recorder FIFO). FIFO eviction is
  **counted** and reported as `metadata.evictions` plus an integrity warning, so truncation is never
  silent.
- Traces are exported by the user as a local JSON download.
- Full trace identifier linkability and pseudonymization audit is documented in Section 3 of
  [`docs/data_schemas.md`](data_schemas.md).

---

## 12. Commands

```bash
npm run dev                # Vite dev server (testbed application)
npm run typecheck          # tsc --noEmit
npm test                   # vitest run (syncs config from model-preparation first)
npm run sync-config        # regenerate src/config/pipelineConfig.json from config.yaml
npm run parity:check       # fail if the parity fixture diverges from the Python reference
npm run parity:refresh     # regenerate the parity fixture from the Python reference
npm run benchmark:runtime  # measure FPS, heap and inference latency in a real browser
npm run build:wasm         # wasm-pack build wasm-vectorizer --target web
npm run build              # build:wasm + tsc + vite build
```

The runtime diagnostics handle is available in development builds as `window.__EDGE_AUI__`
(`status()`, `counts()`, `trace()`, `macroSequences()`, `lastDecision()`).
