# Target Testbed Quality Assessment & Integration Readiness Audit

**Assessment date:** 2026-09-21
**Assessed revision:** `edge-aui-framework` @ `0a4639e` (branch `feat/target-ui-client-integration`)
**Integration counterpart:** `model-preparation` @ `ee11cf3` (branch `explore/pipeline/revision/1`)
**Assessment type:** Read-only, evidence-driven implementation audit
**Deliverable scope:** This document. No production code, test, or configuration file was modified.

Evidence labels used throughout:

| Label          | Meaning                                                         |
| -------------- | --------------------------------------------------------------- |
| `IMPLEMENTED`  | Directly observed in executing or inspectable source code       |
| `DOCUMENTED`   | Asserted in a README, plan, or design doc; not verified in code |
| `INFERRED`     | Reasoned conclusion from indirect evidence                      |
| `NOT FOUND`    | Actively searched for and absent                                |
| `NOT MEASURED` | A required property that this audit did not measure             |

---

## 1. Executive Summary

The target testbed contains **two independent and mutually disconnected implementations of the Edge-AUI client**. The first is a legacy harness (raw `ClientBehaviorTracker` + WASM gate client + ONNX gate client) that reports subjective cognitive labels. The second is the research-grade adaptive pipeline (passive observer → 500 ms/250 ms rolling window → macro interaction stream → dual-gate arbitration → intervention policy → non-destructive actuator) that the plan, the PRDs, and the requirement set in this audit are all written around.

**Only the legacy harness is booted.** `src/main.tsx` is the Vite entry point (`index.html:11`) and it instantiates exactly one thing: `EdgeAUIFramework` (`src/main.tsx:5`, `src/main.tsx:15-24`). Every module of the adaptive pipeline is exported through barrels and covered by unit tests, but no reachable code path instantiates `TelemetryObserver`, `RollingWindowBuffer`, `MacroInteractionStream`, `AdaptiveInferenceEngine`, `InterventionPolicy`, or `UIActuator`. A production-bundle string search confirms they are tree-shaken away: `dist/assets/index-Bj7QX16H.js` contains `Edge-AUI Pipeline Inspector` (the debug panel, which _is_ rendered) but **zero** occurrences of `edge-aui-highlight`, `RollingWindowBuffer`, `MacroInteractionStream`, `NAV_ANALYTICS`, or `InferenceResult`.

This was confirmed at runtime, not inferred. Driving the live application at `http://localhost:5173/` through a sustained synthetic pointer/mouse stream, navigation, filter interaction, form input, scrolling, apply-filter, and export produced **zero console output, zero interventions, and zero recorded events**. The in-application `DebugPanel` reported `Session ID: No Active Session`, `Task: None (Idle)`, `Gate Arbitration: Fast Gate no match / Slow Gate skipped`, `Worker Runtime: uninitialized`, `MACRO SEQUENCE: No macro events recorded`, `Modality Mask: [000000000]`, and `Buffered Events: 0 (B:0 M:0 T:0 O:0 I:0)`.

The individual building blocks are, in several cases, genuinely good: the intervention contract and actuator are the strongest area and are covered by real reversibility/accessibility tests; the 18-D MicroTensor feature order, scaling constants, mask semantics, and window/stride parameters do match `model-preparation/src/config.yaml` and `preprocessing.py`, with the checked-in parity fixtures passing at `1e-4`. But **a pipeline whose stages are separately correct and jointly unexecuted cannot produce behavioural representation, outcome labels, or trace data**, and the specific integration contracts the model-preparation pipeline needs (session/task/condition identity, window ids, prediction ids, observed outcomes) are absent.

Two integration-critical defects compound this and are independent of the wiring gap:

1. **The shipped ONNX graph is not the runtime's model.** `src/workers/onnx-gate/model_int8.onnx` declares input `(1, batch_size, seq_len, **9**)` and output `(1, batch_size, **6**)`, while the runtime's `SequenceBuilder.getShape()` produces `(1, 8, **18**)` and `model-preparation/src/training.py` defines `MICROTENSOR_DIM = 18`, `NUM_CLASSES = 7`, `HIDDEN_DIM = 64`, `NUM_LAYERS = 2`. The graph is also never executed: `OnnxGateClient` is constructed with an empty model URL (`src/core/pipeline.ts:49`), so the `InferenceSession.create` branch is skipped (`src/workers/onnx-gate/onnx.worker.ts:41`), and the inference handler calls a soft-coded heuristic (`onnx.worker.ts:204`) that never touches `session`.
2. **No runtime code produces observed outcomes.** `OutcomeEvent` is defined (`src/telemetry/events.ts:68-83`) and `ExperimentRecorder.recordOutcome` exists (`src/telemetry/recorder.ts:92`), but the only callers are test files. `recordOutcome` has **no production caller** — the target environment supplies no ground truth while the model-preparation pipeline's supervised target is derived from exactly those events.

**Answer to the final question (§33): NO — BLOCKING ENGINEERING WORK REMAINS.** The testbed is a well-structured, well-tested set of _components_ and a _contract shell_, not yet an integration target. The blocking work is bounded and enumerated in §25/§28, but it is not optional: without it there is no observable interaction stream, no MicroTensor sequence, no macro sequence, no outcomes, and no trace for the model-preparation pipeline to consume.

---

## 2. Assessment Scope

**In scope**

- `edge-aui-framework` at `0a4639e`: application entry points, UI and task components, telemetry, MicroTensor extraction, windowing, macro vocabulary, gate interfaces, arbitration, policy, actuator, worker runtime, trace schema/recorder, tests, configuration, build setup.
- The integration contract with `model-preparation` at `ee11cf3`, used **only** to establish expected schemas, feature ordering, windowing parameters, outcome taxonomy, and model I/O. No redesign of the preprocessing pipeline is proposed or performed.
- Runtime behaviour of the running application, verified in a real headless Chromium session.

**Out of scope / not performed**

- No refactoring, no bug fixing, no telemetry redesign, no UI redesign, no state-management changes, no library replacement. Defects found are reported, not repaired.
- No rewrite of the model-preparation preprocessing pipeline.
- No fresh production build. `npm run build` was not executed because it requires `wasm-pack` and would rewrite `wasm-vectorizer/pkg/` and `dist/`. Bundle figures in §20 are labelled as pre-existing build outputs.
- No fabrication of measurements. Anything not observed is marked `NOT MEASURED` or `NOT FOUND`.

**Method and evidence base**

| Evidence source                                                                                                         | What it establishes                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Full source read of `src/` (48 files ≈ 8 043 LOC) and `tests/` (22 files ≈ 3 557 LOC)                                   | Implementation reality, symbols, line numbers                              |
| Static reachability scan of `src/` inter-module imports                                                                 | Which modules are reachable from the booted entry point                    |
| `npx vitest run --reporter=dot`                                                                                         | Reported test totals and pass/fail                                         |
| `npx tsc --noEmit`                                                                                                      | Static type correctness                                                    |
| ONNX graph introspection via `onnx.load`                                                                                | Shipped model input/output shape and op set                                |
| Live browser session (headless Chrome 153, CDP) at `http://localhost:5173/`                                             | Real runtime behaviour, console, DOM, debug panel, trace export, FPS, heap |
| Built-bundle string search in `dist/assets/index-Bj7QX16H.js`                                                           | Which modules actually enter a production bundle                           |
| `model-preparation` source read (`config.yaml`, `preprocessing.py`, `target_generation.py`, `training.py`, `export.py`) | The integration contract the testbed must satisfy                          |
| `git status --short` before and after every step                                                                        | Confirms the audit mutated nothing                                         |

---

## 3. Repository / Architecture Map

### 3.1 Actual source inventory (with status)

| Layer                  | Module                                                         | Status                                                                  | Evidence                                                           |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| App shell / routes     | `src/app/App.tsx` (5-page state-based switch)                  | `IMPLEMENTED`                                                           | `App.tsx:10`, `App.tsx:21-41`                                      |
| Navigation             | `src/app/Navigation.tsx`                                       | `IMPLEMENTED`                                                           | `Navigation.tsx:24-40`                                             |
| Task model             | `src/testbed/tasks/taskModel.ts` (T1–T3)                       | `PARTIALLY IMPLEMENTED` — defined, never driven by UI                   | `taskModel.ts:28-59`; no UI control, confirmed in browser          |
| Task manager           | `src/testbed/tasks/taskManager.ts`                             | `PARTIALLY IMPLEMENTED` — `recordInteraction` has no production caller  | `taskManager.ts:50-73`                                             |
| UI components          | `KPICards.tsx`, `FilterDrawer.tsx`, `ResultsTable.tsx`         | `IMPLEMENTED` (semantic `data-aui-*` annotations present)               | `FilterDrawer.tsx:107-133`, `ResultsTable.tsx:11-84`               |
| Table data             | `src/testbed/mock-data/tableData.ts`                           | `MOCKED` (random generated at module load)                              | `tableData.ts:11-24`, `tableData.ts:25`                            |
| Telemetry observer     | `src/telemetry/observer.ts`                                    | `IMPLEMENTED (UNREACHABLE)`                                             | `observer.ts:40-323`; no production instantiation                  |
| Canonical event schema | `src/telemetry/events.ts`                                      | `IMPLEMENTED`                                                           | `events.ts:24-44`                                                  |
| Normalizer             | `src/telemetry/normalizer.ts`                                  | `IMPLEMENTED`                                                           | `normalizer.ts:55-72`                                              |
| UI context provider    | `src/telemetry/contextProvider.ts`                             | `IMPLEMENTED (UNREACHABLE)`                                             | `contextProvider.ts:62-181`                                        |
| Session manager        | `src/telemetry/session.ts`                                     | `IMPLEMENTED (UNREACHABLE)`                                             | `session.ts:33-102`                                                |
| Trace recorder         | `src/telemetry/recorder.ts`                                    | `IMPLEMENTED (PARTIALLY UNREACHABLE)` — reached only by the DebugPanel  | `recorder.ts:57-261`; `DebugPanel.tsx:20`                          |
| Trace schema           | `src/telemetry/traceSchema.ts`                                 | `IMPLEMENTED`                                                           | `traceSchema.ts:39-50`, `:60-134`                                  |
| MicroTensor features   | `src/microtensor/features.ts`                                  | `IMPLEMENTED (UNREACHABLE)`                                             | `features.ts:43-237`                                               |
| MicroTensor schema     | `src/microtensor/schema.ts`                                    | `IMPLEMENTED`                                                           | `schema.ts:13-24`                                                  |
| Rolling window         | `src/microtensor/window.ts`                                    | `IMPLEMENTED (UNREACHABLE)`                                             | `window.ts:29-212`                                                 |
| Sequence builder       | `src/microtensor/sequence.ts`                                  | `IMPLEMENTED (UNREACHABLE)`                                             | `sequence.ts:18-154`                                               |
| Macro vocabulary       | `src/macro/symbols.ts` (30 symbols)                            | `IMPLEMENTED (UNREACHABLE)`; several symbols have no producing UI       | `symbols.ts:9-47`                                                  |
| Macro stream           | `src/macro/sequence.ts`                                        | `IMPLEMENTED (UNREACHABLE)`                                             | `sequence.ts:18-125`                                               |
| Fast Gate interface    | `src/gates/fast/types.ts`                                      | `IMPLEMENTED`                                                           | `fast/types.ts:7-19`                                               |
| Fast Gate impl         | `src/gates/fast/mockFastGate.ts`                               | `MOCKED` (deterministic pattern matcher, replaces WASM PrefixSpan)      | `mockFastGate.ts:21-139`                                           |
| Slow Gate interface    | `src/gates/slow/types.ts`                                      | `IMPLEMENTED`                                                           | `slow/types.ts:10-27`                                              |
| Slow Gate impl         | `src/gates/slow/mockSlowGate.ts`                               | `MOCKED` (fixed outcome/confidence)                                     | `mockSlowGate.ts:24-70`                                            |
| Arbitration            | `src/gates/arbitration.ts`                                     | `IMPLEMENTED (UNREACHABLE)` — constructed only by worker core and tests | `arbitration.ts:40-149`; `runtime/worker.ts:34`                    |
| Intervention contract  | `src/intervention/types.ts`                                    | `IMPLEMENTED`                                                           | `types.ts:15-49`, `:105-161`                                       |
| Policy                 | `src/intervention/policy.ts`                                   | `IMPLEMENTED (UNREACHABLE)`                                             | `policy.ts:50-222`                                                 |
| Actuator               | `src/intervention/actuator.ts`                                 | `IMPLEMENTED (UNREACHABLE)`                                             | `actuator.ts:34-465`                                               |
| Worker boundary        | `src/runtime/{messages,worker,workerClient}.ts`                | `IMPLEMENTED (UNREACHABLE)`; in-memory fallback core                    | `workerClient.ts:35-55`                                            |
| Legacy tracker         | `src/core/telemetry/ClientBehaviorTracker.ts`                  | `IMPLEMENTED`, **is** the booted system                                 | `main.tsx:5`, `pipeline.ts:76-82`                                  |
| Legacy WASM gate       | `src/workers/wasm-gate/*` + `wasm-vectorizer/`                 | `IMPLEMENTED`, boots and loads WASM successfully                        | console: `WASM Gate ready: Edge-AUI-Deterministic-Gate-v0.1.0`     |
| Legacy ONNX gate       | `src/workers/onnx-gate/*`                                      | `MOCKED` at the inference level — heuristic, model never executed       | `onnx.worker.ts:204`, `:80-172`                                    |
| Legacy pipeline        | `src/core/pipeline.ts`                                         | `IMPLEMENTED`, **is** what boots                                        | `pipeline.ts:31-231`                                               |
| Legacy typed contracts | `src/types/telemetry.ts` (`CognitiveState`, subjective labels) | `IMPLEMENTED`, conflicts with outcome taxonomy                          | `types/telemetry.ts:56-95`                                         |
| Debug bus              | `src/debug/debugBus.ts`                                        | `PLACEHOLDER` — no production publisher                                 | `debugBus.ts:29-76`; only `DebugPanel.tsx` and a test reference it |
| Debug panel            | `src/debug/DebugPanel.tsx`                                     | `IMPLEMENTED` and rendered, but permanently empty                       | `App.tsx:42`; browser observation in §19                           |
| Dead harness           | `src/main.ts` (296 LOC legacy sandbox)                         | `UNUSED` — not referenced by `index.html`                               | `index.html:11` points at `main.tsx`                               |
| Dead utilities         | `src/counter.ts`, `SlidingWindowBuffer.ts`                     | `UNUSED`                                                                | no production importer                                             |

### 3.2 Reachability evidence

A scan for production importers of every module under `src/` shows the adaptive pipeline is imported **only by its own barrel files**. Concretely:

- `src/telemetry/observer.ts` ← `src/telemetry/index.ts` (barrel only)
- `src/microtensor/window.ts` ← `src/microtensor/index.ts` (barrel only)
- `src/macro/sequence.ts` ← `src/macro/index.ts`, `src/microtensor/index.ts` (barrels only)
- `src/intervention/{policy,actuator}.ts` ← `src/intervention/index.ts` (barrel only)
- `src/runtime/workerClient.ts` ← `src/runtime/index.ts` (barrel only)

`src/index.ts` re-exports `telemetry`, `microtensor`, `macro`, `intervention`, and `runtime`, so these modules enter the module graph — but the Vite entry (`main.tsx`) never imports `src/index.ts`. The built-bundle search confirms the bundler removed them.

**Runtime consequence:** booting `main.tsx` starts the legacy tracker and both legacy workers and nothing else. This is the single most important finding in the audit.

### 3.3 Documented vs implemented

| Document                                             | Claim                                                                                                      | Reality                                                                                                                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md:9-12`                                     | "Fast Gate: WebAssembly module for exact sequence matches" / "Slow Gate: Web Worker that runs a GRU model" | The booted Fast Gate is `WasmGateClient` (WASM loads successfully) but it is used for _on-demand pattern mining over legacy macro strings_, not arbitration. The booted Slow Gate loads no model and runs a heuristic. |
| `docs/project_architecture.md:20-22`                 | "Implements a `SlidingWindowBuffer` to batch high-frequency micro-interactions every 500ms"                | `SlidingWindowBuffer` is `UNUSED`. The booted path uses `setInterval(flush, 500)` in `ClientBehaviorTracker.startBufferingCycle` (`ClientBehaviorTracker.ts:313-317`).                                                 |
| `docs/data_schemas.md:5-38`                          | `InteractionEvent` and a 5-field `micro_tensor` JSON object                                                | This documents the **legacy** schema only. It does not document `BehaviourEvent`, `MicroTensorWindow`, `MacroInteraction`, `OutcomeEvent`, `InterventionCommand`, `UIContext`, or `ExperimentTrace`. It is 38 lines.   |
| `docs/plan/target_ui_implementation_plan.md:150-152` | "Complete experimental tasks T1, T2, T3; verify step transitions and trace generation"                     | No UI control starts a task; `TaskManager.recordInteraction` has no production caller. Not reproducible.                                                                                                               |
| `docs/plan/target_ui_implementation_plan.md:153`     | "Inspect Debug Panel for live telemetry stream, window generation, and intervention triggers"              | The Debug Panel renders but is permanently empty (§19).                                                                                                                                                                |
| `docs/audit_baseline.md:49`                          | "`npm run build` executed successfully ... No TypeScript compiler errors"                                  | Not re-verified in this audit; `DOCUMENTED`. Only `tsc --noEmit` was re-run here (clean).                                                                                                                              |
| Task 12.1 (`docs/plan/tasks/12.1.md`)                | Document all final schemas, contracts, taxonomies, trace formats                                           | `docs/data_schemas.md` does not mention `BehaviourEvent`, `MicroTensorWindow`, `OutcomeEvent`, `MacroInteraction`, or `InterventionCommand` (verified by grep: no matches). Task 12.1 is **incomplete**.               |

---

## 4. Actual Runtime Data Flow

### 4.1 What actually runs (booted path)

```
index.html:11  →  /src/main.tsx
                    ├── React: <App/>  →  Navigation | FilterDrawer | KPICards | ResultsTable | DebugPanel
                    └── new EdgeAUIFramework({ bufferWindowMs: 500, trackableSelector: '[data-trackable]' })
                              │
                              ├── ClientBehaviorTracker  (src/core/telemetry/ClientBehaviorTracker.ts)
                              │     pointermove (rAF-throttled) → pointBuffer: RawPointerPoint[]
                              │     pointerover/pointerout on [data-trackable] → dwell accumulator
                              │     click → macroQueue: MacroEvent[]
                              │     scroll → maxScrollDepth, lastScrollVelocity
                              │     setInterval(…, 500) → flush() → extractMicroFeatures() → InteractionPacket
                              │
                              ├── OnnxGateClient → onnx.worker.ts  → inferLatentCognitiveState(packet)   [HEURISTIC]
                              ├── WasmGateClient → wasm.worker.ts  → mine_macro_patterns(sequences, support)
                              └── evaluateAdaptiveTrigger() → UIRecommendation → listener  (src/main.ts only)
