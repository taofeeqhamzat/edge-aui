# Target Client Engineering & Edge-AUI Integration

## Product Requirements Document (PRD) + Implementation Specification

## 0. Mission

You are implementing the **target client/testbed environment** for the Edge-AUI research project.

The research objective is:

> **Implementation of a Foundational Lightweight AI-Assisted Framework for Behavioural Pattern Extraction and Adaptive UI Recommendations on the Web**

The current model-preparation work already establishes an 18-dimensional MicroTensor representation, a foundation GRU architecture, future observable behavioural outcomes, and a planned Fast Gate / Slow Gate architecture.

The immediate objective of this branch is **not to train or modify the ML model**.

The objective is to build a controlled browser-based target environment that provides a stable, observable and testable integration contract for:

1. target UI interaction;
2. behavioural telemetry collection;
3. 500 ms / 250 ms MicroTensor windowing;
4. macro interaction sequence extraction;
5. Fast Gate / PrefixSpan integration;
6. future Slow Gate / GRU inference integration;
7. target UI context/state;
8. intervention commands;
9. non-destructive UI actuation;
10. experimental logging and replay.

The target client must therefore be treated as an **experimental testbed and integration harness**, not as a production e-commerce application.

---

# 1. Branch / Scope

Create a dedicated implementation branch for the target client/testbed.

Suggested branch:

```text
feature/target-ui-client-integration
```

Do not modify the model-preparation architecture unnecessarily.

The target client should communicate with the model-preparation/runtime components through explicit interfaces.

The implementation must remain modular so that:

```text
Rule-based Fast Gate
```

can be substituted by:

```text
PrefixSpan implementation
```

and later:

```text
Slow Gate
```

can be substituted by:

```text
ONNX GRU inference
```

without redesigning the UI.

---

# 2. Current Repository Context

The target client repository is:

```text
https://github.com/taofeeqhamzat/edge-aui
```

Inspect the repository before implementing anything.

Determine:

- existing application structure;
- framework/build system;
- existing TypeScript modules;
- existing WASM/vectorizer integration;
- existing ONNX Runtime Web dependency;
- existing styling/component structure;
- existing test infrastructure;
- existing README/documentation;
- existing runtime abstractions.

Do not replace the current architecture simply to introduce a preferred framework or folder structure.

Reuse existing infrastructure where appropriate.

---

# 3. Critical Architectural Principle

The client must separate the following concerns:

```text
                    TARGET CLIENT
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   UI / Task State   Telemetry       Integration
        │                │                │
        │                ▼                │
        │         MicroTensorizer         │
        │                │                │
        │                ▼                │
        │          Sequence Builder       │
        │                │                │
        └────────────┬───┴────────────────┘
                     ▼
              Gate Interface
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
      Fast Gate             Slow Gate
      PrefixSpan             GRU/ONNX
          │                     │
          └──────────┬──────────┘
                     ▼
             Intervention Command
                     │
                     ▼
             Adaptation Controller
                     │
                     ▼
                    UI
```

The UI must never directly depend on PrefixSpan or ONNX Runtime.

Likewise:

- telemetry must not know about React components;
- the adaptation controller must not know how the model generated its command;
- the Fast Gate must not directly modify the DOM;
- the Slow Gate must not directly modify the DOM.

Use interfaces/contracts between each layer.

---

# 4. Target Application

Implement a deliberately small **E-Commerce Analytics / Operations Dashboard** testbed.

The application should be sufficient to produce realistic but controlled interaction patterns.

It must contain:

## 4.1 Navigation

Example:

```text
Overview
Analytics
Reports
Customers
Settings
```

The navigation should be real interactive elements.

---

## 4.2 Dashboard

Include:

- KPI cards;
- chart/visualization placeholder;
- date filter;
- region filter;
- category filter;
- results table;
- primary action;
- secondary actions.

---

## 4.3 Filter Drawer / Accordion

Implement a filter panel containing multiple collapsible sections.

Example:

```text
Filters

[ Date Range              ▼ ]

[ Region                  ▼ ]

[ Product Category        ▼ ]

[ Advanced Options        ▼ ]
```

The accordions are important because they provide legitimate intervention targets for:

```text
simplify_options
```

and:

```text
expand_tooltip
```

---

## 4.4 Primary Actions

At least two clearly identifiable primary actions must exist.

Example:

```text
Apply Filters
Export Report
```

These must expose stable semantic identifiers.

Example:

```html
data-aui-component="apply-filters" data-aui-role="primary-action"
```

Do not depend on CSS selectors or generated DOM class names for behavioural identification.

