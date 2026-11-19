# Next-Milestone Implementation Plan — Edge-AUI

- **Date:** 2026-11-16 (amended 2026-11-19)
- **Status:** Planning complete — no application code, configuration, model, dataset or deployment change was made
- **Framework baseline:** `edge-aui-framework` branch `feat/refinement`, commit `25033a8`
- **Model baseline:** `model-preparation` commit `cbab411`
- **Authoritative inputs:** [`task-diversification-ui-assessment.md`](../../assessments/task-diversification-ui-assessment.md), [`revised-implementation-planning.md`](../../revised-implementation-planning.md), existing ADR register, both repositories' source and tests
- **Plan version:** `1.2.0`
- **Amendment 1.1.0 (2026-11-18):** the semantic **target** vocabulary is pinned to the approved 14
  IDs; the runtime additionally records `inspect_help` as evidence and that ID is excluded from
  training targets ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).
  Dataset splits are **session-bounded**, with task-level coverage reported
  ([ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md)). Assessment limitation #6's
  residual items remain open and are tracked in §2.8.
- **Amendment 1.2.0 (2026-11-19):** participant traces now exist (39 exported; 35 verified after
  a local provenance retrofit of a mislabelled export). 40.3 was re-run on participant evidence
  and selects **D (12×500 ms) provisionally**; the scripted selection (C) is not confirmed.
  `v2.1.0-participant` is the participant dataset, and Task 50.2's candidates are derived from
  participant macro sequences. 40.4 remains blocked until further collection re-confirms the
  configuration; no participant-held-out claim is made.

**Evidence labels**

| Label | Meaning |
| --- | --- |
| **Verified** | Established from current source, tests or the running testbed in this planning pass |
| **Inferred** | A likely implication that still needs confirmation |
| **Proposed** | A recommended implementation or design decision |
| **Open decision** | Requires researcher or supervisor approval |

No test run, model metric, deployment measurement or participant result is asserted in this plan
unless it is already recorded in the repository and labelled as historical. Phase 0 exists to
re-establish the executable baseline before implementation begins.

---

## 1. Executive Summary

### 1.1 Overall implementation objective

Deliver the next Edge-AUI milestone: the approved four-task testbed (TD1–TD4) with reproducible
starting states and state-verified completion; an interface-agnostic framework that records and
consumes semantic task outcomes without coupling its core to the Analytics dashboard; an additive
semantic trace contract; a model-preparation path that can ingest those traces and train a
task-oriented target head on real participant data; a later Fast Gate/PrefixSpan hardening stage;
and verified, useful, correctly targeted interventions in a reproducible deployment.

The milestone is explicitly **not** a general UI redesign, a participant study protocol, or a
premature PrefixSpan optimisation. Those remain outside this scope.

### 1.2 Confirmed researcher decisions

These are constraints, not open questions. The plan does not reopen them.

| Decision | Approved direction | Plan consequence |
| --- | --- | --- |
| Reports catalogue / TD4 | Approved | Phase 1 adds the Reports catalogue, deterministic presets, report selection and current-report state |
| Customer Segment filter | Remove; do not implement a segment-based task | Remove the control and `segment` from the testbed filter state; no semantic `select_segment` outcome in this milestone |
| Task identifiers | New IDs `TD1`–`TD4` | Task type, configuration keys, timeouts and trace task-definition version use TD1–TD4 |
| Task completion | Verify required UI state, not control-touch order | Testbed-owned state snapshots and completion predicates; `task_complete` only after the predicate passes |
| Task timeout | Implement timeout handling and explicit abandonment/failure semantics | `TaskStatus` gains `Failed`; timeout and abandonment are distinct, tested lifecycle outcomes |
| TD5 hover/inspection task | Excluded from this milestone | No TD5, no hover task-action work; `inspect_kpi`/`inspect_help` stay out of scope |

### 1.3 Approved task set

| ID | Task | Starting point | Main flow | Required completion evidence |
| --- | --- | --- | --- | --- |
| **TD1** | Regional sales export | Overview | Analytics → Region → Europe → Apply → Export | Region = Europe; 18 visible rows; export action recorded |
| **TD2** | Date and category filter | Analytics | Date Range → 2025-06-01 → Product Category → Books → Apply | Correct date and category state; 5 visible rows |
| **TD3** | Empty-result recovery | Analytics | Europe → Books → 2025-09-01 → Apply → observe empty state → Reset Filters | Empty state observed; filters reset; 50 rows restored |
| **TD4** | Report comparison and export | Reports | Open Europe Electronics → return to Reports → Open Europe Books → Export | Both reports visited; Europe Books active; 6 visible rows; export action recorded |

Counts are deterministic properties of the current stimulus generator (`seed = 20250921`) and must
be re-verified in Phase 0. They are not participant measurements.

### 1.4 Major workstreams

| Workstream | Scope | Primary deliverable |
| --- | --- | --- |
| [00 — Baseline and governance](workstream/00-baseline/work.md) | Baseline lock, gap register, dependency map, test baseline | Verified current-state record and execution baseline |
| [10 — Testbed tasks and UI](workstream/10-testbed-tasks/work.md) | TD1–TD4, task harness, Reports catalogue, Reset Filters, annotations, task lifecycle | Reproducible, state-verified task set |
| [20 — Framework contracts](workstream/20-framework-contracts/work.md) | Prediction contract, application vocabularies, semantic derivation, trace schema 1.4, actuator resolver | Interface-agnostic framework with reliable testbed integration |
| [30 — Validation and collection](workstream/30-collection-validation/work.md) | Scripted TD1–TD4 runs, trace verification, collection readiness | Validated exports ready for participant collection |
| [40 — Model preparation](workstream/40-model-preparation/work.md) | Trace ingestion, semantic targets, window/horizon experiment, retraining, evaluation, export | Evaluated semantic-outcome target head |
| [50 — Fast Gate and arbitration](workstream/50-fastgate-arbitration/work.md) | PrefixSpan correctness, pattern semantics, shared arbitration | Consistent, tested gate predictions |
| [60 — Policy and interventions](workstream/60-policy-interventions/work.md) | Outcome→intervention mapping, target resolution, visual/functional verification | Verified adaptive behaviour |
| [70 — Deployment readiness](workstream/70-deployment-readiness/work.md) | Build, assets, persistence, browser checks, demo | Supervisor-ready release |

The task-list target for this milestone is the per-workstream `tasks/*.md` files, indexed in
Appendix A. The repository's older `tasks/todo.md` is a completed prior-milestone record and is not
overwritten.

### 1.5 Implementation phases and dependencies

| Phase | Scope | Depends on | Exit condition |
| --- | --- | --- | --- |
| **0** | Baseline lock and gap register | — | Commits, test baseline, counts and known gaps recorded |
| **1** | Task harness, UI fixes, TD1–TD4 | 0 | Four tasks complete on canonical paths from normalized starts; timeout/abandon/failure tested |
| **2** | Framework contracts, canonicalization, semantic trace | 1 (annotations/events); 2.1 may start after 10.1 | Framework core no longer contains testbed page/task/selector assumptions; semantic outcomes recorded in 1.4 traces |
| **3** | Scripted validation and participant readiness | 1, 2 | TD1–TD4 pass under baseline and adaptive conditions; exports ingestible; collection checklist green |
| **4A** | Dataset and target-generation preparation | 2 (trace schema), 3 (scripted exports) | Semantic dataset, provenance, splits and window/horizon experiment runnable |
| **4B** | Participant collection and target-head retraining | 3, participant traces, 4A | Semantic target head trained, evaluated on held-out participants/tasks, exported |
| **5** | Fast Gate / PrefixSpan hardening and shared arbitration | 4B (per intended order), 3 | Deterministic PrefixSpan tests, pattern semantics and normalized gate results pass |
| **6** | Policy and intervention refinement | 2, 4B, 5 | Every in-scope intervention functionally and visually verified; baseline remains inert |
| **7** | Final integration, deployment, academic readiness | 1–6 | Reproducible build, deployed runtime, documented limitations and demo path |

Phase 4 is deliberately split. **Model retraining must not start before usable participant traces
exist.** Phase 4A may prepare and smoke-test the pipeline on scripted traces; Phase 4B is blocked
on the collection phase.

### 1.5.1 Parallelisation summary

| Work | Can start after | Must remain sequential because |
| --- | --- | --- |
| 10.1–10.2 UI/IDs/task model | Phase 0 | Task IDs/annotations are the contract for later tasks |
| 20.1–20.2 contracts/boundary | 10.1–10.2 | The semantic/trace layer must target stable annotations and task IDs |
| 10.3–10.6 task harness | 10.1–10.2 | Filter state, reports, predicates, canonical actions all share task state |
| 20.3–20.5 gate/semantic/trace | 20.1–20.2 | Schema fields depend on the chosen vocabulary/boundary |
| 30.1 scripted driver | 10.x + 20.x | It exercises the actual task/trace path |
| 40.1–40.2 ingestion/targets | 20.5 + 30.2 | Ingestion/dataset consume the 1.4.0 trace |
| 40.3 window/horizon | 40.2 | It needs semantic labels/dataset |
| 40.4–40.5 retraining/export | 40.3 + participant traces | No retraining before usable participant data |
| 50.1–50.3 Fast Gate/arbitration | 30.1; final after 40.4 | Correctness can start early; pattern alignment waits for real traces/target prep |
| 60.1 policy mapping | 20.1/20.4; final after 40.4/50.3 | Mapping can be built early; verification needs the selected head/gates |
| 60.2 intervention verification | 60.1 | It verifies the mapping/targets |
| 70.1–70.2 deployment | 1–6 | Final release needs the complete path |

**Safe to parallelise:** independent UI tests, model-preparation dataset components, documentation,
and the second-adapter boundary test once 20.2 lands. **Must be sequential:** task schema → trace
schema → ingestion; dataset version → training; training → Fast Gate alignment; all → final
deployment acceptance.

### 1.6 Framework architecture constraints

1. **No testbed vocabulary in the framework core.** The core must not require `select_report`,
   `apply_filter`, `TD1`–`TD4`, `Analytics`, `Reports`, `nav-Analytics`, `btn-export`,
   `filter-drawer`, or the testbed route list. Application vocabularies, macro mappings, pattern
   maps, policy mappings and target resolvers are supplied by integration/configuration.
2. **The testbed owns task definitions and completion predicates.** The framework owns only the
   generic task-lifecycle contract and trace fields. The testbed may contain task-specific logic;
   the framework may not.
3. **Both gates produce the same normalized prediction contract.** The policy consumes a
   gate-agnostic predicted outcome plus context. An intervention command is a policy output, not a
   gate output.
4. **Semantic outcomes are additive during collection.** The existing seven-class generic
   outcome field remains; `taskOutcome` (or the approved equivalent) is recorded alongside it. The
   Slow Gate is not assumed to predict semantic outcomes until it is retrained.
5. **One canonical clock and strict schema versioning.** Trace schema 1.4.0 is additive and
   backward-readable; model-preparation declares the exact accepted key set.
6. **Privacy and provenance remain enforced.** No new behavioural egress path; scripted and
   participant traces never pool; no service-role key in a browser build.
7. **No premature optimisation.** PrefixSpan hardening follows participant collection and target
   head preparation. Do not mix it into Phase 1 or Phase 2.

### 1.7 Main deliverables

