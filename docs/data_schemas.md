# Edge-AUI Framework — Versioned Schema Index & Data Specifications

This document is the authoritative index and specification for all data schemas, wire contracts, and configuration formats used in the Edge-AUI framework.

---

## 1. Versioned Schema Index

The table below indexes every versioned schema and interface in the framework, along with its declaring source file and current version:

| Index | Schema / Contract | Version | Declaring File | Primary TypeScript Interface | Purpose |
|---|---|---|---|---|---|
| **1** | **Experiment Trace Schema** | `1.3.0` | `src/telemetry/traceSchema.ts` | `SerializableExperimentTrace` | Chronological session replay on a single canonical clock, containing telemetry, MicroTensors, outcomes, predictions, policy decisions, interventions (with episode attribution) and provenance. (Legacy `1.2.0` / `1.1.0` readable.) |
| **2** | **MicroTensor Feature Schema** | `1.0.0` | `src/microtensor/window.ts` | `MicroTensorWindow` | 18-D feature vector representation (`[X ⊙ M, M]`: 9 kinematic features + 9 binary modality masks) over 500 ms windows. |
| **3** | **Runtime Configuration Schema**| `1.0.0` | `src/config/runtimeConfig.ts` | `RuntimeConfig` | Layer 2 configuration spanning 9 parameter groups with default initialization and invariant validation. |
| **4** | **Synced Pipeline Configuration**| `1.0.0` | `src/config/pipelineConfig.ts` | `PipelineConfig` | Layer 1 cross-repo hyperparameters synchronized from `model-preparation/src/config.yaml`. |
| **5** | **UI Context Contract** | `1.0.0` | `src/types/uiContext.ts` | `UIContext` | Categorical interface state and R6 numeric vector encoding (`encodeUIContext`). |
| **6** | **UI Adapter Contract** | `1.0.0` | `src/integration/types.ts` | `UiAdapter` | Host application port defining task steps, context extraction, and lifecycle event callbacks. |

---

## 2. Detailed Schema Specifications

### Schema 1: Experiment Trace Schema (`v1.3.0`)
- **Owning File:** [`src/telemetry/traceSchema.ts`](../src/telemetry/traceSchema.ts)
- **Constant:** `EXPERIMENT_TRACE_SCHEMA_VERSION = '1.3.0'`
- **Supported Versions:** `SUPPORTED_EXPERIMENT_TRACE_SCHEMA_VERSIONS = ['1.3.0', '1.2.0', '1.1.0']`
- **Clock:** `TRACE_CLOCK_MODE = 'epoch_ms'` — every record `timestamp` is epoch milliseconds
- **Validation:** `validateExperimentTrace(trace: unknown): TraceValidationResult`
- **Specification:**
  An experiment trace captures a complete evaluation session for offline replay, ablation, and statistical analysis. The testbed performs no telemetry egress; a completed trace may be uploaded to the research collection store **only** when its declared provenance permits it (ADR-018).

```typescript
export interface SerializableExperimentTrace {
  schemaVersion: '1.3.0';
  exportedAt: string; // ISO 8601 UTC timestamp
  session: SessionContext;
  task: UiTaskStateSnapshot;
  metadata: TraceReplayMetadata;
  effectiveConfig?: RuntimeConfig;
  behaviourEvents: BehaviourEvent[];
  microTensors: SerializableMicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  predictions: PredictionEvent[];
  policyDecisions: PolicyDecisionEvent[];
  interventions: InterventionEvent[];
  taskEvents: TaskEvent[];
}
```