```

Boundary-by-boundary:

| Boundary               | Source → Destination              | Data structure                  | Serialisation    | Ownership       | Timing                                             | Copied?                       | Persisted?                                                 | Typed?                           | Errors handled?                              | Mocked?                           |
| ---------------------- | --------------------------------- | ------------------------------- | ---------------- | --------------- | -------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- | -------------------------------- | -------------------------------------------- | --------------------------------- |
| DOM → tracker          | browser → `ClientBehaviorTracker` | `RawPointerPoint`, `MacroEvent` | none (in-memory) | main thread     | per event / rAF                                    | yes (spread in `getRawBatch`) | no (purged in `flush`, `ClientBehaviorTracker.ts:304-310`) | partial (`types/telemetry.ts`)   | no (listener bodies have no try/catch)       | no                                |
| Tracker → pipeline     | `flush()` → `handleWindowFlush`   | `InteractionPacket`             | none             | main thread     | every 500 ms via `setInterval`                     | yes                           | no                                                         | yes                              | yes (`pipeline.ts:113-115`)                  | no                                |
| Pipeline → ONNX worker | `postMessage`                     | `OnnxWorkerRequest`             | structured clone | worker boundary | per 500 ms window                                  | yes                           | no                                                         | yes (`types/worker-messages.ts`) | yes (5 s timeout, `OnnxGateClient.ts:88-96`) | **yes — heuristic**               |
| Pipeline → WASM worker | `postMessage`                     | `WasmWorkerRequest`             | structured clone | worker boundary | on demand, only if ≥ `minPatternSupport` sequences | yes                           | no                                                         | yes                              | yes                                          | no (real WASM, confirmed loaded)  |
| Pipeline → UI          | callback → `main.ts` DOM writes   | `UIRecommendation`              | none             | main thread     | on trigger                                         | yes                           | no                                                         | yes                              | no                                           | **the React UI never subscribes** |
| Pipeline → trace       | **none**                          | —                               | —                | —               | —                                                  | —                             | —                                                          | —                                | —                                            | **`NOT FOUND`**                   |

### 4.2 The intended research path (present in source, never started)

```
TelemetryObserver.emit(BehaviourEvent)                → src/telemetry/observer.ts:116-124
   ↓  (intended: observer.subscribe)
RollingWindowBuffer.push(event) / .tick(now)          → src/microtensor/window.ts:56-124
   ↓  computeWindowMicroTensor(windowEvents, {...})   → src/microtensor/features.ts:43
MicroTensorWindow { windowStart, windowEnd, values }  → src/telemetry/events.ts:49-53
   ↓  (intended: window.subscribe)
MacroInteractionStream.recordFromBehaviourEvent(event)→ src/macro/sequence.ts:50-65
   ↓  deriveMacroSymbol(event)                        → src/macro/symbols.ts:59
MacroInteraction { timestamp, symbol, componentId }   → src/telemetry/events.ts:58-63
   ↓  RuntimeWorkerClient.pushWindow / pushMacro / evaluate
AdaptiveInferenceEngine.evaluate(InferenceContext)    → src/gates/arbitration.ts:56-124
   ↓  FastGate (mock) → on miss → SlowGate (mock)
InterventionCommand                                    → src/intervention/types.ts:41-49
   ↓  InterventionPolicy.accept(command, uiContext)    → src/intervention/policy.ts:67-145
   ↓  UIActuator.apply(command)                        → src/intervention/actuator.ts:57-109
DOM mutation + InterventionEvent → ExperimentRecorder  → src/telemetry/recorder.ts:99-104
```

Every arrow in this diagram exists in code. **Every arrow of the form "and then it is called by the application" does not.**

### 4.3 Traced representative workflow (observed in browser)

Exercise: page load → navigate to Analytics → open two accordions → select region → check a category → fill a date → click Apply Filters → hover KPI card and tooltip → scroll down and back → click Export Report → sustained synthetic `pointermove`/`mousemove`/`pointerover`/`pointerout` stream (~400 events) → two more clicks → 4 s settle.

Observed result:

```
Browser console after all interactions: (empty)
DebugPanel:  Session: No Active Session | Task: None (Idle) | Route: Analytics
             Fast Gate: no match | Slow Gate: skipped | Intervention: no_op | Policy State: idle
             Inference Latency: -- | Feature Extr. Latency: -- | Worker Runtime: uninitialized
             Macro Sequence: No macro events recorded
             MicroTensor: all 0.000 | Modality Mask: [000000000]
             Buffered Events: 0 (B:0 M:0 T:0 O:0 I:0)
Adapted DOM nodes: 0    Recommendations rendered: 0
```

Additionally, the legacy tracker's dwell/macro tracking is inert in this application for a structural reason: it is configured with `trackableSelector: '[data-trackable]'` (`main.tsx:17`, `pipeline.ts:48`), while the testbed UI is annotated with `data-aui-*` attributes only. Live DOM count: `data-trackable` = **0**, `data-aui-component` = **6**, `data-aui-action` = **5**. So the booted system cannot even see the instrumented UI, and the instrumented pipeline that _could_ see it is never started.

---

## 5. Target UI Assessment

### 5.1 Structure — what exists

`IMPLEMENTED` and verified live. Five state-based views (`Overview`, `Analytics`, `Reports`, `Customers`, `Settings`) with only `Analytics` having substantive content (`App.tsx:21-41`).

| Surface           | Component                                                                        | Evidence                                             |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Navigation region | 5 nav buttons, `data-aui-role="navigation"`                                      | `Navigation.tsx:24-40`; live DOM                     |
| Dashboard         | 4 KPI cards, `data-aui-role="kpi-card"`                                          | `KPICards.tsx:9-27`                                  |
| Filters           | `FilterDrawer` with 4 accordions (`data-aui-role="accordion"` + `aria-expanded`) | `FilterDrawer.tsx:107-123`                           |
| Form controls     | date input, region select, 3 checkboxes, segment select                          | `FilterDrawer.tsx:19-92`                             |
| Table             | 50 rows, `data-aui-role="table-row"`, sticky header                              | `ResultsTable.tsx:30-80`                             |
| Tooltips          | 2 `[?]` affordances with `title`, `data-aui-role="tooltip"`                      | `ResultsTable.tsx:30-57`                             |
| Primary actions   | `btn-apply-filters`, `btn-export` (`data-aui-role="primary-action"`)             | `FilterDrawer.tsx:124-132`, `ResultsTable.tsx:12-19` |

### 5.2 Structure — what is absent

Confirmed by live DOM query of the Analytics view:

| Intended surface                 | Live check                                       | Consequence                                                                                      |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Reset filters control            | `[data-aui-component*="reset"]` → **false**      | macro symbol `RESET_FILTERS` is unreachable                                                      |
| Table pagination                 | `[data-aui-component*="pagination"]` → **false** | `TABLE_PAGE_NEXT` / `TABLE_PAGE_PREV` unreachable                                                |
| Sortable columns                 | `[data-aui-component*="sort"]` → **false**       | `TABLE_SORT` unreachable                                                                         |
| Open-report surface              | not present                                      | `OPEN_REPORT` unreachable                                                                        |
| Secondary actions                | none annotated                                   | no `secondary-action` role in live DOM                                                           |
| Assistance/help surface          | no `data-aui-role="help"` element                | `helpAvailable` is `true` only via the two `role="tooltip"` spans (`contextProvider.ts:163-168`) |
| Task controls (start/reset/next) | `taskControls: []` (no matching button)          | tasks cannot be started from the UI                                                              |

### 5.3 Interaction richness — outcome-to-UI mapping

The requirement is a concrete, reproducible UI event per intended outcome. The honest result is that only three of seven are currently producible from the booted application, and **none** are currently observable in telemetry because neither pipeline records them.

| Outcome        | Concrete UI event                                     | Source component                       | Observable telemetry produced today                                                                                                       | Can be reproduced?                                                                                                             |
| -------------- | ----------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CLICK`        | click any `[data-aui-component]`                      | Navigation, FilterDrawer, ResultsTable | **No** — legacy tracker queues `MacroEvent` in a private array with no consumer; adaptive observer not running                            | Mechanism yes; observation no                                                                                                  |
| `FORM_SUBMIT`  | no `<form>` element and no `submit` handler exists    | —                                      | **No**                                                                                                                                    | **No — theoretical.** `FilterDrawer` uses an `onClick`-less `btn-apply-filters` button, so `submit` never fires                |
| `BACKTRACK`    | in-app "back" is the nav button label, not `popstate` | Navigation                             | **No** — `TelemetryObserver.recordNavigationEvent` never emits `popstate` as an event type                                                | **Partially.** `popstate` would fire on real hash/history navigation, but the app has no router (`App.tsx:10` uses `useState`) |
| `RAPID_SCROLL` | scroll the results table / page                       | ResultsTable container, window         | **No**                                                                                                                                    | Yes (mechanism), no (observation)                                                                                              |
| `HOVER_DWELL`  | hover a KPI card or tooltip                           | KPICards, tooltips                     | **No**                                                                                                                                    | Mechanism yes; observation no                                                                                                  |
| `ABANDON`      | closing/reloading the page (`pagehide`)               | browser lifecycle                      | **No** — observer maps `pagehide` to `type: 'pagehide'`, which the model-preparation extractor does read, but the recorder is not running | Yes in principle; not recorded                                                                                                 |
| `NO_OUTCOME`   | inactivity                                            | —                                      | **No** — no window is emitted during inactivity (§9)                                                                                      | **No**                                                                                                                         |

Two of these are the same defect as a contract mismatch, documented in §11 and §26.

### 5.4 Ambiguity and research-target quality

Honest assessment: the UI is a **thin admin dashboard**, not a task-rich instrument. It has one substantive page, 50 identical-structure table rows, one filter drawer, and no multi-step workflow in the UI itself. The only "tasks" (T1–T3) exist purely as data in `taskModel.ts`. For an experiment whose target labels are `CLICK`, `FORM_SUBMIT`, `BACKTRACK`, `RAPID_SCROLL`, `HOVER_DWELL`, `ABANDON`, the current UI can generate motor variety (hover/scroll/dwell) but has no submission, no backtrack, and no abandonment affordance. This is a **ground-truth gap**, classified P0 in §25.

---

## 6. Experimental Task Assessment

`src/testbed/tasks/taskModel.ts:28-59` defines three tasks:

| Task | Objective                 | Steps                                                              | Primary completion event                                                          | Reset mechanism           |
| ---- | ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------- |
| T1   | Filter Analytics          | T1-1 navigate; T1-2 open Region; T1-3 select region; T1-4 apply    | `taskManager.recordInteraction('btn-apply-filters','click')` → status `Completed` | `taskManager.resetTask()` |
| T2   | Export Report             | T2-1 navigate Reports; T2-2 click Export                           | `recordInteraction('btn-export','click')`                                         | same                      |
| T3   | Configure Advanced Filter | T3-1 navigate; T3-2 open Advanced; T3-3 change Segment; T3-4 apply | `recordInteraction('btn-apply-filters','click')`                                  | same                      |

**None of this is reachable.** `TaskManager.recordInteraction` (`taskManager.ts:50-73`) is called only from `tests/target_ui_components.test.tsx:124-172`. There is no listener wiring the observer, the legacy tracker, the policy, or the actuator to the task manager. No UI control can call `startTask`. Live DOM confirms: zero task controls.

### 6.1 Defects in the task definitions themselves

1. **Step T1-2 is unsatisfiable as written.** `taskModel.ts:35` expects `expectedComponentId: 'filter-Region'` with `expectedAction: 'click'`. Live DOM shows `filter-Region` **is** a clickable accordion button, so this particular step is satisfiable — but T1-3 (`taskModel.ts:36`) expects `filter-Region-select` with `change`, which is the `<select>` inside that accordion (`FilterDrawer.tsx:32`). That is coherent. However, T3-2 expects `filter-Advanced Options` (`taskModel.ts:55`) which matches the annotated accordion name, so it is also coherent. The genuine mismatch is elsewhere: because `recordInteraction` is never called, **all** steps are unsatisfiable _in practice_.
2. **Non-deterministic initial state.** `defaultTableData = generateMockData(50)` (`tableData.ts:25`) uses `Math.random()` for date, region, category, sales, and status at module evaluation. Two sessions therefore see different data. For a controlled experiment this breaks stimulus equality between participants and between conditions.
3. **No error / abandonment semantics.** `recordInteraction` increments `errors` on any non-matching `click`/`change` (`taskManager.ts:66-72`) but has no inaction, timeout, or abandonment path, and `TaskStatus` is only `Idle | In Progress | Completed` (`taskModel.ts:2`).
4. **No task/experiment identity.** `TaskState` carries no `experimentId`, no `conditionId`, and no participant link.

### 6.2 Required task events

| Event            | Exists?                                             | Evidence                                       |
| ---------------- | --------------------------------------------------- | ---------------------------------------------- |
| task start       | `IMPLEMENTED` but never invoked                     | `taskManager.ts:35-43`                         |
| task completion  | `IMPLEMENTED` but never invoked                     | `taskManager.ts:61-64`                         |
| task failure     | `NOT FOUND` (no failure state)                      | `taskModel.ts:2`                               |
| task abandonment | `NOT FOUND`                                         | —                                              |
| task reset       | `IMPLEMENTED`, reachable only via DebugPanel button | `taskManager.ts:45-48`, `DebugPanel.tsx:87-89` |

**Consequence for dataset construction and evaluation.** Because no task ever leaves `Idle`, `ExperimentRecorder.export()`/`exportSerializable()` always record `task: { currentTaskId: null, status: 'Idle', ... }` (`recorder.ts:118`, `recorder.ts:135`). Any trace exported today therefore cannot be segmented by task, cannot be labelled with task outcome, and cannot be used to build per-task target outcomes. The observed trace export confirms this: the downloaded payload's task block is `Idle` and all five event arrays are empty.

---

## 7. Telemetry Assessment

### 7.1 Event coverage matrix

Two telemetry implementations exist. Columns describe the **adaptive** observer (`src/telemetry/observer.ts`) because that is the one whose schema matches the model-preparation contract.

| Event                         | Bound?                                                                                       | Timestamp source / precision                                                          | Coordinate source                                               | Target identification                                 | Buffering / flush                            | Cleanup                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `mousemove`                   | yes (`observer.ts:135-143`, `:188`)                                                          | `getMonotonicTimestamp()` = `performance.now()`, sub-ms float (`normalizer.ts:20-25`) | `clientX/Y` normalised by cached viewport                       | `closest('[data-aui-component]')` (`observer.ts:219`) | none — emitted immediately                   | removed in `stop()` (`observer.ts:105-108`) |
| `mouseover`                   | yes (`:145`, `:189`)                                                                         | same                                                                                  | same                                                            | same                                                  | none                                         | same                                        |
| `mouseout`                    | yes (`:146`, `:190`)                                                                         | same                                                                                  | same                                                            | same                                                  | none                                         | same                                        |
| `mousedown` / `mouseup`       | yes (`:147-148`, `:191-192`)                                                                 | same                                                                                  | same                                                            | same                                                  | none                                         | same                                        |
| `click`                       | yes (`:149`, `:193`)                                                                         | same                                                                                  | same                                                            | same; `action: 'click'` default (`:257`)              | none                                         | same                                        |
| `scroll`                      | yes (`:152-159`, `:194`)                                                                     | same                                                                                  | `window.scrollX/Y` normalised to scrollable extent (`:267-274`) | none                                                  | none                                         | same                                        |
| `input` / `change` / `submit` | yes (`:162-164`, `:195-197`)                                                                 | same                                                                                  | n/a                                                             | same                                                  | none                                         | same                                        |
| `popstate`                    | yes (`:167`, `:201`)                                                                         | same                                                                                  | n/a                                                             | n/a                                                   | **emitted as `type: 'navigation'`** (`:315`) | same                                        |
| `hashchange`                  | yes (`:168`, `:202`)                                                                         | same                                                                                  | n/a                                                             | n/a                                                   | **emitted as `type: 'navigation'`**          | same                                        |
| `pagehide`                    | yes (`:169`, `:203`)                                                                         | same                                                                                  | n/a                                                             | n/a                                                   | `type: 'pagehide'` (`:315`)                  | same                                        |
| custom `navigation`           | yes (`:170-173`, `:204`)                                                                     | same                                                                                  | n/a                                                             | `detail.route`                                        | route override                               | same                                        |
| `wheel`                       | **not bound**                                                                                | —                                                                                     | —                                                               | —                                                     | —                                            | —                                           |
| `focus` / `blur`              | **not bound**                                                                                | —                                                                                     | —                                                               | —                                                     | —                                            | —                                           |
| `beforeunload` / `unload`     | **not bound**                                                                                | —                                                                                     | —                                                               | —                                                     | —                                            | —                                           |
| route change (SPA)            | only via a `window.dispatchEvent(new CustomEvent('navigation', …))` the app never dispatches | —                                                                                     | —                                                               | —                                                     | —                                            | —                                           |

### 7.2 Properties

- **Event timestamp source:** single monotonic clock, `performance.now()` (`normalizer.ts:20-25`), used for every event. Good: monotonic within a session. Weakness: this is **navigation-start relative**, not epoch, so cross-session alignment against wall-clock logs is impossible without an added anchor.
- **Timestamp precision:** sub-millisecond float. Sufficient for 500/250 ms windows.
- **Viewport:** cached at `start()` and refreshed on `resize` (`observer.ts:92`, `:130-132`), avoiding layout reads in the hot path. Good.
- **Event frequency / throttling:** default `sampleIntervalMs = 0`, i.e. **unthrottled** (`observer.ts:55`). A high-frequency pointer stream therefore produces one `BehaviourEvent` per browser event with no coalescing and no backpressure. This is a plausible main-thread cost risk, and it is `NOT MEASURED` here.
- **Buffering / flushing:** the observer has **no buffer and no flush**; it pushes synchronously into a `Set` of listeners (`observer.ts:116-124`). Buffering/windowing is delegated to `RollingWindowBuffer`, which is never started. Listener exceptions are caught and logged (`:118-122`).
- **Loss behaviour:** none needed today because nothing downstream exists. Once started, the only bound is window-level: the buffer keeps ≤ 2 000 events and evicts older than 5 s (`window.ts:48`, `:60-62`, `:99`).
- **Cleanup:** complete — every `addEventListener` is paired with a stored unbind closure and `stop()` removes all of them (`observer.ts:105-108`, `:176-186`). Verified by `tests/telemetry_observer.test.ts:158-171`.

### 7.3 Can telemetry reconstruct the raw stream the model-preparation pipeline needs?

**Partially, with two structural gaps.**