---

## 4.5 Tooltips / Contextual Help

At least several controls should support contextual help.

Example:

```text
Conversion Rate [?]
Customer Retention [?]
Advanced Threshold [?]
```

The tooltip mechanism must expose a stable component identifier.

---

## 4.6 Results Table

Provide enough rows to generate:

- vertical scrolling;
- hover;
- repeated selection;
- visual search;
- backtracking.

The table does not need a real backend.

Use deterministic mock data.

---

# 5. Target UI Design Requirements

The target UI is an experimental instrument.

Therefore:

### Must have

- deterministic DOM structure;
- stable component identifiers;
- predictable interaction semantics;
- reproducible initial state;
- deterministic mock data;
- reset functionality;
- task instrumentation.

### Avoid

- unnecessary animations;
- external APIs;
- authentication;
- real payment functionality;
- backend dependencies;
- complex state-management frameworks;
- unnecessary visual effects;
- inaccessible custom controls.

The application should remain lightweight.

---

# 6. Experimental Task Model

Implement a task model.

Create a typed task definition.

Example:

```ts
interface TargetTask {
  taskId: string;
  title: string;
  description: string;
  steps: TargetTaskStep[];
}
```

Each step should contain:

```ts
interface TargetTaskStep {
  stepId: string;
  expectedComponentId: string;
  expectedAction: string;
  completionCondition: string;
}
```

Initially implement at least:

### Task T1 — Filter Analytics

User must:

```text
1. Open Analytics
2. Open Filters
3. Select Region
4. Select Date Range
5. Apply Filters
```

### Task T2 — Export Report

User must:

```text
1. Open Reports
2. Locate target report
3. Configure required filters
4. Export report
```

### Task T3 — Configure Advanced Filter

User must:

```text
1. Open Analytics
2. Open Advanced Options
3. Configure multiple parameters
4. Apply configuration
```

Tasks must be deterministic.

---

# 7. Task State

Implement a centralized target-task state.

Example:

```ts
interface TaskState {
  taskId: string;
  currentStepId: string;
  completedSteps: string[];
  errors: number;
  startedAt: number;
  completedAt?: number;
}
```

Expose read-only task state to the integration layer.

The task state must not be embedded inside the telemetry implementation.

---

# 8. Stable UI Context Contract

Every instrumented UI component should expose semantic metadata.

Use attributes such as:

```html
data-aui-component="region-filter" data-aui-role="filter"
data-aui-action="select" data-aui-task-role="required"
```

Possible roles:

```text
navigation
primary-action
secondary-action
filter
form-field
tooltip
table-row
accordion
help
```

The client must provide a function:

```ts
getActiveUIContext(): UIContext
```

with a contract similar to:

```ts
interface UIContext {
  route: string;
  activeComponentId?: string;
  componentRole?: string;
  taskId?: string;
  taskStepId?: string;
  availableActions: string[];
  primaryActionAvailable: boolean;
  helpAvailable: boolean;
  expandable: boolean;
}
```

This context is intended for the future target intervention model.

---

# 9. Telemetry Architecture

Implement passive client-side telemetry.

Telemetry must observe:

### Pointer

- `mousemove`
- `mouseover`
- `mouseout`
- `mousedown`
- `mouseup`
- `click`

### Scroll

- `scroll`

### Form / UI

- `change`
- `input`
- `submit`

### Navigation

- route changes;
- browser back/forward where observable;
- internal navigation.

### Session lifecycle

- page visibility changes;
- `pagehide`;
- `beforeunload` where available.

Do not collect unnecessary personal data.

---

# 10. Raw Event Schema

Create a typed canonical event.

Example:

```ts
interface BehaviourEvent {
  timestamp: number;
  type: BehaviourEventType;

  x?: number;
  y?: number;

  scrollY?: number;

  componentId?: string;
  componentRole?: string;

  route?: string;

  action?: string;

  taskId?: string;
  taskStepId?: string;
}
```

Event type:

```ts
type BehaviourEventType =
  | "mousemove"
  | "mouseover"
  | "mouseout"
  | "mousedown"
  | "mouseup"
  | "click"
  | "scroll"
  | "change"
  | "input"
  | "submit"
  | "navigation"
  | "pagehide";
```

Timestamp using a monotonic timing source where possible.

Do not use formatted wall-clock strings for the primary event timeline.

---

# 11. Coordinate Normalization

The browser telemetry implementation must produce normalized coordinates consistent with the model-preparation pipeline.

Use:

```text
x_norm = x / viewport_width
y_norm = y / viewport_height
```

Clamp:

```text
[0, 1]
```

Document exactly which coordinate system is being used.

Do not silently switch between:

- screen coordinates;
- viewport coordinates;
- document coordinates.

Pointer coordinates should use viewport coordinates unless the existing vectorizer contract requires otherwise.

---

# 12. MicroTensor Contract

The client must implement a model-facing MicroTensor contract consistent with the current preparation pipeline.

Required shape:

```text
18
```

Represent:

```text
9 behavioural/contextual features
+
9 modality mask values
```

The client must preserve the existing semantic ordering:

```text
0 meanVelocity
1 maxVelocity
2 meanAcceleration
3 hesitationCount
4 totalTrajectoryLength
5 dwellTimeMs
6 trajectoryEntropy
7 scrollDepthPercentage
8 scrollVelocity

9-17 modality mask
```

Do not invent a new feature ordering.

Create one authoritative TypeScript definition:

```ts
const MICRO_TENSOR_FEATURES = [...]
```

and document it.

---

# 13. Modality Mask Semantics

The modality mask represents **recording capability**, not whether an event happened during a window.

This distinction is mandatory.

Pointer capability:

```text
meanVelocity
maxVelocity
meanAcceleration
hesitationCount
totalTrajectoryLength
trajectoryEntropy
```

DOM capability:

```text
dwellTimeMs
```

Scroll capability:

```text
scrollDepthPercentage
scrollVelocity
```

The client must not set the pointer mask to zero merely because the cursor did not move during a window.

For example:

```text
stationary cursor
```

must remain:

```text
pointer mask = 1
```

when pointer telemetry is available.

Likewise:

```text
no scroll event during window
```

does not mean:

```text
scroll modality missing
```

if scroll telemetry is supported.

---

# 14. Windowing

Implement:

```text
window size = 500 ms
stride = 250 ms
```

The client must maintain a rolling event buffer.

For every eligible window:

```text
window_start
window_end
```

construct:

```ts
interface MicroTensorWindow {
  windowStart: number;
  windowEnd: number;
  values: Float32Array; // length 18
}
```

Use `Float32Array`.

Do not allocate ordinary JavaScript arrays repeatedly in the hot path if avoidable.

---

# 15. Sequence Builder

Implement a sequence abstraction independent of the model.

Example:

```ts
interface MicroTensorSequence {
  windows: MicroTensorWindow[];
  sequenceLength: number;
  strideMs: number;
  windowMs: number;
  sessionId: string;
}
```

The initial sequence length should support:

```text
T = 8
```

because the foundation model currently expects:

```text
(B, 8, 18)
```

However, do not hard-code `8` throughout the system.

Define:

```ts
SequenceConfig;
```

with:

```ts
windowMs: 500;
strideMs: 250;
sequenceLength: 8;
```

This will allow future experimentation.

---

# 16. Macro Interaction Sequence

This is critical for Fast Gate / PrefixSpan integration.

The client must maintain a separate **macro interaction stream**.

Do not derive macro sequences by parsing MicroTensor values.

Example:

```ts
interface MacroInteraction {
  timestamp: number;
  symbol: string;
  componentId?: string;
  action?: string;
}
```

Examples:

```text
NAV_ANALYTICS
OPEN_FILTERS
SELECT_REGION
SELECT_DATE
APPLY_FILTER
OPEN_REPORT
EXPORT_REPORT
BACKTRACK
```

The exact symbol vocabulary must be documented.

---

# 17. Macro Sequence Rules

Generate symbols from semantic UI events.

For example:

```text
click[data-aui-component="analytics"]
        ↓
NAV_ANALYTICS
```

and:

```text
click[data-aui-component="apply-filters"]
        ↓
APPLY_FILTER
```

Do not use raw DOM tag names as the primary macro vocabulary.

The macro vocabulary should represent **meaningful application actions**.

---

# 18. Fast Gate Interface

Implement an interface:

```ts
interface FastGate {
  evaluate(sequence: MacroInteraction[]): Promise<GateDecision>;
}
```

Return:

```ts
interface GateDecision {
  matched: boolean;
  intervention?: InterventionCommand;
  source: "fast";
  confidence?: number;
  matchedPattern?: string[];
}
```

Do not implement the full PrefixSpan algorithm in this task unless the repository already contains it.

Initially provide:

```ts
MockFastGate;
```

or:

```ts
RuleBasedFastGate;
```

with deterministic patterns.

The purpose is to establish the integration contract.

---

# 19. PrefixSpan Compatibility

The Fast Gate interface must make it possible to replace the temporary rule implementation with PrefixSpan later.

Example:

```text
Macro sequence:

NAV_ANALYTICS
OPEN_FILTERS
SELECT_REGION
SELECT_DATE
APPLY_FILTER
```

A future PrefixSpan model may match:

```text
NAV_ANALYTICS
→ OPEN_FILTERS
→ SELECT_REGION
→ SELECT_DATE
```

and return:

```text
highlight_primary_action
```

The client must not care whether the match came from:

- hard-coded rules;
- PrefixSpan;
- another sequence-mining implementation.

---

# 20. Slow Gate Interface

Create the future integration contract now.

```ts
interface SlowGate {
  infer(input: SlowGateInput): Promise<SlowGateResult>;
}
```

Input:

```ts
interface SlowGateInput {
  sequence: Float32Array;
  shape: [number, number, number];
  context: UIContext;
}
```

For the current foundation model:

```text
shape = [1, 8, 18]
```

Return:

```ts
interface SlowGateResult {
  outcome?: BehaviourOutcome;
  intervention?: InterventionCommand;
  probabilities?: Float32Array;
  confidence?: number;
  source: "slow";
}
```

Initially provide:

```ts
MockSlowGate;
```

Do not require ONNX Runtime integration in this branch unless it already exists and can be integrated without destabilizing the client.

---

# 21. Gate Arbitration

Implement a central orchestrator:

```ts
interface AdaptiveInferenceEngine {
  evaluate(input: InferenceContext): Promise<InferenceResult>;
}
```

The intended policy:

```text
Macro sequence
      │
      ▼
 Fast Gate
      │
   match?
   /     \
 yes      no
 │         │
 ▼         ▼
action   Slow Gate
           │
           ▼
        action
```

Fast Gate takes precedence.

Slow Gate must only be invoked when Fast Gate returns:

```ts
matched: false;
```

This is a core architectural requirement.

---

# 22. Intervention Command Contract

Define a stable command interface.

```ts
type InterventionType =
  | "no_op"
  | "highlight_primary_action"
  | "simplify_options"
  | "expand_tooltip"
  | "offer_assistance";
```

Command:

```ts
interface InterventionCommand {
  type: InterventionType;

  targetComponentId?: string;

  confidence?: number;

  source: "fast" | "slow" | "rule";

  issuedAt: number;

  ttlMs?: number;

  reason?: string;
}
```

The command is a **declarative instruction**.

It must not contain direct DOM references.

---

# 23. Intervention Policy

Implement a policy layer between model inference and UI actuation.

```ts
interface InterventionPolicy {
  accept(command: InterventionCommand, context: UIContext): PolicyDecision;
}
```

The policy should initially implement:

### Confidence threshold

Use a configurable threshold.

Do not hard-code:

```text
0.75
```

as a scientifically validated threshold.

Configuration:

```ts
confidenceThreshold: number;
```

Default may be:

```text
0.75
```

but clearly mark this as an initial engineering value requiring calibration.

---

# 24. Consecutive Window Requirement

Support temporal persistence.

Example configuration:

```ts
requiredConsecutiveWindows: 2;
```

An intervention should not necessarily fire from one noisy inference.

Maintain:

```text
candidate intervention
consecutive count
last confidence
```

Reset when:

- intervention changes;
- confidence falls below threshold;
- user performs a conflicting action;
- context changes materially;
- task changes.

---

# 25. No-Op Requirement

`no_op` must be treated as a legitimate intervention command.

It means:

```text
maintain current UI state
```

It must not be treated as an error.

The system should default safely to:

```text
NO_OP
```

when:

- there is insufficient evidence;
- the gate returns no match;
- the policy rejects the recommendation;
- context is unavailable;
- an intervention is already active;
- an intervention would conflict with task state.

---

# 26. UI Adaptation Controller

Create:

```ts
interface UIActuator {
  apply(command: InterventionCommand): void;
  clear(command?: InterventionCommand): void;
  reset(): void;
}
```

The actuator is the only component permitted to mutate adaptive UI state.

---

# 27. Non-Destructive Adaptation

Do not directly rewrite application DOM structure.

Prefer:

```text
CSS classes
data attributes
React/component state
ARIA state
progressive disclosure
```

Examples:

```text
edge-aui-highlight
edge-aui-simplified
edge-aui-tooltip-expanded
edge-aui-assistance
```

The adaptation must be reversible.

---

# 28. Intervention Definitions

Implement the following initial actions.

## 28.1 no_op

Do nothing.

---

## 28.2 highlight_primary_action

Apply a visually subtle state to the relevant primary action.

Requirements:

- must not permanently modify layout;
- must be reversible;
- must target semantic component ID;
- must not hijack focus;
- must not trigger a click.

---

## 28.3 simplify_options

Collapse selected secondary filter sections.

Requirements:

- preserve state;
- do not discard user input;
- do not remove controls permanently;
- provide deterministic restoration;
- do not collapse the section containing the currently focused/active control.

---

## 28.4 expand_tooltip

Reveal contextual information for a target field.

Requirements:

- must not permanently alter layout;
- must be dismissible;
- must not steal keyboard focus;
- must use accessible semantics.

---

## 28.5 offer_assistance

Display a small non-blocking assistance prompt.

It must:

- not be modal;
- not block interaction;
- be dismissible;
- be associated with the current task/component;
- expose telemetry when displayed/dismissed.

---

# 29. Adaptation Event Logging

Every intervention must generate an event.

Example:

```ts
interface InterventionEvent {
  timestamp: number;
  type: "issued" | "accepted" | "applied" | "dismissed" | "reverted";
  intervention: InterventionType;
  componentId?: string;
  source: "fast" | "slow" | "rule";
  confidence?: number;
}
```

This is essential for later evaluation.

---

# 30. Ground-Truth Outcome Logging

The testbed must independently record observable outcomes.

Do not derive ground truth from model predictions.

Example:

```ts
interface OutcomeEvent {
  timestamp: number;
  outcome:
    | "CLICK"
    | "FORM_SUBMIT"
    | "BACKTRACK"
    | "RAPID_SCROLL"
    | "HOVER_DWELL"
    | "ABANDON"
    | "NO_OUTCOME";
  componentId?: string;
  taskId?: string;
  taskStepId?: string;
}
```

This creates the target-domain ground-truth stream required for later target alignment.

---

# 31. Behavioural Outcome vs Intervention

Keep these concepts separate.

Example:

```text
HOVER_DWELL
```

is a behavioural outcome.

It does NOT automatically mean:

```text
EXPAND_TOOLTIP
```

Likewise:

```text
BACKTRACK
```

does not automatically imply:

```text
OFFER_ASSISTANCE
```

The target UI context and intervention policy determine whether an intervention is appropriate.

This separation is mandatory for future supervised target-head training.

---

# 32. Session Management

Implement a client session identifier.

```ts
interface SessionContext {
  sessionId: string;
  startedAt: number;
  taskId?: string;
}
```

Generate a fresh session ID for each experimental session.

Do not use personally identifying information.

Provide:

```text
Start Session
Reset Session
Complete Task
```

controls in development/test mode.

---

# 33. Experimental Recording

Implement a local recording abstraction.

```ts
interface ExperimentRecorder {
  recordBehaviourEvent(event: BehaviourEvent): void;
  recordMicroTensor(window: MicroTensorWindow): void;
  recordMacroInteraction(event: MacroInteraction): void;
  recordOutcome(event: OutcomeEvent): void;
  recordIntervention(event: InterventionEvent): void;
  export(): ExperimentTrace;
}
```

Trace:

```ts
interface ExperimentTrace {
  session: SessionContext;
  task: TaskState;
  behaviourEvents: BehaviourEvent[];
  microTensors: MicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  interventions: InterventionEvent[];
}
```

Initially support JSON export.

Do not introduce a backend.

---

# 34. Replay Capability

Implement a basic replay mechanism if feasible without excessive complexity.

At minimum, the exported trace must contain enough information to reconstruct:

- event ordering;
- timestamps;
- macro sequence;
- target outcomes;
- interventions;
- task state transitions.

A later model-preparation experiment should be able to replay a target session without requiring the original user.

---

# 35. Browser / Python Parity

The browser's MicroTensorizer must be designed so its feature semantics match the existing Python preprocessing implementation.

Do not silently introduce different:

- scales;
- clipping;
- feature order;
- modality masks;
- window definitions.

Create a parity fixture containing known synthetic event streams.

Example:

```text
fixture:
stationary pointer
100 ms movement
hover dwell
scroll
click
```

Expected:

```text
Float32Array(18)
```

Use tolerance-based comparison for floating-point values.

---

# 36. Test Strategy

Tests must cover:

## UI

- navigation;
- filter interaction;
- task completion;
- reset;
- intervention application;
- intervention reversal.

## Telemetry

- mouse movement;
- click;
- scroll;
- hover;
- form input;
- navigation;
- session termination.

## Windowing

- 500 ms windows;
- 250 ms stride;
- boundary events;
- overlapping windows.

## MicroTensor