**Key Invariants:**
- **One clock (1.3.0):** every record `timestamp` is epoch milliseconds, produced by `getWallClockTimestamp()`. `performance.now()` is monotonic but resets on navigation, so it is not a legal trace timestamp. `metadata.clock = 'epoch_ms'` states this explicitly. Schema `1.2.0` mixed both clocks in one array, which made the record's internal order unreconstructable and task duration underivable (assessment F-01).
- **Policy decisions (1.3.0):** every evaluation produces exactly one `PolicyDecisionEvent`, including refusals (`policyDecision: 'rejected'`), the baseline decision-only branch (`'decision_only'`) and the absence of a candidate (`'no_prediction'`). `policyReason` is never empty, and `rejectionCategory` allows grouping without parsing prose. A trace that only recorded successful interventions could not answer "why did it not intervene?" (assessment F-07).
- **Window attribution (1.3.0):** `PredictionEvent.predictionId` and `evaluatedWindowIds` name the window sequence that was actually evaluated, captured before the inference call rather than read from a mutable "latest window" field after it (assessment F-18).
- **Episode attribution (1.3.0):** an `InterventionEvent` carries both `interventionEpisodeId` and `predictionId`. Every adaptation type stamps `data-aui-active-adaptation` and `data-aui-adaptation-episode` onto the adapted element, so the trace and the live DOM share a join key (assessment F-05).
- **Adaptation lifetime (1.3.0):** `actuation.defaultTtlMs` (default 8000 ms) is applied to every accepted command, and expiry emits a terminal `reverted` event with `reason: 'ttl'`. An `applied` episode with no terminal event is reported as an integrity warning (assessment F-03).
- **Provenance (1.3.0):** `metadata.provenance` is `'scripted'` or `'participant'`, defaulting to `'scripted'`. It is the switch that decides whether a trace may be uploaded, and it exists so synthetic and participant data can never be pooled by accident (ADR-018).
- **Version identity (1.3.0):** `applicationVersion`, `policyVersion`, `modelVersion` and `executionProvider` record what actually ran. `executionProvider` is the provider the ONNX session reported, not the one requested (assessment F-10, F-19).
- **Bounded execution and truncation (1.3.0):** `metadata.mining` counts `executed` / `skipped` / `superseded` / `timedOut` / `droppedWindows`; `metadata.evictions` proves whether any buffer discarded records; `metadata.integrityWarnings` lists orphaned windows, unterminated episodes and truncation. Silence is never used to mean "nothing happened" (assessment F-02, F-16).
- `microTensors.values` is serialized from native `Float32Array` to standard `number[]`; `windowStart`/`windowEnd` are translated to the canonical epoch clock at export.
- `metadata.durationMs` is computed on the canonical clock only.
- `effectiveConfig` captures the exact Layer 2 configuration active during the session, allowing reproducible evaluation runs.
- **Intervention Attribution (Schema 1.2.0):** Every `InterventionEvent` carries `mappingSource?: 'learned_head' | 'deterministic_mapping' | 'fast_gate_pattern'` explicitly tagging the generative mechanism that caused the adaptation.
- **Model Attribution (Schema 1.2.0):** Every `PredictionEvent` carries `modelVersion?: string`, `contextEncodingVersion?: string`, and `mappingSource?: MappingSource`.
- **Migration & Backward Compatibility:** traces declaring `1.2.0` or `1.1.0` still validate with `isLegacyVersion: true`, and the verifier **reports** rather than fails the checks those versions cannot satisfy (single clock, policy decisions, prediction attribution, provenance), because a legacy capture cannot be retro-fixed. Unknown versions (e.g. `1.0.0` or `0.8.0`) are rejected with an actionable error message.

---

### Schema 2: MicroTensor Feature Schema (`18-D v1.0.0`)
- **Owning File:** [`src/microtensor/window.ts`](../src/microtensor/window.ts) & [`src/config/pipelineConfig.ts`](../src/config/pipelineConfig.ts)
- **Dimension:** 18 continuous float values (`Float32Array`)
- **Format:** `X̃ = [X ⊙ M, M]`, where `X` is a 9-element feature vector and `M` is a 9-element binary modality mask (`1.0` if observed, `0.0` if masked/omitted).

| Index | Feature Key | Unit | Normalization Scale | Description |
|---|---|---|---|---|
| `0` | `meanVelocity` | px/ms | `/ 10.0` | Mean Euclidean cursor velocity across window |
| `1` | `maxVelocity` | px/ms | `/ 10.0` | Maximum Euclidean cursor velocity in window |
| `2` | `meanAcceleration` | px/ms² | `/ 1.0` | Mean cursor acceleration magnitude |
| `3` | `hesitationCount` | count | `/ 25.0` | Directional turns with angle deviation > 45° |
| `4` | `totalTrajectoryLength` | px | `/ 2000.0` | Cumulative Euclidean distance traversed |
| `5` | `dwellTimeMs` | ms | `/ 500.0` | Time hovering over interactive DOM elements |
| `6` | `trajectoryEntropy` | bits | `/ 5.0` | Shannon entropy of cursor trajectory segments |
| `7` | `scrollDepthPercentage`| % [0, 1] | `/ 1.0` | Vertical scroll offset relative to max scroll |
| `8` | `scrollVelocity` | px/ms | `/ 5.0` | Rate of vertical viewport scroll change |
| `9–17`| `mask[0..8]` | binary | 1.0 (valid) / 0.0 | Modality masks corresponding to features 0–8 |

