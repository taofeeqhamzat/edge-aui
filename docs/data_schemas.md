# Edge-AUI Framework — Versioned Schema Index & Data Specifications

This document is the authoritative index and specification for all data schemas, wire contracts, and configuration formats used in the Edge-AUI framework.

---

## 1. Versioned Schema Index

The table below indexes every versioned schema and interface in the framework, along with its declaring source file and current version:

| Index | Schema / Contract | Version | Declaring File | Primary TypeScript Interface | Purpose |
|---|---|---|---|---|---|
| **1** | **Experiment Trace Schema** | `1.1.0` | `src/telemetry/traceSchema.ts` | `SerializableExperimentTrace` | Chronological session replay containing telemetry, MicroTensors, outcomes, predictions, and effective config. |
| **2** | **MicroTensor Feature Schema** | `1.0.0` | `src/microtensor/window.ts` | `MicroTensorWindow` | 18-D feature vector representation (`[X ⊙ M, M]`: 9 kinematic features + 9 binary modality masks) over 500 ms windows. |
| **3** | **Runtime Configuration Schema**| `1.0.0` | `src/config/runtimeConfig.ts` | `RuntimeConfig` | Layer 2 configuration spanning 9 parameter groups with default initialization and invariant validation. |
| **4** | **Synced Pipeline Configuration**| `1.0.0` | `src/config/pipelineConfig.ts` | `PipelineConfig` | Layer 1 cross-repo hyperparameters synchronized from `model-preparation/src/config.yaml`. |
| **5** | **UI Context Contract** | `1.0.0` | `src/types/uiContext.ts` | `UIContext` | Categorical interface state and R6 numeric vector encoding (`encodeUIContext`). |
| **6** | **UI Adapter Contract** | `1.0.0` | `src/integration/types.ts` | `UiAdapter` | Host application port defining task steps, context extraction, and lifecycle event callbacks. |

---

## 2. Detailed Schema Specifications

### Schema 1: Experiment Trace Schema (`v1.1.0`)
- **Owning File:** [`src/telemetry/traceSchema.ts`](../src/telemetry/traceSchema.ts)
- **Constant:** `EXPERIMENT_TRACE_SCHEMA_VERSION = '1.1.0'`
- **Validation:** `validateExperimentTrace(trace: unknown): TraceValidationResult`
- **Specification:**
  An experiment trace captures a complete evaluation session for offline replay, ablation, and statistical analysis without any network egress.

```typescript
export interface SerializableExperimentTrace {
  schemaVersion: '1.1.0';
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
  interventions: InterventionEvent[];
  taskEvents: TaskEvent[];
}
```

**Key Invariants:**
- `microTensors.values` is serialized from native `Float32Array` to standard `number[]` for valid JSON output.
- `metadata.durationMs` is computed strictly using epoch timestamps (`startedAtEpochMs` to `Date.now()`) to prevent monotonic clock skew.
- `effectiveConfig` captures the exact Layer 2 configuration active during the session, allowing reproducible evaluation runs.

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