The model-preparation pipeline consumes canonical events with `timestamp_ms`, `event_type`, `x_norm`, `y_norm`, `xpath`/`target_id`, plus viewport and document dimensions (`preprocessing.py:227-301`, `:491-504`). The observer supplies `timestamp`, `type`, `x`, `y` (normalised [0,1]), `componentId`, `componentRole`, `action`, `route`, `taskId`, `taskStepId`, `targetTag` (`events.ts:24-44`). Field-by-field this is a **rename**, not a redesign — `timestamp`↔`timestamp_ms`, `type`↔`event_type`, `x`/`y`↔`x_norm`/`y_norm`, `componentId`↔`target_id`. That is a tractable adapter.

The two gaps are:

1. **No viewport/document dimensions on the event or the window.** `BehaviourEvent` has no viewport fields, and `RollingWindowBuffer.tick()` does not pass viewport or document to the feature extractor (`window.ts:107-110`), so `computeWindowMicroTensor` silently falls back to `getViewportDimensions()` and the hard-coded `{ width: 1920, height: 3000 }` (`features.ts:47-48`). The Python path normalises against the **observed** viewport parsed from trial XML and fails visibly if absent (`preprocessing.py:245-249`, `:491-494`). This is a semantic and numerical divergence.
2. **No document scroll geometry is recorded.** `getDocumentScrollBounds()` is called only for normalisation, and the resulting `scrollableHeight` is not persisted anywhere, so `scrollDepthPercentage` cannot be recomputed offline against the Python formula `min(1, scroll_count*80 / max(doc_h - vp_h, 1))` (`preprocessing.py:450-451`).

---

## 8. MicroTensor Compatibility Assessment

### 8.1 Actual runtime feature table

Source: `src/microtensor/features.ts:43-236`, `src/microtensor/schema.ts:13-24`, `src/config/pipelineConfig.json` (generated from `model-preparation/src/config.yaml`).

| #   | Feature                 | Unit       | Runtime source             | Calculation                                                        | Mask index | Status                                                  |
| --- | ----------------------- | ---------- | -------------------------- | ------------------------------------------------------------------ | ---------- | ------------------------------------------------------- | --- | ---------------------- |
| 0   | `meanVelocity`          | px/ms      | consecutive pointer events | `mean(√(dx²+dy²)/max(1,dt))` ÷ `mean_velocity_scale`=10            | 9          | `IMPLEMENTED`, matches Python                           |
| 1   | `maxVelocity`           | px/ms      | same                       | `max(...)` ÷ 10                                                    | 10         | `IMPLEMENTED`, matches                                  |
| 2   | `meanAcceleration`      | px/ms²     | same                       | `mean(                                                             | Δv         | /dt)` ÷ 1                                               | 11  | `IMPLEMENTED`, matches |
| 3   | `hesitationCount`       | count      | pointer angles             | turns where `                                                      | Δθ         | > π/4` ÷ 25                                             | 12  | `IMPLEMENTED`, matches |
| 4   | `totalTrajectoryLength` | px         | pointer path               | `Σ √(dx²+dy²)` ÷ 2000                                              | 13         | `IMPLEMENTED`, matches                                  |
| 5   | `dwellTimeMs`           | ms         | DOM targets                | `min(count_of_qualifying_events × 40, 500)` ÷ 500                  | 14         | `IMPLEMENTED`; **proxy, not measurement** (see §8.3)    |
| 6   | `trajectoryEntropy`     | nats→[0,1] | 8-bin angle histogram      | `−Σp log₂p / log₂8`                                                | 15         | `IMPLEMENTED`, matches                                  |
| 7   | `scrollDepthPercentage` | [0,1]      | `scroll` events            | last `scrollY` if present, else `min(1, count×80/max(docH−vpH,1))` | 16         | `IMPLEMENTED`; **diverges in the live path** (see §8.2) |
| 8   | `scrollVelocity`        | [0,1]      | `scroll` events            | `count × 100 / max(duration,1)` ÷ 5                                | 17         | `IMPLEMENTED`, matches                                  |

Mask semantics: mask = **recording capability**, not event occurrence (`schema.ts:57-65`, `features.ts:80-95`). Pointer capability sets mask bits for indices `{0,1,2,3,4,6}`; DOM capability sets bit 5; scroll capability sets `{7,8}`. This exactly reproduces the Python block at `preprocessing.py:369-375` (`mask[[0,1,2,3,4,6]]=1`, `mask[5]=1`, `mask[[7,8]]=1`). Layout is `[X ⊙ M, M]` (`features.ts:230-234`), matching `preprocessing.py:465-466`.

### 8.2 Divergences found

| #   | Divergence                                                                                                                                                                                                                                                                                                                                                                                                                     | Runtime evidence                | Python evidence                                                                                               | Consequence                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Document-size fallback.** Live path never supplies document dimensions, so `{1920, 3000}` is assumed. `processEventStream` _can_ accept them (`window.ts:156`) but the live `tick()` does not pass them (`window.ts:107-110`).                                                                                                                                                                                               | `features.ts:48`                | Viewport/document are mandatory and validated (`preprocessing.py:328-331`, `:501-504`)                        | Only affects the fallback branch of `scrollDepthPct` (index 7) and never fires when `scrollY` is present. Latent, but it means the runtime cannot detect a missing-geometry defect the way Python refuses to.                                                                   |
| D2  | **Scroll-depth semantics.** Runtime prefers the _last normalised_ `scrollY`; Python always computes `count × 80 / (docH − vpH)`.                                                                                                                                                                                                                                                                                               | `features.ts:208-214`           | `preprocessing.py:450-451`                                                                                    | Same index, different numeric meaning and different bounds behaviour. This is a **semantic gap**, not a naming gap. It is the single clearest MicroTensor-parity defect.                                                                                                        |
| D3  | **Dwell-time semantics.** Runtime uses `count × 40 ms` on qualifying events (a synthetic proxy documented as such); the Python reference does the same (`preprocessing.py:437-443`), so the two agree with each other but **both are proxies for real dwell**. The legacy tracker measured real accumulated dwell (`ClientBehaviorTracker.ts:88-95`, `:148-151`), so the two in-repo implementations disagree with each other. | `features.ts:191-198`           | `preprocessing.py:429-443`                                                                                    | Parity is preserved; construct validity of the feature is not established. Report as a known limitation, not a mismatch.                                                                                                                                                        |
| D4  | **No normalisation of velocity to physical units.** Runtime divides `dist/dt` where `dist` is reconstructed as `Δx_norm × vp.width` (`features.ts:116-117`) — this is correct and matches Python's fallback branch (`preprocessing.py:397-398`). Where it differs is that Python _prefers_ stored `x_raw`/`y_raw` when available (`preprocessing.py:390-395`), while the runtime always reconstructs from normalised values.   | `features.ts:116-117`           | `preprocessing.py:390-398`                                                                                    | Introduces a small, systematic rounding error relative to any Python run that used stored raw coordinates. Magnitude is bounded by viewport-quantisation of the normalised float and is small, but it is a real path difference; not quantified in this audit (`NOT MEASURED`). |
| D5  | **Window boundary inclusion.** See §9 — the runtime includes events at `windowEnd` in two consecutive windows; Python uses half-open intervals.                                                                                                                                                                                                                                                                                | `window.ts:93`, `window.ts:149` | `preprocessing.py:513-516` (`searchsorted(side="left")`)                                                      | Boundary events are double-counted, inflating magnitudes in overlapping windows.                                                                                                                                                                                                |
| D6  | **No persisted dimensional metadata.** The runtime tensor is anonymous `Float32Array(18)`. Index meaning is implicit in the order of `features.ts:218-228`. Only `tests/parity.test.ts:65-99` pins the semantics.                                                                                                                                                                                                              | `features.ts:218-234`           | `FEATURE_COLUMN_NAMES` + `MASK_COLUMN_NAMES` are explicit and persisted to Parquet (`preprocessing.py:72-84`) | A silent re-ordering in TypeScript would not be caught by any production assertion, only by tests.                                                                                                                                                                              |

**Conclusion for §8:** the representation is **compatible in schema and feature ordering, and demonstrably so** — unlike the warning in §10 of the brief, this repo is _not_ merely claiming `(18,)` shape coincidence; the mask indices, scales, and normalisation order genuinely align, and `tests/parity.test.ts` passes at `1e-4` against five checked-in scenarios. The incompatibilities are **semantic** (D2 scroll depth), **temporal** (D5 boundaries), and **metadata-level** (D1/D6), not structural.

### 8.3 Provenance caveat on the parity claim

`tests/fixtures/syntheticEvents.json` is a **checked-in static JSON file** containing scenarios (`stationary_pointer`, `accelerated_movement_turns`, `hover_dwell`, `viewport_scroll`, `masked_modalities_pointer_only`) with pre-computed `expectedMicroTensor` values. No repository script regenerates it from `model-preparation`; `parity.test.ts` compares TypeScript output against those frozen numbers. Therefore:

- `IMPLEMENTED`: TypeScript agrees with the frozen expectations to `1e-4`.
- `INFERRED`: the expectations were produced by the Python reference at some earlier point.
- `NOT FOUND`: any CI job that re-derives the fixture from `model-preparation`, so drift in either repo after fixture creation would not be detected.

---

## 9. Windowing Assessment

### 9.1 Actual algorithm

Configuration (`config.yaml`, mirrored into `pipelineConfig.json` and read via `PREPROCESSING_CONFIG`): `window_size_ms = 500`, `stride_ms = 250`, `min_events_per_window = 3`.

**Live path — `RollingWindowBuffer.tick(currentTime?)` (`window.ts:73-124`):**

1. Bail if the event buffer is empty (`:74-76`).
2. `now = currentTime ?? last event timestamp` (`:78`).
3. Initialise `lastWindowEnd` from the first event on first `push` (`:65-67`).
4. Bail if `now − lastWindowEnd < strideMs` (`:84-86`).
5. `windowEnd = lastWindowEnd + strideMs`; `windowStart = windowEnd − windowDurationMs` (`:88-89`).
6. Select events with `timestamp >= windowStart && timestamp <= windowEnd` (`:92-94`).
7. Advance `lastWindowEnd = windowEnd`; evict events older than `windowEnd − 5000 ms` (`:96-100`).
8. Skip the window if fewer than `3` events (`:103-105`).
9. Compute the 18-D tensor and emit + record (`:107-123`).

**Batch path — `processEventStream(events)` (`window.ts:129-172`):** identical arithmetic over a static list, `tCurr` from first to last event, same inclusive bound at `:149`.

**Python reference — `extract_session_microtensors` (`preprocessing.py:471-535`):**

1. `start_time = events[0].ts`, `end_time = events[-1].ts`.
2. `while t_curr + 500 <= end_time:` — **so the final partial window is never emitted.**
3. `i_start = searchsorted(ts, t_curr, 'left')`, `i_end = searchsorted(ts, win_end, 'left')` — **half-open `[t_curr, win_end)`.**
4. Require `>= min_events_per_window`.

### 9.2 Property-by-property answers

| Question                                             | Answer                                                                                                                                                                                                                                                                                                                                          | Evidence                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Event-time or timer based?                           | **Event-time driven, but only when events arrive.** `tick()` is called nowhere in production; when it is called it is driven by the latest event timestamp, not a wall clock.                                                                                                                                                                   | `window.ts:78`; zero production callers                       |
| Do windows overlap?                                  | Yes — 500 ms window, 250 ms stride → 50 % overlap by construction.                                                                                                                                                                                                                                                                              | `:88-89`                                                      |
| Are partial windows emitted?                         | Live path: effectively **no** final partial window (it needs `now` to advance). Batch path: **no** (loop guard `tCurr + 500 <= endTime`). Both agree with Python here.                                                                                                                                                                          | `:144`, `preprocessing.py:511`                                |
| How is the first window initialised?                 | `lastWindowEnd = first event timestamp` (`:65-67`), so the first emitted window is `[t0 − 250, t0 + 250]` — it **starts 250 ms before any data exists**, which is arithmetically odd but harmless because the event filter excludes empty time.                                                                                                 | `:65-67`, `:88-89`                                            |
| How is the final window handled?                     | Simply stops; no flush of a trailing window.                                                                                                                                                                                                                                                                                                    | `:84-86`                                                      |
| Are events on boundaries duplicated?                 | **Yes — this is a defect.** `<= windowEnd` in both paths means an event exactly at `windowEnd` is included in window _N_ and again in window _N+1_, whose `windowStart` equals the previous `windowEnd`. Python uses half-open intervals and does not duplicate.                                                                                | `window.ts:93`, `window.ts:149` vs `preprocessing.py:513-516` |
| Are timestamps monotonic?                            | Yes within a session — a single `performance.now()` source. But `push()` does **not** guard against out-of-order insertion, and `tick()` advances `lastWindowEnd` unconditionally, so a late-arriving event (e.g. from a queued microtask) would create a window that no longer contains it.                                                    | `:56-68`, `:84-96`                                            |
| Does browser timer drift matter?                     | Not for event-time segmentation. It matters for the **legacy** path, which uses `setInterval(…, 500)` (`ClientBehaviorTracker.ts:314`) and is therefore subject to throttling of background tabs.                                                                                                                                               | —                                                             |
| Do inactive periods generate windows?                | **No.** `tick()` returns `null` immediately when the buffer is empty (`:74-76`) and is never called on a timer. This is the most consequential windowing gap: a user who hesitates or abandons produces _no_ windows, so the "hesitation"/"abandon" region of the behavioural space is invisible to the model.                                  | `:73-76`                                                      |
| Do masks distinguish inactivity from unavailability? | **No.** Mask is purely capability (`schema.ts:57-65`). An all-zero-feature window during inactivity would carry mask `111111111` and be indistinguishable from a genuine "recording was active, nothing moved" window. The Python contract has the same property, but Python always has a window to attach it to, whereas the runtime has none. | `features.ts:80-95`                                           |

### 9.3 Conceptual consequence if the implementation differs

Three consequences follow, in order of severity:

1. **Inactivity is unrepresentable** (inactivity → no window). The model-preparation target extractor is built around a lookahead horizon anchored to _windows_ (`target_generation.py:252-289`), so an unrepresented window is an unlabelled training example. `NO_OUTCOME` (class 0) and `ABANDON` (class 6) would be systematically under-populated. This is an **evaluation gap** and a **ground-truth gap**.
2. **Boundary double-counting** inflates `totalTrajectoryLength`, `meanVelocity`, `hesitationCount`, and `trajectoryEntropy` in a window-dependent way — worst at low event rates, where a larger fraction of events sit near boundaries. This is a **temporal gap** and it biases the very features the Slow Gate consumes.
3. **`min_events_per_window = 3` silently discards sparse windows** in both implementations, so slow/lingering interaction — precisely the signal of hesitation — is preferentially dropped at the point of extraction. Parity is preserved, but the _sampling policy_ is hostile to the target classes.

---

## 10. Macro Interaction / Fast Gate Assessment

### 10.1 Event vocabulary

`IMPLEMENTED` and is the single best-designed part of the telemetry layer. `src/macro/symbols.ts:9-47` defines 30 symbols in six families:

```
Navigation:  NAV_OVERVIEW NAV_ANALYTICS NAV_REPORTS NAV_CUSTOMERS NAV_SETTINGS NAV_GENERAL
Filters:     OPEN_FILTERS CLOSE_FILTERS SELECT_DATE SELECT_REGION SELECT_CATEGORY
             SELECT_SEGMENT APPLY_FILTER RESET_FILTERS
Reports:     OPEN_REPORT EXPORT_REPORT
Table:       TABLE_PAGE_NEXT TABLE_PAGE_PREV TABLE_SORT TABLE_ROW_SELECT
Help:        HOVER_KPI HOVER_HELP EXPAND_TOOLTIP
Behavioural: BACKTRACK IDLE_DWELL RAPID_SCROLL
```

This is a **stable, closed taxonomy** with a type guard (`symbols.ts:51-53`) — no free-text symbol space, which is what PrefixSpan needs.

### 10.2 Event identity

`deriveMacroSymbol(event)` (`symbols.ts:59-144`) resolves a `BehaviourEvent` to a symbol using, in order: `componentRole`, `componentId` substring matches, `event.action`, `event.type`, and `event.route`. The consequence is that identity is **finer than `CLICK`**, and it distinguishes exactly the cases the brief asks about:

| Distinction required | Resolvable? | Mechanism                                                                     | Live-DOM check        |
| -------------------- | ----------- | ----------------------------------------------------------------------------- | --------------------- |
| click filter         | yes         | `OPEN_FILTERS` / `CLOSE_FILTERS` via `componentRole==='accordion'` + `action` | accordions present    |
| click primary action | yes         | `APPLY_FILTER` for `btn-apply-filters`, `EXPORT_REPORT` for `btn-export`      | both present          |
| click navigation     | yes         | `NAV_*` from `componentId.startsWith('nav-')` or route                        | 5 nav buttons present |
| click export         | yes         | `componentId.includes('export')` → `EXPORT_REPORT`                            | `btn-export` present  |

**But granularity is undermined by reachability, not design.** Of the 30 symbols, the following have **no producing component in the current UI** (confirmed by live DOM query and source read): `RESET_FILTERS`, `OPEN_REPORT`, `TABLE_PAGE_NEXT`, `TABLE_PAGE_PREV`, `TABLE_SORT`, `EXPAND_TOOLTIP` (no element carries that component/role), and `NAV_GENERAL` (only the 5 known nav components exist). `SELECT_DATE`/`SELECT_REGION`/`SELECT_CATEGORY`/`SELECT_SEGMENT` are reachable because the filter component names contain `date`/`region`/`category`/`segment` (`symbols.ts:96-107`), and these match the live annotations `filter-date-input`, `filter-Region-select`, `filter-category-*`, `filter-segment-select`.

A second-order identity hazard: the substring matching at `symbols.ts:82` (`componentId.includes('export')`) and `:76` (`includes('apply-filter')`) is order-dependent and unbounded. A future component named `export-settings-apply-filter-preview` would resolve to `APPLY_FILTER`. There is no collision test in the suite.

### 10.3 Ordering, session boundaries, pattern representation

| Aspect                          | Status                                                                                                                                                                                                             | Evidence                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Timestamped and ordered         | `IMPLEMENTED` — symbols inherit the monotonic event timestamp; the stream appends in arrival order and `getRecent` preserves chronological order                                                                   | `sequence.ts:56-61`, `:70-75`        |
| Bounded history                 | `IMPLEMENTED` — default capacity 100, FIFO eviction                                                                                                                                                                | `sequence.ts:25`, `:35-37`           |
| PrefixSpan-ready representation | `IMPLEMENTED` — `getRecentSymbols(k)` returns `string[]`; `toPatternString()` returns e.g. `"NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION"`                                                                        | `sequence.ts:80-90`                  |
| Grouping by experiment          | **`NOT FOUND`**                                                                                                                                                                                                    | no `experimentId` anywhere in `src/` |
| Grouping by participant         | **`NOT FOUND`**                                                                                                                                                                                                    | —                                    |
| Grouping by session             | `PARTIAL` — `SessionManager` exists but nothing calls `startSession`; the only live trace export produced filename `experiment-trace-unknown-session-1790006629676.json`, i.e. the `anonymous-unassigned` fallback | `recorder.ts:110-113`, `:197-199`    |
| Grouping by task                | `PARTIAL` — `TaskState.currentTaskId` exists but is always `null`                                                                                                                                                  | §6                                   |
| Sequence-level identity         | **`NOT FOUND`** — no sequence id, no window ids inside the sequence                                                                                                                                                | `schema.ts:49-55`                    |