- exactly 18 dimensions;
- feature ordering;
- normalization;
- mask semantics;
- stationary cursor;
- missing modality.

## Macro sequence

- semantic symbols;
- ordering;
- timestamps;
- backtracking.

## Fast Gate

- match;
- no match;
- intervention return.

## Slow Gate

- receives correct shape;
- only called after Fast Gate miss.

## Arbitration

Test:

```text
Fast Gate match → Slow Gate NOT called
Fast Gate miss → Slow Gate called
```

## Intervention policy

- confidence threshold;
- consecutive windows;
- context mismatch;
- no-op;
- reset.

## Actuator

- highlight;
- simplify;
- tooltip;
- assistance;
- revert;
- idempotency.

---

# 37. Deterministic Mock Gates

Create deterministic mocks for rapid iteration.

Example:

```ts
MockFastGate;
MockSlowGate;
```

Example configuration:

```ts
MockFastGate({
  patterns: {
    "NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION": "highlight_primary_action",
  },
});
```

and:

```ts
MockSlowGate({
  intervention: "expand_tooltip",
  confidence: 0.91,
});
```

This allows the entire client pipeline to be tested before the real models are ready.

---

# 38. Development Debug Panel

Implement a development-only debug panel.

Display:

```text
Session ID
Task
Current Task Step
Current UI Context

MicroTensor:
[18 values]

Macro Sequence:
A → B → C → D

Fast Gate:
matched / no match
pattern
confidence

Slow Gate:
called / skipped
outcome
confidence

Intervention:
type
source
confidence
state
```

Also show:

```text
latest inference latency
latest feature-generation latency
worker/main-thread status
```

The debug panel should be disabled or removable from production builds.

---

# 39. Runtime Architecture

If Web Workers are already supported by the repository, use one.

Preferred architecture:

```text
Main Thread
│
├── UI
├── Task Manager
├── Telemetry Observer
├── UI Context Provider
└── Adaptation Controller
          │
          │ postMessage / transferable buffers
          ▼
      Worker
          │
          ├── MicroTensor processing
          ├── Sequence management
          ├── Fast Gate
          └── Slow Gate
```

The worker should never directly manipulate DOM.

The main thread receives:

```ts
InterventionCommand;
```

and applies it through:

```ts
UIActuator;
```

---

# 40. Transferable Buffers

Where appropriate, use:

```ts
ArrayBuffer;
Float32Array;
```

and transferable ownership for model inputs.

Do not claim "zero-copy" unless the implementation actually avoids copies.

Measure it if necessary.

The goal is:

> minimize main-thread computation and unnecessary allocation.

---

# 41. No Remote Inference Dependency

The default target runtime must operate without an inference API.

No request such as:

```text
POST /predict
```

should be required for normal inference.

The architecture must support:

```text
local telemetry
→ local feature extraction
→ local gate
→ local intervention
```

---

# 42. ONNX Integration Boundary

Do not tightly couple the testbed to a specific model filename.

Define:

```ts
interface ModelRunner {
  initialize(): Promise<void>;

  infer(input: Float32Array, shape: readonly number[]): Promise<ModelOutput>;
}
```

Later:

```text
OnnxModelRunner
```

can implement the interface.

For now:

```text
MockModelRunner
```

is acceptable.

---

# 43. Configuration

Centralize runtime configuration.

Example:

```ts
interface EdgeAUIConfig {
  telemetry: {
    windowMs: number;
    strideMs: number;
  };

  sequence: {
    length: number;
  };

  policy: {
    confidenceThreshold: number;
    consecutiveWindows: number;
  };

  runtime: {
    enableFastGate: boolean;
    enableSlowGate: boolean;
    debug: boolean;
  };
}
```

Do not scatter magic numbers across modules.

---

# 44. Performance Instrumentation

Instrument, but do not impose unsupported performance claims.

Measure:

```text
telemetry processing time
MicroTensor generation time
Fast Gate latency
Slow Gate latency
intervention policy latency
actuation latency
worker message latency
```

Record:

```text
p50
p95
p99
```

where enough samples exist.

The implementation should establish the measurement mechanism now.

Actual performance claims belong to later evaluation.

---

# 45. Accessibility Requirements

Adaptive UI must not undermine accessibility.

Ensure:

- keyboard navigation continues to work;
- focus is not unexpectedly stolen;
- tooltip semantics are accessible;
- assistance prompt is dismissible;
- color is not the only indication of highlighting;
- collapsed content can be restored;
- screen-reader semantics remain coherent.

---

# 46. Research Reproducibility

Provide a deterministic testbed configuration.

Document:

```text
browser version
build version
application version
task version
telemetry schema version
MicroTensor schema version
intervention schema version
```

Add a schema version:

```ts
const TELEMETRY_SCHEMA_VERSION = "1.0";
const MICROTENSOR_SCHEMA_VERSION = "1.0";
const INTERVENTION_SCHEMA_VERSION = "1.0";
```

---

# 47. Data Privacy

The client must process telemetry locally by default.

Do not claim that this provides "mathematically guaranteed privacy."

The defensible runtime property is:

> Raw interaction telemetry is processed locally and is not transmitted to a remote inference service during normal operation.

Experimental export is explicitly user/developer initiated.

---

# 48. Required Directory Architecture

Adapt to the existing repository where appropriate, but target a separation similar to:

```text
src/
├── app/
│   ├── routes/
│   └── state/
│
├── testbed/
│   ├── tasks/
│   ├── components/
│   └── mock-data/
│
├── telemetry/
│   ├── observer.ts
│   ├── events.ts
│   ├── session.ts
│   └── recorder.ts
│
├── microtensor/
│   ├── features.ts
│   ├── window.ts
│   ├── sequence.ts
│   └── schema.ts
│
├── macro/
│   ├── symbols.ts
│   └── sequence.ts
│
├── gates/
│   ├── types.ts
│   ├── fast/
│   ├── slow/
│   └── arbitration.ts
│
├── intervention/
│   ├── types.ts
│   ├── policy.ts
│   └── actuator.ts
│
├── runtime/
│   ├── worker.ts
│   └── messages.ts
│
└── debug/
    └── DebugPanel.tsx
```

Do not blindly create duplicate modules if equivalent repository modules already exist.

---

# 49. Implementation Order

Implement in this order:

## Stage 1 — Repository audit

Before coding:

- inspect repository;
- identify reusable modules;
- identify existing WASM/vectorizer;
- identify ONNX integration;
- identify test setup;
- report architectural conflicts.

Do not code until the architecture is understood.

---

## Stage 2 — Target UI

Implement:

- dashboard;
- navigation;
- filters;
- forms;
- table;
- tooltips;
- primary actions;
- task flows.

Verify deterministic operation.

---

## Stage 3 — Semantic UI instrumentation

Add:

```text
data-aui-component
data-aui-role
data-aui-action
```

and implement:

```ts
getActiveUIContext();
```

---

## Stage 4 — Telemetry

Implement:

- event observers;
- canonical events;
- session management;
- local recorder.

---

## Stage 5 — MicroTensor

Implement:

- 500 ms windows;
- 250 ms stride;
- 18-D vector;
- modality masks;
- sequence length 8.

---

## Stage 6 — Macro sequence

Implement:

```text
semantic event
→ macro symbol
→ ordered sequence
```

---

## Stage 7 — Gate interfaces

Implement:

```text
FastGate
SlowGate
AdaptiveInferenceEngine
```

with deterministic mocks.

---

## Stage 8 — Intervention system

Implement:

```text
InterventionCommand
InterventionPolicy
UIActuator
```

and all five intervention types.

---

## Stage 9 — Runtime worker

Move expensive processing behind the worker boundary where appropriate.

---

## Stage 10 — Recording/replay

Implement experiment trace export.

---

## Stage 11 — Testing

Run unit + integration + browser tests.

---

## Stage 12 — Documentation

Document:

```text
target UI
task model
telemetry schema
MicroTensor schema
macro vocabulary
gate interfaces
intervention taxonomy
runtime architecture
recording format
```

---

# 50. Acceptance Criteria

The branch is complete when all of the following are true.

### Target UI

- [ ] Dashboard runs locally.
- [ ] All experimental tasks can be completed.
- [ ] UI can be reset deterministically.
- [ ] Semantic component identifiers exist.

### Telemetry

- [ ] Pointer telemetry works.
- [ ] Scroll telemetry works.
- [ ] Hover telemetry works.
- [ ] Click/form/navigation telemetry works.
- [ ] Session lifecycle is recorded.

### MicroTensor

- [ ] 500 ms window implemented.
- [ ] 250 ms stride implemented.
- [ ] 18-D vector produced.
- [ ] Feature ordering matches foundation contract.
- [ ] Modality mask semantics match current specification.
- [ ] Sequence `(8,18)` can be generated.

### Macro sequence

- [ ] Semantic macro events are generated.
- [ ] Sequence ordering is deterministic.
- [ ] PrefixSpan-compatible interface exists.

### Gate integration

