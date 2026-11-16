# Edge-AUI — Comprehensive Implementation Planning Directive

## Objective

Produce a comprehensive, technically grounded implementation plan for the next Edge-AUI development milestone.

The plan must cover three connected areas:

1. **Target UI / testbed:** implement the approved task diversification and address the UI, task-harness and instrumentation limitations identified in the UI assessment.
2. **Edge-AUI framework:** address the identified behavioral, architectural and runtime limitations while preserving a reusable, interface-agnostic framework.
3. **Model preparation:** prepare the data and training pipeline for collecting new participant traces and retraining or fine-tuning the Slow Gate target head using task-oriented UI outcomes.

The final implementation milestone should leave the project with:

- The approved diversified tasks implemented and reliably verifiable.
- A usable, consistent semantic outcome-recording pipeline.
- A framework that remains independent of the testbed's pages, components, tasks and outcome vocabulary.
- A retrained target head capable of predicting the agreed task-oriented outcomes.
- Fast Gate and Slow Gate outputs that can be consumed by a common policy interface.
- Interventions that are visibly appropriate, correctly targeted, non-disruptive and useful.
- A reproducible, tested deployment suitable for another round of academic and supervisor evaluation.

**Your assignment is to document the implementation plan, not execute it.**

Do not modify application code, configuration, models, datasets or deployment infrastructure during this task.

---

## 1. Required source material and initial investigation

Before producing the plan, inspect the current repositories and the complete UI assessment report.

### Primary assessment document

[`task-diversification-ui-assessment.md`](./assessments/task-diversification-ui-assessment.md)

This report is available in the edge-aui-framework repository. Its executive summary, detailed findings, technical references and researcher's appended decisions are authoritative inputs for this planning exercise.

Do not rely solely on the report summary. Inspect the detailed findings, including:

- Existing UI and task limitations.
- Task definitions and their proposed completion predicates.
- Shared semantic outcome vocabulary and derivation rules.
- DOM annotation and intervention targets.
- Existing macro symbols and their relationship to semantic outcomes.
- Task lifecycle and trace-recording limitations.
- Existing tests and verification findings.
- Recommended migration path for the Slow Gate taxonomy.

### Repositories

Inspect the current state of:

- `edge-aui` — framework and target testbed.
- `edge-aui-model-preparation` — data preparation, training, evaluation and model export.

Use the actual repository state as the implementation baseline. Do not assume that every assessment recommendation remains unimplemented. Identify changes already made since the assessment and plan only what remains necessary.

Inspect relevant source code, tests, configuration, model artifacts, data schemas, documentation and deployment configuration.

Use commit history where useful to establish the current state and identify unfinished work.

### Evidence discipline

For every significant finding, distinguish:

- **Verified:** established through current source, tests or execution.
- **Inferred:** a likely implication that needs confirmation.
- **Proposed:** a recommended implementation or design decision.
- **Open decision:** requires researcher or supervisor approval.

Do not invent repository state, test results, model performance or deployment measurements.

---

## 2. Decisions already approved

Treat the following as researcher decisions, not unresolved recommendations.

| Decision                  | Approved direction                                                          |
| ------------------------- | --------------------------------------------------------------------------- |
| Reports catalogue / TD4   | Approved                                                                    |
| Customer Segment filter   | Remove; do not implement a segment-based task                               |
| Task identifiers          | Introduce new IDs `TD1`–`TD4`                                               |
| Task completion           | Verify required UI state, not merely whether controls were touched in order |
| Task timeout              | Implement timeout handling and explicit abandonment/failure semantics       |
| TD5 hover/inspection task | Excluded from this milestone                                                |

### Decision 6 — Semantic outcome taxonomy migration

The assessment recommends recording semantic task outcomes additively during task implementation and participant collection, then retraining the Slow Gate using the semantic vocabulary after sufficient traces have been collected.

The researcher has mostly finalized this decision.

The implementation plan must however:

1. Present the recommended additive approach.
2. Explain its compatibility benefits and implications for trace collection.
3. Identify the exact point at which the model taxonomy, training configuration and exported model must change.
4. Identify the minimum decision needed before implementation.
5. Avoid assuming that the current seven-class model can predict semantic task outcomes without retraining.

Unless a different decision is subsequently made, use additive semantic recording as the planning baseline.

---

## 3. Target UI / testbed implementation scope

The testbed is the experimental environment in which participant interactions, behavioral traces, predictions and visible interventions are demonstrated and evaluated.

It may contain task-specific logic and task-specific UI semantics. Those responsibilities must remain outside the reusable framework core.

### 3.1 Implement the approved task set

Plan implementation of the following four tasks.

| ID  | Task                         | Starting point | Main flow                                                                 | Required completion evidence                                                      |
| --- | ---------------------------- | -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| TD1 | Regional sales export        | Overview       | Analytics → Region → Europe → Apply → Export                              | Region = Europe; 18 visible rows; export action recorded                          |
| TD2 | Date and category filter     | Analytics      | Date Range → 2025-06-01 → Product Category → Books → Apply                | Correct date and category state; 5 visible rows                                   |
| TD3 | Empty-result recovery        | Analytics      | Europe → Books → 2025-09-01 → Apply → observe empty state → Reset Filters | Empty state observed, filters reset, 50 rows restored                             |
| TD4 | Report comparison and export | Reports        | Open Europe Electronics → return to Reports → Open Europe Books → Export  | Both reports visited; Europe Books active; 6 visible rows; export action recorded |

These counts correspond to the assessment's deterministic stimulus dataset (`seed = 20250921`). Verify them against the current data generator before implementation. Do not treat them as participant measurements.

The task implementation should preserve the intended distinction between tasks:

- Different starting points.
- Different action sequences.
- Different selection modalities.
- Different completion actions.
- Explicit recovery and backtracking opportunities.

Do not add TD5 or unrelated tasks.

### 3.2 Task harness and lifecycle

Plan the necessary changes to make every trial reproducible.

Include:

- Explicit `startingPage` per task.
- Task-start normalization before recording `task_start`.
- Reset of applied and draft filters.
- Collapse of filter accordions.
- Clearing of stale report state and errors.
- Deterministic initial state.
- State snapshots for task verification.
- State-based completion predicates for TD1–TD4.
- Explicit timeout handling using the existing timeout configuration where appropriate.
- Explicit abandonment and failure semantics.
- Correct handling when a task is reset, replaced or interrupted.
- Prevention of condition changes during an active trial, or a clearly defined safe transition.
- New task IDs and configuration updates.

A task must not complete merely because a participant interacted with the expected controls. Verify the actual required state.

For example, TD1 must verify the selected region and resulting row count before accepting the export as successful.

The plan should identify how task-specific predicates remain in the testbed rather than being embedded in the framework's core.

### 3.3 Fix identified UI limitations

Plan the minimum necessary UI changes:

- Add a Reset Filters control that clears both draft and applied filter state.
- Add the approved Reports catalogue.
- Add report-selection controls, deterministic report presets and a visible current-report indicator.
- Synchronize report presets, applied filters and filter-drawer state.
- Remove the inert Customer Segment control.
- Normalize filter-section identifiers to stable snake_case-compatible IDs.
- Add the minimum necessary region annotations.
- Ensure report selection does not incorrectly emit a user `apply_filter` action.
- Ensure task-start routing does not get recorded as a participant navigation action.

For the Reports catalogue, preserve the intended TD4 comparison task. Include the deterministic report entries and metadata required by the assessment. Do not expose matching row counts in the catalogue, because participants must open and compare the reports.

Avoid broader UI redesign or cosmetic enhancement unrelated to task execution or intervention quality.

### 3.4 Task and interaction verification

The plan must include automated tests and scripted dry runs covering:

- All four task starting states.
- All expected action sequences.
- Correct completion and failure conditions.
- Task timeout and abandonment.
- Reset behavior.
- Report preset synchronization.
- Filter state consistency across navigation.
- Correct result counts and empty-state behavior.
- No duplicate task interactions.
- No spurious `task_error` events on canonical task paths.

