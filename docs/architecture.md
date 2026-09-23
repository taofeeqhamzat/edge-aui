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
| Minimum events per window | 3 | same |
| Interval semantics | half-open `[start, end)` | `src/microtensor/window.ts` |
| Grid | fixed monotonic grid; `anchor(origin)` | same |
| Flush delay | one stride | `flushDelayMs` |
| Inactivity | windows are emitted with `inactive: true` | same |

Two deliberate properties:

- **Half-open slots** so an event on a boundary is counted exactly once. This matches
  `model-preparation/src/preprocessing.py`, which uses `searchsorted(..., side="left")`.
- **A fixed grid, not an event-anchored one**, so a given timestamp always falls in the same
  window regardless of when the first interaction happened. This is what makes windows
  comparable between sessions.

The buffer counts events that arrived too late to be windowed (`lateEvents`) and windows it
had to skip for falling below the minimum (`skippedSparseWindows`), so silent data loss is
observable rather than invisible.

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

---

## 5. Macro interaction vocabulary

Thirty symbols in `src/macro/symbols.ts`, derived from the semantic DOM annotations
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
- Resolves a mined pattern through a declared pattern → intervention map
  (`TESTBED_FAST_GATE_PATTERNS` in `src/runtime/boot.ts`).
- Ranks deterministically: support desc, then length desc, then lexicographic.
- Matches a pattern as an **in-order subsequence** of the recent sequence
  (`suffixMatchOnly: false`). Strict suffix matching was tried first and proved too strict
  here, because consecutive actions frequently straddle the window stride.
- Fails safe: a miner error or an undeclared pattern yields a miss, never a fabricated match.

### Slow Gate — `src/gates/slow/onnxSlowGate.ts`

- Loads the INT8 GRU graph (`public/models/model_int8.onnx`) and warms it during worker
  `INIT`, so an unusable model surfaces at start-up rather than degrading silently.
- Input `(1, T, 18)`, output 7 outcome logits → softmax → outcome + candidate intervention.
- Reports the **execution provider that actually served the session**.
- Fails visibly when no session exists: `NO_OUTCOME` at confidence 0, no probabilities.

### Arbitration — `src/gates/arbitration.ts`

Implements Fast Gate precedence: the Slow Gate is invoked only when the Fast Gate returns
`matched: false`, or a match without an actionable (non-`no_op`) intervention. Both gate calls
are individually guarded, and per-evaluation wall-clock latency is measured.

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
| `simplify_options` | collapses expanded accordions, tags the drawer | re-expands; restores focus and class |
| `expand_tooltip` | inserts a `role="tooltip"` bubble, links `aria-describedby` | removes the bubble; restores attributes |
| `offer_assistance` | appends a `role="status" aria-live="polite"` banner | removes the node and listeners |

`targetComponentId` is escaped before selector interpolation, and focus is never stolen.

---

## 8. Experimental conditions

`conditionId` is `'baseline'` or `'adaptive'` and gates **only** `UIActuator.apply`.

In `baseline` the pipeline still observes, windows, mines, derives outcomes, records
predictions and *decides* interventions — it simply never mutates the DOM. This is what makes
a like-for-like telemetry comparison between conditions possible. Switching condition is
treated as starting a new trial and rebuilds the runtime (`src/runtime/boot.ts`).

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
}

interface PredictionEvent {
  timestamp: number; windowId?: number;
  matchedGate: 'fast' | 'slow' | 'none';
  outcome?: OutcomeType; interventionType?: string; confidence?: number;
  latencyMs?: number; bothGatesEvaluated: boolean;
  sessionId?: string; experimentId?: string; conditionId?: ExperimentalCondition;
}

interface TaskEvent {
  timestamp: number;
  type: 'task_start' | 'task_step' | 'task_complete' | 'task_error'
      | 'task_reset' | 'task_abandon';
  taskId: string | null; taskStepId?: string;
  status: 'Idle' | 'In Progress' | 'Completed' | 'Abandoned';
  errors: number; durationMs?: number; reason?: 'reset' | 'timeout' | 'navigation';
}

interface InterventionCommand {
  type: 'no_op' | 'highlight_primary_action' | 'simplify_options'
      | 'expand_tooltip' | 'offer_assistance';
  targetComponentId?: string;
  confidence?: number;
  source: 'fast' | 'slow' | 'rule';
  issuedAt: number; ttlMs?: number; reason?: string;
}
```

### Experiment trace (`schemaVersion 1.1.0`)

`ExperimentRecorder` produces one `SerializableExperimentTrace` per session:

```typescript
{
  schemaVersion: '1.1.0';
  exportedAt: string;                       // ISO 8601
  session: SessionContext;                  // sessionId, startedAt, startedAtEpochMs,
                                            // experimentId, conditionId, taskId
  task?: TaskState;
  metadata: { durationMs, totalEvents, behaviourCount, microTensorCount, macroCount,
              outcomeCount, predictionCount, interventionCount, taskEventCount,
              finalTaskStatus, experimentId, conditionId, uiVersion };
  behaviourEvents: BehaviourEvent[];
  microTensors: { windowId, windowStart, windowEnd, values: number[], eventCount?, inactive? }[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  predictions: PredictionEvent[];
  interventions: InterventionEvent[];
  taskEvents: TaskEvent[];
}
```

- `metadata.durationMs` is derived from `startedAtEpochMs` only. Subtracting the monotonic
  `startedAt` from `Date.now()` produced meaningless values.
- `validateExperimentTrace()` checks structure, including a required `windowId` on every
  window and outcome and a required `conditionId`.
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
- a qualifying event is `click`/`mousedown` → `CLICK`/`FORM_SUBMIT`, a lifecycle event →
  `ABANDON`, `blur`/`popstate`/`hashchange` → `BACKTRACK`, the 4th scroll → `RAPID_SCROLL`,
  the 2nd `mouseover` → `HOVER_DWELL`;
- `ABANDON` requires an observable termination signal, never mere absence of activity.

**Derivation is deferred.** A window is queued on emission and settled only once the observed
stream has advanced past its horizon, with a 2 s idle grace period. Labelling immediately
(before post-window activity exists) is what prevented `CLICK` and `FORM_SUBMIT` from ever
being produced.

---

## 11. Privacy

- No network egress: no `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon` in `src/`.
- No persistence: no `localStorage`, `sessionStorage`, or IndexedDB.
- Raw pixel coordinates are never stored in the trace; only normalised values and derived
  tensors.
- Buffers are bounded (`RollingWindowBuffer` capacity and retention, recorder FIFO).
- Traces are exported by the user as a local JSON download.

Buffer eviction bounds retention and memory; it is **not** a privacy guarantee, and no such
guarantee is claimed.

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
