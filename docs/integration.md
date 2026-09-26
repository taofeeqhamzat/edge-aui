# Edge-AUI Framework — Integration Guide

This guide describes how to embed the Edge-AUI framework into any web application (React, Vue, Svelte, or vanilla TypeScript/JavaScript).

The framework operates entirely on the client side:
- **Fast Brain (Fast Gate):** WebAssembly-compiled PrefixSpan sequence pattern miner identifying frequent macro-interactions.
- **Slow Brain (Slow Gate):** Web Worker executing an INT8-quantized GRU via ONNX Runtime Web (WebGPU / WASM) predicting observable interaction outcomes.
- **Capture-Transform-React Pipeline:** Passive DOM telemetry → 500 ms MicroTensor sliding window → Dual-gate arbitration → Reversible UI actuation → In-memory experiment trace.

---

## 1. Architectural Boundaries & Privacy Principles

Adhere strictly to the privacy and architectural constraints defined in [ADR-009](decisions/ADR-009-edge-model-storage-strategy.md), [ADR-011](decisions/ADR-011-ui-adapter-generalisation-boundary.md), and [ADR-012](decisions/ADR-012-configurability-strategy.md):

1. **Zero External Egress:** All behavioral telemetry, MicroTensor vectors, predictions, and traces are processed locally in memory. Zero network requests transmit user interactions.
2. **Anonymous Identification:** Sessions use cryptographically random UUID v4 identifiers (`sessionManager.startSession()`). No PII, cookies, IP addresses, or hardware fingerprints are captured.
3. **Budget Guardrails:** Resident memory footprint <= 20 MB; inference execution <= 50 ms Total Blocking Time; bundle payload <= 500 KB.
4. **Non-Destructive Actuation:** Interface adaptations (`highlight_primary_action`, `simplify_options`, `expand_tooltip`, `offer_assistance`, `no_op`) must never modify user data or destroy layout. Adaptations must preserve keyboard focus, accessibility trees, and ARIA attributes, and must revert cleanly on reset.

---

## 2. Step-by-Step Integration

### Step 1: Implement the `UiAdapter` Interface

The framework communicates with host applications strictly through the `UiAdapter` port defined in [`src/integration/types.ts`](../src/integration/types.ts). Host applications define task steps, contextual element resolution, and task lifecycle tracking.

```typescript
import {
  UiAdapter,
  UiTaskDefinition,
  UiTaskStateSnapshot,
  UiTaskLifecycleEvent
} from 'edge-aui-framework/integration';
import { UIContext } from 'edge-aui-framework/types';

export class MyAppAdapter implements UiAdapter {
  public readonly id = 'my-app-adapter';
  public readonly version = '1.0.0';

  private tasks: UiTaskDefinition[] = [
    {
      id: 'checkout',
      title: 'Checkout Flow',
      description: 'Complete shipping address and payment',
      expectedSteps: ['address_entered', 'payment_selected', 'order_placed'],
      timeoutMs: 120000
    }
  ];

  private currentTaskId: string | null = 'checkout';
  private currentStepIndex = 0;
  private status: 'Not Started' | 'In Progress' | 'Completed' | 'Abandoned' = 'In Progress';
  private stateListeners = new Set<(state: UiTaskStateSnapshot) => void>();

  public getTasks(): UiTaskDefinition[] {
    return this.tasks;
  }

  public getTaskState(): UiTaskStateSnapshot {
    return {
      currentTaskId: this.currentTaskId,
      currentStepIndex: this.currentStepIndex,
      status: this.status,
      elapsedMs: 0
    };
  }

  public resolveUiContext(): UIContext {
    return {
      activePage: window.location.pathname,
      activeRegion: 'main-content',
      currentViewport: [window.innerWidth, window.innerHeight],
      formValidity: true,
      openModalId: null
    };
  }

  public onTaskStateChange(listener: (state: UiTaskStateSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public notifyTaskEvent(event: UiTaskLifecycleEvent): void {
    // Notify registered listeners of task lifecycle progression
    const state = this.getTaskState();
    this.stateListeners.forEach((l) => l(state));
  }
}
```

### Step 2: Annotate the DOM for Actuation & Context

The `UIActuator` targets elements annotated with standard `data-aui-*` HTML attributes:

```html
<!-- Primary action target for 'highlight_primary_action' -->
<button
  id="checkout-btn"
  data-aui-component="button"
  data-aui-target="primary_action"
  class="btn btn-primary"
>
  Place Order
</button>

<!-- Complex section for 'simplify_options' -->
<div
  data-aui-component="filter-panel"
  data-aui-target="filter_panel"
  class="options-panel"
>
  <!-- Non-essential options can receive .aui-subdued when simplified -->
  <div class="option-item">Advanced Option A</div>
</div>

<!-- Contextual help target for 'offer_assistance' and 'expand_tooltip' -->
<div
  data-aui-component="tooltip-trigger"
  data-aui-target="help_trigger"
  data-aui-assistance-text="Click here to review order details before submitting."
>
  Need help?
</div>
```

The actuator applies scoped CSS classes (`aui-highlight`, `aui-simplified`, `aui-tooltip-expanded`, `aui-assistance-active`) and manages ARIA attributes (`aria-expanded`, `aria-describedby`) without modifying application state.

### Step 3: Configure and Initialize `AdaptiveRuntime`

Initialize `AdaptiveRuntime` with the custom adapter and optional Layer 2 configuration overrides:

```typescript
import { AdaptiveRuntime } from 'edge-aui-framework/runtime';
import { MyAppAdapter } from './MyAppAdapter';

const adapter = new MyAppAdapter();

const runtime = new AdaptiveRuntime({
  adapter,
  autoStart: true,
  experimentId: 'pilot-study-01',
  conditionId: 'adaptive', // 'baseline' (passive observation) | 'adaptive' (active adaptations)
  config: {
    policy: {
      confidenceThreshold: 0.80,
      cooldownMs: 6000
    },
    actuation: {
      defaultAssistanceText: 'Would you like guidance completing this order?'
    }
  }
});

// Runtime starts event observers and Web Worker arbitration
console.log('Edge-AUI Runtime status:', runtime.getStatus());
```

### Step 4: Export Session Traces for Offline Analysis

At the end of a user session or task, export the complete replay trace:

```typescript
import { experimentRecorder } from 'edge-aui-framework/telemetry';

// Export in-memory trace object
const trace = experimentRecorder.export();
console.log('Recorded events:', trace.behaviourEvents.length);
console.log('Effective Config recorded:', trace.effectiveConfig);

// In browser testbed, trigger a local JSON file download
experimentRecorder.downloadTraceAsJSON('session_trace.json');
```

---

## 3. Configuration Surface Reference

The framework implements a two-layer configuration model ([ADR-012](decisions/ADR-012-configurability-strategy.md)):
- **Layer 1 (Canonical Pipeline Config):** Synced from `model-preparation/src/config.yaml` into `src/config/pipelineConfig.json`. Governs window sizing, feature definitions, and model shapes.
- **Layer 2 (Runtime Config):** Framework-owned typed configuration covering 9 parameter groups with zero-configuration defaults.