**Granularity verdict: appropriate, and in places arguably too fine, but currently unused.** For deterministic PrefixSpan mining the vocabulary granularity is right: at the level of `NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER` a pattern miner can generalise across sessions, whereas raw `CLICK` alone would not. The two granularity risks are (a) symbols that can never fire (dead vocabulary inflating the nominal alphabet), and (b) substring-based identity collisions, which the test suite does not guard.

### 10.4 Fast Gate implementation status

| Component                       | Status                                                                                      | Evidence                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Interface contract              | `IMPLEMENTED`                                                                               | `gates/fast/types.ts:7-19`                                                                                                   |
| Deterministic matcher           | `IMPLEMENTED`, but **`MOCKED` relative to the architecture**                                | `mockFastGate.ts:40-68`; suffix or exact matching over registered patterns                                                   |
| WASM PrefixSpan                 | `IMPLEMENTED` in Rust and **loaded successfully at runtime**                                | `wasm-vectorizer/src/prefix_span.rs`; console `WASM Gate ready: Edge-AUI-Deterministic-Gate-v0.1.0`; `wasm.worker.ts:88-101` |
| Wiring to the adaptive pipeline | **`NOT FOUND`** — `AdaptiveInferenceEngine` receives a `MockFastGate`, never the WASM miner | `runtime/worker.ts:51-53`                                                                                                    |

So the repository contains a working WASM PrefixSpan miner and a working (mock) deterministic gate, and **no code path connects the miner to arbitration**. PrefixSpan currently appears only in the legacy pipeline's on-demand `minePatterns()` (`pipeline.ts:183-188`), which requires `historicalMacroSequences.length >= minPatternSupport` (default 2) and is called only from `evaluateAdaptiveTrigger` when a cognitive-state threshold has already fired.

---

## 11. Outcome Event Assessment

### 11.1 Schema

`IMPLEMENTED` — `src/telemetry/events.ts:68-83`:

```typescript
export type OutcomeType =
  | "CLICK"
  | "FORM_SUBMIT"
  | "BACKTRACK"
  | "RAPID_SCROLL"
  | "HOVER_DWELL"
  | "ABANDON"
  | "NO_OUTCOME";

export interface OutcomeEvent {
  timestamp: number;
  outcome: OutcomeType;
  componentId?: string;
  taskId?: string;
  taskStepId?: string;
}
```

Against the brief's minimum representation:

| Required field                  | Present?                | Note                                                              |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `outcome_type`                  | yes (`outcome`)         | 7 values, exactly matching `config.yaml` `outcome_taxonomy` (0–6) |
| `timestamp`                     | yes                     | monotonic                                                         |
| `session_id`                    | **no**                  | obtainable only via `ExperimentTrace.session.sessionId`           |
| `task_id`                       | yes, optional           | always `undefined` in practice                                    |
| `interaction_id` / source event | **no**                  | no back-reference to the `BehaviourEvent` that caused the outcome |
| `target element`                | partial (`componentId`) | no role, no tag, no coordinates                                   |
| `context`                       | **no**                  | no route, no `UIContext` snapshot                                 |

### 11.2 Derivation: observed vs model-inferred

| Kind                                             | Status                                                                                                      | Evidence                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Observed outcome**                             | **`NOT FOUND` in the testbed at runtime.** The schema and the recorder method exist; nothing produces them. | `recordOutcome` production callers: none (grep across `src/` returns only the declaration at `recorder.ts:92`)                                                   |
| Observed outcome (offline, in model-preparation) | `IMPLEMENTED`                                                                                               | `target_generation.py:76-249` (`extract_lookahead_outcome`), `:252-289` (`extract_outcome_for_window`)                                                           |
| **Model-inferred outcome**                       | `IMPLEMENTED` but structurally different                                                                    | `MockSlowGate` returns `outcome: 'HOVER_DWELL'` by default (`mockSlowGate.ts:49`); the legacy ONNX worker returns 5 subjective labels (`onnx.worker.ts:135-150`) |

### 11.3 Compatibility of the two taxonomies

The testbed and model-preparation agree on the 7-class outcome taxonomy. The **live system does not use it at all**:

| Producer                             | Vocabulary                                                                | Cardinality | Evidence                     |
| ------------------------------------ | ------------------------------------------------------------------------- | ----------- | ---------------------------- |
| Testbed `OutcomeType`                | `NO_OUTCOME CLICK FORM_SUBMIT BACKTRACK RAPID_SCROLL HOVER_DWELL ABANDON` | 7           | `events.ts:68-75`            |
| model-preparation `OUTCOME_TAXONOMY` | same 7 names, ids 0–6                                                     | 7           | `target_generation.py:26-34` |
| Booted ONNX worker                   | `Focused Hesitation Exploring Frustrated Idle`                            | 5           | `onnx.worker.ts:135-140`     |
| Shipped ONNX graph                   | unnamed logits                                                            | 6           | graph introspection          |

Three different vocabularies in one system. §26 classifies this as a semantic gap.

### 11.4 What the testbed can currently prove about ground truth

Nothing. There is no code path that turns a user interaction into an `OutcomeEvent`. Consequently the target environment cannot currently supply the supervised signal the model-preparation pipeline needs, and the "self-supervised lookahead" contract (`target_generation.py:76-102`) has no runtime counterpart. This is the second P0 blocker.

---

## 12. UI Context Assessment

### 12.1 What is exposed

`IMPLEMENTED` — `getActiveUIContext()` (`contextProvider.ts:62-181`) returns:

| Field                    | Source                                                                          | Live value observed                                             |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| `route`                  | `[data-aui-route]`, else `pathname`, else `'Overview'`                          | `Analytics`                                                     |
| `activeComponentId`      | `closest('[data-aui-component]')` on tracked/hovered/focused element            | `page-analytics`, later `btn-apply-filters`                     |
| `componentRole`          | `[data-aui-role]`                                                               | `primary-action`                                                |
| `taskId` / `taskStepId`  | `taskManager.getState()` + step lookup in `EXPERIMENTAL_TASKS`                  | always `undefined` (no task active)                             |
| `availableActions`       | union of `[data-aui-action]` values, defaults to `['click']`                    | present                                                         |
| `primaryActionAvailable` | `[data-aui-role="primary-action"]:not([disabled])` exists                       | `true`                                                          |
| `helpAvailable`          | `[data-aui-role="help"                                                          | "tooltip"]` … exists                                            | `true` |
| `expandable`             | target role `accordion`, or `aria-expanded` present, or id contains `accordion` | `false` for `page-analytics`; `true` when drawn on an accordion |

### 12.2 Minimum context needed vs available

To map `behaviour → target outcome → intervention` the pipeline needs: current route, active component + role, task identity, task step, which interventions are currently feasible, and which experimental condition applies. Available today: the first two fully, task/step partially (always empty), feasibility fully, condition **not at all**.

| Field                | Available?                    | Needed for                                 |
| -------------------- | ----------------------------- | ------------------------------------------ |
| current route        | yes                           | outcome disambiguation, trace segmentation |
| page/view            | yes (derivable from route)    | —                                          |
| active component     | yes                           | intervention targeting                     |
| task                 | structurally yes, actually no | target labels                              |
| target element       | yes (`componentId`, `role`)   | actuator targeting                         |
| visible controls     | partial (`availableActions`)  | intervention eligibility                   |
| form state           | **no**                        | `FORM_SUBMIT` detection                    |
| filter state         | **no**                        | T1/T3 step progress                        |
| viewport             | **no** (not on `UIContext`)   | MicroTensor re-derivation (§8 D1)          |
| scroll state         | **no**                        | `RAPID_SCROLL`                             |
| UI version           | **no**                        | reproducibility across UI revisions        |
| experiment condition | **no**                        | baseline/adaptive comparison (§17)         |

**Assessment:** the context provider is sufficient for **actuation eligibility** (which is what `InterventionPolicy.checkContextEligibility` consumes, `policy.ts:179-221`) and insufficient for **outcome construction and experiment control**. Adding `viewport`, `scrollState`, `conditionId`, and `uiVersion` is a small, well-contained change; adding real task/form/filter state requires the task wiring of §6.

---

## 13. Intervention Taxonomy Assessment

The five intended interventions are the correct research vocabulary and map one-to-one onto `config.yaml`'s `target_intervention_vocabulary`. Contract status: `IMPLEMENTED` (`src/intervention/types.ts`).

| Intervention               | Implemented? | Concrete target                                                                              | Actuator mechanism                                                                                                                                               | Reversible?                                                                     | Testable?                                    |
| -------------------------- | ------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `no_op`                    | Yes          | none                                                                                         | no DOM change; emits an `applied` event                                                                                                                          | n/a (no-op is inherently reversible)                                            | Yes — `tests/actuator.test.ts:176-187`       |
| `highlight_primary_action` | Yes          | `[data-aui-component="<id>"]`, else first `[data-aui-role="primary-action"]:not([disabled])` | adds class `edge-aui-highlight` + `data-aui-active-adaptation="highlight"`                                                                                       | Yes — restores exact prior `class` attribute (or removes it)                    | Yes — `actuator.test.ts:46-81`               |
| `simplify_options`         | Yes          | all `[data-aui-role="accordion"]`; `[data-aui-component="filter-drawer"]`                    | adds `edge-aui-simplified`; programmatically clicks expanded accordions closed                                                                                   | Yes — re-clicks to restore, restoring `aria-expanded`; restores drawer class    | Yes — `actuator.test.ts:82-119`              |
| `expand_tooltip`           | Yes          | `[data-aui-component="<id>"]`, else first `[data-aui-role="tooltip"]`                        | adds `edge-aui-tooltip-expanded`, `aria-expanded="true"`, inserts non-modal `role="tooltip"` bubble next to target, links via `aria-describedby`, Esc to dismiss | Yes — removes bubble, restores `class`, `aria-describedby`, and stashed `title` | Yes — `actuator.test.ts:120-243`             |
| `offer_assistance`         | Yes          | document body (non-modal `<aside role="status" aria-live="polite">`)                         | appends banner with dismiss button; Esc to dismiss                                                                                                               | Yes — removes node and listeners                                                | Yes — `actuator.test.ts:146-175`, `:244-262` |

### 13.1 Quality observations

- **Non-destructiveness is genuinely implemented, not asserted.** Each adaptation stores a precise reversal closure; `highlight` and `tooltip` restore the _exact_ initial `class` string rather than toggling a class (`actuator.ts:197-212`, `:367-390`). `reset()` iterates and reverses every active adaptation (`:137-150`). `getActiveInterventions()` exposes state (`:155-157`).
- **Accessibility is treated as a first-class constraint.** Focus is not stolen and is explicitly restored after programmatic clicks (`actuator.ts:246-249`, `:264-266`, `:283-285`). Tooltips use `role="tooltip"` + `aria-describedby` with a unique id (`:330-344`). Assistance uses `role="status" aria-live="polite"` (`:407-408`). Esc dismissal exists for both help surfaces.
- **Concurrency semantics exist.** Applying a second adaptation of the same type clears the first (`:77-79`); different types coexist (two active interventions verified in `e2e_simulation.test.ts:238-262`).
- **Gaps.**
  1. **Selector injection.** `command.targetComponentId` is interpolated into a CSS attribute selector without escaping (`actuator.ts:185-187`, `:297-299`). A component id containing `"` or `]` would produce an invalid selector and throw. Ids are currently developer-controlled (`FilterDrawer.tsx:109` builds `filter-${section.name}`), so this is a robustness gap, not an exploit.
  2. **No duration/TTL enforcement.** `InterventionCommand.ttlMs` is validated (`types.ts:149-151`) and stored, but no actuator code reads it, so an adaptation persists until explicitly cleared or reset. `e2e_simulation.test.ts` never exercises `ttlMs`.
  3. **No automatic task-change reversion.** `InterventionPolicy` resets its _candidate streak_ on task switch (`policy.ts:68-72`), but the actuator is not subscribed to task or route changes, so a highlight applied on Analytics remains applied after navigating away. Since `App.tsx` swaps the whole subtree (`App.tsx:21-41`), the element is unmounted and the CSS class is lost with it — a **silent inconsistency**: the actuator's `activeAdaptations` map still holds a stale record until `reset()`.
  4. **Repeated-trigger behaviour is only partially defined.** Re-applying the same type clears then re-applies (`:77-79`), emitting `reverted` then `applied`; there is no cooldown, and `InterventionPolicy` has no time-based suppression, only a _count_-based persistence gate (`policy.ts:113-133`).
  5. **User override is dismissal-only.** Esc/× produce a `dismissed` `InterventionEvent`, but policy does not consume dismissal as negative feedback to suppress re-issuing that intervention.

---

## 14. Policy / Actuator Assessment

### 14.1 Separation of prediction and adaptation

**`IMPLEMENTED` and cleanly separated at the type and call level.**

```
FastGate.evaluate(macroSequence)  →  GateDecision { matched, intervention?, confidence? }
SlowGate.infer({ sequence, shape, context })  →  SlowGateResult { outcome?, intervention?, probabilities?, confidence? }
        ↓
AdaptiveInferenceEngine.evaluate(InferenceContext)  →  InferenceResult { intervention?, matchedGate, latencyMs }
        ↓
InterventionPolicy.accept(command, context)  →  PolicyDecision { accepted, command, reason }
        ↓
UIActuator.apply(command)  →  DOM mutation
```

Evidence: the model layer returns declarative values only (`fast/types.ts:7-19`, `slow/types.ts:10-27`); `InterventionCommand` is explicitly documented as containing "zero direct DOM references or side-effects" (`intervention/types.ts:37-49`); the only module that touches `document` is `actuator.ts`. The model cannot manipulate DOM state because no model interface has a DOM handle. **This separation is real and is the repository's strongest architectural property.**

### 14.2 Policy mechanism status

| Mechanism                         | Status                                                                                                                                                        | Evidence                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Confidence threshold              | `IMPLEMENTED`, default `0.75`, flagged as an uncalibrated engineering baseline                                                                                | `policy.ts:37-41`, `:86-97`                  |
| Temporal persistence              | `IMPLEMENTED` — `requiredConsecutiveWindows = 2` on _identical_ (type, target)                                                                                | `policy.ts:113-133`                          |
| Cooldown                          | **`NOT FOUND`**                                                                                                                                               | —                                            |
| Repeated-intervention suppression | Partial — persistence gate only; no post-application refractory period                                                                                        | `policy.ts:113-133`                          |
| Conflicting interventions         | Partial — a different candidate resets the streak; there is no arbitration between two simultaneously-valid candidates because the engine returns at most one | `policy.ts:114-124`, `arbitration.ts:75-109` |
| Intervention duration             | **`NOT FOUND`** — `ttlMs` unenforced (§13.1)                                                                                                                  | `types.ts:149-151` only                      |
| Rollback                          | `IMPLEMENTED` in the actuator (`reset`, `clear`); policy does not trigger it                                                                                  | `actuator.ts:114-150`                        |
| User override                     | Partial — dismissal events emitted, not consumed by policy                                                                                                    | `actuator.ts:435-445`                        |
| Baseline condition                | **`NOT FOUND`** at application level                                                                                                                          | §17                                          |
| Logging                           | `IMPLEMENTED` — `InterventionEvent { issued, accepted, applied, dismissed, reverted }`                                                                        | `events.ts:88-102`                           |

### 14.3 Arbitration correctness

`AdaptiveInferenceEngine.evaluate` (`arbitration.ts:56-124`) implements ADR-002 faithfully and defensively:

1. Runs the Fast Gate inside `try/catch`, degrading to `{ matched: false }` on error (`:66-72`).
2. Short-circuits the Slow Gate only when the decision is `matched` **and** carries an intervention **and** that intervention is not `no_op` (`:75`) — a subtle and correct guard, since a matched `no_op` should not suppress GRU inference.
3. Runs the Slow Gate inside `try/catch`, returning `matchedGate: 'none'` on failure (`:90-113`).
4. Reports measured wall-clock `latencyMs` per evaluation via `performance.now()` (`:57`, `:76`, `:100`, `:116`).

This is verified by 8 arbitration tests (`tests/gate_arbitration.test.ts:42-249`) plus the end-to-end simulation. **But the engine is instantiated only by `RuntimeWorkerCore`, which itself is instantiated only by tests** — `RuntimeWorkerClient` is exported from `src/runtime/index.ts` and imported by nothing in the application.

**Classification for §14:** the policy/actuator layer is `IMPLEMENTED` and high quality, `MOCKED` at the gate implementations, and `UNWIRED` end-to-end. It cannot be evaluated experimentally until §25's P0-1 is resolved.

---

## 15. Model Integration Readiness

| Component             | Integration point exists?                                                                                            | Required input                                            | Required output                                                       | Current status                                                                               | Blocking issue                                                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PrefixSpan** (WASM) | Yes — `mine_macro_patterns(sequences, minSupport)` in `wasm.worker.ts:88-101`; worker is **loaded and running**      | `string[][]`, `minSupport`                                | `{ pattern, support, confidence }[]`                                  | `IMPLEMENTED` in Rust, loaded at runtime, but **not connected to `AdaptiveInferenceEngine`** | `MockFastGate` is hard-wired in `runtime/worker.ts:51-53`. No adapter maps mined patterns to registered gates. Macro stream is not collected in the app.                                                                                                                                                                                     |
| **Foundation GRU**    | Boundary only — `SlowGate` interface accepts `{ sequence: Float32Array, shape: [1,T,18], context }`                  | `(1,8,18)` float32                                        | `SlowGateResult { outcome, probabilities, confidence, intervention }` | `NOT INTEGRATED` — only `MockSlowGate` exists (`mockSlowGate.ts:24-70`)                      | No real model behind the interface. `model-preparation/src/training.py:80-90` defines `FoundationOutcomeHead(64→7)`; nothing loads it.                                                                                                                                                                                                       |
| **Target head**       | Boundary only — same `SlowGateResult.outcome` + `intervention` slot                                                  | `h_T` (64) ⊕ UI context vector `C` (`training.py:93-118`) | 5 intervention classes                                                | `NOT INTEGRATED`                                                                             | **No UI context vector exists as a numeric tensor.** `UIContext` is a TypeScript object with `route`, ids, and booleans (`types/telemetry.ts:141-151`); `TargetInterventionHead` requires a `context_dim=6` numeric tensor, and `training.py:105-107` declares it mandatory. The encoding from `UIContext` → `R^6` is undefined and unbuilt. |
| **Slow Gate (real)**  | Interface yes; runtime no                                                                                            | `(1,8,18)` + context                                      | 7-class outcome + 5-class intervention                                | `MOCKED`                                                                                     | ONNX graph mismatch (§18) and no sequence reaches it.                                                                                                                                                                                                                                                                                        |
| **ONNX Runtime Web**  | `IMPLEMENTED` and booting                                                                                            | `modelUrl`                                                | `InferenceSession`                                                    | Boots, reports `provider: webgpu (GPU: true)`, but **loads no model**                        | `pipeline.ts:49` passes `''`; `onnx.worker.ts:41` skips creation; `modelLoaded:false` path returns provider `'webgpu'` or `'heuristic'` (`:66-73`). The provider label is therefore **misleading**.                                                                                                                                          |
| **Worker inference**  | `IMPLEMENTED` — two models: `src/runtime/*` (adaptive, unused) and `src/workers/{onnx,wasm}-gate/*` (legacy, booted) | typed requests                                            | typed responses                                                       | Adaptive runtime `UNREACHABLE`; legacy workers running                                       | No worker receives a `MicroTensorWindow`. `RuntimeWorkerClient` has zero production callers.                                                                                                                                                                                                                                                 |

