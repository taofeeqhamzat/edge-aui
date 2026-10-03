Comprehensive Implementation Correctness & Gap Assessment

Role

Act as a senior research software engineer and implementation auditor for the Edge-AUI project.

Your task is to perform a comprehensive assessment of the current implementation, not to redesign or immediately implement the next milestones.

The purpose of this assessment is to establish a reliable baseline before the next implementation cycle:

1. Testbed + framework + model deployment pipeline for research-participant telemetry persistence and collection, eventually supporting UX assessment metrics such as task completion time and related task outcomes.
2. Task-list reassessment to determine whether the current tasks adequately exercise the intended behavioural patterns and adaptive interventions.
3. Testbed UI hardening, while deliberately retaining its skeletal/simple character; fix correctness/usability/visual-observability issues rather than turning it into a production product UI.
4. Improve the observability of adaptive interventions, both visually in the testbed and through the developer/research panel, so that intervention activation can be confidently verified during experiments.

The model-preparation and learning-transfer experiment is already considered complete for the current experimental cycle:

- Foundation model training/evaluation has been completed.
- Transfer learning to the target intervention task has been completed.
- Synthetic intervention labels were generated from an automated browser session.
- The synthetic labels were generated using a deterministic intervention policy.
- The TargetInterventionHead has been integrated into the runtime.
- These synthetic labels are not participant-derived ground truth and must not be represented as such.
- The deterministic policy should now be treated as the source of synthetic supervision / baseline behaviour, not as an unfinished substitute for the learned intervention head.

Do not reopen the completed model-training work unless the audit discovers a concrete correctness defect that materially affects the current runtime.

⸻

1. Primary Objective

Determine, from the actual repository implementation and tests:

What is currently correct, what is only partially implemented, what is misleading or methodologically unsafe, what is unverified, and what must be addressed before the system can be used for research-participant telemetry collection and UX assessment?

The assessment must distinguish between:

- implemented and verified;
- implemented but insufficiently tested;
- implemented but methodologically questionable;
- implemented but difficult to observe/debug;
- partially implemented;
- specified but not implemented;
- obsolete/legacy;
- deferred intentionally;
- blocked by another dependency;
- genuinely missing.

Do not infer implementation from documentation alone.

Trace claims in documentation back to the actual code/tests/configuration where possible.

⸻

2. Human-in-the-Loop Requirement

The human researcher remains the final decision-maker.

You are an auditor and implementation assistant, not the architectural decision-maker.

Do not silently:

- change architecture;
- alter experimental methodology;
- redefine task semantics;
- change intervention semantics;
- modify model behaviour;
- introduce participant-data persistence;
- introduce new privacy assumptions;
- remove existing components;
- change research metrics;
- change the task list;
- “fix” subjective UI behaviour.

If you discover something requiring an architectural or methodological decision, document it as a decision point.

For each significant decision point provide:

Decision:
Why it matters:
Current implementation:
Options:
Evidence required:
Recommended next investigation:
Human decision required:

Do not implement these decisions during this assessment unless a change is necessary merely to execute the audit itself.

⸻

3. Repository Reconnaissance

Start by establishing the actual repository state.

Inspect:

- project structure;
- package configuration;
- runtime entry points;
- test configuration;
- build configuration;
- model/runtime assets;
- worker boundaries;
- WASM assets;
- testbed UI;
- task definitions;
- telemetry implementation;
- experiment/trace implementation;
- persistence/export mechanisms;
- developer/research panel;
- intervention rendering/actuation;
- configuration files;
- documentation;
- ADRs;
- scripts;
- CI configuration;
- generated/build artefacts where relevant.

Identify:

Current runtime entry point
Current testbed entry point
Current model loading path
Current telemetry path
Current persistence/export path
Current experiment lifecycle
Current task lifecycle
Current intervention path
Current diagnostic/dev-panel path
Current browser deployment path

Produce a concise architecture map based on the actual implementation.

⸻

4. End-to-End Runtime Correctness Audit

Trace the complete runtime path:

Research participant
↓
Target UI
↓
BehaviourEvent
↓
Session / experiment / task identity
↓
Windowing
↓
MicroTensor
↓
Macro interaction history
↓
Fast Gate
↓
Slow Gate
↓
TargetInterventionHead
↓
Policy
↓
Actuator
↓
Visible UI intervention
↓
Outcome / task event
↓
Experiment trace
↓
Persistence / export

For every arrow determine:

- actual implementation;
- data structure/schema;
- producer;
- consumer;
- validation;
- error handling;
- timing;
- identity propagation;
- provenance;
- tests;
- known limitations.

Explicitly identify any point where the documented architecture differs from the implementation.

⸻

5. Telemetry Correctness Audit

Assess whether the current telemetry system is suitable as the basis for research participant collection.

Inspect:

Event capture

- Which browser events are captured?
- Are events normalized consistently?
- Are timestamps monotonic?
- Is wall-clock time separated from monotonic duration measurement?
- Are duplicate events possible?
- Are events lost?
- What happens under rapid interaction?
- What happens when the page becomes inactive/backgrounded?
- What happens on navigation?
- What happens when the session terminates unexpectedly?

Identity

Verify propagation of:

participant/session
experiment
condition
task
task attempt
window
prediction
intervention episode
source event

Identify missing or ambiguous identity relationships.

Privacy/data minimization

Audit what is actually collected and persisted.

Explicitly identify:

- raw behavioural telemetry;
- DOM information;
- selectors;
- URLs;
- page/application metadata;
- text/content;
- identifiers;
- potentially sensitive information;
- persistent browser storage;
- server-side persistence;
- exported traces.

Do not invent a privacy policy.

Instead report what the implementation currently does and what decisions remain necessary before participant deployment.

⸻

6. Persistence & Research-Collection Readiness

This is a major next milestone.

Assess the current system’s ability to support:

participant session
↓
experiment
↓
condition
↓
task attempts
↓
telemetry
↓
model predictions
↓
interventions
↓
task outcomes
↓
research trace
↓
durable storage/export

Determine whether persistence currently exists, and exactly where.

Assess:

- browser-local persistence;
- server persistence;
- export;
- import/replay;
- session recovery;
- schema versioning;
- experiment versioning;
- task versioning;
- model versioning;
- intervention-policy versioning;
- trace integrity;
- partial-session handling;
- failed-session handling;
- duplicate submission;
- crash recovery;
- offline behaviour;
- synchronization;
- data validation.

Do not implement persistence yet.

Instead determine the smallest architecture that would be required for a reliable research collection pipeline.

Separate:

A. Runtime collection

What the browser/testbed records.

B. Transport

How data leaves the participant environment.

C. Persistence

Where durable research data is stored.

D. Dataset preparation

How persisted traces become training/evaluation data.

E. Research analysis

How task performance and behavioural metrics are derived.

Identify which layers already exist and which are missing.

⸻

7. UX Assessment Readiness

Assess whether the current system can eventually support metrics such as:

- task completion time;
- task success/failure;
- task abandonment;
- number of attempts;
- backtracking;
- navigation errors;
- interaction count;
- intervention count;
- intervention timing;
- intervention acceptance/dismissal;
- time-to-completion after intervention;
- condition-level comparisons.

Do not assume that every metric is required.

Determine:

1. Which metrics are currently observable.
2. Which are derivable.
3. Which require new task lifecycle events.
4. Which require persistent timestamps.
5. Which require explicit participant actions.
6. Which require methodological decisions.

Pay particular attention to task completion time:

taskStart
↓
participant interactions
↓
taskComplete / taskFail / taskAbandon

Determine whether the existing task lifecycle provides a sufficiently reliable measurement boundary.

Identify clock/timestamp problems.

⸻

8. Task List Reassessment

Do not immediately rewrite the tasks.

Audit the current task set against the research objective.

For every task determine:

Task:
Primary user goal:
Expected interaction sequence:
Behavioural pattern exercised:
Expected telemetry:
Expected macro pattern:
Expected Fast Gate behaviour:
Expected Slow Gate behaviour:
Expected intervention:
Expected observable UI change:
Expected task outcome:
Research metric:
Current implementation status:

Assess whether the current tasks collectively exercise:

- habitual/repeated sequences;
- filtering/navigation;
- form interaction;
- hesitation;
- hover/dwell;
- backtracking;
- rapid scrolling;
- option complexity;
- tooltip/help demand;
- intervention opportunities;
- no-intervention cases;
- Fast Gate matches;
- Slow Gate invocation;
- learned intervention-head predictions.

Identify:

- redundant tasks;
- tasks that do not exercise the intended behaviour;
- tasks that are impossible/ambiguous;
- tasks that depend on accidental UI state;
- tasks that cannot produce the intended telemetry;
- tasks where intervention visibility is too subtle to evaluate;
- missing control/baseline tasks.

Do not rank tasks.

Produce a factual coverage matrix and identify gaps.

⸻

9. Testbed UI Hardening Audit

The testbed is intentionally skeletal.

Do not recommend turning it into a polished production e-commerce application.

Assess only what is necessary for:

- correct interaction;
- reliable task execution;
- clear experimental state;
- visible intervention behaviour;
- reproducibility;
- accessibility/usability sufficient for participant studies;
- reliable telemetry generation.

Inspect known visual bugs and search for additional ones.

Look for:

- incorrect layout;
- overflow;
- clipped content;
- broken responsive behaviour;
- incorrect expanded/collapsed state;
- hidden controls;
- inconsistent disabled states;
- confusing task-state transitions;
- accidental state persistence;
- intervention overlays/styles that are difficult to see;
- visual changes that are too subtle to identify;
- UI changes that could be mistaken for normal UI behaviour.

Separate:

Correctness bugs
Observability problems
Usability problems
Purely cosmetic issues
Research-validity issues

⸻

10. Intervention Observability Audit

This is a priority.

Trace each intervention from:

model prediction
↓
policy decision
↓
intervention command
↓
actuator
↓
DOM/UI change

For each intervention type determine:

- triggering condition;
- prediction source;
- confidence;
- policy threshold;
- cooldown;
- TTL;
- target element;
- DOM mutation;
- visible effect;
- revert behaviour;
- diagnostic representation;
- trace representation.

Determine why interventions are currently difficult to confirm.

Potential causes to investigate include:

- low confidence;
- policy threshold;
- sustained-window requirement;
- cooldown;
- wrong selector;
- actuator failure;
- subtle CSS;
- short TTL;
- intervention immediately reverting;
- dev-panel event loss;
- prediction/actuation timing mismatch;
- target UI state masking the intervention.

Do not assume the cause.

Produce evidence.

⸻

11. Developer / Research Panel Audit

Assess whether the developer panel provides sufficient observability to answer:

“Why did/didn’t the system intervene?”

At minimum determine whether it exposes:

current task
current condition
window ID
MicroTensor/window status
Fast Gate result
Slow Gate invoked?
model prediction
intervention probabilities
selected intervention
policy decision
policy rejection reason
actuator result
intervention episode
timestamp
latency

Distinguish:

Runtime truth

What actually happened.

Diagnostic display

What the panel says happened.

Identify any discrepancies.

The panel should make it possible to distinguish:

No prediction
Prediction below threshold
Policy rejected prediction
Cooldown active
Fast Gate handled interaction
Slow Gate invoked
Intervention emitted
Actuator failed
Intervention currently active
Intervention expired

Do not implement the panel during this assessment unless required for instrumentation needed to prove a finding.

⸻

12. Fast Gate / Slow Gate Audit

Assess the actual routing behaviour.

Verify:

interaction
↓
macro history
↓
Fast Gate
├── match → intervention/policy path
└── no match → Slow Gate
↓
GRU + UIContext
↓
TargetInterventionHead

Check:

- whether Fast Gate is actually invoked;
- whether its match is based on the intended history;
- whether fresh/current macro interactions are considered;
- whether Slow Gate is invoked only when intended;
- whether the learned target head is actually being used;
- whether the deterministic policy still intercepts the learned path;
- whether fallback paths obscure learned-model behaviour.

Report observed routing rather than assuming intended routing.

⸻

13. TargetInterventionHead Integration Audit

The model training itself is complete.

Audit the runtime integration only.

Verify:

- model artifact identity;
- input shape;
- feature ordering;
- normalization/scaling;
- UIContext encoding;
- sequence handling;
- hidden-state extraction;
- target-head output mapping;
- softmax/logit handling;
- intervention vocabulary;
- thresholding;
- fallback;
- ONNX/runtime compatibility;
- browser loading;
- worker/main-thread boundary;
- model version propagation into traces.

Perform a parity check where practical:

training/Python output
vs
browser/runtime output

for identical inputs.

Any discrepancy should be classified as:

- numerical tolerance;
- preprocessing mismatch;
- model export issue;
- runtime bug;
- configuration mismatch.

⸻

14. Configuration Audit

The final architecture is expected to remain highly configurable so that:

1. experiments can rapidly change parameters/policies;
2. other UIs can integrate without complex bespoke configuration.

Assess whether this is actually true.

Inspect configurability for:

- telemetry;
- event types;
- sampling;
- window size/stride;
- minimum events;
- settlement;
- MicroTensor features;
- normalization;
- macro grouping;
- PrefixSpan;
- model/runtime;
- UIContext vocabulary;
- intervention thresholds;
- sustained duration;
- cooldown;
- TTL;
- actuator targets;
- tasks;
- experiment conditions;
- trace schema;
- persistence.

Identify hard-coded values that should be configurable.

However, distinguish between:

meaningful experimental parameter
vs
implementation detail

Do not recommend making every constant configurable.

⸻

15. Testing Audit

Inspect the entire test suite.

Classify tests as:

- unit;
- schema/contract;
- integration;
- browser;
- end-to-end;
- model parity;
- experiment reproducibility;
- performance;
- persistence;
- failure/recovery.

Determine:

- what is genuinely tested;
- what is only mocked;
- what is covered only by happy paths;
- what lacks browser-level verification;
- what lacks failure-path testing;
- what lacks deterministic replay;
- what lacks data-integrity checks.

Pay particular attention to the gap between:

"the code has a test"

and

"the research claim is actually verified."

⸻

16. Performance & Deployment Audit

Review existing measurements.

Do not repeat benchmarks unnecessarily if valid evidence already exists.

Determine the status of:

- main-thread latency;
- worker latency;
- model inference latency;
- Fast Gate latency;
- telemetry throughput;
- window generation;
- MicroTensor extraction;
- memory;
- heap growth;
- long tasks;
- TBT;
- FPS/rAF;
- artifact size;
- WASM size;
- model size;
- runtime loading time.

Explicitly distinguish:

Measured
Estimated
Target
Not measured
Blocked
Deferred

Do not turn target budgets into claims.

⸻

17. Research Validity Audit

Assess whether the current implementation can support a defensible research experiment.

Focus on:

Condition separation

Can baseline and adaptive conditions be clearly distinguished?

Same telemetry

Does the baseline still collect the same telemetry?

Intervention isolation

Does the adaptive condition differ because of the intervention mechanism rather than unrelated UI changes?

Task consistency

Are task instructions and UI state reproducible?

Randomization/counterbalancing

Determine whether this is currently implemented.

Do not assume it is necessary for every current engineering test, but identify what would be needed for participant evaluation.

Synthetic supervision

Clearly document:

Synthetic intervention labels
↓
generated by deterministic policy
↓
used for model training/transfer
↓
NOT participant ground truth

Identify exactly where this provenance is preserved or lost.

⸻

18. Documentation / Implementation Consistency

Cross-check:

- README;
- architecture docs;
- ADRs;
- experiment docs;
- model-preparation documentation;
- runtime documentation;
- task documentation;
- comments;
- schemas;
- code;
- tests.

Look specifically for stale statements from earlier architecture versions.

Flag contradictions such as:

documentation says X
code implements Y
tests assume Z

Do not silently resolve them.

⸻

19. Legacy / Dead-Code Audit

Identify:

- unused runtime files;
- obsolete telemetry implementations;
- old gate clients;
- duplicate schemas;
- old model-loading paths;
- abandoned architectures;
- dead configuration;
- stale tests;
- conflicting implementations.

For each item classify:

Safe to remove
Needs verification
Potential compatibility dependency
Intentionally retained
Unknown

Do not delete anything during this audit.

⸻

20. Deliverables

Produce a comprehensive assessment report containing:

A. Executive Status