A scripted task run must be possible under both baseline and adaptive conditions.

---

## 4. Framework implementation scope

This is the most important architectural constraint of the plan.

**Edge-AUI must remain an interface-agnostic adaptive UI framework. It must not become a framework hardcoded around the Analytics dashboard, TD1–TD4, or their semantic outcome identifiers.**

The testbed is one integration of the framework, not its architectural definition.

### 4.1 Establish clear responsibility boundaries

The plan should explicitly distinguish the following responsibilities.

| Responsibility                 | Framework core                                         | Testbed / integration                                      |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| Behavioral telemetry ingestion | Generic event contract and collection interfaces       | DOM event sources and application-specific capture         |
| MicroTensor construction       | Generic feature representation and processing contract | UI-specific event mapping and available modalities         |
| Macro-interaction processing   | Generic sequence representation                        | Application-specific macro symbol mapping                  |
| Fast Gate                      | Pattern-matching engine                                | Declared patterns and outcome mappings                     |
| Slow Gate                      | Model inference and generic input/output contract      | Model artifact and application-specific outcome vocabulary |
| Arbitration                    | Gate coordination and result normalization             | Configuration of gate preferences and fallback behavior    |
| Policy execution               | Generic policy interface and execution lifecycle       | Outcome-to-intervention rules                              |
| DOM targeting                  | Generic actuator contract                              | Semantic target identifiers and target resolution          |
| UI intervention                | Generic intervention commands                          | React/CSS implementation and visual styling                |
| Task management                | Must not depend on testbed task definitions            | Task definitions, task state and completion predicates     |
| Research trace collection      | Generic trace contracts and extension points           | Study-specific metadata and persistence                    |

Inspect the existing architecture and identify any violations of these boundaries.

Do not assume that the current implementation already satisfies them.

### 4.2 Introduce or refine integration contracts

Assess the minimum interfaces necessary for an external application to integrate Edge-AUI.

Consider the following conceptual contracts, adapting existing types where possible:

- Behavioral event input.
- UI context and semantic annotations.
- Macro-interaction input.
- Gate prediction result.
- Arbitration result.
- Intervention command.
- Actuator target resolution.
- Trace/event export.

A gate prediction should be able to communicate at least:

- Predicted outcome identifier.
- Confidence or match strength, where applicable.
- Source gate (`fast` or `slow`).
- Relevant target/context information or a reference to it.
- Timestamp and prediction identifier.

The framework should not require outcome identifiers such as `select_report` or `apply_filter` to exist globally.

Those identifiers must be supplied through application integration and configuration.

Likewise, do not hardcode `data-aui-component="btn-export"` or other testbed selectors into the framework core.

### 4.3 Shared semantic outcome contract

Both gates must ultimately produce outcomes that can be consumed by the same policy layer.

Plan a normalized result contract so that:

- Fast Gate predictions can map to semantic task outcomes.
- Slow Gate predictions can map to the same semantic task outcomes after retraining.
- Arbitration does not need to understand individual UI components.
- Policy decisions can be configured independently of gate implementation.
- The actuator receives a generic intervention command with an application-resolvable target.

For this testbed, the semantic vocabulary includes:

- `navigate_overview`
- `navigate_analytics`
- `navigate_reports`
- `select_report`
- `open_filter_section`
- `close_filter_section`
- `select_region`
- `select_date_range`
- `select_category`
- `apply_filter`
- `reset_filter`
- `export_report`
- `backtrack`
- `NO_OUTCOME`

`task_complete` and `task_abandon` are task-lifecycle/evaluation outcomes, not ordinary model prediction targets.

The complete assessment vocabulary may contain additional conditional or deferred outcomes. Do not expand the implementation unnecessarily.

The framework must support a different application's vocabulary without changing its core source code.

### 4.4 Semantic outcome derivation and event canonicalization

Plan the changes needed to correct the current click-centric and inconsistent outcome derivation.

The implementation should:

- Recognize committed `change` events.
- Recognize form submissions.
- Distinguish Apply from Export.
- Deduplicate click/submit pairs.
- Deduplicate checkbox click/input/change events.
- Require a genuine value change before emitting a selection outcome.
- Apply exact identifier/role matching before substring matching.
- Prevent tooltip identifiers from being misclassified as filter selections.
- Avoid labeling row hover as row selection.
- Distinguish user actions from system-generated intervention events.
- Record semantic outcomes alongside existing generic outcomes during the additive phase.

Preserve the underlying evidence required for future reprocessing where practical.

The framework should offer generic event normalization and extension points. The testbed should provide the application-specific mapping from canonical events to semantic outcomes.

### 4.5 Backtracking

Implement the assessment's deterministic route-level backtracking rule in the appropriate layer.

At task start:

`visitedPages = [startingPage]`

On deliberate page transition to a different page:

- If the destination has already been visited during the current task, emit `backtrack`.
- Record the new visit.
- Do not classify same-page navigation as backtracking.

A return to Reports during TD4 should produce the direct navigation outcome and the derived `backtrack` outcome.

Do not classify blur, accordion collapse, filter changes or ordinary control focus changes as backtracking.

The rule should be implemented in a reusable sequence/context mechanism or a testbed adapter, not as a hardcoded Reports-specific condition in the framework core.

Document the chosen ownership and rationale.

### 4.6 Macro symbol and context contracts

Assess existing macro symbols for correctness and consistency.

The plan should address:

- Unreachable symbols.
- Misclassified symbols.
- Symbols emitted for interactions the UI does not actually support.
- Missing producers for behavior signals needed by the intended tasks.
- The relationship between macro symbols and semantic outcomes.
- Stable UI component and region identifiers.

Do not prematurely standardize PrefixSpan (F-02) during this milestone's earlier task and data-collection stages.

The dedicated Fast Gate hardening stage should follow participant data collection and target-head preparation, as specified in the project sequence.

---

## 5. Model preparation and participant-data pipeline

The model-preparation work must be planned around the new task-oriented outcome vocabulary and the actual traces that the testbed will collect.

The existing foundation model and training pipeline are valuable assets. Preserve them unless repository inspection establishes a concrete reason for changing them.

### 5.1 Trace schema and semantic labels

Plan how the testbed will export:

- Existing behavioral events and MicroTensor windows.
- Macro-interaction sequences.
- UI context and semantic annotations.
- Task ID and task-definition version.
- Session and pseudonymous participant identifiers.
- Task start, completion, timeout and abandonment metadata.
- Semantic task outcomes.
- Prediction and intervention traces, where available.

Retain existing generic outcome fields during the additive collection phase.

Add the semantic outcome field or equivalent without silently changing the meaning of existing schema fields.

The plan must define schema/version compatibility and migration requirements.

### 5.2 Target UI annotations

Use the existing `data-aui-component` contract as the canonical component identifier unless repository inspection establishes a better existing abstraction.

Do not introduce a parallel identifier system unnecessarily.

Plan the minimum additional annotations:

- `data-aui-region` for major UI regions.
- Stable identifiers for filter sections.
- Semantic roles and actions for report controls.
- Stable report IDs and current-report context.
- Relevant state information needed for task verification and intervention targeting.

The testbed should supply these annotations. The framework should consume them through generic UI-context contracts.

Do not introduce full DOM snapshots or unrestricted DOM scraping unless a specific requirement justifies them.

### 5.3 Participant trace collection readiness

Before participant collection, the implementation must provide:

- Reproducible task starting states.
- Reliable task completion and abandonment records.
- Correct semantic action recording.
- Consistent timestamps and session identifiers.
- Stable task and schema versions.
- Validated UI annotations.
- Baseline/adaptive condition metadata.
- Exported traces that can be consumed by the model-preparation pipeline.

Plan a scripted pre-collection validation using all four tasks under both conditions.

Do not prescribe arbitrary participant counts or claim statistical adequacy without a study design and supporting rationale.

### 5.4 Dataset generation and quality control

Plan the data-preparation changes required to turn testbed exports into Slow Gate training examples.