- [ ] Fast Gate interface exists.
- [ ] Slow Gate interface exists.
- [ ] Fast Gate has deterministic mock.
- [ ] Slow Gate has deterministic mock.
- [ ] Slow Gate executes only after Fast Gate miss.

### Intervention

- [ ] Five intervention commands supported.
- [ ] Confidence policy configurable.
- [ ] Consecutive-window policy implemented.
- [ ] All interventions reversible.
- [ ] No-op safely handled.

### Runtime

- [ ] Worker boundary exists or is clearly isolated for later activation.
- [ ] No remote inference is required.
- [ ] Model runner interface exists.
- [ ] ONNX can be integrated without changing UI APIs.

### Experimentation

- [ ] Behaviour events can be recorded.
- [ ] MicroTensors can be recorded.
- [ ] Macro sequences can be recorded.
- [ ] Ground-truth outcomes can be recorded.
- [ ] Interventions can be recorded.
- [ ] Experiment traces can be exported.

### Testing

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Gate arbitration is tested.
- [ ] MicroTensor parity fixtures exist.
- [ ] Intervention actuator is tested.
- [ ] No regression to existing repository functionality.

---

# 51. Explicit Non-Goals

Do NOT implement these unless required by an existing repository dependency:

- foundation GRU training;
- target intervention model training;
- real PrefixSpan implementation;
- real ONNX model inference;
- INT8 quantization;
- cloud inference;
- user authentication;
- production backend;
- database;
- real e-commerce API;
- real payments;
- large-scale analytics;
- production deployment;
- statistical human-subject study infrastructure.

These belong to later phases.

The purpose of this branch is to create the **target environment and integration contracts** that make those later experiments possible.

---

# 52. Research Questions This Branch Must Enable

The resulting target client must make it possible to answer later:

### RQ1 — Behavioural representation

Can the foundation GRU representation learned from public interaction datasets transfer to a controlled target UI?

### RQ2 — Target adaptation

Does target-domain fine-tuning improve intervention prediction relative to a frozen foundation encoder?

### RQ3 — Gate architecture

Can deterministic macro-pattern matches be handled by the Fast Gate while reserving probabilistic inference for unmatched sequences?

### RQ4 — Runtime

Can behavioural inference and UI adaptation occur locally without unacceptable main-thread impact?

### RQ5 — Adaptation utility

Does adaptive UI behaviour improve task performance or reduce interaction difficulty relative to a static baseline?

The target client is successful if it makes these questions experimentally measurable.

---

# 53. Required Final Agent Report

At completion, report:

## Repository changes

List:

```text
files created
files modified
files removed
```

## Architecture

Explain:

```text
UI → telemetry → MicroTensor
UI → macro sequence
Fast Gate → Slow Gate
inference → policy → actuator
```

## Schemas

Provide the final:

- BehaviourEvent schema;
- MicroTensor schema;
- MacroInteraction schema;
- UIContext schema;
- OutcomeEvent schema;
- InterventionCommand schema;
- ExperimentTrace schema.

## Tests

Report:

```text
unit tests
integration tests
browser tests
total passed
total failed
```

Do not fabricate results.

## Performance

Report actual measured values only.

Do not claim:

```text
<50 ms
<20 MB
60 FPS
```

unless actually measured.

## Known limitations

Explicitly list:

- mock components;
- assumptions;
- missing model integrations;
- unresolved browser differences;
- telemetry limitations;
- future work.

---

# 54. Definition of Done

The final result should be a working experimental browser application in which the following sequence can be demonstrated:

```text
User interacts with target UI
        ↓
TelemetryObserver records raw events
        ↓
500 ms / 250 ms MicroTensor windows
        ↓
18-D feature vectors
        ↓
8-window sequence
        │
        ├──────────────→ Macro interaction sequence
        │                         │
        │                         ▼
        │                    Fast Gate
        │                         │
        │                    no match
        │                         ▼
        │                    Slow Gate
        │
        ▼
Target UI Context
        │
        └──────────────┬───────────
                       ▼
              Intervention Policy
                       │
                       ▼
              InterventionCommand
                       │
                       ▼
                 UIActuator
                       │
                       ▼
                 Target UI
                       │
                       ▼
              Experiment Recorder
```

The system must be capable of running this flow with deterministic mock gates **before the real PrefixSpan and GRU/ONNX models are connected**.

This is intentional.

The branch establishes the stable **client-side experimental contract** that subsequent model-preparation branches can target.

Do not optimize prematurely.

Do not introduce unsupported architectural claims.

Prioritize:

1. correctness;
2. observability;
3. deterministic behaviour;
4. clean interfaces;
5. reproducibility;
6. minimal implementation complexity.