- TD1–TD4 with normalized starts, state predicates, timeout/abandon/failure semantics and tests.
- Reports catalogue, report presets, current-report indicator, Reset Filters and filter-state
  consistency; inert segment removed.
- Framework contracts for normalized predictions, application-supplied macro/context/outcome
  vocabularies, semantic derivation and actuator target resolution.
- Trace schema 1.4.0 with semantic task outcome, task-definition version and normalized prediction
  fields, plus cross-repository compatibility.
- Scripted TD1–TD4 baseline/adaptive validation and participant-collection readiness evidence.
- Semantic target dataset, window/horizon experiment, retrained and evaluated task-outcome head,
  ONNX export and bundle manifest.
- Hardened Fast Gate/PrefixSpan, shared arbitration and no-match behaviour.
- Verified policy/intervention behaviour and a supervisor-ready deployment/demo path.
- New ADRs 025–031 and updated schema/architecture documentation.

### 1.8 Decision 6 — settled vocabulary and split policy

**Decision 6 — semantic outcome taxonomy migration.** The approved planning baseline is additive
semantic recording. The vocabulary and the split unit were settled on 2026-11-18; the remaining
rows are unchanged from the planning baseline.

| Decision | Status / approved value | Why it matters |
| --- | --- | --- |
| Field name and version | Implemented as `taskOutcome` + `taskOutcomeVocabularyVersion` in trace schema 1.4.0; retained unless a rename is approved (ADR-026 deferment) | Both runtime and ingestion must agree before collection |
| **Target vocabulary** | **Settled:** the 14 IDs in §3.4. The runtime records one further ID, `inspect_help`, as evidence; it is excluded from targets and its windows are excluded and counted — [ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md) | Determines the semantic head's output dimension (14) and evaluation |
| **Split unit** | **Settled:** session-bounded splits with task-level coverage; participant-bounded only when ADR-023 approves an identifier — [ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md) | Determines the leakage-control unit and what the evaluation may claim |
| Lifecycle exclusion | `task_complete`/`task_abandon` are evaluation labels, not prediction targets | Prevents task-script leakage into the model |
| Migration point | Record additively through Phases 3–4A; swap model taxonomy/config/output only in Phase 4B | Avoids an untrained seven-class head claiming semantic predictions |
| Generic taxonomy retention | Keep seven-class `outcome` and `outcome_taxonomy` through collection | Backward compatibility and ablation |
| Label horizon | Start with the existing `[500, 1500] ms` and compare a small controlled set in Phase 4A | Determines future-outcome labels |

The vocabulary and split decisions are recorded; the label horizon is still selected by the 40.3
experiment. Retraining (4B) remains blocked on usable participant traces, not on taxonomy approval.

Other open decisions are listed in §12.2. The approved decisions in §1.2 are not reopened.

### 1.9 Definition of completion (summary)

The milestone is complete only when: TD1–TD4 pass state-verified canonical runs; timeout,
abandonment and failure are explicit and tested; Reports/reset/filter consistency are verified;
the framework core contains no testbed page/task/selector vocabulary; semantic outcomes are
recorded and ingested additively; a semantic target head is trained, evaluated and exported; the
Fast Gate/PrefixSpan behaviour is deterministic and tested; interventions are functionally and
visually verified with baseline inert; and a reproducible deployed build and supervisor demo path
exist. The full checklist is §13.

---

## 2. Current-State Assessment

### 2.1 Repositories and baseline

| Repository | Baseline | State |
| --- | --- | --- |
| `edge-aui-framework` | branch `feat/refinement`, commit `25033a8` | Working tree clean apart from the planning/assessment documents added for this milestone |
| `model-preparation` | commit `cbab411` | Working tree clean |

This planning pass inspected both repositories, the complete assessment report, the existing
plans and ADRs, the trace schemas, gate/policy/actuator code, the model-preparation pipeline,
scripts, tests and current model artifacts. It did not execute the full test suites; Phase 0 does.

No source, configuration or artifact change was made in either repository between the production
of the task-diversification assessment and this planning pass; both working trees are clean apart
from the planning/assessment documents. The assessment's UI/task findings therefore remain the
current baseline rather than historical observations.

**Historical artifact note.** `model-preparation/models/bundles/v1.0.0/bundle.json` records the
previous five-class intervention head: dataset `v1.0.0`, input `(batch, seq_len, 18)` + `(batch, 6)`,
output `(batch, 5)`, test Macro-F1 `0.5524`, accuracy `0.767`. These are historical values for a
different target; they must not be presented as performance of the future semantic head.

### 2.2 What is already implemented

| Area | Implemented | Evidence |
| --- | --- | --- |
| Testbed shell | Five pages; Analytics filters/KPIs/results/export; trial controls; debug panel | `src/app/App.tsx`, `src/testbed/components/*` |
| Task model | Legacy T1–T3, strict ordered step matching, lifecycle events | `src/testbed/tasks/taskModel.ts`, `taskManager.ts` |
| Telemetry | Passive observer, canonical events, geometry, epoch clock, 18-D MicroTensor windows | `src/telemetry/*`, `src/microtensor/*` |
| Macro stream | 26 macro symbols, sequence history, WASM PrefixSpan gateway | `src/macro/*`, `src/gates/fast/*` |
| Gates | Mock and ONNX slow gate, dual-gate arbitration, per-gate latency | `src/gates/*` |
| Policy/actuation | Confidence, persistence, cooldown, dismissal, TTL; five interventions; non-destructive actuator | `src/intervention/*` |
| Trace | Schema 1.3.0, policy decisions, provenance, predictions, interventions, task events | `src/telemetry/traceSchema.ts`, `recorder.ts` |
| Integration | `UiAdapter` port, testbed adapter, session persistence, participant identity, collection gate, Supabase/Cloudflare deployment | `src/integration/*`, `src/telemetry/*`, `docs/deploy/*` |
| Model preparation | Foundation GRU, five-class intervention head, scripted traces, target dataset, session splits, class weights, training/eval, ONNX export, reproducibility bundle, trace ingestion 1.3.0 | `model-preparation/src/*`, `models/*` |
| Assessment | Task diversification assessment with approved decisions in the planning directive | `docs/assessments/task-diversification-ui-assessment.md` |

### 2.3 Verified gaps

| Area | Verified gap | Consequence |
| --- | --- | --- |
| Tasks | Legacy T1–T3 only; all start on Analytics; T2 is navigation + export; T3's segment step is inert | Task set does not exercise the approved diversity |
| Completion | `TaskManager` matches component ID + action only; no value/state predicate | Wrong region/report can be marked complete |
| Timeout/failure | `taskTimeoutsMs` exists but is unused; `TaskStatus` has no `Failed` | A stalled trial remains `In Progress`; no explicit failure |
| Task start | No `startingPage`, filter reset, accordion reset, report reset or error reset | Starting state depends on prior activity |
| Filter state | `App.appliedFilters` and `FilterDrawer` draft state are separate; drawer resets on navigation | Table and controls disagree after navigation |
| Reset Filters | No control; Reset Trial does not clear filters | TD3 cannot be implemented as approved; tasks are contaminated |
| Reports | Reports is a placeholder; no catalogue, presets or current-report state | TD4 cannot be implemented |
| Segment | Control exists; `applyFilters()` ignores `segment` | Dead control; approved removal not done |
| IDs/annotations | Filter sections use spaces; no `data-aui-region`; report controls absent | Brittle task matching and weak intervention targeting |
| Action duplication | Checkbox `click`/`input`/`change` and Apply `click`/`submit` are not canonicalised | Spurious `task_error`; duplicate outcomes |
| Task replacement | Starting a new task mid-trial overwrites state without abandonment; condition can switch mid-task | Silent trial loss/contamination |
| Outcome derivation | `OutcomeDeriver` ignores `change`/`input`/`submit`; `btn` heuristic labels Export as `FORM_SUBMIT`; `blur` is `BACKTRACK` | Semantic actions are invisible or wrong |
| Macro symbols | Testbed-specific symbols/IDs live in framework core; `tooltip-region` becomes `SELECT_REGION`; row hover is `TABLE_ROW_SELECT`; several symbols have no producer | Boundary violation and noisy/misleading evidence |
| Framework coupling | `contextVector.ts` hardcodes five routes and T1–T3 step counts; `boot.ts` holds testbed patterns; `onnxSlowGate.ts` hardcodes outcome/intervention orders; `actuator.ts` hardcodes `filter-drawer` | Second UI would require core edits |
| Gate contract | Fast/Slow gates return interventions directly; policy consumes an intervention, not a predicted outcome | Both gates cannot share one policy contract |
| Trace | Schema 1.3.0 has no semantic task outcome or task-definition version | New labels cannot be collected/ingested |
| Model prep | Target dataset labels are five intervention classes; target outcome is the generic seven-class label; config has no semantic taxonomy; target head output is 5 | Cannot train a semantic-outcome head |
| Scripted harness | Model-preparation script still drives T1–T3 with `EMEA`/`Enterprise` and old controls | Scripted validation cannot exercise TD1–TD4 |
| Documentation | `docs/architecture.md` still says "Thirty symbols" while source has 26; schemas name T1–T3; model-preparation docs describe the five-class head | Drift and misleading instructions |

### 2.4 Framework/testbed boundary violations (verified)

| Location | Violation | Required direction |
| --- | --- | --- |
| `src/macro/symbols.ts` | Hard-coded `NAV_ANALYTICS`, `btn-export`, `filter-Region`, `tooltip-region`, etc. | Move testbed macro mapping to testbed integration; framework exposes a generic mapper contract |
| `src/types/contextVector.ts` | Hard-coded `ROUTE_VOCABULARY` and `TASK_STEP_COUNTS` for T1–T3 | Accept route/task/step configuration from the integration; move testbed values out of core |
| `src/runtime/boot.ts` | `TESTBED_FAST_GATE_PATTERNS` and testbed task comments in framework runtime | Move patterns to testbed composition/configuration and inject them |
| `src/gates/slow/onnxSlowGate.ts` | Hard-coded `OUTCOME_CLASS_ORDER` and `TARGET_INTERVENTION_ORDER` | Accept vocabulary mappings and model metadata from configuration |
| `src/intervention/actuator.ts` | Hard-coded `filter-drawer` in `simplify_options` | Inject a generic target resolver; testbed supplies the target ID |
| `src/telemetry/contextProvider.ts` | Default route `Overview` and implicit testbed page semantics | Make route resolution configurable; keep DOM annotation default generic |
| `src/outcome/derive.ts` | Generic seven-class taxonomy is acceptable as a fallback, but semantic mapping needs an application extension point | Add application-supplied semantic derivation, keep generic fallback |

### 2.5 Model-preparation state and gaps

**Implemented:** canonical trace ingestion for 1.3.0 (1.2.0/1.1.0 legacy), session-bounded splits,
class weights derived on the training partition, provenance manifest, scripted intervention labels,
five-class intervention-head training/evaluation, ONNX export and reproducibility bundle.

**Gaps relative to this milestone:**

- `src/trace_ingestion.py` accepts 1.3.0 only and does not allow semantic-outcome fields or a task
  definition version.
- `src/target_dataset.py` builds `(sequence, context, intervention class)` examples. Its
  `target_outcome` is the generic seven-class label, not a semantic task outcome.
- `src/target_generation.py` implements the generic click/scroll/hover lookahead policy. It has no
  committed-change, form-submit, report-selection or route-backtracking rules.
