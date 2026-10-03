# Edge-AUI Framework — Integration Guide

This guide describes how to embed the Edge-AUI framework into any web application (React, Vue, Svelte, or vanilla TypeScript/JavaScript).

The framework operates entirely on the client side:
- **Fast Brain (Fast Gate):** WebAssembly-compiled PrefixSpan sequence pattern miner identifying frequent macro-interactions.
- **Slow Brain (Slow Gate):** Web Worker executing an INT8-quantized GRU via ONNX Runtime Web (WASM execution provider) predicting observable interaction outcomes.
- **Capture-Transform-React Pipeline:** Passive DOM telemetry → 500 ms MicroTensor sliding window → Dual-gate arbitration → Reversible UI actuation → In-memory experiment trace.

---

## 1. Architectural Boundaries & Privacy Principles

Adhere strictly to the privacy and architectural constraints defined in
[ADR-009](decisions/ADR-009-participant-telemetry-storage-export.md),
[ADR-011](decisions/ADR-011-ui-adapter-generalisation-boundary.md) and
[ADR-012](decisions/ADR-012-configurability-strategy.md). The egress boundary was amended by
[ADR-018](decisions/ADR-018-scripted-vs-participant-provenance.md); read that record before changing
anything here.

1. **Zero External Egress for behavioural telemetry — one gated exception.** All behavioural
   telemetry, MicroTensor vectors, predictions and traces are processed locally. The **only** path
   by which behavioural telemetry may leave the client is the provenance-gated research collection
   in `src/telemetry/collection.ts`, and only for a session whose declared `provenance` the build's
   `VITE_AUI_COLLECTION_MODE` permits. In the default `scripted` mode a `participant`-provenance
   trace is refused for upload and stays local. Model and runtime assets are loaded as same-origin
   static files; those are asset loads, not telemetry egress.
2. **Anonymous Identification:** Sessions use cryptographically random UUID v4 identifiers
   (`sessionManager.startSession()`). No PII, cookies, IP addresses or hardware fingerprints are
   captured. `participantId` exists, is nullable and is **never** populated by the framework — no
   participant identifier scheme has been approved
   ([ADR-023](decisions/ADR-023-participant-identification.md)).
3. **Budget Guardrails:** Resident memory footprint <= 20 MB; inference execution <= 50 ms Total
   Blocking Time; bundle payload <= 500 KB. **The payload target is not met** — the ONNX Runtime
   WASM binary alone is 13,479,978 B. Report `NOT MEASURED` rather than asserting a budget that has
   not been measured for the path in question.
4. **Non-Destructive Actuation:** Interface adaptations (`highlight_primary_action`,
   `simplify_options`, `expand_tooltip`, `offer_assistance`, `no_op`) must never modify user data or
   destroy layout. They must preserve keyboard focus, accessibility trees and ARIA attributes, and
   must revert cleanly — on TTL expiry, on user dismissal, or at teardown, each recorded with a
   typed `reason` ([ADR-021](decisions/ADR-021-intervention-observability-and-ttl.md)).
5. **Local persistence exists.** A session snapshot is written to IndexedDB so an interrupted
   session survives a reload and a failed upload is retryable
   ([ADR-019](decisions/ADR-019-session-persistence-and-recovery.md)). A session found still in
   progress on the next load is marked `incomplete` and is never presented as a finished capture.

---

## 2. Step-by-Step Integration

### Step 1: Implement the `UiAdapter` Interface

The framework communicates with host applications strictly through the `UiAdapter` port defined in
[`src/integration/types.ts`](../src/integration/types.ts). Host applications define task steps,
contextual element resolution and task lifecycle tracking.

The framework is a `private` package with no `exports` map, so it is consumed by **relative source
import** rather than by a bare package specifier:

```typescript
import {
  UiAdapter,
  UiTaskDefinition,
  UiTaskStateSnapshot,
  UiTaskLifecycleEvent
} from '../integration/index';
import { UIContext } from '../types/uiContext';

export class MyAppAdapter implements UiAdapter {
  public readonly id = 'my-app-adapter';
  public readonly version = '1.0.0';

  // `UiTaskDefinition` declares `steps` (a `UiTaskStep[]`) and has no per-task timeout;
  // task timeouts are a runtime experiment parameter, not an adapter concern.
  private tasks: UiTaskDefinition[] = [
    {
      id: 'checkout',
      name: 'Checkout Flow',
      description: 'Complete shipping address and payment',
      steps: [
        { stepId: 'address_entered', description: 'Enter a shipping address',
          expectedComponentId: 'shipping-address', expectedAction: 'change' },
        { stepId: 'payment_selected', description: 'Choose a payment method',
          expectedComponentId: 'payment-method', expectedAction: 'click' },
        { stepId: 'order_placed', description: 'Place the order',
          expectedComponentId: 'place-order', expectedAction: 'click' }
      ]
    }
  ];

  private currentTaskId: string | null = 'checkout';
  private currentStepIndex = 0;
  private status: UiTaskStateSnapshot['status'] = 'In Progress';
  private stateListeners = new Set<(state: UiTaskStateSnapshot) => void>();

  public getTaskState(): UiTaskStateSnapshot {
    return {
      currentTaskId: this.currentTaskId,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      completedSteps: [],
      errors: 0
    };
  }

  // The context port is `getActiveContext`, and the real `UIContext` fields are
  // route / activeComponentId / componentRole / availableActions / primaryActionAvailable /
  // helpAvailable / expandable / viewport / document / scrollState / conditionId / uiVersion.
  public getActiveContext(): UIContext {
    return {
      route: 'Checkout',
      activeComponentId: 'shipping-address',
      componentRole: 'form-field',
      availableActions: ['change', 'input'],
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: false,
      conditionId: 'adaptive',
      uiVersion: '1.0.0'
    };
  }

  public onTaskStateChange(callback: (state: UiTaskStateSnapshot) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  public onTaskLifecycle(callback: (event: UiTaskLifecycleEvent) => void): () => void {
    // Emit task_start / task_step / task_complete as the application advances.
    void callback;
    return () => undefined;
  }

  // Required for step matching: the runtime calls this for every observed interaction.
  public recordInteraction(componentId: string, action: string): void {
    void componentId;
    void action;
  }

  public getTaskActionForEvent(eventType: string): string | undefined {
    return eventType === 'submit' ? 'click' : undefined;
  }

  // Optional: ask the runtime to abandon the active task, e.g. on a route change.
  public abandonTask(reason: string): void {
    void reason;
    this.status = 'Abandoned';
  }
}
```

### Step 2: Annotate the DOM for Actuation & Context

The `UIActuator` targets elements annotated with `data-aui-*` attributes. The attribute that
identifies an element's **semantic role** is `data-aui-role`:

```html
<!-- Primary action target for 'highlight_primary_action'.
     `data-aui-role="primary-action"` is the documented fallback when no component id is given. -->
<button
  id="place-order"
  data-aui-component="place-order"
  data-aui-role="primary-action"
  data-aui-action="click"
  class="btn btn-primary"
>
  Place Order
</button>

<!-- Accordion section for 'simplify_options'.
     The actuator reads `aria-expanded` to collapse sections and restores it on revert. -->
<button
  type="button"
  data-aui-component="advanced-options"
  data-aui-role="accordion"
  aria-expanded="true"
>
  Advanced options
</button>

<!-- Contextual help target for 'offer_assistance' and 'expand_tooltip'.
     `data-aui-role="tooltip"` is the fallback selector; `title` or `data-tooltip` supplies text. -->
<div
  data-aui-component="order-help"
  data-aui-role="tooltip"
  data-tooltip="Click here to review order details before submitting."
>
  Need help?
</div>
```

The actuator applies scoped CSS classes (`edge-aui-highlight`, `edge-aui-simplified`,
`edge-aui-tooltip-expanded`, plus an `edge-aui-assistance-banner` element) and manages ARIA
attributes (`aria-expanded`, `aria-describedby`) without modifying application state.

**Correlation attributes.** Every adaptation type stamps two attributes on the element it adapted:

| Attribute | Value | Purpose |
|---|---|---|
| `data-aui-active-adaptation` | `highlight` \| `simplified` \| `tooltip-expanded` \| `assistance` | Names the adaptation currently applied |
| `data-aui-adaptation-episode` | e.g. `ep_3` | Joins the live DOM to the trace's intervention episode |

Both are removed with the adaptation, so a reverted adaptation cannot look active. A verifier can
therefore assert that the adaptation recorded in the trace is the one visible on screen, in both
directions.

### Step 3: Configure and Initialize `AdaptiveRuntime`

```typescript
import { AdaptiveRuntime } from '../runtime/adaptiveRuntime';
import { MyAppAdapter } from './MyAppAdapter';

const adapter = new MyAppAdapter();

const runtime = new AdaptiveRuntime({
  adapter,
  experimentId: 'pilot-study-01',
  conditionId: 'adaptive', // 'baseline' (observe only) | 'adaptive' (adaptations permitted)
  config: {
    policy: {
      confidenceThreshold: 0.80,
      cooldownMs: 6000,
      ttlMs: 8000            // how long an accepted adaptation stays visible
    },
    actuation: {
      defaultTtlMs: 8000,
      defaultAssistanceText: 'Would you like guidance completing this order?'
    },
    fastGate: {
      miningTimeoutMs: 1500,     // bounded mining deadline
      maxCorpusSequences: 40     // caps the mining cost input
    }
  }
});

// `start()` is asynchronous: it establishes the session, warms the worker and loads the
// ONNX graphs before any event is recorded.
await runtime.start();

console.log('Edge-AUI Runtime status:', runtime.getStatus());
```