### 15.1 Additional integration facts

- **Both worker entry points use the same construction pattern** — `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` (`OnnxGateClient.ts:47-50`, `WasmGateClient.ts:46-49`, `workerClient.ts:40`). Vite's worker plugin resolves and emits these correctly (the prior `dist` contains `onnx.worker-*.js` and `wasm.worker-*.js`), so this pattern is proven in this build setup.
- **`RuntimeWorkerClient` silently falls back to an in-memory core** when `Worker` is undefined or construction throws (`workerClient.ts:36-54`). For a benchmark this is dangerous: a performance measurement taken through the client could actually be measuring synchronous main-thread execution. Any future latency benchmark must assert which mode is active.
- **`workerClient.ts:18` imports `RuntimeWorkerCore` from `worker.ts` directly**, so the worker module graph — including `MockFastGate`, `MockSlowGate`, `SequenceBuilder`, `AdaptiveInferenceEngine` — is pulled into the main-thread bundle when the client is imported. This is a bundle-size and thread-isolation concern for later (§22, P2).
- **The dev server correctly provides the cross-origin isolation headers** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (`vite.config.ts:21-26`), and the live page reports `crossOriginIsolated: true` — required for `SharedArrayBuffer`/threaded WASM.

---

## 16. Experiment Traceability

### 16.1 Implemented trace schema

`IMPLEMENTED` — `SerializableExperimentTrace` (`traceSchema.ts:39-50`):

```typescript
{
  schemaVersion: '1.0.0';
  exportedAt: string;              // ISO 8601
  session: { sessionId, startedAt, taskId? };
  task?: TaskState;                // { currentTaskId, status, currentStepIndex, completedSteps, startTime?, endTime?, errors }
  metadata: { durationMs, totalEvents, behaviourCount, microTensorCount,
              macroCount, outcomeCount, interventionCount, finalTaskStatus? };
  behaviourEvents: BehaviourEvent[];
  microTensors: { windowStart, windowEnd, values: number[] }[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  interventions: InterventionEvent[];
}
```

Plus `validateExperimentTrace()` (`traceSchema.ts:60-134`) and `reconstructReplayStream()` (`:152-169`), which merges behaviour, macro, outcome, and intervention items into one chronologically sorted stream.

### 16.2 Can one complete interaction be reconstructed?

| Link in the required chain | Logged?                                       | Evidence                                                                                                                                                                    |
| -------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Experiment                 | **no**                                        | no `experimentId` field anywhere                                                                                                                                            |
| Participant / session      | structurally yes, actually no                 | `session.sessionId`, but `SessionManager.startSession` has no caller; live export produced `unknown-session` and `anonymous-unassigned` (`recorder.ts:110-113`, `:197-199`) |
| Task                       | yes structurally, always `Idle`               | `recorder.ts:118`, `:135`                                                                                                                                                   |
| Raw events                 | **only if the observer is started**           | `recordBehaviourEvent` is called from nowhere in production                                                                                                                 |
| MicroTensor windows        | **only if the window buffer is started**      | `window.ts:118-120` (auto-record), unreachable                                                                                                                              |
| Macro sequence             | **only if the macro stream is started**       | `sequence.ts:39-41`, unreachable                                                                                                                                            |
| Observed outcome           | **never**                                     | `recordOutcome` has no production caller                                                                                                                                    |
| Model prediction           | **not logged at all**                         | `InferenceResult` is returned to callers; no recorder method exists for predictions                                                                                         |
| Policy decision            | **not logged at all**                         | `PolicyDecision` is returned; nothing records it                                                                                                                            |
| Intervention               | via `UIActuator.onInterventionEvent` if wired | `actuator.ts:162-165`; the wiring exists in `e2e_simulation.test.ts:100-102`, not in production                                                                             |
| Task result                | in `task` block, always `Idle`                | §6                                                                                                                                                                          |

### 16.3 Missing correlation identifiers

| Identifier                            | Present?                           | Minimum needed?                                                                                                                                                            |
| ------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `experiment_id`                       | `NOT FOUND`                        | **Yes** — without it two runs cannot be pooled or separated                                                                                                                |
| `condition_id` (baseline vs adaptive) | `NOT FOUND`                        | **Yes** — the core experimental contrast (§17)                                                                                                                             |
| `session_id`                          | present in schema; never populated | Yes                                                                                                                                                                        |
| `task_id`                             | present in schema; always `null`   | Yes                                                                                                                                                                        |
| `event_id`                            | `NOT FOUND`                        | No — timestamps + session scope suffice for replay                                                                                                                         |
| `window_id`                           | `NOT FOUND`                        | **Yes** — a window is the unit the model consumes and the unit the lookahead outcome is anchored to; without it a prediction cannot be tied to the window that produced it |
| `prediction_id`                       | `NOT FOUND`                        | **Yes** for evaluating the model; `window_id` + `matchedGate` would suffice as a weaker substitute                                                                         |
| `intervention_id`                     | `NOT FOUND`                        | Recommended — needed to correlate an `applied`/`reverted`/`dismissed` triple as one intervention episode                                                                   |

**Minimum required for reproducible evaluation:** `experiment_id`, `condition_id`, `session_id`, `task_id`, `window_id`, and an `intervention_episode_id`. Today the trace contains none of the first two, none of the last two, and populates neither `session_id` nor `task_id` in practice.

### 16.4 Clock-mixing defect

`session.startedAt` is written by `getMonotonicTimestamp()` = `performance.now()` (`session.ts:43`), while `metadata.durationMs` is computed as `Date.now() − activeSession.startedAt` (`recorder.ts:136-137`) and `exportedAt` is `new Date().toISOString()` (`:159`). `performance.now()` is time-origin-relative (typically page load), whereas `Date.now()` is epoch milliseconds. **`durationMs` is therefore meaningless** — for a page open 60 s with a session started 5 s after load, `durationMs ≈ 1.7 × 10¹²`. This is a concrete, verifiable bug in the trace contract.

**Verification method:** `ExperimentTrace` has no test asserting `metadata.durationMs` plausibility; `tests/telemetry_session_recorder.test.ts:174-190` validates schema shape only.

---

## 17. Baseline / Control Condition

| Capability required                                | Status                                                     | Evidence                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disable interventions globally                     | **`NOT FOUND`** at application level                       | `AdaptiveInferenceEngine` exposes `setEnableFastGate` / `setEnableSlowGate` (`arbitration.ts:134-148`) and `INIT` accepts both flags (`runtime/worker.ts:60-61`), but the app never constructs the engine, so there is no switch to reach them |
| Keep telemetry active while adaptation is disabled | **`NOT FOUND`** — no code separates "observe" from "adapt" | the observer and the engine are independent objects but no runtime composes them, so no condition flag can gate one and not the other                                                                                                          |
| Reproduce the same task                            | **`NOT FOUND`**                                            | tasks cannot start (§6); stimuli are randomised at module load (`tableData.ts:25`)                                                                                                                                                             |
| Reset UI state                                     | `PARTIAL`                                                  | `UIActuator.reset()` is implemented and tested; `TaskManager.resetTask()` exists; neither is reachable from a task control, only the DebugPanel button                                                                                         |
| Distinguish experimental conditions                | **`NOT FOUND`**                                            | no `conditionId` in `SessionContext` (`session.ts:9-13`), `UIContext` (`types/telemetry.ts:141-151`), or `ExperimentTrace`                                                                                                                     |

**Assessment:** the testbed cannot currently run a controlled comparison. Even the specific requirement highlighted in the brief — _telemetry should remain available in the baseline condition_ — is unachievable, because the condition switch and the telemetry switch would have to be the same switch, and neither exists.

Design note for the fix (labelled `RECOMMENDED`, §25 P0-4): `AdaptiveInferenceEngine` already has the right seam. Gating `UIActuator.apply` on a `conditionId === 'adaptive'` check while leaving observer → window → macro → recorder running gives a clean baseline condition with identical telemetry, and requires no architectural change.

---

## 18. Testing Assessment

### 18.1 Executed results (observed, not inferred)

```
$ npx vitest run --reporter=dot
 Test Files  22 passed (22)
      Tests  149 passed (149)
   Start at  17:02:08
   Duration  14.29s (environment 81%, tests 8%, transform 5%, import 5%, worker 1%)
             Environment  jsdom was created 22 times · 67.86s total, 81% of tracked time

$ npx tsc --noEmit
TSC_EXIT=0   (no diagnostics)
```

| Metric                                                           | Value                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Test files                                                       | 22                                                                                                         |
| Tests passed                                                     | 149                                                                                                        |
| Tests failed                                                     | 0                                                                                                          |
| Unit tests                                                       | ~118 (feature maths, schema/type guards, window/sequence arithmetic, normalizer, session, recorder, gates) |
| Component tests (jsdom + Testing Library)                        | 4 files (`target_ui_components`, `semantic_dom_annotations`, `active_ui_context`, `debug_panel`)           |
| Integration tests (real modules, synthetic fixtures, no browser) | 3 files (`e2e_simulation`, `gate_arbitration`, `worker_runtime`)                                           |
| Browser / E2E tests                                              | **0**                                                                                                      |
| Parity tests                                                     | 1 file, 5 scenarios at `1e-4`                                                                              |
| Environment                                                      | jsdom; `vitest.config.ts` sets `environment: 'jsdom'`, `globals: true`                                     |

Note: `npx vitest run --reporter=basic` fails with `Error: Failed to load custom Reporter from basic` — the `basic` reporter does not exist in vitest 5.0. That is tooling friction, not a test failure; the default/`dot` reporter works.

### 18.2 Coverage against the ten priorities the brief names

| #   | Priority                        | Covered?        | Evidence / gap                                                                                                                                                                                                                                                                              |
| --- | ------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Telemetry correctness           | **Partial**     | `telemetry_observer.test.ts:32-187` covers pointer/scroll/form capture, `data-aui-*` extraction, normalisation, throttling, unsubscribe, and `stop()` cleanup. Not covered: event **ordering**, loss under load, `pagehide`/`popstate` event-type mapping, or the observer→window contract. |
| 2   | 500 ms / 250 ms windowing       | **Partial**     | `microtensor_window.test.ts:11-116` covers stride emission, `min_events_per_window`, batch 500/250 slicing, and subscription. **Not covered: the inclusive-boundary double-count defect (§9), inactivity producing no window, or first-window initialisation.**                             |
| 3   | 18-D MicroTensor compatibility  | **Good**        | `microtensor_features.test.ts:14-201` + `parity.test.ts:17-113` verify dimension, ordering, bounds, no NaN/Inf, and `1e-4` parity against 5 frozen fixtures. Gap: fixtures are static JSON, not regenerated from Python (§8.3).                                                             |
| 4   | Modality masks                  | **Good**        | `microtensor_features.test.ts:156-183` and `parity.test.ts:65-99` assert capability semantics and mask-bit positions.                                                                                                                                                                       |
| 5   | Macro sequence ordering         | **Partial**     | `macro_sequence.test.ts:11-121` covers record, derive-from-event, capacity, pattern string, subscription, clear. Gap: no collision test for substring-based identity (§10.2); no ordering test under interleaved identical timestamps.                                                      |
| 6   | Outcome generation              | **NOT COVERED** | No test produces an `OutcomeEvent` from a live interaction. `recordOutcome` is only called directly with hand-built objects (`telemetry_session_recorder.test.ts:104`, `e2e_simulation.test.ts:248`). The absence of a generator is untested because it does not exist.                     |
| 7   | Intervention command validation | **Good**        | `intervention_types.test.ts:11-80` covers the taxonomy, type guard, factory, no_op default, and malformed-command rejection (`validateInterventionCommand`, `types.ts:105-161`).                                                                                                            |
| 8   | Actuator reversibility          | **Good**        | `actuator.test.ts:46-262` covers all four adaptations, exact-attribute restoration, focus preservation, Esc dismissal, `aria-describedby` linkage, and multi-adaptation reset. Gap: no `ttlMs` duration test, no cross-route-unmount test.                                                  |
| 9   | Baseline / adaptive separation  | **NOT COVERED** | No test constructs a baseline condition; `gate_arbitration.test.ts:142-190` tests `enableFastGate`/`enableSlowGate` flags but those are gate-level, not condition-level.                                                                                                                    |
| 10  | Session / task correlation      | **Partial**     | `telemetry_session_recorder.test.ts:34-65` covers session lifecycle; `target_ui_components.test.tsx:123-172` covers task transitions and reset. Gap: no test asserts that recorded events carry `sessionId`/`taskId`, because they do not (§16).                                            |

### 18.3 What the suite does not prove

1. **No test drives the composed pipeline.** Every integration test constructs its collaborators by hand (`e2e_simulation.test.ts:40-112` builds a DOM fixture, a session, a task, a mock Fast Gate, a mock Slow Gate, a policy, an actuator, and a recorder). The production composition — observer → `RollingWindowBuffer` → `MacroInteractionStream` → `RuntimeWorkerClient` → engine → policy → actuator → recorder — is **never assembled in a test**. This is why the wiring gap survived a 149-test green suite.
2. **No browser test.** `vitest.config.ts` sets jsdom only; no Playwright/Cypress config exists. The DebugPanel warning `An update to DebugPanel inside a test was not wrapped in act(...)` (`tests/debug_panel.test.tsx`, three occurrences) is the only runtime-behaviour symptom surfaced.
3. **A test mutates the repository.** `tests/sync_config.test.ts` runs `syncConfig()` unmocked, which **writes** `src/config/pipelineConfig.json` (observed log: `[sync-config] Successfully wrote .../src/config/pipelineConfig.json`). Measured hash before and after the full run is identical (`1f62c599…424c843`), so the regeneration is idempotent and the audit left the tree clean — but the test is not hermetic, and drift in `config.yaml` would silently rewrite a tracked file during `npm test`.

---

## 19. Browser Runtime Assessment

**Environment:** headless Chrome 153.0.0.0 (CDP), macOS, 8 logical CPUs, `navigator.deviceMemory = 8`, WebGPU adapter available. App served by `npx vite --port 5173 --strictPort` (Vite 8.2.2, ready in 985 ms). Interaction via `agent-browser` on an isolated named session. `public/index.html` served `/src/main.tsx`.

### 19.1 Observed console output

On load, and only on load:

```
[log] [WasmGateClient] WASM Gate ready: Edge-AUI-Deterministic-Gate-v0.1.0
[log] [OnnxGateClient] ONNX Gate ready with provider: webgpu (GPU: true)
[log] [Edge-AUI] Framework running with dual-gate inference.
[log] [OnnxGateClient] ONNX Gate ready with provider: webgpu (GPU: true)
```

Then **nothing**, across every interaction performed. Absent: runtime errors, listener failures, hydration problems, worker failures, serialization errors, unhandled exceptions. Also absent: any sign of the adaptive pipeline.

Interpretation of the four lines:

- Line 1 is **accurate**: the real Rust/WASM PrefixSpan module initialised in a worker.
- Lines 2 and 4 say `provider: webgpu (GPU: true)`. `GPU: true` is the **capability probe** result (`onnx.worker.ts:22-32`). `provider: webgpu` is the _requested/assumed_ provider written by the fallback branch (`:66`), **not** a provider that loaded a model, because `modelUrl` was empty (`pipeline.ts:49`) so the `InferenceSession.create` branch at `:41-63` never ran. Two init logs appear because `OnnxGateClient` calls `this.init()` in its constructor (`OnnxGateClient.ts:24`) and `EdgeAUIFramework.init()` calls it again (`pipeline.ts:65`); the second is deduplicated by the `isReady && initPromise` guard, but the log fires twice. This is a **misleading diagnostic** that would lead an operator to believe GPU inference is active.

### 19.2 Exercised interactions and results

| Interaction              | Performed                                                                                   | Observed effect                                          |
| ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Navigation               | clicked Analytics, Reports, Analytics                                                       | view switched; `[data-aui-route]` updated to `Analytics` |
| Accordion open/close     | clicked Product Category, Advanced Options                                                  | `aria-expanded` toggled `false→true`                     |
| Select + checkbox + date | region = "Europe", category clothing checked, date `2025-01-15`                             | inputs updated; no error                                 |
| Primary action           | clicked Apply Filters                                                                       | no observable effect (button has no `onClick`)           |
| Hover                    | KPI total-revenue card, tooltip-region                                                      | no telemetry effect                                      |
| Scroll                   | down 600 px, down 400, up 400                                                               | `window.scrollY` = 302; no telemetry effect              |
| Export                   | clicked Export Report                                                                       | no download, no effect (button has no `onClick`)         |
| Synthetic pointer stream | ~400 `pointermove`/`mousemove`/`pointerover`/`pointerout` events over 3 elements × 4 rounds | no telemetry effect                                      |
| Debug panel              | opened via toggle                                                                           | rendered; all values empty (§19.3)                       |
| Export Trace             | clicked                                                                                     | see §19.4                                                |
| Reset Task               | clicked                                                                                     | no state change (already `Idle`)                         |

Console after all of the above: **empty**.

### 19.3 Debug panel live state (observed)

```
SESSION & TASK CONTEXT
  Session ID:        No Active Session
  Task:              None (Idle)
  Step:              N/A
  Route:             Analytics
  Component Focus:   page-analytics (none)  →  later  btn-apply-filters (primary-action)
  Flags:             primaryAction:yes | help:yes | expandable:no
GATE ARBITRATION & DECISIONS
  Fast Gate:         no match
  Slow Gate:         skipped
  Intervention:      no_op
  Policy State:      idle
LATENCY & WORKER STATUS
  Inference Latency: --
  Feature Extr. Latency: --
  Worker Runtime:    uninitialized
MACRO SEQUENCE
  No macro events recorded
LATEST MICROTENSOR (18-D)
  mean_vel: 0.000 … scroll_vel: 0.000
  Modality Mask:     [000000000]
RECORDER BUFFERS
  Buffered Events:   0 (B:0 M:0 T:0 O:0 I:0)
```