- `src/config.yaml` has `outcome_taxonomy` (7 classes), `target_intervention_vocabulary` (5
  classes) and `training.target_classes: 5`; no semantic vocabulary or semantic head dimension.
- `src/training.py` defines `TargetInterventionHead` with a fixed five-class projection.
- `src/export.py` validates a five-class `intervention_logits` graph and writes
  `intervention_head*.onnx`; there is no semantic-head export contract.
- The scripted harness `scripts/record_scripted_traces.py` drives T1–T3 and old values; it cannot
  validate TD1–TD4.
- The window/horizon choice (`T=8`, 500/250 ms, `[500, 1500] ms`) has not been evaluated for the
  semantic vocabulary.
- No semantic dataset version, semantic class distribution, held-out evaluation (session- or
  participant-bounded) or task-level evaluation exists yet.
- `docs/data_schemas.md` documents the five-class intervention head and old task IDs; it must be
  revised with schema 1.4.0 and the semantic head.

### 2.6 Work already completed that this plan preserves

- The foundation GRU and its training pipeline are preserved. The new head is additive; the
  foundation checkpoint is not overwritten.
- The five-class intervention head and `bundle/v1.0.0` are retained as the previous reproducible
  artifact and comparison basis.
- The 1.3.0 trace contract, single clock, policy-decision records, provenance gate, session
  persistence and deployment work are preserved; 1.4.0 is additive.
- The current Fast Gate tests and bounded-execution counters are preserved; Step 5 hardens them
  rather than replacing the miner boundary.
- The UI assessment's approved decisions are treated as fixed.

### 2.7 Evidence discipline

Phase 0 records the exact commit hashes, test outcomes and deterministic counts. Any material
difference from this plan (for example, a recommendation that has since been implemented) is
recorded in the Phase 0 gap register and the plan is adjusted before implementation. A plan task is
not "done" because the source file was edited; its acceptance criteria and verification commands
must pass.

### 2.8 Assessment limitation #6 — macro-symbol status (2026-11-18)