### Step 4: Export Session Traces for Offline Analysis

The current contract is **schema 1.3.0** on a single epoch-millisecond clock:

```typescript
import { experimentRecorder } from '../telemetry/recorder';

// The canonical serializable form. `export()` returns the in-memory form with Float32Array
// tensors, which is not JSON-serializable and is not the interchange format.
const trace = experimentRecorder.exportSerializable();

console.log('Schema:', trace.schemaVersion);          // '1.3.0'
console.log('Clock:', trace.metadata.clock);           // 'epoch_ms'
console.log('Provenance:', trace.metadata.provenance); // 'scripted'
console.log('Recorded events:', trace.behaviourEvents.length);
console.log('Policy decisions:', trace.policyDecisions.length);

// Inspect before trusting: a truncated or partially-settled capture says so.
if (trace.metadata.integrityWarnings?.length) {
  console.warn('Trace integrity warnings:', trace.metadata.integrityWarnings);
}

// Trigger a local JSON file download in the browser.
experimentRecorder.downloadTraceAsJSON('session_trace.json');
```

For durable collection, drive `src/telemetry/collection.ts`
(`ResearchCollection.completeSession()`), which persists locally and uploads only when the
provenance gate permits.

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
| | `maxPatternLength` | `4` | `>= 1` | Layer 2 | Max length of mined sequential patterns (bounded execution) |
| | `maxPatterns` | `32` | `>= 1` | Layer 2 | Max patterns considered per evaluation |
| | `maxCorpusSequences` | `40` | `>= 1` | Layer 2 | Corpus cap sent to the miner; bounds mining cost |
| | `miningTimeoutMs` | `1500` | `> 0` | Layer 2 | Bounded mining deadline; an overrun is recorded, not dropped |
| | `rpcTimeoutMs` | `3000` | `>= miningTimeoutMs` | Layer 2 | Worker round-trip budget |
| | `patternInterventionMap`| Mappings | Record<string, string>| Layer 2 | Map of mined pattern string to intervention |
| **6. Slow Gate** | `modelPath` | (dead key) | valid URI | Layer 2 | Declared but unread; the runtime loads `public/models/model_int8.onnx` + `intervention_head_int8.onnx` |
| | `executionProvider` | `'wasm'` | `'webgpu' \| 'wasm' \| 'auto'`| Layer 2 | ONNX Runtime Web backend. The deployment uses the WASM-only entry point ([ADR-016](decisions/ADR-016-cloudflare-pages-deployment.md)) |
| | `sequenceLength` | `8` | `>= 1` | Layer 1 | Number of consecutive windows (T=8) |
| | `confidenceThreshold` | `0.75` | `[0, 1]` | Layer 2 | Softmax probability cutoff for intervention |
| | `targetContextEncoding`| `'R6'` | `'R6' \| 'none'` | Layer 2 | UI context vector projection format |
| | `enabled` | `true` | boolean | Layer 2 | Whether Slow Gate inference is active |
| | `fallbackBehavior` | `'mock'` | `'mock' \| 'no_op' \| 'fast_only'` | Layer 2 | Behaviour when no ONNX session is available |
| **7. Policy** | `confidenceThreshold` | `0.75` | `[0, 1]` | Layer 2 | Minimum probability for policy issuance |
| | `requiredConsecutiveWindows`| `2` | `>= 1` | Layer 2 | Consecutive windows exceeding threshold |
| | `cooldownMs` | `5000` | `>= 0` | Layer 2 | Cooldown between successive adaptations |
| | `ttlMs` | `8000` | `> 0` | Layer 2 | Default adaptation lifetime applied to accepted commands |
| | `dismissalCooldownMs` | `15000` | `>= 0` | Layer 2 | Extended suppression upon user dismissal |
| **8. Actuation** | `defaultTtlMs` | `8000` | `> 0` | Layer 2 | Auto-reversion timer for transient cues |
| | `revertBehavior` | `'on_reset'` | `'on_reset' \| 'on_ttl' \| 'on_action'` | Layer 2 | Trigger for removing adaptation styling |
| | `defaultAssistanceText`| String | string | Layer 2 | Fallback assistance text copy |
| **9. Experiment** | `experimentId` | `'exp-default'` | string | Layer 2 | Active study identifier |
| | `conditionId` | `'adaptive'` | `'baseline' \| 'adaptive'` | Layer 2 | Experimental trial condition |
| | `trialOrder` | `['T1', 'T2', 'T3']` | Array of task IDs | Layer 2 | Order of evaluation tasks |
| | `taskTimeoutsMs` | `{ T1: 120000, ... }`| Record<string, number>| Layer 2 | Max duration per trial task |
| | `traceSchemaVersion` | `'1.3.0'` | semver | Layer 2 | Schema version written to exported traces ([ADR-017](decisions/ADR-017-canonical-trace-contract-and-clock.md)) |

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