The plan must address:

- Trace validation and malformed-record handling.
- Reconstruction of behavioral sequences.
- Semantic outcome derivation and label provenance.
- Prediction timestamp and future-outcome labeling.
- History window and lookahead horizon configuration.
- Incomplete observation windows.
- Missing modalities and masks.
- Duplicate events.
- Participant/session-level splitting before sequence-window generation.
- Class distribution and participant coverage.
- Data leakage prevention.
- Reproducible preprocessing and dataset versioning.

The training target should represent a meaningful future task-related UI action, not merely the most recent click.

At prediction time \(t\):

- Inputs must contain only behavioral and UI-context information available at or before \(t\).
- The target should be a qualifying semantic outcome occurring after \(t\), within the configured prediction horizon.
- Future UI state, future interactions and post-intervention evidence must not leak into the input.

### 5.5 History window and prediction horizon

The current foundation configuration uses eight 500 ms windows with a 250 ms stride and a 1,000 ms lookahead in the previous outcome-generation setup.

Do not assume these values are optimal for the new task-oriented vocabulary.

Plan a small, controlled experiment that evaluates history-window and prediction-horizon configurations separately.

The experiment should consider:

- Frequency of each semantic outcome.
- Time between meaningful task actions.
- Prediction usefulness and lead time.
- Per-outcome precision, recall and F1.
- Class imbalance.
- False early predictions.
- Incomplete observation windows.

Do not expand the search into an open-ended hyperparameter exercise. Propose a small set of defensible configurations and explain how the final configuration will be selected.

### 5.6 Target-head taxonomy migration

The current Slow Gate foundation model uses a generic seven-class outcome taxonomy.

The new target head must eventually predict the agreed semantic task-oriented outcomes.

Plan:

1. How the existing foundation representation and model weights can be preserved.
2. How the target head output dimension and label mapping will change.
3. How training configuration and source-of-truth taxonomy will be updated.
4. How class weighting and rare-outcome handling will be evaluated.
5. How model evaluation will be performed on participant-held-out data.
6. How the updated model will be exported and integrated into the browser runtime.
7. How the previous model and taxonomy will remain reproducible.

The model-preparation repository's canonical configuration must remain the source of truth. Do not independently hand-edit generated framework configuration.

Do not assume that the existing generic target head can be directly relabeled without retraining.

### 5.7 Evaluation requirements

At minimum, plan evaluation for:

- Per-class precision, recall and F1.
- Macro-F1 and appropriate aggregate metrics.
- Confusion matrix.
- Class distribution and majority baseline.
- Participant-held-out performance.
- Task-level performance.
- Prediction lead time.
- Calibration or confidence reliability, where supported.
- Model size and browser inference latency.

Separate model-prediction evaluation from user-experience evaluation.

A successful prediction does not prove that an intervention improves task performance.

---

## 6. Fast Gate and arbitration

The implementation sequence must preserve the researcher's intended order:

1. Task and testbed implementation.
2. Participant trace collection.
3. Slow Gate target-head retraining and evaluation.
4. Fast Gate hardening, especially PrefixSpan correctness (Quality assessment 2 finding F-02).
5. Intervention refinement and final integration validation.

The implementation plan should include Fast Gate work as a later phase, not prematurely mix algorithm optimization into task implementation.

The later Fast Gate phase should address:

- Correct PrefixSpan sequence matching.
- Pattern declaration and support semantics.
- Minimum support and sequence-length configuration.
- Sequence boundaries and session isolation.
- Match confidence or strength.
- Pattern-to-semantic-outcome mapping.
- Correct handling of no-match cases.
- Deterministic and reproducible tests.
- Performance and memory behavior on realistic sequences.
- Alignment with the new task traces.

Both gates must produce the same normalized prediction-result contract.

Arbitration should decide which prediction is used, not translate testbed-specific DOM selectors or task definitions.

The plan must document:

- Gate invocation and fallback rules.
- Fast Gate match behavior.
- Slow Gate invocation conditions.
- Conflict handling.
- No-match behavior.
- Prediction provenance.
- How the policy receives the final normalized prediction.