Note that `Component Focus` and `Flags` are **not** empty — those come from `getActiveUIContext()` polled on a 250 ms interval (`DebugPanel.tsx:65-68`), which reads the DOM directly. Everything sourced from `debugBus` (`DebugPanel.tsx:62`) or `experimentRecorder` (`:52`) is empty or static. That is a crisp confirmation of the root cause: **DOM-derived context works; pipeline-derived state does not exist.** `debugBus` has no production publisher (grep: referenced only by `DebugPanel.tsx:22` and `debug_bus` test).

### 19.4 Trace export behaviour (observed)

`ExperimentRecorder.downloadTraceAsJSON()` was instrumented in-page by monkey-patching `URL.createObjectURL` and `HTMLAnchorElement.prototype.click`:

```json
{
  "blobType": "application/json",
  "blobSize": 622,
  "download": "experiment-trace-unknown-session-1790006629676.json",
  "href": "blob:http://localhost:5173/1c49c8ba-…"
}
```

Confirmed: the export mechanism **works** (622-byte JSON, correct MIME type, correct download attribute, client-side blob URL — consistent with the zero-backend privacy claim), and the filename shows the `unknown-session` fallback because no session was ever started. The payload contains no events.

### 19.5 Environment and isolation observations

| Property                                                                           | Observed                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `crossOriginIsolated`                                                              | `true`                                      |
| `Cross-Origin-Opener-Policy`                                                       | `same-origin` (from `vite.config.ts:22-25`) |
| `Cross-Origin-Embedder-Policy`                                                     | `require-corp`                              |
| Service worker registrations                                                       | 0                                           |
| `localStorage` / `sessionStorage` keys                                             | `[]` / `[]`                                 |
| DOM nodes (Analytics, 50 rows)                                                     | 583                                         |
| `data-aui-component` / `data-aui-action` / `data-aui-task-role` / `data-trackable` | 6 / 5 / 0 / **0**                           |
| Elements with an applied adaptation                                                | 0                                           |

**Assessment for §19:** the testbed UI renders correctly and its DOM annotation contract is consistent; the runtime research pipeline is entirely inert; and the only diagnostic that suggests otherwise (`provider: webgpu (GPU: true)`) is misleading.

---

## 20. Performance Measurements

**Only directly observed values are reported.** Where a target requirement was not measured, the value is `NOT MEASURED`.

### 20.1 Measured in this audit

| Measurement                                                      | Value                                             | Method / caveat                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest suite wall-clock                                          | 14.29 s (22 files, 149 tests)                     | `npx vitest run --reporter=dot`; jsdom creation accounted for 67.86 s of aggregate environment time, 81 % of tracked time                                                                                                         |
| Vitest environment overhead                                      | 81 % of tracked time; jsdom instantiated 22 times | The suite is **environment-bound**, not compute-bound. Any assertion about feature-extraction cost cannot be drawn from these durations.                                                                                          |
| TypeScript check                                                 | exit 0, no diagnostics                            | `npx tsc --noEmit`                                                                                                                                                                                                                |
| Dev server cold start                                            | 985 ms                                            | Vite 8.2.2, first run                                                                                                                                                                                                             |
| `requestAnimationFrame` rate (idle Analytics view, 1.5 s sample) | **61 FPS**                                        | Measured in the live page. This is the _baseline UI_ frame rate with the research pipeline inactive; it says nothing about pipeline cost.                                                                                         |
| JS heap in use                                                   | **11.25 MB** used / 18.85 MB total                | `performance.memory` in the live page, after load and interaction. Headless Chrome; not comparable to a native browser profile and not a proxy for the 20 MB _active framework_ budget because the framework is largely inactive. |
| DOM size                                                         | 583 nodes; 50 table rows                          | `document.getElementsByTagName('*').length`                                                                                                                                                                                       |
| Trace export payload                                             | 622 bytes JSON (empty)                            | Blob interception                                                                                                                                                                                                                 |

### 20.2 Artifact sizes (pre-existing build output — not re-measured)

These figures come from the checked-in `dist/` directory dated 2026-09-18, i.e. a **prior** build. No fresh `npm run build` was executed (§2).

| Artifact                                                | Bytes                       | Notes                                                                                             |
| ------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `dist/assets/index-Bj7QX16H.js`                         | 230 779                     | React app + debug panel; adaptive pipeline tree-shaken out                                        |
| `dist/assets/onnx.worker-CPel4ptk.js`                   | 400 243                     | ONNX worker bundle                                                                                |
| `dist/assets/ort-wasm-simd-threaded.jsep-DC5y_g6C.wasm` | 26 827 543                  | **26.8 MB** — ONNX Runtime Web WASM/JSEP binary                                                   |
| `dist/assets/wasm_vectorizer_bg-CP60W7kk.wasm`          | 91 937                      | Rust PrefixSpan/vectorizer WASM (matches `wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm`, 91 937 B) |
| `dist/assets/wasm.worker-B8V4HCJr.js`                   | 9 457                       |                                                                                                   |
| `dist/assets/index-CEYG-w_0.css`                        | 9 047                       |                                                                                                   |
| `dist/` total                                           | **27 584 026 B ≈ 26.31 MB** |                                                                                                   |

Serving-side facts: `src/workers/onnx-gate/model_int8.onnx` is **47 435 B**; `wasm-vectorizer/pkg/wasm_vectorizer.js` is **20 341 B**.

### 20.3 Requirement-by-requirement status

| Requirement (from `AGENTS.md:19-26` / `model-preparation` P8)                                                          | Status                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model artifact ≤ 200 KB                                                                                                | **47 435 B — MET** for the single shipped ONNX file                                                                                                                                                                                               |
| WASM + model combined < 500 KB                                                                                         | **NOT MET** on the current build: 26.31 MB total `dist/`, dominated by ORT's WASM runtime. Reaching this would require a non-JSEP/threaded ORT build or dropping ORT in favour of a hand-written GRU. **Not investigated further in this audit.** |
| Active memory ≤ 20 MB                                                                                                  | `NOT MEASURED` — the 11.25 MB heap reading is for an application whose framework is inactive, so it does not test this requirement                                                                                                                |
| Inference latency < 50 ms                                                                                              | `NOT MEASURED` — no model executes. No claim is made.                                                                                                                                                                                             |
| Total Blocking Time < 50 ms                                                                                            | `NOT MEASURED` — no long-task profiling performed                                                                                                                                                                                                 |
| 60 FPS                                                                                                                 | 61 FPS observed for the **static UI**; `NOT MEASURED` under live pipeline load                                                                                                                                                                    |
| Event-handling cost, window-construction time, worker dispatch latency, DOM mutation cost, memory growth during a task | `NOT MEASURED` — none of these paths execute in the running app                                                                                                                                                                                   |

**Explicit non-claims.** No inference latency, quantisation speedup, WebGPU acceleration, or memory-budget conformance is asserted anywhere in this report, because none was measured.

---

## 21. Privacy / Data Lifecycle

Actual lifecycle, traced from source:

```
raw DOM event
   ↓  TelemetryObserver listener (main thread)  — no persistence
   ↓  BehaviourEvent (monotonic ts, normalised coords, component ids)
   ├─ observer.emit() → listeners                        [no buffer, no disk]
   └─ RollingWindowBuffer.push()                         [bounded, in memory]
        ├─ capacity: max 2 000 events (window.ts:48, :60-62)
        ├─ retention: events older than 5 000 ms evicted (window.ts:47, :99-100)
        └─ tick() → computeWindowMicroTensor() → MicroTensorWindow
                └─ ExperimentRecorder.recordMicroTensor()   [in memory, capacity 10 000]
   ↓  RuntimeWorkerClient.pushWindow(window)  → postMessage with transferable ArrayBuffer
   ↓  worker: SequenceBuilder (FIFO, T = 8 windows)
   ↓  gate inference (no network)
   ↓  disposal: buffers overwritten by FIFO eviction; page unload discards all memory
```

### 21.1 Findings

| Question                                               | Finding                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Are raw coordinates persisted?                         | **In memory only, and only in the legacy path.** `ClientBehaviorTracker.pointBuffer` holds `{x, y, timestamp}` in raw client pixels (`ClientBehaviorTracker.ts:68-72`) and is purged on every `flush()` (`:304-310`). The adaptive observer stores nothing: it derives normalised `BehaviourEvent`s and emits them synchronously (`observer.ts:116-124`). | code read; live `localStorage`/`sessionStorage` both empty          |
| Does telemetry leave the browser?                      | **No.** No `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon` call exists in `src/`. Workers communicate only with the main thread via `postMessage`. The trace export is a client-side `Blob` + `URL.createObjectURL` (`recorder.ts:187-213`).                                                                                                            | grep of `src/`; blob URL observed as `blob:http://localhost:5173/…` |
| Is local storage used?                                 | **No.** Zero `localStorage`/`sessionStorage`/`indexedDB` references in `src/`; live key lists are empty.                                                                                                                                                                                                                                                  | grep; browser check                                                 |
| Do logs contain sensitive interaction data?            | **No, and this is a defect for a different reason.** The only console output is four startup lines (worker/gate readiness). No event, coordinate, or identifier is logged, which also means there is no diagnostic trail for the telemetry pipeline.                                                                                                      | live console capture                                                |
| Are buffers explicitly cleared?                        | Yes where implemented: `ClientBehaviorTracker.flush()` (`:304-310`) and `destroy()` (`:337-341`); `RollingWindowBuffer.clear()` (`:204-207`); `MacroInteractionStream.clear()` (`:105-107`); `ExperimentRecorder.clear()` (`:225-231`); `UIActuator.reset()` (`:137-150`); `SequenceBuilder.clear()` (`:53`).                                             | code read                                                           |
| Can data survive a page reload?                        | **No.** Everything is in-memory; there is no persistence layer. A reload discards the entire trace, including any un-exported data.                                                                                                                                                                                                                       | code read                                                           |
| Do experiment logs contain raw or derived information? | **Derived only.** `SerializableExperimentTrace` carries `BehaviourEvent`s (normalised `x`/`y`, component ids) and 18-D tensors — never raw pixel coordinates. The legacy `pointBuffer` is never exported.                                                                                                                                                 | `traceSchema.ts:39-50`, `recorder.ts:157-173`                       |

### 21.2 Explicitly not claimed

- No claim of "mathematical privacy guarantees" is made or implied. Buffer deletion and FIFO eviction reduce **retention duration and memory footprint**; they do not guarantee non-recoverability, and none of them constitute a privacy mechanism against same-origin script, browser extensions, or a memory dump.
- No claim of anonymisation is made. `SessionManager.generateAnonymousSessionId()` produces a UUID v4 with no PII (`session.ts:21-31`) — verified as a design property of the generator, but the trace also contains component ids, route names, and precise timing, which together are potentially re-identifying.
- The **absence of any data-export affordance in the research path** is itself the larger practical gap: because the pipeline never runs, no participant data of any kind is currently collected, so the privacy question is currently moot and will become live the moment the pipeline is wired (P1).

---

## 22. Research Validity Assessment

Classified against the research objective: _a lightweight framework for behavioural pattern extraction and adaptive UI recommendation on the web._

| Dimension                          | Classification      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Behavioural pattern extraction** | **PARTIALLY READY** | The math is complete and parity-verified: 9 kinematics per window, 8-bin entropy, angular hesitation > 45°, capability masks (`features.ts:43-236`; `parity.test.ts` green at `1e-4`). Windowing and macro vocabulary exist. **But no pattern is extracted at runtime**: the observer is not started, `tick()` is never called, and the macro stream never receives an event. Inactivity produces no window at all (§9.2), and boundary events are double-counted (§9.2). |
| **Target-domain adaptation**       | **NOT READY**       | Association of a pattern with a concrete UI state requires observed outcomes and task/condition identity. `OutcomeEvent` has no producer; `taskId` is always `null`; there is no `conditionId` and no `window_id`. The UI also lacks the affordances to generate `FORM_SUBMIT`, `BACKTRACK`, and `ABANDON` (§5.3).                                                                                                                                                        |
| **Recommendation / intervention**  | **PARTIALLY READY** | This is the strongest dimension. A model recommendation maps to a concrete, declared, reversible, accessible UI change for all five interventions (`intervention/types.ts`, `policy.ts`, `actuator.ts`; 262 lines of actuator tests). **But nothing drives it**: the engine, policy, and actuator are never instantiated by the application, and no `InterventionCommand` is ever produced at runtime.                                                                    |
| **Edge execution**                 | **PARTIALLY READY** | The architecture is genuinely edge-shaped: dedicated workers, transferable `ArrayBuffer`s, typed RPC, a proven `new Worker(new URL(...))` build pattern, COOP/COEP configured and observed (`crossOriginIsolated: true`), and a real Rust/WASM gate that loads. **Not ready** because no model executes: the ONNX graph does not match the runtime tensor (§18 of the brief → §15 here), the graph is not loaded, and the always-used inference path is a heuristic.      |
| **Experimental validation**        | **NOT READY**       | No baseline condition, no condition identifier, no task start/reset from the UI, non-deterministic stimuli (`tableData.ts:25`), no `experiment_id`/`session_id` in practice, and `metadata.durationMs` is computed across two incompatible clocks (§16.4). Adaptive-vs-non-adaptive comparison is not currently possible.                                                                                                                                                 |

**Overall:** the framework demonstrates a sound and mostly well-tested _component_ architecture with an unusually clean model→policy→actuator separation and genuine non-destructive actuation. It does not yet demonstrate an _observable, reproducible, controllable, and measurable_ behavioural-to-adaptation experiment, which is the standard the brief sets.

---

## 23. Readiness Matrix

| Area                      | Current implementation                                                                                                                                                       | Evidence                                                                                                              | Status                  | Blocking?       | Recommended action                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Target UI**             | 5 views, 1 substantive; nav, KPIs, filter drawer, 50-row table, 2 tooltips, 2 primary actions; consistent `data-aui-*` annotations                                           | `App.tsx`, `Navigation.tsx`, `FilterDrawer.tsx`, `ResultsTable.tsx`; live DOM: 6 components / 5 actions / 0 trackable | `PARTIALLY READY`       | No              | Add reset-filters, pagination/sort, and a report-open surface so the declared macro vocabulary is reachable (§10.2) |
| **Task workflows**        | T1–T3 defined; `recordInteraction` has no production caller; no UI control starts a task                                                                                     | `taskModel.ts:28-59`, `taskManager.ts:50-73`; live `taskControls: []`                                                 | `NOT READY`             | **Yes (P0)**    | Wire `TaskManager` to a task control and to the telemetry stream; emit start/step/complete/error/reset              |
| **Telemetry**             | Observer complete, well-cleaned, unthrottled by default; no buffering; **never started**                                                                                     | `observer.ts:40-323`; bundle search; DebugPanel `B:0`                                                                 | `IMPLEMENTED, UNWIRED`  | **Yes (P0)**    | Compose and start observer + window + macro stream in the app entry point                                           |
| **MicroTensor**           | 18-D feature order, scales, mask semantics, `[X⊙M, M]` layout all match Python; parity tests green                                                                           | `features.ts:43-236`, `parity.test.ts`                                                                                | `READY WITH CONDITIONS` | No              | Fix D2 (scroll-depth semantics); expose feature-name metadata; regenerate fixtures from Python in CI                |
| **Windowing**             | 500/250 implemented in two paths; inclusive upper bound duplicates boundary events; inactivity yields no window; no viewport/document passed in the live path                | `window.ts:73-172`; `features.ts:47-48`; `preprocessing.py:511-530`                                                   | `PARTIALLY READY`       | **Yes (P0)**    | Emit windows on a monotonic schedule, use half-open intervals, pass geometry explicitly                             |
| **Macro events**          | 30-symbol closed taxonomy; capability-driven identity finer than `CLICK`; 7 symbols unreachable; substring collision risk                                                    | `symbols.ts:9-147`; live DOM checks                                                                                   | `READY WITH CONDITIONS` | No              | Prune or implement dead symbols; add collision tests; add experiment/participant/session grouping                   |
| **PrefixSpan interface**  | Real Rust PrefixSpan compiled and **loaded**; `MockFastGate` is what arbitration uses; miner not connected to arbitration                                                    | `wasm.worker.ts:88-101`; console log; `runtime/worker.ts:51-53`                                                       | `PARTIALLY READY`       | No              | Adapt mined patterns into `FastGate` registrations                                                                  |
| **Outcome events**        | Schema + `OUTCOME_TAXONOMY` + recorder method exist; **no producer**; no `session_id`/`interaction_id`/`context` on the event                                                | `events.ts:68-83`; `recorder.ts:92` (no production caller)                                                            | `NOT READY`             | **Yes (P0)**    | Implement an outcome deriver over the live event stream and record it                                               |
| **UI context**            | Route, active component/role, task/step, available actions, 3 feasibility flags                                                                                              | `contextProvider.ts:62-181`; live values                                                                              | `READY WITH CONDITIONS` | No              | Add viewport, scroll state, condition id, UI version                                                                |
| **Intervention taxonomy** | All 5 declared; 4 actuated; `no_op` trivial; validator strict                                                                                                                | `intervention/types.ts:15-161`                                                                                        | `READY`                 | No              | —                                                                                                                   |
| **Policy layer**          | Confidence 0.75, 2-window persistence, context eligibility, task-switch reset, `no_op` fallback; no cooldown/TTL/user-override feedback                                      | `policy.ts:37-222`; 210 lines of tests                                                                                | `READY WITH CONDITIONS` | No              | Add cooldown + TTL enforcement; consume `dismissed` as negative feedback                                            |
| **Actuator**              | 4 non-destructive adaptations, exact-attribute restoration, focus preservation, ARIA, Esc dismissal, tested                                                                  | `actuator.ts:34-465`; `actuator.test.ts:46-262`                                                                       | `READY`                 | No              | Escape `targetComponentId` before selector interpolation                                                            |
| **Worker boundary**       | Typed messages, transferable buffers, timeouts, in-memory fallback; adaptive client has zero production callers                                                              | `runtime/{messages,worker,workerClient}.ts`                                                                           | `PARTIALLY READY`       | No              | Wire it; assert which mode (worker vs fallback) is active in benchmarks                                             |
| **Model integration**     | `SlowGate` interface clean; shipped graph expects 9 features / emits 6; runtime produces `(1,8,18)`; graph never loaded; context vector unbuilt                              | ONNX introspection; `pipeline.ts:49`; `onnx.worker.ts:41`, `:204`; `training.py:93-118`                               | `NOT READY`             | **Yes (P0/P2)** | Re-export the current 18-D/7-class graph; load it; encode `UIContext` → `R^6`                                       |
| **Experiment trace**      | Schema, validator, replay, JSON export and client-side download work; no experiment/condition/window/prediction ids; session and task unpopulated; `durationMs` mixes clocks | `traceSchema.ts`, `recorder.ts:109-213`; live export 622 B, `unknown-session`                                         | `PARTIALLY READY`       | **Yes (P0)**    | Add the five required correlation ids; fix clock; start a session                                                   |
| **Baseline condition**    | Gate-level enable flags exist; no application-level condition switch; no condition id                                                                                        | `arbitration.ts:134-148`; `session.ts:9-13`                                                                           | `NOT READY`             | **Yes (P0)**    | Gate `UIActuator.apply` on a condition flag while telemetry stays on                                                |
| **Testing**               | 22 files / 149 tests pass; `tsc` clean; strong unit + actuator coverage; no browser test; composition untested; one test writes a tracked file                               | vitest output; §18                                                                                                    | `READY WITH CONDITIONS` | No              | Add a composed-pipeline integration test and a browser smoke test; harden `sync_config.test.ts`                     |
| **Performance**           | 61 FPS idle, 11.25 MB heap, 985 ms dev cold start measured; all budget requirements unmeasured; `dist` 26.31 MB                                                              | §20                                                                                                                   | `NOT MEASURED`          | No              | Profile with the pipeline live; decide on the ORT payload                                                           |
| **Privacy**               | No network egress, no storage, in-memory only, FIFO-bounded, derived-only logs, client-side export                                                                           | §21; grep; live storage/inspection                                                                                    | `READY WITH CONDITIONS` | No              | Document the lifecycle; the gap is that nothing is collected at all                                                 |