[Assessment limitation #6](../../assessments/task-diversification-ui-assessment.md) reported that
several macro symbols were misleading or unreachable. The workstreams that touched this area fixed
part of it; the rest is still open and must not be treated as closed by the vocabulary decision in
§3.4.

| Item (limitation #6) | Status 2026-11-18 | Where it is carried |
| --- | --- | --- |
| `tooltip-region` matches the `SELECT_REGION` substring rule | **Open in the macro stream.** The semantic layer orders exact-ID checks first, so `tooltip-region` derives `inspect_help`, never `select_region`; the macro mapper still checks `componentId.includes('region')` before its tooltip branch | WS50 (pattern semantics) / a follow-up macro fix |
| `TABLE_ROW_SELECT` emitted on row hover even though rows are not selectable | **Open.** Rows carry `data-aui-component="table-row-*"` and `data-aui-action="hover"`; the mapper derives `TABLE_ROW_SELECT` from the identifier | WS50 / macro follow-up |
| `RESET_FILTERS`, `OPEN_REPORT` have no control | **Closed** — Reset Filters (10.3) and the Reports catalogue (10.4) provide producers | WS10 record |
| `TABLE_PAGE_*`, `TABLE_SORT` have no control | **Open** — no pagination or sorting exists, and none is planned for TD1–TD4 | Explicitly out of scope; symbols must not be mined as if reachable |
| `EXPAND_TOOLTIP` reachable by clicking a tooltip `<span>` but produces no visible expansion | **Open** — the affordance is a native `title`; the click emits the symbol but nothing expands | WS50 / macro follow-up |
| `BACKTRACK`, `IDLE_DWELL`, `RAPID_SCROLL` have no producer | **Open in the macro stream.** The generic outcome layer derives `BACKTRACK`/`RAPID_SCROLL`, but no event action feeds the macro mapping | WS50 / macro follow-up |

The semantic target decision (§3.4, ADR-030) deliberately keeps the tooltip **exclusion rule** and
only narrows the target set to 14. Removing the rule, or mining symbols that no control produces,
would reintroduce the defect the assessment recorded.

---

## 3. Target Architecture and Responsibility Boundaries

### 3.1 Component and data flow

```text
┌──────────────────────────── Browser testbed (application integration) ─────────────────────────┐
│  React UI (Overview / Analytics / Reports / Customers / Settings)                              │
│      │ DOM events + data-aui-* annotations                                                     │
│      ▼                                                                                         │
│  Testbed task host ── task definitions TD1–TD4, state snapshot, completion predicates, timeout │
│      │                                                                                         │
│      ├──────────────► framework TaskLifecycleContract (generic state/lifecycle events)         │
│      │                                                                                         │
│      ▼                                                                                         │
│  framework TelemetryObserver ─► canonical BehaviourEvent ─► MicroTensor window/sequence        │
│                                      │                              │                          │
│                                      │                              ▼                          │
│                                      │                    application MacroMapper (testbed)    │
│                                      │                              │                          │
│                                      │                              ▼                          │
│                                      │                    Fast Gate (PrefixSpan)               │
│                                      │                              │                          │
│                                      │                              ▼                          │
│                                      └──────────────► application SemanticOutcomeDeriver       │
│                                                                     │                          │
│                                                                     ▼                          │
│                                                         normalized PredictionResult             │
│                                                         (outcome id, confidence, gate, refs)   │
│                                                                     │                          │
│                    Slow Gate (GRU/ONNX, configured vocabulary) ─────┘                          │
│                                                                     │                          │
│                                                                     ▼                          │
│                                                     application policy mapping                 │
│                                                     (outcome + context -> intervention)         │
│                                                                     │                          │
│                                                                     ▼                          │
│                                                     generic policy gates (confidence/cooldown) │
│                                                                     │                          │
│                                                                     ▼                          │
│                                                     intervention command -> actuator           │
│                                                     (application target resolver)              │
│                                                                     │                          │
│                                                                     ▼                          │
│                                                     ExperimentRecorder -> trace 1.4.0          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────── model-preparation (offline) ─────────────────────────────────────┐
│ trace ingestion (1.4.0 + legacy) -> canonical events -> semantic target generation            │
│ -> session-bounded dataset -> window/horizon experiment -> target-head training               │
│ -> evaluation (per-class, macro-F1, confusion, lead time) -> ONNX export + bundle             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Responsibility boundaries

| Responsibility | Framework core | Testbed / integration | Model preparation |
| --- | --- | --- | --- |
| Event ingestion | Canonical event contract, observer, normalisation, dedupe | DOM sources and application event capture | Ingests canonical trace |
| MicroTensor | Feature/window contract and processing | UI-specific modality/annotation mapping | Reconstructs and validates |
| Macro stream | Generic sequence representation | Macro symbol vocabulary and event→symbol mapping | Reads macro sequences for analysis |
| Fast Gate | PrefixSpan engine, bounded execution, normalized result | Declared pattern→outcome map, confidence policy | Trains/evaluates only if applicable |
| Slow Gate | Generic inference/result contract, configured vocabulary | Model artifact selection and app vocabulary | Produces model artifact |
| Arbitration | Gate coordination, provenance, fallback | Gate preference/fallback configuration | — |
| Policy | Generic confidence/cooldown/persistence/TTL gates | Outcome→intervention mapping and context rules | — |
| Actuation | Generic command contract and lifecycle | Target resolver, React/CSS implementation | — |
| Task management | Generic task-lifecycle contract and trace fields | TD1–TD4 definitions, state snapshot, predicates, timeout | Uses task metadata for splits/evaluation |
| Semantic outcomes | Generic derivation/extension contract, trace field | Application semantic mapper and vocabulary | Target generation and training labels |
| Trace/research | Schema, recorder, export, provenance gate | Study metadata, annotations, condition | Dataset/manifest/versioning |
| Deployment | Runtime packaging | Testbed build and demo | Model artifact delivery |

### 3.3 Integration contracts to establish or refine

| Contract | Direction | Minimum fields |
| --- | --- | --- |
| `BehaviourEvent` | Testbed → framework | Existing canonical fields plus any approved semantic-neutral fields |
| `UiAdapter` | Framework ↔ testbed | Existing task state/lifecycle/context/record methods; optional UI-state snapshot accessor |
| `MacroMapper` | Testbed → framework | `(event, context) -> macroSymbol or null`, application vocabulary/version |
| `ContextEncodingConfig` | Testbed → framework | route vocabulary, task step counts/total steps, action vocabulary |
| `PredictionResult` | Gate → arbitration/policy | outcome ID, confidence/match strength, source gate, target/context reference, timestamp, prediction ID |
| `GateDecision` | Gate → arbitration | matched, prediction, provenance, optional diagnostics |
| `OutcomePolicy` | Testbed → framework | `(PredictionResult, UIContext) -> InterventionCommand or no_op` |
| `TargetResolver` | Framework → testbed | `(targetId, context) -> Element or null`; no framework selector knowledge |
| `SemanticOutcomeDeriver` | Testbed → framework | canonical event/sequence state → semantic outcome + derivation metadata |
| `Trace` | Framework → model-preparation | 1.4.0 JSON with semantic outcomes, task version, normalized predictions |

### 3.4 Shared semantic outcome contract

**Target vocabulary — the approved 14 IDs** ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).
The semantic head's output dimension is 14, and the semantic dataset labels only these:

```text
navigate_overview
navigate_analytics
navigate_reports
select_report
open_filter_section
close_filter_section
select_region
select_date_range
select_category
apply_filter
reset_filter
export_report
backtrack
NO_OUTCOME
```

**The runtime vocabulary is deliberately wider.** Task 20.4 records one further ID,
`inspect_help`, for a committed click on a tooltip affordance. That ID exists because the
exact-identifier rule stops `tooltip-region` from being classified as `select_region` (assessment
limitation #6). It is recorded evidence, not a target: dataset v2 excludes those windows from the
training examples and reports the excluded count rather than relabelling them `NO_OUTCOME`.
Deleting the rule to make the recorded count 14 would either lose the evidence or reopen the
substring defect, so the recorded/target split is the contract:

| Set | Size | Used by |
| --- | --- | --- |
| Recorded runtime vocabulary | 15 IDs | Trace `taskOutcome`, ingestion, analysis |
| Target vocabulary | 14 IDs | Dataset labels, model output dimension, evaluation |

`task_complete` and `task_abandon` are task-lifecycle/evaluation outcomes, not ordinary model
prediction targets.

The residual items of assessment limitation #6 concern the **macro** stream, not this vocabulary,
and remain open — see §2.8.

The framework must not import or require these strings. It supplies:
- a trace field and derivation metadata shape that accepts any string ID;
- a vocabulary-version field;
- a configured `PredictionResult` shape;
- application-supplied mapping hooks.

The testbed supplies the IDs, derivation rules, macro mapping and policy mapping. A second
application with a different vocabulary must not require a framework core edit.

### 3.5 Event canonicalization and semantic derivation ownership

Framework core owns the **generic mechanics**:

- commit a `change` only when the value actually changed;
- treat one checkbox interaction as one committed selection, not `click` + `input` + `change`;
- treat one form submission as one `apply` (suppress the submit button's duplicate click);
- order exact identifier/role checks before substring checks;
- suppress system-generated/programmatic actions from user outcomes;
- expose the canonical event plus derivation context to the application.

The testbed owns the **application rules**:

- which component/role/action maps to which semantic outcome ID;
- which filter section/report/control is involved;
- the backtrack visited-page rule's page identity (the generic tracker accepts the current page);
- the outcome vocabulary and version.

The existing generic seven-class `OutcomeDeriver` remains available for backward compatibility and
for the generic outcome field. It is not the semantic target layer. The semantic deriver is
additive.

### 3.6 Task harness ownership

- **Testbed:** TD1–TD4 definitions, `startingPage`, task-specific completion predicates, timeout
  durations, UI reset and state snapshot. This is the only place that knows the task names,
  components, counts and reports.
- **Framework:** generic task-state/lifecycle contract (`Idle`, `In Progress`, `Completed`,
  `Abandoned`, `Failed`), lifecycle event types, optional timeout reason, trace fields. It must not
  know a task ID or predicate.

`TaskManager` currently lives in `src/testbed/tasks`; that placement is correct. The framework
adapter continues to expose generic snapshots. The change is to add state predicates, timeout and
failure semantics and to ensure the framework trace contract can carry them.

### 3.7 Model/export handoff

The model-preparation repository remains the source of truth for:

- feature/window configuration and semantic target taxonomy;
- training configuration and target-head output dimension;
- evaluation and model artifact metadata;
- ONNX graph naming, input/output contract and bundle manifest.

The framework consumes an exported artifact plus a manifest:
- graph inputs: sequence `(batch, T, 18)` and context `(batch, 6)`;
- graph output: semantic outcome logits `(batch, N)` where `N` is vocabulary size;
- manifest carries `outcomeVocabulary`, `vocabularyVersion`, `modelVersion`, `trainingCommit`,
  `datasetVersion`, `labelPolicyVersion`, `contextEncodingVersion`;
- the framework maps logits to outcome IDs from the manifest/config, not from a hardcoded order.

### 3.8 Decision records that constrain this plan

| ADR | Decision |
| --- | --- |
| [ADR-025](../../decisions/ADR-025-task-harness-and-state-verification-boundary.md) | Testbed owns task definitions/predicates; framework owns generic lifecycle; timeout is `task_fail`/`Failed`; task-definition version is recorded |
| [ADR-026](../../decisions/ADR-026-additive-semantic-outcome-taxonomy.md) | Additive semantic recording; keep the seven-class taxonomy; retrain the semantic head after participant traces |
| [ADR-027](../../decisions/ADR-027-event-canonicalization-and-outcome-derivation-ownership.md) | Framework owns canonicalization/backtracking mechanics; testbed owns semantic rules/vocabulary |
| [ADR-028](../../decisions/ADR-028-normalized-gate-prediction-contract.md) | Both gates return a normalized outcome prediction; policy maps outcome→intervention; actuator receives the command |
| [ADR-029](../../decisions/ADR-029-trace-schema-1-4-task-versioning.md) | Additive trace 1.4.0 with semantic outcome/task version/prediction fields; legacy versions readable |
| [ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md) | Target vocabulary pinned to the 14 approved IDs; `inspect_help` recorded as evidence, excluded from targets |
| [ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md) | Session-bounded dataset splits with task-level coverage; participant-bounded only after ADR-023 approves an identifier |

### 3.9 Hypothetical second UI vocabulary (conceptual check)

To demonstrate the boundary without implementing a second application, the plan uses a
`Shopfront` vocabulary:

| Testbed today | Hypothetical Shopfront | Framework change required |
| --- | --- | --- |
| `Analytics`, `Reports` routes | `Home`, `Catalog`, `Cart` | None; route list is supplied by the integration |
| `nav-Analytics` | `SHOP_NAV_CATALOG` | None; macro mapper is supplied |
| `select_report` | `open_category` | None; vocabulary is supplied |
| `apply_filter` | `add_to_cart` | None; outcome policy is supplied |
| `filter-drawer` simplify target | `cart-summary` simplify target | None; target resolver is supplied |

If any of these requires a framework core edit, the boundary is not yet correct. This is an
acceptance criterion for Workstream 20.

---

## 4. Detailed Implementation Phases

Each phase below links to its workstream. The workstream `work.md` is the execution index; the task
files carry acceptance criteria and verification.

### Phase 0 — Repository audit and implementation baseline

- **Objective:** Lock the baseline, verify the plan's assumptions and record the executable gap
  register.
- **Current-state findings:** Both repositories have substantive implementations; the approved
  task set, semantic layer and semantic target head are missing. See §2.
- **Required implementation work:** No product code. Record commits, run the existing suites,
  verify deterministic counts, confirm artifact hashes, record environment/test results and update
  this plan only where evidence contradicts it.
- **Repositories/files:** both repositories; `docs/plan/3/workstream/00-baseline/`.
- **Architecture considerations:** Do not "fix" gaps during the audit; record them.
- **Dependencies:** None.
- **Tests/verification:** `npm test`, `npm run typecheck`, `python3 -m pytest tests -q`, build if
  feasible; deterministic filter counts; `git rev-parse HEAD`.
- **Acceptance criteria:** A written baseline record with commit hashes, pass/fail/blocked test
  results, verified TD counts and a gap register mapped to WS10–WS70.
- **Deliverables:** `baseline-gap-register.md`; updated plan if drift.
- **Risks/deferred:** Environment-dependent tests may be blocked; record as blocked, not passed.
- **Workstream:** [00 — Baseline](workstream/00-baseline/work.md).

### Phase 1 — Task harness, UI fixes and TD1–TD4

- **Objective:** Implement the approved four tasks with normalized starts, state-verified
  completion, explicit timeout/abandon/failure and the minimum UI changes.
- **Current-state findings:** Legacy T1–T3 only; inert segment; no reset; no Reports; no state
  predicates; duplicate actions; filter-state inconsistency (§2.3).
- **Required implementation work:** Stable IDs/annotations; remove segment; TD1–TD4 model and
  config; controlled filter state; Reset Filters; Reports catalogue/presets/current report;
  task-start normalization; state snapshot/predicates; timeout/failure; canonical action pipeline;
  task lifecycle guards; tests and dry runs.
- **Repositories/files:** `src/app/App.tsx`, `src/app/Navigation.tsx`,
  `src/testbed/components/{FilterDrawer,ResultsTable,TrialControls,ReportsCatalogue}.tsx`,
  `src/testbed/tasks/{taskModel,taskManager,completion}.ts`, `src/testbed/data/reportCatalog.ts`,
  `src/types/contextVector.ts`, `src/config/runtimeConfig.ts`, tests, `docs/architecture.md`.
- **Architecture considerations:** Task definitions/predicates stay in testbed; framework receives
  generic snapshots. Report presets must not emit user `apply_filter`; task-start routing must not
  emit a participant navigation outcome.
- **Dependencies:** Phase 0.
- **Tests/verification:** task wiring/component/state tests; canonical path per task under both
  conditions; timeout/abandon/failure tests; filter consistency across navigation; report preset
  sync; duplicate-action tests.
- **Acceptance criteria:** §5.1–§5.7 acceptance; all four canonical paths complete with zero
  canonical-path errors; wrong values/states do not complete; timeout/failure recorded; reset
  restores 50 rows.
- **Deliverables:** TD1–TD4, Reports catalogue, Reset Filters, state predicates, tests, updated
  docs.
- **Risks/deferred:** Moderate Reports addition; filter state lift touches several components;
  task timeout values are protocol decisions.
- **Workstream:** [10 — Testbed tasks and UI](workstream/10-testbed-tasks/work.md).

### Phase 2 — Framework contracts, event canonicalization and semantic trace recording

- **Objective:** Remove testbed vocabulary from framework core, establish the normalized
  prediction contract, add semantic derivation, and add trace schema 1.4.0.
- **Current-state findings:** Framework core hardcodes macro symbols, route/task context, gate
  vocabularies, boot patterns and a testbed actuator target; gates return interventions; schema is
  1.3.0. See §2.4.
- **Required implementation work:** `PredictionResult`; generic `MacroMapper`; configurable context
  encoding; configurable gate vocabularies; fast pattern→outcome mapping; arbitration/policy
  boundary; canonical event pipeline; application semantic deriver; backtrack tracker; actuator
  resolver; schema 1.4.0/recorder/verifier/tests.
- **Repositories/files:** `src/gates/*`, `src/macro/*`, `src/types/contextVector.ts`,
  `src/telemetry/{events,traceSchema,recorder,contextProvider}.ts`, `src/runtime/*`,
  `src/intervention/actuator.ts`, `src/testbed/adapter.ts`, `src/testbed/config/*`, tests.
- **Architecture considerations:** §3; ADR-025–029; no testbed IDs in core; no behavior regression
  for the existing 1.3.0 path.
- **Dependencies:** Phase 1 for annotations/events; 2.1 can begin after 10.1.
- **Tests/verification:** contract tests for a second mock adapter; no testbed imports in core;
  canonicalization tests; semantic derivation fixtures; backtrack tests; schema 1.4 round-trip and
  1.3 backward compatibility; gate/policy contract tests.
- **Acceptance criteria:** Workstream 20 exit criteria and the §13 framework checklist; core grep
  shows no testbed IDs/routes; a second adapter can supply a different vocabulary without core
  edits; 1.4 traces validate and 1.3 traces remain readable.
- **Deliverables:** contracts, semantic layer, schema 1.4, tests, ADRs.
- **Risks/deferred:** Cross-cutting refactor; keep compatibility shims until Phase 3 validates.
- **Workstream:** [20 — Framework contracts](workstream/20-framework-contracts/work.md).

### Phase 3 — Scripted validation and participant trace readiness

- **Objective:** Prove the whole path on scripted TD1–TD4 runs under both conditions and make
  collection ready.
- **Current-state findings:** Existing scripted harness drives legacy T1–T3 and old values; no
  TD1–TD4 driver; traces can export but semantic/task fields do not exist yet.
- **Required implementation work:** scripted driver per task/condition; trace verifier updates;
  acceptance matrix; collection readiness checklist and runbook.
- **Repositories/files:** `scripts/record_scripted_traces.py`, framework `scripts/verify-trace.mjs`,
  `scripts/compare-condition-traces.mjs`, docs/runbooks, tests.
- **Architecture considerations:** Scripted runs are `scripted` provenance; never describe them as
  participant evidence. Use the real browser/runtime path, not a synthetic trace.
- **Dependencies:** Phases 1 and 2.
- **Tests/verification:** all four tasks × two conditions; no duplicate task interactions; no
  spurious errors; timeout/abandon fixtures; schema 1.4 verification; ingestion smoke test.
- **Acceptance criteria:** §10 matrix rows for tasks/collection pass; exports ingestible; collection
  checklist signed off.
- **Deliverables:** scripted traces, validation report, collection-ready runbook.
- **Risks/deferred:** Browser automation timing/flakiness; participant study protocol remains out of
  scope.
- **Workstream:** [30 — Validation and collection](workstream/30-collection-validation/work.md).

### Phase 4 — Model-preparation dataset and target-head retraining

- **Objective:** Prepare a semantic target dataset, evaluate window/horizon choices, train and
  evaluate a task-outcome head on participant traces, and export it.
- **Current-state findings:** Five-class intervention head and generic outcome dataset exist;
  semantic labels, semantic target dataset, semantic head and semantic export do not.
- **Required implementation work:** 4A ingestion/schema, semantic target generation, dataset,
  splits/class balance, window/horizon experiment. 4B participant collection, training, evaluation,
  export/bundle, framework handoff.
- **Repositories/files:** `model-preparation/src/{trace_ingestion,target_generation,target_dataset,
  training,export,config}.py`, `src/config.yaml`, `models/`, `docs/data_schemas.md`, tests,
  `scripts/record_scripted_traces.py`, framework model config/runtime.
- **Architecture considerations:** Framework does not train; model repo owns taxonomy/config/export.
  Preserve foundation checkpoint; keep the previous head artifact; additive semantic head.
- **Dependencies:** Phase 2 trace schema for 4A; Phase 3 collection readiness and actual participant
  traces for 4B.
- **Tests/verification:** ingestion 1.4 + legacy; semantic label parity between TS and Python;
  leakage tests; window/horizon experiment; per-class/macro-F1/confusion/majority baseline;
  held-out at the declared split unit (session until ADR-023; ADR-031); ONNX parity/quantization;
  bundle verification.
- **Acceptance criteria:** Workstream 40 exit criteria and the §13 model-preparation checklist; the
  exported semantic head loads in the browser and produces the configured output dimension; no
  future leakage; metrics reported with support.
- **Deliverables:** semantic dataset version, experiment report, trained head, ONNX + bundle v2,
  evaluation report.
- **Risks/deferred:** Retraining blocked on participant traces; class sparsity; participant study
  design not included.
- **Workstream:** [40 — Model preparation](workstream/40-model-preparation/work.md).

### Phase 5 — Fast Gate / PrefixSpan hardening and shared arbitration

- **Objective:** Correct PrefixSpan matching and pattern semantics, and make both gates produce the
  normalized prediction contract for arbitration/policy.
- **Current-state findings:** The miner exists and is tested at a basic level; Quality Assessment 2
  finding F-02 remains; pattern declarations and support semantics need review; the gate result is
  not normalized.
- **Required implementation work:** correctness fixes, deterministic tests, pattern declaration and
  support semantics, sequence boundaries/session isolation, confidence/strength, pattern→semantic
  outcome mapping, no-match/fallback, performance/memory, shared arbitration.
- **Repositories/files:** `src/gates/fast/*`, `src/gates/arbitration.ts`,
  `src/runtime/worker/*`, `src/runtime/boot.ts`/testbed pattern config, tests, docs.
- **Architecture considerations:** No testbed DOM selectors in the miner; patterns are application
  configuration; both gates return the same result shape.
- **Dependencies:** Phase 3 traces; Phase 4B per the intended sequence.
- **Tests/verification:** deterministic PrefixSpan fixtures; support/length/boundary tests;
  session-isolation tests; pattern→outcome tests; no-match/fallback; latency/memory on realistic
  sequences.
- **Acceptance criteria:** Workstream 50 exit criteria and the §13 Fast Gate/arbitration checklist;
  no false/noisy matches on canonical task paths; both gates' results are consumable by the same
  policy.
- **Deliverables:** hardened Fast Gate, pattern config, shared arbitration tests, evidence.
- **Risks/deferred:** Do not optimise before traces; avoid changing the miner boundary.
- **Workstream:** [50 — Fast Gate and arbitration](workstream/50-fastgate-arbitration/work.md).

### Phase 6 — Policy and intervention refinement

- **Objective:** Map semantic outcomes to conservative, useful interventions; verify target
  resolution, visibility, dismissal/cleanup and baseline inertness.
- **Current-state findings:** Generic policy and five intervention types exist; policy consumes an
  intervention command, not a predicted outcome; testbed outcome→intervention mapping does not
  exist; intervention verification evidence is partial.
- **Required implementation work:** testbed outcome policy, target resolver, missing-target
  behavior, confidence/context/cooldown/limits, visual/functional suite, refinement report.
- **Repositories/files:** `src/intervention/*`, `src/testbed/policy/*`, CSS, tests, docs.
- **Architecture considerations:** Outcome→intervention is testbed configuration; framework policy
  gates remain generic; actuator receives generic commands.
- **Dependencies:** Phases 2, 4B, 5.
- **Tests/verification:** all in-scope types; correct target; visible/screenshot checks; no layout
  shift/focus theft; dismissal/TTL; baseline no adaptation; adaptive only configured actions;
  missing target.
- **Acceptance criteria:** Workstream 60 exit criteria and §10 T-22; baseline inert; each
  intervention functionally verified; visual vs source-only evidence distinguished.
- **Deliverables:** policy mapping, verification suite, screenshot/functional report.
- **Risks/deferred:** Visual judgments need human review; no claim of user benefit without a study.
- **Workstream:** [60 — Policy and interventions](workstream/60-policy-interventions/work.md).

### Phase 7 — Final integration, deployment and academic-evaluation readiness

- **Objective:** Produce a reproducible, deployed, demonstrable release with honest measurements
  and documented limitations.
- **Current-state findings:** Deployment exists (Cloudflare Pages/Workers, Supabase, WASM ORT);
  payload target is unmet; new model assets and schema require revalidation.
- **Required implementation work:** production build/assets, model/worker load, end-to-end trace
  persistence/export, environment configuration, browser checks, demo runbook, final limitations and
  measurements.
- **Repositories/files:** framework build/config/deploy docs, `public/models`, `_headers`,
  `scripts/check-deploy-assets.mjs`, Supabase config/docs, README/architecture.
- **Architecture considerations:** Do not introduce production infrastructure; preserve provenance
  gate; report `NOT MEASURED` where not measured; do not reuse historical WebGPU claims.
- **Dependencies:** Phases 1–6.
- **Tests/verification:** `npm run build:ci`, `check:deploy-assets`, deployed load, worker
  init/inference, baseline/adaptive run, trace export, Supabase gate, browser checks,
  `benchmark:runtime`.
- **Acceptance criteria:** §11/§13; deployed URL demonstrates TD1–TD4 and trace export; build
  reproducible; limitations/measurements documented.
- **Deliverables:** supervisor-ready release, runbook, final evidence report.
- **Risks/deferred:** Payload target may remain unmet; cross-browser scope may remain limited;
  participant study not included.
- **Workstream:** [70 — Deployment readiness](workstream/70-deployment-readiness/work.md).

---

## 5. Target UI and Task Implementation

### 5.1 Task definitions and completion predicates

All tasks use `taskDefinitionVersion: "TD-v2"` and new IDs `TD1`–`TD4`. The testbed task host
normalizes the start before `task_start`.

**TD1 — Regional sales export**

| Field | Value |
| --- | --- |
| Starting page | `Overview` |
| Actions | `nav-Analytics` → `filter-section-region` → `filter-Region-select = Europe` → `btn-apply-filters` → `btn-export` |
| State evidence | `page === 'Analytics'`; `appliedFilters.region === 'Europe'`; `visibleRowCount === 18`; export action recorded |
| Failure/ambiguity | Export before Apply does not complete; wrong region does not complete; a later correct state can still complete if export is recorded after it |
| Timeout | Configured per task (default 120 s; open decision in §12.2) |

**TD2 — Date and category filter**

| Field | Value |
| --- | --- |
| Starting page | `Analytics` |
| Actions | `filter-section-date-range` → `filter-date-input = 2025-06-01` → `filter-section-product-category` → check `filter-category-books` → `btn-apply-filters` |
| State evidence | `appliedFilters.dateFrom === '2025-06-01'`; `appliedFilters.categories === ['Books']`; `visibleRowCount === 5`; Apply recorded |
| Failure/ambiguity | Wrong date/category does not complete; extra categories do not complete; the count must match the recorded dataset seed |
| Timeout | 120 s default |

**TD3 — Empty-result recovery**

| Field | Value |
| --- | --- |
| Starting page | `Analytics` |
| Actions | Region Europe → Category Books → Date 2025-09-01 → Apply (0 rows) → observe empty → Reset Filters |
| State evidence | An `apply_filter` with `{Europe, Books, 2025-09-01}` and `visibleRowCount === 0`; `results-empty` present; reset/clear-all produces `visibleRowCount === 50` |
| Failure/ambiguity | Clearing only one filter (6 rows) does not complete; a reset before the empty state does not count; manual clear-all is accepted if it produces 50 rows |
| Timeout | 150 s default |

**TD4 — Report comparison and export**

| Field | Value |
| --- | --- |
| Starting page | `Reports` |
| Actions | `open-report-eu-electronics` → Analytics (3 rows) → `nav-Reports` → `open-report-eu-books` → Analytics (6 rows) → `btn-export` |
| State evidence | `visitedReportIds` includes `eu-electronics` and `eu-books`; `currentReportId === 'eu-books'`; preset filters `{region: Europe, categories: ['Books']}`; `visibleRowCount === 6`; export recorded |
| Failure/ambiguity | Exporting `eu-electronics` does not complete; opening only Books does not complete; returning via browser Back is not supported by the state-only router |
| Timeout | 150 s default |

The counts are deterministic from the stimulus generator. Phase 0 re-verifies them; if the dataset
changes, update the predicates and the report preset expectations in one change.

### 5.2 Task-start normalization sequence

Before `task_start` is recorded:

1. Set `currentPage = task.startingPage`.
2. Reset `appliedFilters` and the drawer draft to `EMPTY_FILTER_STATE`.
3. Collapse all filter sections.
4. Clear `currentReportId` and `visitedReportIds`.
5. Clear prior task errors, evidence and timeout timer.
6. Dismiss/reset any active adaptation through the runtime reset path.
7. Only then emit `task_start` with the task ID and definition version.

The task-start route change is **not** a participant navigation action. It must not emit
`navigate_analytics`, `navigate_reports` or `backtrack`.

### 5.3 UI-state snapshot

The testbed supplies a narrow snapshot to the task manager:

```ts
interface TestbedTaskUiState {
  page: 'Overview' | 'Analytics' | 'Reports' | 'Customers' | 'Settings';
  appliedFilters: {
    dateFrom: string;
    region: string;
    categories: string[];
  };
  visibleRowCount: number;
  empty: boolean;
  currentReportId: string | null;
  visitedReportIds: string[];
  lastAction?: {
    componentId: string;
    action: string;
    timestamp: number;
  };
}
```

No free-text field values are added to telemetry. The snapshot is evaluated in the testbed and
only the task state/lifecycle plus semantic outcomes are recorded.

### 5.4 Task lifecycle, timeout, abandonment and failure

Proposed semantics:

| Event | Status | Reason | Trigger |
| --- | --- | --- | --- |
| `task_start` | `In Progress` | — | After normalization |
| `task_step` | `In Progress` | — | Canonical action/evidence progression (diagnostic) |
| `task_complete` | `Completed` | — | Completion predicate passes exactly once |
| `task_fail` | `Failed` | `timeout` | Configured timeout elapses before completion |
| `task_abandon` | `Abandoned` | `reset` | Participant/researcher resets the trial |
| `task_abandon` | `Abandoned` | `replaced` | A new task replaces an in-progress trial (if replacement is allowed) |
| `task_abandon` | `Abandoned` | `condition_change` | Condition changes while a trial is in progress |
| `task_abandon` | `Abandoned` | `interrupted` | Page unload/navigation interruption that ends the trial |

The preferred UI guard is to disable Start and condition controls while a task is `In Progress`;
replacement then cannot occur silently. If replacement remains enabled, the old trial is abandoned
with `replaced` before the new `task_start`.

`task_fail` is a new lifecycle type; the trace schema 1.4.0 and model-preparation ingestion must
accept it. `TaskStatus` gains `Failed`; `abandonmentReason` gains `replaced`, `condition_change` and
`interrupted`.

### 5.5 Minimum UI changes

| Change | Scope | Reason |
| --- | --- | --- |
| Add `btn-reset-filters` | `FilterDrawer` | TD3; clears draft + applied state; type `button`, never submits |
| Lift filter state into `App` (or controlled drawer) | `App`, `FilterDrawer` | Eliminates draft/applied divergence; report presets and reset can update both |
| Add Reports catalogue | `App`, new `ReportsCatalogue`, report data | TD4; deterministic presets, current report |
| Remove Customer Segment | `FilterDrawer`, `FilterState`, tests | Approved; dead control |
| Normalize filter-section IDs | `FilterDrawer`, task model, tests | `filter-section-date-range`, `filter-section-region`, `filter-section-product-category` |
| Add `data-aui-region` | major region containers | Interventions/analysis; no parallel ID system |
| Add report annotations | catalogue/current report | `select_report`, current report, target resolution |
| Preserve `data-aui-component` | all | Canonical identifier; do not introduce `data-aui-id` without an approved migration |

No other visual redesign is in scope.

### 5.6 Reports catalogue

Deterministic entries (counts for verification only; do **not** display counts in the catalogue):

| Report ID | Display name | Preset region | Preset category | Matching rows |
| --- | --- | --- | --- | --- |
| `eu-electronics` | Europe Electronics | Europe | Electronics | 3 |
| `eu-books` | Europe Books | Europe | Books | 6 |
| `eu-clothing` | Europe Clothing | Europe | Clothing | 9 |
| `na-clothing` | North America Clothing | North America | Clothing | 7 |
| `apac-electronics` | Asia Pacific Electronics | Asia Pacific | Electronics | 8 |

Presets set `dateFrom = ""`, `region`, `categories = [category]`; the removed segment is not part of
the state. Selecting a report updates `currentReportId`, `appliedFilters` and the visible drawer
together, then navigates to Analytics. A programmatic preset must not emit a user `apply_filter`.
The current-report label is visible on Analytics and carries `data-aui-component="current-report"`.

### 5.7 Verification for the task layer

- One test per task for the canonical path and one negative test per completion predicate.
- Start normalization tests for all four starting pages.
- Timeout and explicit failure tests; reset/replacement/condition-change abandonment tests.
- Filter consistency: apply filters, navigate away/back, verify table + drawer agree.
- Report preset sync: selecting each report updates table, drawer and current-report label.
- Duplicate-action tests: one checkbox/apply/export action → one task interaction; no canonical-path
  `task_error`.
- Counts: TD1 18, TD2 5, TD3 0→50, TD4 3→6; assert against the deterministic dataset.
- Scripted dry run under baseline and adaptive conditions; no adaptive DOM mutation in baseline.

---

## 6. Framework Changes

### 6.1 Normalized prediction and semantic outcome contract

Define a gate-agnostic result:

```ts
interface PredictionResult {
  predictionId: string;
  outcomeId: string;                 // application-supplied ID, e.g. 'apply_filter'
  outcomeVocabularyVersion: string;
  confidence?: number;               // probability or match strength
  source: 'fast' | 'slow';
  matched: boolean;
  targetComponentId?: string;
  contextRef?: { route?: string; taskId?: string; taskStepId?: string };
  timestamp: number;
  pattern?: string[];                // fast-gate provenance
  mappingSource?: 'learned_head' | 'deterministic_mapping' | 'fast_gate_pattern';
}
```

A gate returns this (or a gate result containing it). Arbitration selects the result and preserves
provenance. The policy receives `PredictionResult` + `UIContext`; the testbed maps the outcome to an
intervention candidate; the generic policy applies confidence/persistence/cooldown/TTL.

The framework core must accept any string outcome ID and vocabulary version. It must not import
`select_report` or any testbed ID.

### 6.2 Application vocabulary boundary

Move/abstract:

- macro symbol vocabulary and event→symbol mapping from `src/macro/symbols.ts` to a testbed
  `MacroMapper` implementation/configuration;
- route vocabulary and task step counts from `src/types/contextVector.ts` to an integration
  `ContextEncodingConfig`;
- fast gate declared patterns from `src/runtime/boot.ts` to testbed configuration;
- outcome vocabulary/order from `OnnxSlowGate` to model manifest/config;
- `filter-drawer` from `UIActuator` to an injected `TargetResolver` or testbed target config.

Framework defaults may remain for the testbed, but they must not be required by the core. A second
mock adapter test must prove a different vocabulary works without editing core modules.

### 6.3 Gate changes

**Fast Gate:** patterns map to a semantic outcome ID (or a normalized prediction), not directly to
an intervention command. Pattern confidence/support is carried in the result. No match returns
`matched: false` with a clear reason.

**Slow Gate:** the model manifest/config supplies the outcome vocabulary and output order. The gate
returns the top outcome, confidence/probabilities and `source: 'slow'`. It must not hardcode the
seven-class or five-class orders. The old intervention head remains a configurable compatibility
artifact for baseline/ablation; it is not the semantic contract.

**Arbitration:** Fast Gate first, Slow Gate on miss; no-match returns a normalized no-match result;
provenance (gate, pattern, model version, mapping source) travels with the prediction. Do not
redesign arbitration beyond what the shared contract requires.

### 6.4 Event canonicalization

Implement a generic canonical action pipeline before task/outcome mapping:

- committed `change` only when the value changed;
- one checkbox interaction → one selection;
- one form submission → one Apply (suppress the duplicate button click);
- one date commit → one date outcome;
- exact `data-aui-component`/role checks before substring checks;
- system/programmatic actions excluded from user outcomes;
- stable event IDs/correlation for dedupe.

The observer remains the raw evidence source; canonicalization must be testable and must not delete
the underlying event record.

### 6.5 Semantic outcome derivation and backtracking

Framework generic mechanics plus testbed rules:

- exact IDs/roles: `tooltip-region` is `inspect_help`, never `select_region`;
- `change`/input committed values only; no hover-as-selection;
- `apply_filter` from form submit, not button-click heuristic;
- `export_report` not `FORM_SUBMIT`;
- `select_report` wins over `navigate_analytics` for a report open;
- row hover is not `select_row`;
- backtrack: `visitedPages = [startingPage]`; on deliberate page change, emit `backtrack` if the
  destination was visited earlier in the task, then record the visit. Same-page clicks, blur,
  accordion collapse and filter edits do not count. The generic tracker accepts the current page;
  the testbed supplies page identity. A report open changes page but its primary outcome is
  `select_report`; the page visit still updates the tracker, so a later return to Reports emits
  `navigate_reports` plus `backtrack`.
- system intervention events are not user outcomes.

Record `taskOutcome` alongside the generic `outcome`; do not replace the generic taxonomy in this
phase. `inspect_help` is recorded but is not one of the 14 target IDs: keep the exact-ID rule that
produces it (it is what prevents `tooltip-region` from becoming `select_region`) and exclude those
windows from training labels ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).

### 6.6 Trace schema 1.4.0

Additive fields (proposed names; final names are Decision 6):

| Record | Field | Type | Purpose |
| --- | --- | --- | --- |
| `OutcomeEvent` | `taskOutcome` | string | Semantic outcome ID |
| `OutcomeEvent` | `taskOutcomeVocabularyVersion` | string | Vocabulary version |
| `OutcomeEvent` | `taskOutcomeSource` | string | Derivation source/rule |
| `TaskEvent` | `taskDefinitionVersion` | string | TD-v2 vs legacy |
| `TaskEvent` | `task_fail` type / `reason` extensions | — | Timeout/failure semantics |
| `PredictionEvent` | `predictedOutcome` | string | Normalized gate outcome |
| `PredictionEvent` | `predictionContractVersion` | string | Contract version |
| `PredictionEvent` | `targetContext` | object | Target/context reference |
| `metadata` | `taskDefinitionVersion`, `semanticOutcomeVocabularyVersion` | string | Study-level identity |

Keep 1.3.0 readable; version the validator and model-preparation allowlist. Do not silently change
the meaning of `outcome` or `target_outcome`.

### 6.7 Actuator target resolver

Replace the hardcoded `filter-drawer` simplification target with an injected resolver/config:
- resolver receives a semantic target ID and current context;
- default DOM resolver may use `data-aui-component`;
- missing target returns null and the actuator reports failure without mutating a random element;
- the testbed supplies `simplifyOptionsTargetId: 'filter-drawer'` (or equivalent).

---

## 7. Model-Preparation Changes

### 7.1 Trace ingestion and schema 1.4.0

- Add 1.4.0 to `TRACE_KEY_ALLOWLIST`, `BEHAVIOUR_EVENT_KEY_ALLOWLIST`, `OutcomeEvent`/`TaskEvent`
  key handling and supported versions.
- Reject unknown versions loudly; keep 1.3.0/1.2.0/1.1.0 legacy support.
- Carry `taskOutcome`, vocabulary version, task definition version, `task_fail` and normalized
  prediction fields through canonical events and provenance.
- Add tests for 1.4.0, unknown versions, missing semantic fields and legacy defaults.

### 7.2 Semantic target generation

Add a semantic target generator that:
- derives future semantic outcomes only from information after the anchor window, within the
  configured lookahead;
- recognises committed changes, form submits, report selection, reset, navigation/backtrack;
- uses exact IDs/roles and canonical action dedupe;
- labels only the 14 target IDs; a window whose future outcome is `inspect_help` is excluded and
  counted, never relabelled `NO_OUTCOME` ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md));
- records label provenance (`source: trace_semantic_outcome` vs re-derived), the target-vocabulary
  version and the recorded-vocabulary version it was derived from;
- mirrors the TypeScript derivation on shared fixtures;
- keeps the generic seven-class outcome for backward comparison.

Do not silently replace `target_outcome` with `task_outcome`; add fields and version them.

### 7.3 Dataset, splits and class balance

New dataset version (e.g. `v2.0.0-semantic`) with:
- sequence `(T, 18)`, context `(6)`, `target_task_outcome` + ID, target-vocabulary version,
  recorded-vocabulary version, task definition version, provenance;
- retained generic `target_outcome`/`target_intervention` columns for legacy/ablation;
- **session-bounded splits before window generation** — participant-bounded only when ADR-023
  approves an identifier; the split unit is recorded in the manifest
  ([ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md));
- class weights derived on the training partition only;
- per-partition semantic class distribution, absent-class declarations and majority baselines;
- per-partition task-level coverage reporting, and an excluded-window count for outcomes outside
  the 14 IDs (`inspect_help`).

### 7.4 Window and horizon experiment

Small controlled set, not an open-ended search:

| Config | History | Stride | Lookahead |
| --- | --- | --- | --- |
| A (baseline) | 8 × 500 ms | 250 ms | 500–1500 ms |
| B | 8 × 500 ms | 250 ms | 1000–2000 ms |
| C | 4 × 500 ms | 250 ms | 500–1500 ms |
| D | 12 × 500 ms | 250 ms | 500–1500 ms |

Evaluate per-outcome frequency, time between meaningful actions, prediction lead time, per-outcome
P/R/F1, macro-F1, class imbalance, false early predictions and incomplete windows. Select a
configuration using pre-declared criteria (coverage, macro-F1, lead time, stability); do not select
on a single aggregate.

### 7.5 Target-head architecture and training

- Preserve `foundational_gru.pth` and the recurrent backbone.
- Add `TargetTaskOutcomeHead` (or parameterised equivalent) with output dimension = 14, the
  approved target vocabulary ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)).
- Keep `TargetInterventionHead` and `bundle/v1.0.0` reproducible for comparison.
- Training config: semantic taxonomy, head class count, history/lookahead, class weights, seed,
  split, dataset version.
- Freeze/partial/full ablation remains; report foundation retention.
- Do not relabel the old five-class head; retrain a new head.

### 7.6 Evaluation and export

- Per-class precision/recall/F1, macro-F1, weighted-F1, confusion matrix, support, majority
  baseline.
- Held-out performance at the declared split unit — session-held-out until ADR-023 approves a
  participant identifier, participant-held-out only after that
  ([ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md)) — plus task-level
  performance, prediction lead time and calibration/reliability where support allows.
  Participant-held-out generalisation is **NOT MEASURED** until an identifier exists.
- Class distribution/imbalance and rare-class handling.
- ONNX: inputs `(batch, T, 18)` + `(batch, 6)`, output `(batch, 14)`; quantized INT8; parity and
  size/latency measured.
- Bundle v2 manifest: target-vocabulary version and the recorded-vocabulary version, dataset
  version/hash, split unit, code commit, seed, environment, metrics, input/output contract,
  artifact hashes.
- Framework handoff: model URL/config points to the new artifact; framework reads vocabulary from
  the manifest/config, not hardcoded order.

### 7.7 Decision 6 migration point

| Phase | What changes | What does not change |
| --- | --- | --- |
| During collection (Phases 3–4A) | Additive `taskOutcome` recording, ingestion, dataset prep, generic outcome retained | Seven-class model, old head, old bundle |
| Before retraining (Phase 4B start) | Add semantic taxonomy to `config.yaml`; create semantic dataset version; set head output dimension | Foundation weights; legacy artifacts |
| At retraining | Train new semantic head; evaluate; export ONNX + bundle v2 | Generic seven-class head remains reproducible |
| At runtime adoption | Point Slow Gate to new artifact/vocabulary; keep fallback/ablation | Old model can still be loaded for comparison |
| After validation | Policy consumes semantic predictions; old intervention head becomes comparison/fallback | Trace schema keeps generic and semantic fields |

The exact point is **after participant traces exist and before the semantic head training run**.
The current seven-class model cannot predict semantic outcomes; do not claim it can.

---

## 8. Fast Gate and PrefixSpan

### 8.1 Later-phase scope

The intended order is task/testbed → participant collection → target-head retraining → Fast Gate
hardening → intervention refinement. Workstream 50 starts after Phase 4B.

### 8.2 Required work

- Correct PrefixSpan sequence matching (Quality Assessment 2 finding F-02).
- Pattern declaration semantics: support, minimum/maximum length, confidence/strength.
- Sequence boundaries and session isolation; no cross-session pattern leakage.
- Match confidence/strength and no-match behavior.
- Pattern→semantic outcome mapping (application config).
- Deterministic tests and realistic-sequence performance/memory tests.
- Alignment with TD1–TD4 traces; no false matches on canonical paths.
- Both gates return the same normalized prediction contract; arbitration selects, policy consumes.

### 8.3 Non-goals

- No algorithm replacement without evidence.
- No testbed selectors in the miner.
- No premature optimisation before traces and target-head preparation.
- No claim that a mined pattern is a "known-good sequence" whitelist.

---

## 9. Policy and Intervention Refinement

### 9.1 Outcome→intervention policy

Testbed mapping (candidate, conservative; not every prediction gets an intervention):

| Predicted outcome | Candidate response |
| --- | --- |
| `navigate_analytics` / `navigate_reports` | `offer_assistance` or `no_op` |
| `select_report` | highlight the relevant report control / contextual tooltip |
| `open_filter_section` | highlight the filter section or `no_op` |
| `select_region` / `select_date_range` / `select_category` | highlight the control or contextual tooltip |
| `apply_filter` | highlight Apply |
| `reset_filter` | highlight Reset or `no_op` |
| `export_report` | highlight Export |
| `backtrack` | contextual navigation assistance or `no_op` |
| `NO_OUTCOME` | `no_op` |

The generic policy continues to enforce confidence threshold, consecutive-window persistence,
context eligibility, cooldown, dismissal and TTL. Add per-task intervention limits if configured;
do not exceed the existing `maxInterventionsPerTask` without a decision.

### 9.2 Target resolution

- Targets are application-provided semantic IDs, resolved through the injected resolver.
- Missing target → actuation failure recorded, no random fallback.
- `simplify_options` target is testbed-configured, not hardcoded.
- `expand_tooltip` requires title/data-tooltip; KPI/control targets need text.
- No layout shift, focus theft, or accessibility-tree corruption.

### 9.3 Verification

- Functional: correct element, visible rendered state, dismiss/cleanup, no unintended DOM mutation,
  no duplicate episode, no task-completion interference, baseline inert.
- Visual: screenshots for each in-scope intervention at target viewports; human review.
- Evidence distinction: visually verified vs source/unit-test only.
- Do not claim improved task performance or user benefit without a study.

---

## 10. Testing and Acceptance Matrix

| ID | Requirement | Verification | Acceptance |
| --- | --- | --- | --- |
| T-01 | TD1–TD4 canonical paths | component/integration tests + scripted runs | All complete; expected counts; no canonical errors |
| T-02 | Start normalization | tests for all starting pages | Page/filters/sections/report/errors reset before `task_start` |
| T-03 | State predicates | negative tests per task | Wrong value/report/state does not complete |
| T-04 | Timeout/failure | fake-timer tests + scripted run | `task_fail`/Failed recorded once; no completion |
| T-05 | Abandon/reset/replace/condition | lifecycle tests | Correct reason/status; no silent loss |
| T-06 | Reset Filters | component test | Draft + applied cleared; 50 rows; no submit |
| T-07 | Report presets/current report | component test | Table, drawer, current report agree; no user apply event |
| T-08 | Filter consistency across nav | component test | Table and drawer agree after away/back |
| T-09 | No duplicate interactions | observer/task tests | Checkbox/Apply/Export one interaction each |
| T-10 | Segment removed | component/source test | No control, no `segment` state, no dead outcome |
| T-11 | Semantic derivation | fixture tests TS/Python parity | Exact IDs/roles, committed changes, apply/export/report/backtrack correct |
| T-12 | Backtrack rule | sequence tests | Reports return emits nav + backtrack; blur/accordion/filter do not |
| T-13 | Framework boundary | second mock adapter test + grep | No testbed IDs/routes in core; second vocabulary works |
| T-14 | Gate contract | unit/integration tests | Fast/Slow return same `PredictionResult` shape; arbitration provenance |
| T-15 | Trace 1.4 | schema/recorder/verifier tests | 1.4 validates; 1.3 readable; semantic/task fields present |
| T-16 | Model ingestion | Python tests | 1.4 + legacy; unknown rejected; semantic labels/provenance |
| T-17 | Leakage | dataset tests | No future data; session/participant splits; no cross-task leakage |
| T-18 | Window/horizon experiment | experiment report + script | Pre-declared configs and selection criteria |
| T-19 | Semantic head metrics | training/eval tests | Per-class/macro-F1/confusion/majority/held-out/lead time reported |
| T-20 | Export | ONNX tests + bundle | Input/output contract, parity, size/latency, vocabulary |
| T-21 | Fast Gate correctness | deterministic fixtures | F-02 cases; support/boundaries/session isolation/no-match |
| T-22 | Interventions | functional + screenshots | Correct target/visible/dismiss/TTL/no shift; baseline inert |
| T-23 | Deployment | build/assets/deployed run | Build, assets, worker, model, trace export, Supabase gate |
| T-24 | Documentation | link/schema/consistency tests | ADRs, schemas, architecture, README agree |

Commands are listed in Appendix B.

---

## 11. Deployment and Academic-Evaluation Readiness

### 11.1 Release requirements

- Clean checkout production build (`npm run build:ci`) with the committed WASM package.
- ONNX runtime assets and the configured semantic-head graph (plus any retained legacy graph) are
  present under `/models/`; no JSEP/WebGPU asset.
- Per-asset size below Cloudflare Pages' 25 MiB limit; record total payload honestly (current
  combined target is unmet under ADR-008/016; do not claim it is met).
- Worker initialises, loads the configured model, reports provider/model version honestly.
- Baseline/adaptive runtime works; baseline applies no adaptation.
- Trace persistence/export works; Supabase/provenance gate verified where configured.
- Model artifact/version identification visible in trace/metadata.
- Browser/environment checks in the intended study environment (Chromium is the current verified
  environment; do not claim Firefox/Safari without evidence).
- Build/deploy/runbook and a concise supervisor demo.

### 11.2 Measurements

Run `npm run benchmark:runtime` after the model change and record actual memory, latency/TBT,
payload and provider. Use `NOT MEASURED` for anything not measured. Do not reuse historical WebGPU
claims; the deployment uses WASM.

### 11.3 Supervisor demo path

1. Load the deployed testbed; show the session/condition and model/provider status.
2. Run TD1 under baseline: note that no adaptation is applied.
3. Run TD1 under adaptive: show the configured intervention path on the correct target, or the
   recorded policy decision when no intervention is emitted.
4. Run TD4: show Reports catalogue → comparison → export.
5. Export a trace; show schema 1.4.0, semantic outcomes, task version and provenance.
6. Show the model bundle manifest and the known limitations.

---

## 12. Risks, Open Decisions and Deferred Work

### 12.1 Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Semantic label sparsity (14 classes) | High | Measure coverage; class weights; report absent classes; avoid overclaiming |
| Retraining blocked on participant traces | High | Split Phase 4A/4B; pipeline smoke-tests on scripted data; no retraining claim before data |
| Framework refactor breaks existing 1.3.0 path | High | Compatibility shims; run existing suites each task; second-adapter test |
| Filter-state lift touches many components | Medium | Do it in one task with tests; report preset/reset share the same state path |
| Reports catalogue scope creep | Medium | Fixed deterministic catalogue, no counts, no charts/backends |
| Task timeout values are arbitrary | Medium | Mark as protocol decision; default values are placeholders |
| Duplicate event canonicalization misses an edge | Medium | Fixture-based tests per control; negative tests |
| PrefixSpan F-02 incorrectness | High | Dedicated phase; deterministic fixtures; no premature optimisation |
| Payload target remains unmet | High | Record actual size; do not claim target met; defer reduction |
| Browser coverage limited to Chromium | Medium | Record scope; manual checks in intended environment; no cross-browser claim |
| Task/model leakage from task progress | High | Exclude lifecycle labels from model targets; session-bounded splits with task coverage, participant-bounded when ADR-023 lands ([ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md)) |
| Runtime vocabulary wider than target vocabulary | Medium | Recorded/target split declared and versioned; `inspect_help` windows excluded and counted ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)) |
| Supabase/egress policy regression | High | Provenance-gated collection tests; no new egress path |
| Visual intervention judgments | Medium | Functional assertions + screenshots; human review; distinguish evidence |

### 12.2 Open decisions

| # | Decision | Why it matters | Recommended default |
| --- | --- | --- | --- |
| 1 | Decision 6 field names/versioning/migration point | Trace and model compatibility | `taskOutcome`, additive, retrain in 4B |
| 2 | Timeout failure semantics | Completion/abandon metrics | `task_fail` + `Failed` for timeout; `task_abandon` for reset/replaced/interrupted |
| 3 | Task timeout durations | Participant burden | 120/120/150/150 s placeholders; protocol decision |
| 4 | Allow task replacement mid-trial? | Data integrity | Disable Start/condition changes while `In Progress`; explicit reset |
| 5 | Keep intervention head alongside semantic head? | Payload/comparison | Keep old artifact for comparison; production uses semantic head after validation |
| 6 | Exact semantic vocabulary | Model output dimension | **Settled 2026-11-18:** 14 target IDs in §3.4; `inspect_help` recorded but not targeted ([ADR-030](../../decisions/ADR-030-semantic-target-vocabulary-pinned-to-14.md)) |
| 7 | Participant study protocol/counterbalancing | Validity | Deferred (ADR-014 D7); not part of this plan |
| 8 | Browser scope | Deployment claim | Chromium current; state intended environment; no cross-browser claim |
| 9 | Fast Gate pattern set | Gate behaviour | **Basis settled:** participant-derived candidates exist (159 at ≥3-session support, 35 sessions); 50.2 validates/declares them. Scripted-derived sequences are not the basis |
| 10 | Reports catalogue visual treatment | UI scope | Existing styles; list + Open + current report; no counts |
| 11 | Dataset split unit | Leakage control / evaluation claim | **Settled 2026-11-18:** session-bounded with task coverage; participant-bounded when ADR-023 lands ([ADR-031](../../decisions/ADR-031-session-bounded-dataset-splits.md)) |

### 12.3 Deferred work

| Deferred item | Deferred until | Reason |
| --- | --- | --- |
| TD5 hover/inspection task | Excluded by researcher | Avoid weak completion/instrumentation scope |
| Multi-participant study protocol, consent, counterbalancing | Study design | Not this milestone |
| Second real application integration | After this milestone | A hypothetical vocabulary test is sufficient here |
| Package split/publication | After a second real UI | ADR-011 |
| PrefixSpan optimisation/open-ended search | WS50 after traces | Evidence first |
| Payload reduction below 500 KB | After functional milestone | ADR-008/016; current target unmet |
| Date-to filter/pagination/sorting/row selection | Future task design | Not needed for TD1–TD4 |
| Scroll region attribution | Future scanning task | No task requires it |

---

## 13. Final Definition of Done

### Target UI and tasks

- [ ] TD1–TD4 implemented with new IDs and task-definition version.
- [ ] Starting states normalized and reproducible on all four tasks.
- [ ] Completion verified against actual UI state, not control touches.
- [ ] Timeout, abandonment and failure explicit and tested.
- [ ] Reports catalogue, presets and current-report state work.
- [ ] Reset Filters clears draft and applied state; 50 rows restored.
- [ ] Customer Segment control and state removed.
- [ ] Filter/report state consistent across navigation.
- [ ] Canonical actions produce no duplicate task interactions or spurious errors.

### Framework

- [ ] Framework core independent of testbed pages, tasks, components and semantic IDs.
- [ ] Application behavior supplied through integration contracts/config.
- [ ] Semantic outcome derivation separated from generic event collection.
- [ ] Both gates return the same normalized prediction contract.
- [ ] Arbitration/policy independent of DOM selectors.
- [ ] Actuator resolves application-provided targets; missing target fails safely.
- [ ] Existing 1.3.0/generic behavior preserved.

### Model preparation

- [ ] Participant traces export/ingest reproducibly (1.4.0 + legacy).
- [ ] Semantic outcomes recorded/versioned correctly, with the 14 target IDs distinguished from
      the recorded `inspect_help` ID (ADR-030).
- [ ] Training inputs use only information available at prediction time.
- [ ] Session-bounded splits prevent leakage; task-level coverage reported; participant-bounded
      splits only after ADR-023 approves an identifier (ADR-031).
- [ ] Outcome coverage and class imbalance measured.
- [ ] Window/horizon choices evaluated on a small controlled set.
- [ ] Semantic target head trained/evaluated on held-out data at the declared split unit
      (participant-held-out only once participant IDs exist; otherwise session-held-out and
      explicitly declared — ADR-031).
- [ ] ONNX model compatible with browser runtime and manifest/versioned.

### Fast Gate and arbitration

- [ ] PrefixSpan behavior covered by deterministic tests.
- [ ] Patterns represent intended task-related sequences.
- [ ] Matches map to semantic outcomes correctly.
- [ ] No-match/fallback correct.
- [ ] Both gates produce compatible results for the shared policy.

### Interventions

- [ ] Each in-scope intervention functionally verified.
- [ ] Applied interventions visible and correctly styled.
- [ ] Targets semantically correct; missing target safe.
- [ ] No disruption to normal UI/task completion.
- [ ] Repeated/inappropriate interventions controlled.
- [ ] Baseline remains free of adaptive interventions.

### Deployment and evaluation

- [ ] Production build succeeds from clean checkout.
- [ ] Runtime assets/model load in deployed environment.
- [ ] End-to-end telemetry → gates → arbitration → policy → actuator verified.
- [ ] Traces persist/export correctly; provenance gate intact.
- [ ] Deployment instructions reproducible.
- [ ] Known limitations and actual measurements documented.
- [ ] Ready for supervisor review and the next participant-study stage.

---

## Appendix A — Workstream and task index

| Workstream | Tasks |
| --- | --- |
| 00 — Baseline | [00.1 Baseline lock and gap register](workstream/00-baseline/tasks/00.1-baseline-lock-and-gap-register.md) |
| 10 — Testbed tasks | [10.1 IDs, annotations and segment removal](workstream/10-testbed-tasks/tasks/10.1-identifiers-annotations-segment-removal.md), [10.2 Task model v2 and configuration](workstream/10-testbed-tasks/tasks/10.2-task-model-v2-and-config.md), [10.3 Task host, filter state and reset](workstream/10-testbed-tasks/tasks/10.3-task-host-filter-state-reset.md), [10.4 Reports catalogue and presets](workstream/10-testbed-tasks/tasks/10.4-reports-catalogue-and-presets.md), [10.5 State predicates, timeout and failure](workstream/10-testbed-tasks/tasks/10.5-state-predicates-timeout-failure.md), [10.6 Canonical actions and task tests](workstream/10-testbed-tasks/tasks/10.6-canonical-actions-and-task-tests.md) |
| 20 — Framework | [20.1 Normalized prediction contract](workstream/20-framework-contracts/tasks/20.1-normalized-prediction-contract.md), [20.2 Application vocabulary boundary](workstream/20-framework-contracts/tasks/20.2-application-vocabulary-boundary.md), [20.3 Configurable gate vocabularies](workstream/20-framework-contracts/tasks/20.3-configurable-gate-vocabularies.md), [20.4 Semantic derivation and canonicalization](workstream/20-framework-contracts/tasks/20.4-semantic-derivation-and-canonicalization.md), [20.5 Trace schema 1.4 and actuator resolver](workstream/20-framework-contracts/tasks/20.5-trace-schema-1.4-and-actuator-resolver.md) |
| 30 — Validation | [30.1 Scripted TD1–TD4 driver](workstream/30-collection-validation/tasks/30.1-scripted-task-driver.md), [30.2 Trace verification and collection readiness](workstream/30-collection-validation/tasks/30.2-trace-verification-and-collection-readiness.md) |
| 40 — Model preparation | [40.1 Ingest schema 1.4 and semantic outcomes](workstream/40-model-preparation/tasks/40.1-ingest-schema-1.4-semantic-outcomes.md), [40.2 Semantic target generation and dataset](workstream/40-model-preparation/tasks/40.2-semantic-target-generation-and-dataset.md), [40.3 Window/horizon, splits and class balance](workstream/40-model-preparation/tasks/40.3-window-horizon-splits-class-balance.md), [40.4 Semantic head training and evaluation](workstream/40-model-preparation/tasks/40.4-semantic-head-training-evaluation.md), [40.5 ONNX export, bundle v2 and handoff](workstream/40-model-preparation/tasks/40.5-onnx-export-bundle-v2-handoff.md) |
| 50 — Fast Gate | [50.1 PrefixSpan correctness and bounds](workstream/50-fastgate-arbitration/tasks/50.1-prefixspan-correctness-and-bounds.md), [50.2 Pattern semantics and semantic mapping](workstream/50-fastgate-arbitration/tasks/50.2-pattern-semantics-and-semantic-mapping.md), [50.3 Shared arbitration and performance](workstream/50-fastgate-arbitration/tasks/50.3-shared-arbitration-and-performance.md) |
| 60 — Interventions | [60.1 Outcome policy and target resolution](workstream/60-policy-interventions/tasks/60.1-outcome-policy-and-target-resolution.md), [60.2 Intervention verification and refinement](workstream/60-policy-interventions/tasks/60.2-intervention-verification-and-refinement.md) |
| 70 — Deployment | [70.1 Build, assets and runtime verification](workstream/70-deployment-readiness/tasks/70.1-build-assets-runtime-verification.md), [70.2 Persistence, browser checks and supervisor release](workstream/70-deployment-readiness/tasks/70.2-persistence-browser-checks-supervisor-release.md) |

## Appendix B — Commands

**Framework**

```bash
cd edge-aui-framework
npm test
npm run typecheck
npm run parity:check
npm run sync-config
npm run check:deploy-assets
npm run build:ci
node scripts/verify-trace.mjs <trace.json>
node scripts/compare-condition-traces.mjs --baseline <b.json> --adaptive <a.json>
```

Focused tests are named in each task file. The scripted TD1–TD4 driver is introduced in 30.1.

**Model preparation**

```bash
cd model-preparation
python3 -m pytest tests -q
python3 -m src.target_dataset --help
python3 -m src.training --help
python3 -m src.export --help
python3 -m src.reproduce --help
```

The semantic dataset/export commands are defined in 40.2–40.5 and must be recorded in
`docs/data_schemas.md` and the experiment report.

## Appendix C — Source reference index

| Area | Files |
| --- | --- |
| Testbed shell/components | `src/app/App.tsx`, `src/app/Navigation.tsx`, `src/testbed/components/*` |
| Task model/state | `src/testbed/tasks/taskModel.ts`, `taskManager.ts` |
| Telemetry/events/schema | `src/telemetry/{observer,events,traceSchema,recorder,contextProvider}.ts` |
| MicroTensor/macro | `src/microtensor/*`, `src/macro/*` |
| Gates/arbitration | `src/gates/*`, `src/runtime/worker/*` |
| Policy/actuation | `src/intervention/*` |
| Integration/runtime | `src/integration/*`, `src/runtime/*`, `src/testbed/adapter.ts` |
| Configuration | `src/config/runtimeConfig.ts`, `src/config/pipelineConfig.json`, `model-preparation/src/config.yaml` |
| Trace/collection/deploy | `src/telemetry/collection*.ts`, `src/telemetry/session.ts`, `docs/deploy/*` |
| Model preparation | `model-preparation/src/*`, `model-preparation/tests/*`, `model-preparation/models/*` |
| Prior decisions | `docs/decisions/ADR-001…ADR-024`, new ADR-025…ADR-031 |
| Assessment | `docs/assessments/task-diversification-ui-assessment.md` |

---

*This plan is a planning deliverable. No implementation, configuration, model, dataset or
deployment change was made while producing it.*