---

### Schema 3: Runtime Configuration Schema (`v1.0.0`)
- **Owning File:** [`src/config/runtimeConfig.ts`](../src/config/runtimeConfig.ts)
- **Validation:** `validateRuntimeConfig(config: RuntimeConfig): void`
- **Structure:**
  Comprehensive Layer 2 configuration spanning 9 parameter groups:
  1. `telemetry`: Event types, sample throttling, buffer capacities.
  2. `windowing`: Duration (500 ms), stride (250 ms), settlement delay (250 ms), idle thresholds.
  3. `microtensor`: Schema version, feature names, normalization scales.
  4. `macro`: Sequence lookback, grouping slot duration (2000 ms), max capacity.
  5. `fastGate`: PrefixSpan parameters (min support, confidence, pattern map).
  6. `slowGate`: ONNX GRU model path, sequence length (T=8), WebGPU/WASM provider.
  7. `policy`: Arbitration thresholds, cooldowns (5000 ms), dismissal suppression (15000 ms).
  8. `actuation`: Adaptation TTL (8000 ms), revert behavior, assistance text.
  9. `experiment`: Study ID, condition ID (`baseline` vs `adaptive`), task timeouts.

---

### Schema 4: Synced Pipeline Configuration Schema (`v1.0.0`)
- **Owning File:** [`src/config/pipelineConfig.ts`](../src/config/pipelineConfig.ts) & [`src/config/pipelineConfig.json`](../src/config/pipelineConfig.json)
- **Source of Truth:** `model-preparation/src/config.yaml`
- **Sync Script:** `npm run sync-config` (`scripts/sync-config.mjs`)
- **Specification:**
  Ensures zero covariate shift between offline PyTorch GRU training and client-side ONNX Runtime Web inference. Governs the exact outcome taxonomy (`0: NO_OUTCOME`, `1: CLICK`, `2: FORM_SUBMIT`, `3: BACKTRACK`, `4: RAPID_SCROLL`, `5: HOVER_DWELL`, `6: ABANDON`) and intervention vocabulary (`simplify_options`, `highlight_primary_action`, `offer_assistance`, `expand_tooltip`, `no_op`).

---

### Schema 5: UI Context Contract (`v1.0.0`)
- **Owning File:** [`src/types/uiContext.ts`](../src/types/uiContext.ts) & [`src/types/contextVector.ts`](../src/types/contextVector.ts)
- **Constant:** `TESTBED_UI_VERSION = '1.0.0'`
- **Numeric Projection:** 6-element float array `ContextVector` (R6 encoding via `encodeUIContext`):
  - `[0]`: `route` (normalized index into `ROUTE_VOCABULARY` `['Overview', 'Analytics', 'Reports', 'Customers', 'Settings']`, `/ 5.0`)
  - `[1]`: `primaryActionAvailable` (`1.0` if true, `0.0` if false)
  - `[2]`: `helpAvailable` (`1.0` if true, `0.0` if false)
  - `[3]`: `expandable` (`1.0` if true, `0.0` if false)
  - `[4]`: `taskProgress` (derived from `taskId` and `taskStepId`: `(stepNumber - 1) / totalTaskSteps`, bounded in `[0.0, 1.0]`)
  - `[5]`: `actionAvailability` (count of unique actions normalized by `ACTION_VOCABULARY` `['click', 'change', 'toggle', 'hover', 'select', 'input', 'focus']`, `/ 7.0`)
- All components are strictly bounded in `[0.0, 1.0]` with zero-imputation prohibited. Missing context produces sample exclusion.

---

### Schema 6: UI Adapter Contract (`v1.0.0`)
- **Owning File:** [`src/integration/types.ts`](../src/integration/types.ts)
- **Specification:**
  Defines the pluggable interface ports isolating core runtime logic from any specific UI implementation.