---

## 24. Blocking Issues

**B1 — The adaptive pipeline is never started.**
_Evidence:_ `src/main.tsx:5,15-24` boots only `EdgeAUIFramework`. Production importers exist only for barrels. Bundle search: `RollingWindowBuffer`, `MacroInteractionStream`, `NAV_ANALYTICS`, `InferenceResult`, `edge-aui-highlight` all absent from `dist/assets/index-Bj7QX16H.js`. Live DebugPanel: `Session: No Active Session`, `Worker Runtime: uninitialized`, `Macro Sequence: No macro events`, `Buffered Events: 0`.
_Blocks:_ every downstream requirement — telemetry, MicroTensor, macro, outcomes, trace, policy, actuation.

**B2 — No runtime producer of `OutcomeEvent`.**
_Evidence:_ `ExperimentRecorder.recordOutcome` (`recorder.ts:92`) has no production caller; grep across `src/` returns only the declaration.
_Blocks:_ supervised target construction, model-preparation framing, any outcome-based evaluation.

**B3 — The booted ONNX path is a heuristic and its model is incompatible.**
_Evidence:_ `pipeline.ts:49` `onnxModelUrl: ''` → `onnx.worker.ts:41` skips creation → `:204` always calls `inferLatentCognitiveState`. Graph introspection: input `(1, batch_size, seq_len, 9)`, output `(1, batch_size, 6)`; runtime produces `(1,8,18)`; `training.py` defines 18-D input, 7 classes. Console reports `provider: webgpu (GPU: true)` from the fallback branch (`:66`).
_Blocks:_ Slow Gate integration, edge-inference claims, ONNX/quantisation evaluation.

**B4 — Tasks cannot be driven or observed.**
_Evidence:_ `taskManager.recordInteraction` has no production caller; no task control in the live DOM; `TaskState` is permanently `Idle`.
_Blocks:_ task segmentation, per-task outcomes, controlled task-based experiments, baseline reproduction.

**B5 — No experiment/condition identity or correlation ids in the trace.**
_Evidence:_ no `experimentId`, `conditionId`, `windowId`, `predictionId`, or `interventionEpisodeId` in `SessionContext`, `UIContext`, or `ExperimentTrace`.
_Blocks:_ baseline/adaptive comparison, pooled analysis, prediction-level evaluation, reproducibility.

**Non-blocking but validity-threatening (P1)**: window boundary double-counting and inactivity producing no window (§9); scroll-depth semantic divergence (D2); non-deterministic table data; `durationMs` clock mixing; `data-trackable` vs `data-aui-*` selector mismatch; 7 unreachable macro symbols; no cooldown/TTL in policy; `sync_config.test.ts` writing a tracked file.

---

## 25. Recommended Next Steps

Format per the brief: _Problem / Evidence / Why it matters / Proposed implementation / Affected files / Dependencies / Verification._

### P0 — Blocking model/testbed integration

**P0-1 — Compose and start the adaptive pipeline.**

- **Problem:** the research pipeline never runs (B1).
- **Evidence:** §4.2, §19.3.
- **Why it matters:** without it there is no telemetry, no MicroTensor, no macro sequence, no outcome, and no trace — every other requirement is unreachable.
- **Proposed implementation:** create a single `AdaptiveRuntime` composition module that owns one `TelemetryObserver`, one `RollingWindowBuffer`, one `MacroInteractionStream`, one `RuntimeWorkerClient`, one `InterventionPolicy`, one `UIActuator`, and the shared `experimentRecorder`; start it from the app shell on mount and stop it on unmount. Start a `sessionManager` session at the same moment. Keep the legacy `EdgeAUIFramework` untouched or remove its boot from `main.tsx`.
- **Affected files:** `src/main.tsx`, new `src/runtime/adaptiveRuntime.ts` (or equivalent), `src/app/App.tsx`, `src/telemetry/observer.ts` (subscription only), `src/microtensor/window.ts` (drive `tick`).
- **Dependencies:** none.
- **Verification:** DebugPanel shows a session id, a live macro sequence, non-zero `T:` counts, and a non-zero 18-D tensor after interacting with the UI; a browser smoke test asserts those counters are non-zero.

**P0-2 — Emit windows on a monotonic schedule with half-open intervals and explicit geometry.**

- **Problem:** inactivity produces no window; boundary events are double-counted; geometry falls back to `{1920, 3000}` (§9, D1, D5).
- **Evidence:** `window.ts:73-76`, `:93`, `:149`; `features.ts:47-48`.
- **Why it matters:** silence and hesitation — the behavioural states the Slow Gate most needs — are either unrepresented or feature-distorted; feature values diverge from the training distribution.
- **Proposed implementation:** drive `tick()` from a monotonic timer (in addition to event arrival) so windows are emitted during inactivity; change both selection predicates to `>= windowStart && < windowEnd`; thread `viewport` and `document` from a single geometry source into `computeWindowMicroTensor` on the live path; make an all-zero window carry a distinguishable "no input" signal rather than relying on the capability mask alone.
- **Affected files:** `src/microtensor/window.ts`, `src/microtensor/features.ts`, `src/microtensor/schema.ts` (if a `windowId`/`activity` field is added), `src/telemetry/observer.ts` (geometry handoff).
- **Dependencies:** P0-1.
- **Verification:** new windowing tests for boundary exclusivity, inactivity emission, and explicit geometry; a parity scenario covering a sparse/inactive window.

**P0-3 — Implement runtime outcome derivation.**

- **Problem:** nothing produces `OutcomeEvent` (B2).
- **Evidence:** `recorder.ts:92` has no production caller.
- **Why it matters:** the target environment must supply observable ground truth independently of model prediction; the whole model-preparation target-generation contract depends on it.
- **Proposed implementation:** port the deterministic policy from `model-preparation/src/target_generation.py:76-289` into a TypeScript `deriveOutcome(windowEndMs, futureEvents, sessionTerminated)` with the same lookahead horizon `[+500 ms, +1500 ms]`, the same early-event-wins rule, and the same tie-breaking hierarchy; extend `OutcomeEvent` with `sessionId`, `windowId`, `sourceEventTimestamp`, and the `UIContext` snapshot; call `recordOutcome` from the runtime composition after each window.
- **Affected files:** new `src/outcome/derive.ts`, `src/telemetry/events.ts`, `src/telemetry/recorder.ts`, `src/runtime/adaptiveRuntime.ts`.
- **Dependencies:** P0-1, P0-2 (window ids).
- **Verification:** unit tests replicating the Python cases (earliest-event selection, 1 ms tie tolerance, `ABANDON` requiring a lifecycle event or stream termination, `NO_OUTCOME` otherwise); an integration test asserting one outcome per emitted window.

**P0-4 — Wire the task model and add the experimental condition switch.**

- **Problem:** tasks are inert (B4); no baseline condition (B5, §17).
- **Evidence:** `taskManager.ts:50-73`; live `taskControls: []`; `session.ts:9-13`.
- **Why it matters:** without task identity there are no task-level outcomes; without a condition switch, adaptive-vs-baseline comparison — the core experiment — is impossible.
- **Proposed implementation:** add a task control surface that calls `startTask`/`resetTask` and a subscriber that forwards `BehaviourEvent`s into `taskManager.recordInteraction(componentId, action)`; reset `UIActuator` and `InterventionPolicy` on task change; add `conditionId: 'baseline' | 'adaptive'` to `SessionContext`, propagate into `UIContext`, and gate only `UIActuator.apply` on it so telemetry keeps running in the baseline; make the table dataset deterministic (fixed seed or a static fixture).
- **Affected files:** `src/testbed/tasks/taskManager.ts`, `src/testbed/components/*`, `src/telemetry/session.ts`, `src/telemetry/contextProvider.ts`, `src/runtime/adaptiveRuntime.ts`, `src/testbed/mock-data/tableData.ts`.
- **Dependencies:** P0-1.
- **Verification:** tests that drive T1 to completion through the real observer stream in both conditions; a test asserting `conditionId === 'baseline'` records telemetry with zero actuator DOM changes.

**P0-5 — Add the correlation identifiers and fix trace identity/clock defects.**

- **Problem:** no `experimentId`/`conditionId`/`windowId`/`predictionId`; session and task always empty; `durationMs` mixes `performance.now()` with `Date.now()`; trace exports as `unknown-session` (§16).
- **Evidence:** `traceSchema.ts:39-50`; `recorder.ts:110-137`, `:197-199`; live filename.
- **Why it matters:** a trace that cannot be attributed to an experiment, condition, session, task, or window cannot support reproducible evaluation.
- **Proposed implementation:** add `experimentId`, `conditionId`, `windowId`, `predictionId`, and `interventionEpisodeId`; start a session at runtime composition; record the epoch offset once so monotonic event times can be converted; compute `durationMs` from a single clock; log a prediction record per evaluation.
- **Affected files:** `src/telemetry/traceSchema.ts`, `src/telemetry/recorder.ts`, `src/telemetry/session.ts`, `src/runtime/adaptiveRuntime.ts`.
- **Dependencies:** P0-1.
- **Verification:** a schema validation test asserting every recorded element carries non-empty ids; a test asserting `metadata.durationMs` is plausible for a known elapsed interval.

### P1 — Required for reliable experimentation

- **P1-1 Fix the scroll-depth semantic divergence (D2).** Runtime prefers the last normalised `scrollY` (`features.ts:208-214`); Python computes `count × 80 / (docH − vpH)` (`preprocessing.py:450-451`). _Verification:_ a parity scenario where the two formulas differ.
- **P1-2 Regenerate parity fixtures from `model-preparation` in CI.** Fixtures are static JSON (§8.3). _Verification:_ a script that runs the Python reference and fails on drift beyond `1e-4`.
- **P1-3 Reconcile the outcome vocabularies.** Three exist: 7 outcome classes (testbed/Python), 5 latent cognitive labels (legacy worker), 6 graph logits. _Verification:_ one vocabulary constant consumed by both the testbed and the worker.
- **P1-4 Add cooldown, TTL enforcement, and dismissal feedback to policy/actuator.** `ttlMs` is validated but unread; dismissal is emitted but unconsumed (`types.ts:149-151`, `actuator.ts:435-445`). _Verification:_ tests for TTL expiry, cooldown suppression, and re-issue suppression after dismissal.
- **P1-5 Escape `targetComponentId` before selector interpolation.** `actuator.ts:185-187`, `:297-299`.
- **P1-6 Make `sync_config.test.ts` hermetic.** It writes `src/config/pipelineConfig.json` during `npm test`; measured idempotent today but not isolated. _Verification:_ test writes to a temp path (`syncConfig({ outputPath })` already supports this).
- **P1-7 Add a composed-pipeline integration test.** The production composition is never assembled in any test (§18.3). _Verification:_ one test that constructs the runtime composition with the in-memory worker fallback and asserts a full event → window → macro → outcome → trace path.
- **P1-8 Add a browser smoke test.** No browser test exists. _Verification:_ Playwright/Cypress asserting rendered routes, filter interaction, and non-zero DebugPanel counters.
- **P1-9 Reconcile the legacy trackable selector or delete the legacy path.** `[data-trackable]` matches nothing in the testbed UI (§4.3, live DOM count 0).
- **P1-10 Complete Task 12.1 documentation.** `docs/data_schemas.md` (38 lines) documents only the legacy schema; `docs/project_architecture.md` (24 lines) describes `SlidingWindowBuffer` which is unused. _Verification:_ documentation review against `src/`.

### P2 — Required for final edge/runtime evaluation

- **P2-1 Re-export the ONNX graph from the current architecture.** 18-D input, 7 outcome classes, `HIDDEN_DIM 64`, `NUM_LAYERS 2` (`training.py:60-63`, `export.py:67-106`). _Verification:_ graph introspection asserts input `(1, batch_size, seq_len, 18)` and output `(1, batch_size, 7)`.
- **P2-2 Build the `UIContext` → `R^6` encoding the target head requires.** `training.py:93-118` declares a `context_dim=6` tensor as mandatory. _Verification:_ a documented encoding plus a round-trip test.
- **P2-3 Implement a real `OnnxSlowGate` behind the existing `SlowGate` interface**, loading the model in the adaptive runtime worker with WebGPU→WASM→CPU fallback. _Verification:_ a test asserting `modelLoaded === true` and that a `(1,8,18)` input produces 7 probabilities.
- **P2-4 Stop labelling an unloaded model as `webgpu`.** Report `heuristic` unless a session actually exists (`onnx.worker.ts:66-73`); deduplicate the double init log (`OnnxGateClient.ts:24` + `pipeline.ts:65`).
- **P2-5 Instrument and measure the budgets.** Event-handling cost, window construction, worker dispatch, main-thread blocking, memory growth over a task, and inference latency are all `NOT MEASURED`. Also decide the ORT payload question: `ort-wasm-simd-threaded.jsep*.wasm` alone is 26.8 MB against a 500 KB combined target.
- **P2-6 Remove the main-thread import of the worker core.** `workerClient.ts:18` pulls `RuntimeWorkerCore` (and therefore the gates) into the main bundle; keep the fallback behind a dynamic import.

### P3 — Improvements / polish

- Prune or implement the 7 unreachable macro symbols; add identity-collision tests for substring matching (`symbols.ts:76-107`).
- Add `wheel`, `focus`, `blur`, `beforeunload` listeners to the observer if the outcome taxonomy needs them (`target_generation.py:163-180` treats `blur`/`popstate` as `BACKTRACK` and lifecycle events as `ABANDON`).
- Persist feature-name metadata alongside the tensor so index order is self-describing.
- Make `DebugPanel`'s `helpAvailable`/`expandable` flags reflect real assistance surfaces rather than two `title` spans.
- Remove `src/main.ts`, `src/counter.ts`, and the unused `SlidingWindowBuffer.ts`, or document them as legacy.
- Deduplicate `src/types/index.ts` and `src/telemetry/index.ts` re-exporting `contextProvider` twice.

---

## 26. Proposed Implementation Sequence

The brief's proposed sequence is dependency-correct in outline but assumes the pipeline is already composed. Repository evidence shows a missing layer _before_ step 3: nothing is emitted at all. The revised sequence inserts composition and outcome generation, and reorders the model work to follow the contract work rather than precede it.

```text
0. Compose and start the adaptive runtime                     [P0-1]  ← NEW, must come first
        ↓
1. Window emission: monotonic schedule, half-open, geometry   [P0-2]
        ↓
2. Telemetry contracts: geometry on events, selector fix      [P1-1, P1-9]
        ↓
3. MicroTensor output stabilized + parity fixtures in CI      [P1-2]
        ↓
4. Macro interaction output live (stream + worker ingest)     [P0-1, P1-3]
        ↓
5. OutcomeEvent derivation + UIContext extension             [P0-3]
        ↓
6. Task model wired + experiment/condition + correlation ids  [P0-4, P0-5]
        ↓
7. Experiment trace complete and reproducible                 [P0-5]
        ↓
8. Deterministic Fast Gate interface (WASM patterns → gate)   [non-blocking]
        ↓
9. Intervention policy hardening: cooldown, TTL, dismissal    [P1-4]
        ↓
10. Actuator applied in production; selector escaping         [P1-5]
        ↓
11. Real model integration: re-export 18-D/7-class graph      [P2-1]
        ↓
12. Context vector encoding + Target head                     [P2-2, P2-3]
        ↓
13. Slow Gate integrated behind the existing interface         [P2-3]
        ↓
14. Edge inference decisions: ORT payload, provider honesty    [P2-4, P2-5, P2-6]
        ↓
15. Benchmarks with the pipeline live (all budgets)            [P2-5]
        ↓
16. Controlled UI evaluation (baseline vs adaptive)            [P0-4]
```

**Why this ordering differs from the brief.** The brief places "stabilize target UI/task state" first and "add model integration interface" at step 8. The evidence supports a different dependency structure:

- _Composition is the true root dependency._ Every later item — MicroTensor output, macro output, outcomes, trace, policy, actuation — is currently unobservable because nothing is composed or started. No stabilization work on the individual modules can be _verified_ until the pipeline runs end-to-end, so composition moves to step 0.
- _Task/condition identity must precede experiment trace._ Correlation ids are properties of the trace, and the trace is only meaningful once task and condition identity exist. The brief's step 6 (experiment trace) therefore moves after task/condition wiring.
- _Outcome generation must precede model integration._ The model's supervised target is derived from observed outcomes. Integrating a model against a non-existent target signal is unverifiable, so outcome derivation moves ahead of steps 11–13.
- _The model interface already exists._ `FastGate`/`SlowGate`/`AdaptiveInferenceEngine`/`InterventionCommand` are implemented and tested; "add model integration interface" is not outstanding work. What is outstanding is _loading a compatible graph_ and _encoding UI context_ — so those move to P2, after the contract work, matching the priority classes in §25.
- _Policy/actuator hardening is not blocking._ Both are implemented and tested; only TTL/cooldown/dismissal semantics are missing. Moved after the P0 blockers.

---

## 27. Known Limitations

### Mock and placeholder components

- `MockFastGate` (`gates/fast/mockFastGate.ts`) — deterministic suffix/exact matcher standing in for PrefixSpan-driven arbitration. The real Rust PrefixSpan exists and loads (`wasm.worker.ts:88-101`, console log) but is not wired to arbitration.
- `MockSlowGate` (`gates/slow/mockSlowGate.ts`) — returns a fixed `HOVER_DWELL` outcome at `confidence 0.85` by default; the ONNX worker's heuristic (`onnx.worker.ts:80-172`) is a second, independent mock with a different vocabulary.
- `src/workers/onnx-gate/model_int8.onnx` — incompatible (9 features in, 6 logits out) and never loaded.
- `src/testbed/mock-data/tableData.ts` — 50 rows generated with `Math.random()` at module load; not seeded, not static.
- `src/debug/debugBus.ts` — a functional pub/sub with no production publisher; the DebugPanel's gate/latency/tensor sections are structurally incapable of showing data today.
- `src/main.ts` — a 296-line legacy sandbox harness that is not the Vite entry point.