A concise statement of the current implementation state.

Use factual status categories rather than a single subjective readiness score.

Example:

COMPLETE
PARTIALLY COMPLETE
VERIFIED
UNVERIFIED
GAP
BLOCKED
DEFERRED

B. Actual Architecture

A diagram or structured representation of the implementation that actually exists.

C. End-to-End Trace

Show the complete data path from:

participant interaction → persisted research record

and identify missing links.

D. Correctness Findings

For each finding:

ID:
Area:
Severity:
Evidence:
Observed behaviour:
Expected behaviour:
Impact:
Recommended action:
Implementation required?:
Human decision required?:

Use severity such as:

Critical
High
Medium
Low
Informational

Do not use severity as a political-style or subjective ranking; it should represent engineering/research impact according to the definitions above.

E. Research-Readiness Gaps

Separate:

- participant telemetry collection;
- persistence;
- dataset generation;
- task measurement;
- intervention observability;
- baseline/adaptive experimentation;
- UX assessment.

F. Task Coverage Matrix

Show which behavioural patterns and system paths each task exercises.

G. Intervention Observability Matrix

For every intervention:

Intervention
Prediction source
Trigger
Policy decision
Actuator
Visible effect
Dev-panel evidence
Trace evidence
Current verification status

H. Test Coverage Matrix

Identify important claims without corresponding tests.

I. Configuration Audit

Identify parameters that are currently hard-coded but materially affect experimentation or UI portability.

J. Legacy/Dead-Code Findings

Do not modify them; document them.

K. Architectural Decision Log

List decisions that require the human researcher.

For example:

- persistence architecture;
- participant identifier strategy;
- server vs browser persistence;
- retention;
- raw telemetry policy;
- task list changes;
- intervention visualization;
- baseline/adaptive protocol;
- randomization/counterbalancing;
- TS vs WASM vectorization;
- deployment/runtime packaging.

L. Recommended Next Milestones

Only after completing the audit, propose the smallest coherent implementation sequence.

The likely milestone families are:

1. Participant telemetry collection + persistence
2. Research trace/dataset pipeline
3. Task reassessment
4. Testbed UI hardening
5. Intervention observability
6. UX assessment instrumentation
7. Baseline/adaptive experimental execution
8. Deployment/shareability hardening

Do not assume this ordering is correct. Derive the sequence from the audit.

⸻

21. Evidence Discipline

Every important conclusion must be backed by one of:

- source code;
- test;
- browser/runtime observation;
- recorded trace;
- benchmark;
- configuration;
- documentation.

Explicitly label conclusions as:

VERIFIED
PARTIALLY VERIFIED
INFERRED
UNVERIFIED
NOT IMPLEMENTED
NOT MEASURED
DEFERRED

Never claim:

- participant validation where only synthetic sessions exist;
- model generalization from synthetic labels;
- performance budgets that were not measured;
- persistence that only exists as browser export;
- intervention activation merely because a prediction was produced;
- research validity merely because an engineering test passed.

⸻

22. Important Scope Boundary

This task is an assessment only.

Do not:

- implement participant persistence;
- redesign the task set;
- redesign the UI;
- retrain the model;
- change intervention policies;
- change the model architecture;
- migrate TypeScript to Rust/WASM;
- remove legacy code;
- introduce a backend;
- introduce a database;
- alter research methodology.

Those may become subsequent implementation tasks based on the assessment.

The only permitted code changes are temporary/minimal instrumentation required to establish an otherwise unverifiable finding, and such changes must be explicitly documented.

⸻

23. Final Question the Audit Must Answer

At the end, answer this concretely:

If the next goal is to deploy the testbed/framework/model pipeline to collect research-participant telemetry, persist it reliably for dataset preparation, and eventually use the same environment for UX assessment, what prevents us from doing that today?

Separate the answer into:

Must fix before participant deployment
Must fix before meaningful UX assessment
Should fix for research reliability
Should fix for maintainability/shareability
Can remain deferred

Then identify the smallest next implementation slice that removes the most important blockers without prematurely building the entire participant infrastructure.

The assessment is the deliverable. Do not begin that implementation slice until the human researcher has reviewed the findings and explicitly authorizes it.