Avoid redesigning arbitration without evidence that the existing mechanism cannot support the requirements.

---

## 7. Intervention refinement and visual verification

Interventions must be useful, visible and appropriate to the predicted semantic outcome.

They must not be implemented as task-specific behavior embedded in the framework core.

### 7.1 Policy and intervention mapping

Plan a testbed-specific policy mapping from semantic outcomes and UI context to intervention commands.

Examples:

| Predicted outcome | Possible policy response                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `select_report`   | Highlight the relevant report-selection control or offer contextual guidance           |
| `select_filter`   | Highlight the appropriate filter section or control                                    |
| `apply_filter`    | Highlight the Apply action if the user appears unlikely to commit the selected filters |
| `export_report`   | Highlight the export control or provide a concise tooltip                              |
| `backtrack`       | Offer contextual navigation assistance where appropriate                               |

These are candidate mappings, not mandatory interventions for every prediction.

The policy should be conservative. A predicted action does not always justify an intervention.

The plan must identify how confidence, context, intervention history and cooldowns prevent unnecessary or repetitive assistance.

### 7.2 Visual and behavioral requirements

Verify that interventions:

- Target the correct semantic UI element.
- Are visually noticeable without overwhelming the interface.
- Use consistent styling.
- Do not obscure important controls or content.
- Do not cause layout shifts that disrupt interaction.
- Do not interfere with normal pointer, keyboard or form behavior.
- Can be dismissed or naturally expire where appropriate.
- Do not repeatedly trigger for the same unresolved condition.
- Remain distinguishable from ordinary UI styling.
- Work at the target testbed's supported viewport sizes.

Assess all existing intervention types, including:

- `highlight_primary_action`
- `simplify_options`
- `expand_tooltip`
- `offer_assistance`
- `no_op`

Do not assume these interventions currently work correctly or are neccessary merely because their command types exist.

### 7.3 Verification

Plan visual and functional verification for every intervention type that remains in scope.

Include:

- Correct target resolution.
- Visible rendered state.
- Appropriate style and placement.
- Dismissal and cleanup.
- No unintended DOM mutation.
- No duplicate intervention.
- No interference with task completion.
- Behavior when the target element is missing.
- Baseline condition verification: no adaptive intervention should be applied.
- Adaptive condition verification: only configured policy actions should be applied.

Use screenshots or browser-based checks where useful, but include functional assertions as well.

The final report must distinguish visually verified interventions from those verified only by source inspection or unit tests.

---

## 8. Deployment and academic-evaluation readiness

The final implementation must be suitable for another supervisor review and controlled participant evaluation.

Plan the deployment work needed to establish a reproducible release.

Include:

- Production build verification.
- Correct ONNX runtime asset packaging and loading.
- Model artifact availability and version identification.
- Worker initialization and inference.
- Baseline/adaptive runtime behavior.
- Trace persistence and export.
- Environment configuration.
- Supabase integration where currently used.
- Error handling and useful diagnostic logging.
- Browser compatibility checks within the intended study environment.
- Build and deployment documentation.
- Reproducible test instructions.
- A concise demonstration path for the supervisor.

Do not introduce unnecessary production infrastructure.

The target is a reliable research prototype, not a commercial product.

Any deployment performance claims must be based on actual measurements. Do not reuse historical WebGPU performance claims if the deployed runtime uses WASM.

---

## 9. Required implementation phases

Organize the proposed work into sequential phases with explicit dependencies.

Use this suggested structure, adjusting it only when repository evidence justifies doing so:

| Phase | Scope                                                                    | Main deliverable                                               |
| ----- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 0     | Repository audit and implementation baseline                             | Verified gap register and dependency map                       |
| 1     | Task harness, UI fixes and TD1–TD4 implementation                        | Reproducible, state-verified tasks                             |
| 2     | Framework contracts, event canonicalization and semantic trace recording | Interface-agnostic framework with reliable testbed integration |
| 3     | Scripted validation and participant trace readiness                      | Validated exports and collection-ready deployment              |
| 4     | Testbed dataset preparation and Slow Gate target-head retraining         | Evaluated semantic-outcome model                               |
| 5     | Fast Gate / PrefixSpan hardening and shared arbitration                  | Consistent gate predictions                                    |
| 6     | Policy and intervention refinement                                       | Verified, useful adaptive UI behavior                          |
| 7     | Final integration, deployment and academic evaluation readiness          | Supervisor-ready release                                       |

Phases may contain parallelizable work, but clearly identify dependencies and avoid scheduling model retraining before usable participant traces exist.

For each phase, specify:

1. Objective.
2. Current-state findings.
3. Required implementation work.
4. Relevant repositories and source files.
5. Architectural considerations.
6. Dependencies and prerequisites.
7. Tests and verification.
8. Acceptance criteria.
9. Deliverables.
10. Risks and deferred work.

Identify tasks that can be performed independently and tasks that must remain sequential.

---

## 10. Architecture and configurability requirements

The implementation should remain lightweight and configurable.

Assess which values should be configuration-driven rather than hardcoded:

- Telemetry and feature parameters.
- History-window and prediction-horizon settings.
- Macro symbol mappings.
- PrefixSpan parameters.
- Model artifact and inference configuration.
- Outcome mappings.
- Arbitration behavior.
- Policy rules.
- Intervention styling and behavior.
- Runtime feature flags.

Do not make every internal implementation detail configurable. Identify a sensible configuration boundary that supports rapid experimentation without making integration unnecessarily complicated.

The testbed should be able to define its own:

- UI annotations.
- Task definitions.
- Semantic outcome vocabulary.
- Macro-interaction mappings.
- Intervention targets.
- Policy mappings.

The framework should provide generic contracts, reusable processing and execution mechanisms.

If another application uses a different set of pages, actions and outcomes, integrating it should not require modifying framework core source code.

Document the proposed integration boundary and demonstrate it conceptually with a second, hypothetical UI vocabulary. Do not implement a second application.

---

## 11. Required report deliverable

Create a Markdown implementation plan in the framework repository, preferably:

`docs/plan/3/next-milestone-implementation-plan.md`

`docs/plan/3/workstream/*/work.md`

`docs/plan/3/workstream/*/tasks/*.md`

The report must be comprehensive enough to guide an implementation agent through the milestone without another broad architectural assessment.

Use this structure:

### 1. Executive Summary

This section is crucial.

It must provide, at a glance:

- Overall implementation objective.
- Confirmed researcher decisions.
- The approved task set.
- Major workstreams.
- Implementation phases and dependencies.
- Key framework architecture constraints.
- Main deliverables.
- Open decisions, especially Decision 6.
- Definition of completion.

A reader should understand the scope and implementation sequence without reading the full document.

### 2. Current-State Assessment

Summarize verified findings from both repositories and the UI assessment.

Identify already-completed work and remaining gaps.

### 3. Target Architecture and Responsibility Boundaries

Describe the intended separation between framework core, testbed integration, model preparation and deployment.

Include a component/data-flow diagram where useful.

### 4. Detailed Implementation Phases

For every phase, document the work, source locations, dependencies, tests and acceptance criteria.

### 5. Target UI and Task Implementation

Detail TD1–TD4, state verification, task lifecycle, UI modifications and semantic annotations.

### 6. Framework Changes

Detail interface-agnostic contracts, event canonicalization, semantic outcome integration, gate result normalization, arbitration and actuator boundaries.

### 7. Model-Preparation Changes

Detail trace ingestion, data preparation, semantic target generation, window/horizon experiments, retraining, evaluation and export.

### 8. Fast Gate and PrefixSpan

Detail the later hardening scope and its relationship to the shared prediction contract.

### 9. Policy and Intervention Refinement

Detail the policy mapping, target resolution, visual requirements and verification plan.

### 10. Testing and Acceptance Matrix

Map each important requirement to its verification method and acceptance condition.

### 11. Deployment and Academic-Evaluation Readiness