| Group | Parameter | Default | Valid Range | Layer Owner | Description |
|---|---|---|---|---|---|
| **1. Telemetry** | `enabledEventTypes` | `['mousemove', ...]` | Array of DOM event names | Layer 2 | Events observed by `TelemetryObserver` |
| | `sampleIntervalMs` | `0` | `>= 0` | Layer 2 | Mousemove throttling interval (0 = unthrottled) |
| | `captureGeometry` | `true` | boolean | Layer 2 | Record element bounding rects and viewport dims |
| | `maxBufferSize` | `10000` | `>= 100` | Layer 2 | Trace ring buffer capacity |
| **2. Windowing** | `windowDurationMs` | `500` | `> 0` | Layer 1 | MicroTensor aggregation span |
| | `strideMs` | `250` | `> 0, <= windowDurationMs` | Layer 1 | Sliding step between adjacent windows |
| | `minEventCount` | `3` | `>= 1` | Layer 1 | Min events required for active window emission |
| | `inactivityThresholdMs`| `2000` | `> 0` | Layer 2 | Idle duration before Slow Gate idle check |
| | `settlementDelayMs` | `250` | `>= 0` | Layer 1 | Lookahead delay to settle boundary events |
| | `pendingOutcomeGraceMs`| `2000` | `> 0` | Layer 2 | Max wait to settle outcome for inactive stream |
| **3. MicroTensor** | `schemaVersion` | `'1.0.0'` | semver | Layer 2 | Version of 18-D feature vector schema |
| | `inputDim` | `18` | 18 | Layer 1 | Feature dimension (9 kinematic + 9 mask) |
| | `featureNames` | `['meanVelocity', ...]`| 9 strings | Layer 1 | Canonical feature order |
| | `normalization` | Scale factors | numeric dict | Layer 1 | Divisors applied to kinematic features |
| **4. Macro** | `groupingIntervalMs` | `2000` | `> 0` | Layer 2 | Time slot grouping macro interactions |
| | `maxHistoryLength` | `400` | `>= 10` | Layer 2 | Max recent macro actions held in memory |
| | `maxRecentSymbols` | `6` | `>= 1` | Layer 2 | Count of recent symbols sent to debug bus |
| | `recentSequenceLookback`| `40` | `>= 1` | Layer 2 | Max actions passed to Fast Gate miner |
| **5. Fast Gate** | `miner` | `'wasm'` | `'wasm' \| 'mock'` | Layer 2 | PrefixSpan engine implementation |
| | `minSupport` | `1` | `>= 1` | Layer 2 | Min sequence frequency to qualify pattern |
| | `minConfidence` | `0.60` | `[0, 1]` | Layer 2 | Min confidence to trigger Fast Gate match |
| | `maxPatternLength` | `4` | `>= 1` | Layer 2 | Max length of mined sequential patterns |
| | `patternInterventionMap`| Mappings | Record<string, string>| Layer 2 | Map of mined pattern string to intervention |
| **6. Slow Gate** | `modelPath` | `'/models/gru_edge_aui.onnx'`| valid URI | Layer 2 | URI to INT8 ONNX GRU model artifact |
| | `executionProvider` | `'auto'` | `'webgpu' \| 'wasm' \| 'auto'`| Layer 2 | ONNX Runtime Web backend |
| | `sequenceLength` | `8` | `>= 1` | Layer 1 | Number of consecutive windows (T=8) |
| | `confidenceThreshold` | `0.75` | `[0, 1]` | Layer 2 | Softmax probability cutoff for intervention |
| | `targetContextEncoding`| `'R6'` | `'R6' \| 'none'` | Layer 2 | UI context vector projection format |
| | `enabled` | `true` | boolean | Layer 2 | Whether Slow Gate inference is active |
| **7. Policy** | `confidenceThreshold` | `0.75` | `[0, 1]` | Layer 2 | Minimum probability for policy issuance |
| | `requiredConsecutiveWindows`| `2` | `>= 1` | Layer 2 | Consecutive windows exceeding threshold |
| | `cooldownMs` | `5000` | `>= 0` | Layer 2 | Cooldown between successive adaptations |
| | `dismissalCooldownMs` | `15000` | `>= 0` | Layer 2 | Extended suppression upon user dismissal |
| **8. Actuation** | `defaultTtlMs` | `8000` | `> 0` | Layer 2 | Auto-reversion timer for transient cues |
| | `revertBehavior` | `'on_reset'` | `'on_reset' \| 'timeout'` | Layer 2 | Trigger for removing adaptation styling |
| | `defaultAssistanceText`| String | string | Layer 2 | Fallback assistance text copy |
| **9. Experiment** | `experimentId` | `'exp-default'` | string | Layer 2 | Active study identifier |
| | `conditionId` | `'adaptive'` | `'baseline' \| 'adaptive'` | Layer 2 | Experimental trial condition |
| | `trialOrder` | `['T1', 'T2', 'T3']` | Array of task IDs | Layer 2 | Order of evaluation tasks |
| | `taskTimeoutsMs` | `{ T1: 120000, ... }`| Record<string, number>| Layer 2 | Max duration per trial task |
| | `traceSchemaVersion` | `'1.1.0'` | semver | Layer 2 | Schema version written to exported traces |

---

## 4. Verification and Health Checks

1. **Parity Check:** Ensure client feature extraction matches Python reference:
   ```bash
   npm run parity:check
   ```
2. **Contract Testing:** Verify adapter decoupling and configuration invariants:
   ```bash
   npm test tests/ui_adapter_contract.test.ts
   npm test tests/pipeline_configuration.test.ts
   ```
3. **Runtime Benchmarks:** Profile memory footprint and Total Blocking Time:
   ```bash
   npm run benchmark:runtime
   ```