### Assumptions made by this audit

- That `dist/` reflects a build of the current source. It is dated 2026-09-18 and was **not** rebuilt; bundle-derived statements are labelled as such and used only for tree-shaking evidence, which is robust to a small source delta.
- That the checked-in parity fixtures were originally produced by the Python reference (§8.3). This is inferred, not proven by any artifact in either repository.
- That `git status` observations from this session (`?? AGENT.target_testbed_QA.md`, `?? rebase.sh`, otherwise clean) represent the starting state, and that the audit added exactly one file.
- That a headless-Chrome FPS/heap reading is informative about the _static_ UI only, and says nothing about pipeline cost.

### Missing model integrations

- No foundation GRU, no target intervention head, no Slow Gate model, no `UIContext` → `R^6` encoding, no verified ONNX graph. `NOT INTEGRATED` across all four (see §15).

### Unresolved browser differences

- Only headless Chrome 153 on macOS was exercised. No Firefox, Safari, or WebKit run. WebGPU availability and the `performance.memory` reading are Chromium-specific.
- `navigator.gpu` was present and an adapter was obtained, but `navigator.gpu.requestAdapter()` is asynchronous and may fail on other hardware; the fallback path was not exercised in a GPU-less browser.
- The dev server supplies COOP/COEP (`crossOriginIsolated: true`); nothing verifies that the same headers exist in any deployed configuration, and the required threaded-WASM path depends on them.

### Telemetry limitations

- Observer default is **unthrottled** (`sampleIntervalMs = 0`); worst-case main-thread cost is `NOT MEASURED`.
- No `wheel`, `focus`, `blur`, `beforeunload`, or `unload` listeners, which limits `RAPID_SCROLL`, `BACKTRACK`, and `ABANDON` observability.
- `popstate`/`hashchange` are collapsed into `type: 'navigation'` (`observer.ts:315`), losing the distinction the model-preparation extractor uses for `BACKTRACK` (`target_generation.py:173`).
- Event timestamps are page-relative, not epoch.
- Inactivity produces no window at all.

### Schema mismatches

| Schema                | Issue                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `BehaviourEvent`      | `timestamp`/`type`/`x`/`y` vs Python `timestamp_ms`/`event_type`/`x_norm`/`y_norm`; no viewport/document geometry |
| `MicroTensorWindow`   | anonymous `Float32Array(18)` with implicit index meaning; no feature-name metadata; no window id                  |
| `OutcomeEvent`        | no `sessionId`, `windowId`, source-event back-reference, or context snapshot; no producer                         |
| `UIContext`           | no viewport, scroll state, condition id, or UI version; not encodable to the mandatory `R^6` context tensor       |
| `InterventionCommand` | `ttlMs` validated but unenforced; no cooldown/priority fields                                                     |
| `ExperimentTrace`     | no `experimentId`/`conditionId`/`predictionId`; `session` and `task` unpopulated; `durationMs` mixes clocks       |
| ONNX graph            | input `(1,batch,seq,9)` vs runtime `(1,8,18)`; output 6 vs 7 classes                                              |

### Experimental limitations

- No condition switch, no condition identifier, no `experimentId`.
- Tasks cannot be started, completed, failed, abandoned, or reset from the UI.
- Stimuli are non-deterministic across sessions.
- No participant identity, no counterbalancing, no randomisation mechanism.
- One participant per session with no session-to-condition assignment logic.
- The UI cannot generate `FORM_SUBMIT`, `BACKTRACK`, or `ABANDON` (no form element, no router, no abandonment affordance).

### Unmeasured performance requirements

`NOT MEASURED`: inference latency (<50 ms), total blocking time (<50 ms), active memory (<20 MB), event-handling cost, window-construction time, worker dispatch latency, main-thread blocking, memory growth during a task, DOM mutation cost, and combined WASM+model payload (<500 KB). Only 61 FPS idle, 11.25 MB heap, 985 ms dev cold start, and the pre-existing `dist` sizes were observed — the `dist` total (26.31 MB) makes the 500 KB budget look unattainable without an ORT payload decision.

### Future work

Everything in §25 P0–P3, and specifically: composition first, then windowing correctness, then outcome derivation, then task/condition/identity, then the real model.

---

## 28. Final Agent Report

### Repository changes

```text
files created:   1
  - docs/assessments/target-testbed-quality-assessment.md   (this report)

files modified:  0
files removed:   0
```

**Only the assessment document was created.** No production code, test, configuration, or documentation file in either repository was modified. Verified with `git status --short` in `edge-aui-framework` before and after every step; the only entries at the end are the pre-existing untracked `AGENT.target_testbed_QA.md` and `rebase.sh`, plus this report. `model-preparation` was read only. The `docs/assessments/` directory already existed (containing only `.DS_Store`) and was populated, not created.

The full test run regenerates `src/config/pipelineConfig.json` via the `pretest` hook; its SHA-256 was captured immediately before and after the suite and is identical (`1f62c5990b479e8735af593c2341ff14186655854528fb7cf9f31b412424c843`), so the audit left no content drift.

### Architecture

**UI → telemetry → MicroTensor**

- UI: `IMPLEMENTED`. `App.tsx`, `Navigation.tsx`, `FilterDrawer.tsx`, `KPICards.tsx`, `ResultsTable.tsx`, with a consistent `data-aui-*` semantic annotation contract.
- Telemetry: `IMPLEMENTED` but `UNWIRED`. `TelemetryObserver` captures 11 event types with a single monotonic clock, cached viewport, capability-derived masks, and complete listener cleanup — and is never instantiated by the application.
- MicroTensor: `IMPLEMENTED` but `UNWIRED`. `computeWindowMicroTensor` produces a mathematically correct, parity-verified 18-D `[X⊙M, M]` tensor — reached only from the also-unwired `RollingWindowBuffer`.
- Net: **partial/missing at runtime** — the UI renders, the telemetry module exists, and no tensor is produced.

**UI → macro sequence**

- Vocabulary: `IMPLEMENTED` (30 symbols, closed taxonomy, type guard). Identity is capability-driven and finer than `CLICK`.
- Stream: `IMPLEMENTED` but `UNWIRED` (`MacroInteractionStream`, bounded at 100, with a PrefixSpan-ready `string[]` projection).
- Net: **missing at runtime** — no macro token is ever produced by the running app; 7 declared symbols have no producing component.

**Fast Gate → Slow Gate**

- Interfaces and arbitration: `IMPLEMENTED`, correct, and defensively coded (`AdaptiveInferenceEngine` honours ADR-002 precedence and short-circuits only on a non-`no_op` match).
- Gate implementations: `MOCKED` (both). The real Rust PrefixSpan compiles, loads, and runs — but is connected only to the legacy on-demand mining path, never to arbitration.
- Net: **mock-only** — arbitration has never executed against a real model or the real miner.

**Inference → policy → actuator**

- Policy: `IMPLEMENTED` (confidence 0.75, 2-window persistence, context eligibility, task-switch reset, `no_op` fallback). `UNWIRED`.
- Actuator: `IMPLEMENTED` and the strongest component in the repository (four non-destructive adaptations, exact-attribute restoration, focus preservation, ARIA linkage, Esc dismissal, reset). `UNWIRED`.
- Separation of concerns between model output and DOM manipulation is genuine and enforced by types.
- Net: **implemented and tested, never driven** — no `InterventionCommand` is produced at runtime and no adaptation is applied outside tests.

### Schemas — observed current state

| Schema                                                                          | Status                                    | Observed definition                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BehaviourEvent`                                                                | `IMPLEMENTED`                             | `events.ts:24-44` — `timestamp, type, x?, y?, scrollX?, scrollY?, componentId?, componentRole?, route?, action?, taskId?, taskStepId?, targetTag?`; `type` is one of 12 values (`events.ts:6-18`)                                                                                                                         |
| `MicroTensor`                                                                   | `IMPLEMENTED`                             | `events.ts:49-53` — `MicroTensorWindow { windowStart, windowEnd, values: Float32Array }`, length 18 = 9 behavioural (`features.ts:218-228`) + 9 binary capability masks (`features.ts:230-234`), layout `[X⊙M, M]`                                                                                                        |
| `MacroInteraction`                                                              | `IMPLEMENTED`                             | `events.ts:58-63` — `timestamp, symbol, componentId?, action?`; symbol ∈ 30-value `MACRO_SYMBOLS` (`symbols.ts:9-47`)                                                                                                                                                                                                     |
| `UIContext`                                                                     | `IMPLEMENTED`                             | `types/telemetry.ts:141-151` — `route, activeComponentId?, componentRole?, taskId?, taskStepId?, availableActions[], primaryActionAvailable, helpAvailable, expandable`                                                                                                                                                   |
| `OutcomeEvent`                                                                  | `IMPLEMENTED (schema only — no producer)` | `events.ts:68-83` — `timestamp, outcome: OutcomeType, componentId?, taskId?, taskStepId?`; `OutcomeType` ∈ 7 values                                                                                                                                                                                                       |
| `InterventionCommand`                                                           | `IMPLEMENTED`                             | `intervention/types.ts:41-49` — `type, targetComponentId?, confidence?, source: 'fast'\|'slow'\|'rule', issuedAt, ttlMs?, reason?`; `InterventionType` ∈ 5 values (`:15-21`); `INTERVENTION_SCHEMA_VERSION = '1.0'`                                                                                                       |
| `ExperimentTrace`                                                               | `IMPLEMENTED`                             | `traceSchema.ts:39-50` — `schemaVersion ('1.0.0'), exportedAt, session, task?, metadata{10 fields}, behaviourEvents[], microTensors[] (values as number[]), macroInteractions[], outcomes[], interventions[]`                                                                                                             |
| `SerializableExperimentTrace` validator                                         | `IMPLEMENTED`                             | `traceSchema.ts:60-134`                                                                                                                                                                                                                                                                                                   |
| Foundation/target model I/O contract                                            | `PARTIALLY IMPLEMENTED`                   | Python: `(N, T, 18)` in, 7-class foundation head, `[h_T, C]` with mandatory `context_dim=6` for the target head (`training.py:60-118`). TypeScript: `SlowGateInput { sequence: Float32Array, shape: [1,T,18], context: UIContext }` (`slow/types.ts:10-15`). **The `UIContext` → `R^6` numeric encoding does not exist.** |
| ONNX deployment contract                                                        | **MISMATCHED**                            | Graph: input `(1, batch_size, seq_len, 9)`, output `(1, batch_size, 6)`, opset 17, 2×GRU + quantized MatMul. Runtime: `(1, 8, 18)`.                                                                                                                                                                                       |
| Experiment identity (`experimentId`, `conditionId`, `windowId`, `predictionId`) | **NOT IMPLEMENTED**                       | No such field anywhere in `src/`                                                                                                                                                                                                                                                                                          |

### Tests

```text
unit tests:        22 files / 149 tests — 149 passed, 0 failed
integration tests: 3 files (e2e_simulation, gate_arbitration, worker_runtime) — real modules, synthetic fixtures, no browser
component tests:   4 files (jsdom + Testing Library)
browser tests:     0  (no Playwright/Cypress configuration exists)
typecheck:         npx tsc --noEmit → exit 0, no diagnostics
total passed:      149 / 149
total failed:      0
duration:          14.29 s wall clock (environment 81%)
```

Reported results were observed by running the suite in this session; nothing is fabricated. Two caveats stated plainly: (a) `--reporter=basic` does not exist in vitest 5 and errors out, so the `dot` reporter was used; (b) `tests/sync_config.test.ts` writes a tracked file (`src/config/pipelineConfig.json`) as a side effect, though the write is idempotent as measured. Coverage gaps against the ten required contracts are itemised in §18.2 — most importantly, **no test assembles the production pipeline**, which is why a 149-test green suite coexists with a completely inert runtime.

### Performance

Measured: 61 FPS idle (rAF, 1.5 s), 11.25 MB used / 18.85 MB total JS heap, 583 DOM nodes, 985 ms Vite cold start, 14.29 s test suite, 622-byte empty trace export, 47 435 B ONNX file, 91 937 B PrefixSpan WASM, 230 779 B app JS, 400 243 B ONNX worker JS, **26.31 MB** total pre-existing `dist/` (dominated by a 26.8 MB ORT WASM binary).

`NOT MEASURED`: inference latency, total blocking time, active memory against the 20 MB budget, event-handling cost, window-construction time, worker dispatch latency, main-thread blocking, memory growth during a task, DOM mutation cost, and 60 FPS under live pipeline load. No `<50 ms`, `<20 MB`, `60 FPS`, or `<500 KB` conformance is claimed anywhere in this report.

### Known limitations

The complete list is §27. The headline items, each with its evidence above: `MockFastGate` and `MockSlowGate` substitute for the real gates; the shipped ONNX graph is incompatible with the runtime tensor and is never loaded; the legacy ONNX path is a heuristic reported to the console as `provider: webgpu`; the table dataset is unseeded random; `debugBus` has no production publisher; the adaptive pipeline is unreachable from the booted entry point; `OutcomeEvent` has no producer; no `UIContext` → `R^6` encoding exists for the target head; tasks can neither start nor complete from the UI; no experimental condition or condition identifier exists; the required correlation ids are absent; the trace mixes `performance.now()` with `Date.now()`; 7 of 30 macro symbols have no producing component; events on window boundaries are double-counted; inactivity produces no window; and every performance budget is unmeasured.

---

## 29. Final Question

### Can the current testbed now serve as the integration target for model-preparation experiments?

```text
NO — BLOCKING ENGINEERING WORK REMAINS
```

### Criterion-by-criterion basis

| #   | Requirement                               | Verdict     | Decisive evidence                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Observable interaction telemetry          | **No**      | Observer never started. Live DebugPanel: `Buffered Events: 0 (B:0 M:0 T:0 O:0 I:0)` after ~400 synthetic pointer events, navigation, filter edits, scroll, and clicks. `src/main.tsx:5,15-24` boots only the legacy harness; the adaptive modules are tree-shaken from `dist/assets/index-Bj7QX16H.js`.                                                    |
| 2   | Compatible MicroTensor windows            | **No**      | The 18-D math is correct and parity-verified, but **no window is produced at runtime**: `RollingWindowBuffer.tick()` has no production caller, so `MicroTensorWindow`s exist only in tests. Two further divergences (scroll-depth semantics D2; boundary double-count D5) would need fixing first.                                                         |
| 3   | Stable macro interaction sequences        | **No**      | The 30-symbol taxonomy is stable and correctly granular, but no macro token is emitted at runtime; 7 declared symbols have no producing UI component; no experiment/session/participant grouping exists.                                                                                                                                                   |
| 4   | Observable target outcomes                | **No**      | `ExperimentRecorder.recordOutcome` (`recorder.ts:92`) has **no production caller**. There is no runtime outcome derivation, and the UI cannot produce `FORM_SUBMIT`, `BACKTRACK`, or `ABANDON` at all.                                                                                                                                                     |
| 5   | Sufficient UI context                     | **Partial** | `getActiveUIContext()` supplies route, active component/role, feasibility flags, and task/step fields — verified live. Missing: viewport, scroll state, `conditionId`, UI version, and a numeric encoding for the target head.                                                                                                                             |
| 6   | Concrete intervention targets             | **Yes**     | All five interventions declared, four actuated against concrete `data-aui-*` targets with exact-attribute restoration, focus preservation, ARIA linkage, and Esc dismissal; covered by 262 lines of actuator tests. This is the one criterion that passes outright.                                                                                        |
| 7   | Stable model integration boundary         | **No**      | `FastGate`/`SlowGate`/`AdaptiveInferenceEngine` are clean and tested, but the shipped graph expects 9 input features and emits 6 logits while the runtime produces `(1,8,18)` and expects 7 outcome classes; the graph is never loaded (`pipeline.ts:49`); and the mandatory `R^6` UI-context tensor for `TargetInterventionHead` does not exist.          |
| 8   | Reproducible experiment traces            | **No**      | The trace schema, validator, replay, and client-side export all work (verified: a valid 622-byte JSON download), but exports contain no events, carry `unknown-session`, always show `task: Idle`, and mix `performance.now()` with `Date.now()` so `metadata.durationMs` is meaningless. No `experimentId`, `conditionId`, `windowId`, or `predictionId`. |
| 9   | Controllable baseline/adaptive conditions | **No**      | No application-level condition switch and no condition identifier. Gate-level enable flags exist but are unreachable, and there is no way to keep telemetry on while adaptation is off — because neither is composed.                                                                                                                                      |

**Score: 1 of 9 criteria passes outright; 1 is partial; 7 fail.** The decision is therefore `NO`, and it is a decision about _execution_, not about code quality or aesthetics: the repository contains a genuinely sound and well-tested set of components, with an unusually disciplined model/policy/actuator separation, and a mismatched set of _wiring and contract_ obligations that must be discharged before a single experiment can run.

### Smallest set of engineering changes to reach the next experimental milestone

The next milestone is: _one participant performs a defined task, and the resulting trace contains raw events, 18-D windows, a macro sequence, an observed outcome, and (in the adaptive condition) an applied and reverted intervention — with everything attributable to an experiment, condition, session, task, and window._ Five changes reach it. None requires an architectural redesign.

1. **Compose and start the pipeline (P0-1).** One runtime module owning observer + rolling window + macro stream + worker client + policy + actuator + recorder, started from the app shell, with a session started at the same moment.
2. **Emit windows correctly and continuously (P0-2).** Drive `tick()` from a monotonic timer as well as event arrival; use half-open intervals; pass viewport and document geometry explicitly. Without this, hesitation and abandonment remain invisible and feature values stay boundary-biased.
3. **Derive and record outcomes (P0-3).** Port the deterministic lookahead rule from `target_generation.py` into TypeScript, attach `sessionId`/`windowId`/source-event/context to `OutcomeEvent`, and call it once per emitted window.
4. **Wire tasks, conditions, and identity (P0-4, P0-5).** A task control driving `startTask`/`resetTask`; a subscriber feeding `recordInteraction`; `conditionId` that gates only the actuator; deterministic table data; and `experimentId`/`conditionId`/`windowId`/`predictionId` plus a single-clock `durationMs` in the trace.
5. **Only then, the model (P2-1 → P2-3).** Re-export an 18-D/7-class graph, encode `UIContext` → `R^6`, and implement `OnnxSlowGate` behind the existing `SlowGate` interface.

Items 1–4 are contract and wiring work confined to the testbed, and they are sufficient to make the _baseline_ condition fully instrumented and replayable — which is itself the first scientifically meaningful result the testbed can produce. Item 5 is the only step that touches model-preparation, and it consumes an interface that already exists.