Define the release requirements and supervisor demonstration path.

### 12. Risks, Open Decisions and Deferred Work

Separate blockers from decisions that can wait.

### 13. Final Definition of Done

Provide a checklist covering the complete milestone.

---

## 12. Definition of Done

The plan must define completion in terms of verifiable outcomes.

At minimum, the final implementation must satisfy the following.

### Target UI and tasks

- [ ] TD1–TD4 are implemented with new task identifiers.
- [ ] Starting states are normalized and reproducible.
- [ ] Completion is verified against actual UI state.
- [ ] Timeout, abandonment and failure behavior are explicit and tested.
- [ ] Reports catalogue and report presets work correctly.
- [ ] Reset Filters clears both draft and applied state.
- [ ] The inert Customer Segment control is removed.
- [ ] Filter and report state remain consistent across navigation.
- [ ] Canonical user actions do not generate duplicate task interactions.
- [ ] All canonical task paths complete without spurious errors.

### Framework

- [ ] Framework core remains independent of testbed tasks and UI outcome identifiers.
- [ ] Application-specific behavior is supplied through integration contracts and configuration.
- [ ] Semantic outcome derivation is separated from generic event collection.
- [ ] Both gates can return the same normalized prediction contract.
- [ ] Arbitration and policy remain independent of DOM selectors.
- [ ] The actuator resolves application-provided semantic targets.
- [ ] Existing generic behavior and supported integrations are not unnecessarily broken.

### Model preparation

- [ ] Participant traces can be exported and ingested reproducibly.
- [ ] Semantic outcomes are correctly recorded and versioned.
- [ ] Training examples use only information available at prediction time.
- [ ] Participant/session leakage is prevented.
- [ ] Outcome coverage and class imbalance are measured.
- [ ] History-window and prediction-horizon choices are evaluated.
- [ ] The target head is trained and evaluated on the agreed semantic vocabulary.
- [ ] The exported model is compatible with the browser runtime.

### Fast Gate and arbitration

- [ ] PrefixSpan behavior is covered by deterministic tests.
- [ ] Declared patterns represent the intended task-related sequences.
- [ ] Pattern matches map correctly to semantic outcomes.
- [ ] No-match and fallback behavior are correct.
- [ ] Both gates produce compatible results for the shared policy.

### Interventions

- [ ] Each in-scope intervention is functionally verified.
- [ ] Applied interventions are visibly noticeable and appropriately styled.
- [ ] Targets are semantically correct.
- [ ] Interventions do not disrupt normal UI use or task completion.
- [ ] Repeated and inappropriate interventions are controlled.
- [ ] Baseline mode remains free of adaptive interventions.

### Deployment and evaluation

- [ ] Production build succeeds.
- [ ] Runtime assets and model load correctly in the deployed environment.
- [ ] The end-to-end telemetry → gates → arbitration → policy → actuator path is verified.
- [ ] Research traces persist or export correctly.
- [ ] Deployment instructions are reproducible.
- [ ] Known limitations and actual performance measurements are documented.
- [ ] The project is ready for supervisor interaction, academic reassessment and the next participant-study stage.

---

## 13. Final instructions

The plan should be implementation-oriented, not a theoretical architecture proposal.

Be specific about files, modules, contracts, tests and acceptance criteria wherever repository evidence supports it.

Prioritize the smallest coherent implementation that achieves the research objective.

Do not:

- Implement changes while preparing this plan.
- Rebuild completed model-preparation work without justification.
- Redesign the UI beyond the approved task requirements.
- Couple framework core to TD1–TD4 or their outcome identifiers.
- Optimize PrefixSpan before the planned stage.
- Expand the participant study or data pipeline into an unnecessarily complex research platform.
- Introduce unrelated features or production infrastructure.
- Claim that a requirement is satisfied without evidence.

Where a design choice is not yet settled, document the alternatives, trade-offs and recommended default rather than silently making the decision.

**The final report must provide a clear, dependency-aware route from the current repository state to a deployable, demonstrable and academically assessable Edge-AUI research prototype.**