```typescript
export interface UiAdapter {
  readonly id: string;
  readonly version: string;
  getTasks(): UiTaskDefinition[];
  getTaskState(): UiTaskStateSnapshot;
  resolveUiContext(): UIContext;
  onTaskStateChange?(listener: (state: UiTaskStateSnapshot) => void): () => void;
  notifyTaskEvent?(event: UiTaskLifecycleEvent): void;
  startTask?(taskId: string): void;
  completeTask?(taskId: string): void;
  abandonTask?(taskId: string): void;
  onInit?(runtime: unknown): void;
  onDestroy?(): void;
}
```

---

## 3. Trace Identifiers & Linkability Specification (ADR-010 / Task 5.2)

Per ADR-010 (Guarantee 4), every identifier present in an exported `SerializableExperimentTrace` is enumerated below with its linkability and privacy guarantees explicitly stated:

| Identifier Key | Location in Trace | Format / Type | Scope & Lifetime | Cross-Session Linkability | Privacy Rationale & Guarantees |
|---|---|---|---|---|---|
| `sessionId` | `session.sessionId`, `metadata`, events | UUID v4 string (e.g. `c7f5...`) | Session-scoped ephemeral identifier generated at runtime initialisation | **Unlinkable** across sessions or browser restarts | Rotated on every session creation; cannot be tied to persistent user or device identity. |
| `experimentId` | `session.experimentId`, `metadata`, events | Alphanumeric slug (e.g. `exp-001`) | Study trial configuration group | **Unlinkable** to individuals | Identifies the study arm or evaluation protocol version; contains zero subject information. |
| `conditionId` | `session.conditionId`, `metadata`, events | Enum: `'baseline'` \| `'adaptive'` | Study condition | **Unlinkable** to individuals | Differentiates control vs intervention arm; identical across all participants in that arm. |
| `taskId` | `session.taskId`, `task.currentTaskId`, events | Token: `'T1'`, `'T2'`, `'T3'` | Active study task duration | **Unlinkable** to individuals | Represents standardized protocol task definition. |
| `taskStepId` | `task.completedSteps`, `taskEvents`, events | Token (e.g. `'T1-1'`, `'T1-2'`) | Active task sub-step duration | **Unlinkable** to individuals | Protocol milestone tracking token. |
| `windowId` | `microTensors`, `macroInteractions`, `outcomes`, `predictions`, `interventions` | Monotonic integer (`0, 1, 2, ...`) | Session-scoped rolling window sequence index | **Unlinkable** across sessions | Used strictly for intra-session temporal correlation across MicroTensors, outcomes, predictions, and adaptations. |
| `interventionEpisodeId`| `interventions` | Monotonic token (`'ep_1'`, `'ep_2'`) | Single adaptation episode lifecycle | **Unlinkable** across sessions | Correlates the `issued` → `accepted` → `applied` → `dismissed`/`reverted` states of a single intervention event. |
| `componentId` | `behaviourEvents`, `interventions`, context | Semantic string (e.g. `'btn-save'`) | DOM component lifetime | **Unlinkable** to individuals | Static DOM widget identifier derived from `data-aui-component` or element tag; carries zero user input or free text. |

### Data Minimization & Privacy Guarantees (ADR-010)

1. **Zero Field Values (Guarantee 1):** The passive observer (`TelemetryObserver`) captures structural metadata (`componentId`, `componentRole`, `action`, `route`) but **never** reads or serializes input values (`input.value`, `textarea.value`, `select.value`, or text contents). Form field values and confidential sentinels are provably absent from all traces (enforced by `tests/context_redaction.test.ts`).
2. **Zero Network Egress (Guarantee 2):** Telemetry observation, windowing, inference, policy evaluation, DOM adaptation, and trace export run entirely on the client edge. Zero network egress primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`) are invoked during telemetry execution (enforced by `tests/context_redaction.test.ts`).
3. **Session-Scoped Storage (Guarantee 3):** All recorded events and buffers reside in volatile JavaScript memory. Traces exist only for the duration of the page lifecycle unless explicitly exported by local researcher download. Persistent storage and remote upload are explicitly deferred (ADR-009 / ADR-014 D1).

