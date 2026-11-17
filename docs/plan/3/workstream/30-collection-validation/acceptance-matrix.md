# Acceptance Matrix — TD1–TD4 × Baseline/Adaptive

- **Workstream:** 30 — Collection validation (Task 30.2)
- **Evidence date:** 2026-11-17
- **Framework commit:** `5f5f734` (`feat/refinement`)
- **Model-preparation commit:** `963ae54` (`explore/pipeline/revision/2`)
- **Origin:** `http://localhost:5199/?auiDiagnostics=1` (local Vite dev server)
- **Automation:** `agent-browser 0.36.0`, Chrome 157.0.8103.51 (headless), viewport 1920×1080
- **Provenance of every capture:** `scripted` — engineering evidence, **not participant evidence**

**Evidence labels**

| Label | Meaning |
| --- | --- |
| **Verified** | Observed in this pass from a real browser capture, a real test run, or the running runtime. |
| **Inferred** | A conclusion that follows from verified evidence but was not itself measured. |
| **Blocked** | Not observable in this environment; the manual step is named. |
| **Not observed** | The measurement ran and produced a negative result (for example, no adaptation). |

Every capture in this matrix is produced by
`model-preparation/scripts/record_scripted_traces.py`, which starts each trial through
`btn-start-<task>`, drives the canonical path with real DOM events, and reads the runtime's
retained export of the finished trial. No trace was hand-authored.

---

## 1. Scripted capture matrix

Verification: `node scripts/verify-trace.mjs <capture>` (15/15 checks on every capture).

| Task | Condition | Capture | Status | Duration (ms) | Windows | Outcomes | Predictions | Policy verdicts | Applied interventions | Semantic outcomes | Verifier |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| TD1 | baseline | `scripted-TD1-baseline-trial1.json` | Completed | 6328 | 17 | 17 | 4 | 4 | 0 | `open_filter_section`, `select_region`, `apply_filter`, `export_report` | PASS |
| TD2 | baseline | `scripted-TD2-baseline-trial1.json` | Completed | 6138 | 17 | 17 | 3 | 3 | 0 | `select_date_range`, `open_filter_section`, `select_category`, `apply_filter` | PASS |
| TD3 | baseline | `scripted-TD3-baseline-trial1.json` | Completed | 9385 | 28 | 28 | 4 | 4 | 0 | `select_region`, `open_filter_section`, `select_category`, `select_date_range`, `apply_filter`, `reset_filter` | PASS |
| TD4 | baseline | `scripted-TD4-baseline-trial1.json` | Completed | 5273 | 13 | 13 | 3 | 3 | 0 | `navigate_reports`, `select_report`, `export_report` | PASS |
| TD1 | adaptive | `scripted-TD1-adaptive-trial1.json` | Completed | 6007 | 17 | 17 | 4 | 4 | 0 | `open_filter_section`, `select_region`, `apply_filter`, `export_report` | PASS |
| TD2 | adaptive | `scripted-TD2-adaptive-trial1.json` | Completed | 5810 | 18 | 18 | 4 | 4 | 0 | `select_date_range`, `open_filter_section`, `select_category`, `apply_filter` | PASS |
| TD3 | adaptive | `scripted-TD3-adaptive-trial1.json` | Completed | 9009 | 28 | 28 | 4 | 4 | 0 | `select_region`, `open_filter_section`, `select_category`, `select_date_range`, `apply_filter`, `reset_filter` | PASS |
| TD4 | adaptive | `scripted-TD4-adaptive-trial1.json` | Completed | 5046 | 16 | 16 | 4 | 4 | 0 | `navigate_reports`, `select_report`, `export_report` | PASS |

Captures live in `model-preparation/.data/raw/scripted/`; every filename begins with
`scripted-`, and `manifest.json` records the commit hashes, condition, task, timestamps,
browser, viewport, per-capture counts, retries and result.

**Verified:** all eight captures completed with `task.status = Completed`,
`task.errors = 0`, zero `task_error` events, a `1.4.0` schema version,
`metadata.taskDefinitionVersion = TD-v2`, the semantic vocabulary version, unique
`windowId`s, and one policy verdict per prediction.

---

## 2. Canonical completion evidence per task

The asserted state is the trace's own `task.uiState` snapshot (not a DOM scrape), plus the
semantic outcomes observed in the same trial.

| Task | Approved evidence | Baseline | Adaptive |
| --- | --- | --- | --- |
| TD1 | Region = Europe; 18 visible rows; export recorded; 5 canonical steps | **Verified** `region=Europe`, `visibleRowCount=18`, `export_report` | **Verified** same |
| TD2 | `dateFrom = 2025-06-01`; only Books; 5 visible rows; 5 canonical steps | **Verified** `dateFrom=2025-06-01`, `categories=[Books]`, `visibleRowCount=5` | **Verified** same |
| TD3 | Empty result observed; filters reset; 50 rows restored; 8 canonical steps | **Verified** empty state observed, `reset_filter` recorded, `visibleRowCount=50`, default filters | **Verified** same |
| TD4 | Europe Electronics and Europe Books visited; Europe Books active; 6 rows; export recorded; 4 canonical steps | **Verified** `visitedReportIds=[eu-electronics,eu-books]`, `currentReportId=eu-books`, `visibleRowCount=6`, `export_report` | **Verified** same |

The task definitions they mirror are in
[taskModel.ts:103](../../../../../src/testbed/tasks/taskModel.ts#L103) and the completion
predicates in [completion.ts:16](../../../../../src/testbed/tasks/completion.ts#L16).
The driver holds its own copy of the step ids and fails the run if the recorded
`taskEvents` do not contain them.

---

## 3. Condition integrity

Comparison command, run once per task pair:

```bash
node scripts/compare-condition-traces.mjs \
  --baseline ../model-preparation/.data/raw/scripted/scripted-TD1-baseline-trial1.json \
  --adaptive ../model-preparation/.data/raw/scripted/scripted-TD1-adaptive-trial1.json
```

| Check | TD1 | TD2 | TD3 | TD4 | Label |
| --- | --- | --- | --- | --- | --- |
| Schema parity (`1.4.0`) | PASS | PASS | PASS | PASS | **Verified** |
| Task parity | PASS | PASS | PASS | PASS | **Verified** |
| Condition parity (session says baseline/adaptive) | PASS | PASS | PASS | PASS | **Verified** |
| Provenance parity (`scripted`) | PASS | PASS | PASS | PASS | **Verified** |
| Task-definition version parity (`TD-v2`) | PASS | PASS | PASS | PASS | **Verified** |
| Baseline zero actuator mutations | PASS | PASS | PASS | PASS | **Verified** |
| Adaptive applied interventions are configured | PASS (none) | PASS (none) | PASS (none) | PASS (none) | **Verified** |
| Adaptive applied interventions are attributed | PASS (none) | PASS (none) | PASS (none) | PASS (none) | **Verified** |
| Adaptive actuation observed | NO | NO | NO | NO | **Not observed** |

**Verified:** no baseline capture contains an applied intervention, so the baseline
condition never mutated the DOM. Every adaptive capture ran the real ONNX Slow Gate
(`executionProvider = wasm`, `modelVersion = TargetInterventionHead-v1.0.0-int8`) and
recorded real policy verdicts.

**Not observed:** no adaptive trial applied an intervention. The recorded refusal reasons
are concrete: `below_threshold`, `pending_persistence` and `no_prediction`. TD1's adaptive
trial did produce a Fast Gate candidate (`simplify_options`, confidence 1.0) but the next
window's candidate differed, so the two-consecutive-window persistence rule rejected it.
This is a policy decision, not a broken capture. Deliberate triggering of interventions and
their visual/functional verification belong to [Workstream 60](../60-policy-interventions/work.md);
adding off-task stimulation to the canonical TD path to force an actuation would have made
the task evidence unrepresentative.

**Inferred:** because the baseline and adaptive captures ran the same canonical path and
the policy declined in both, the comparison demonstrates condition integrity and actuation
accounting, not an adaptive behavioural difference. It says nothing about usability,
performance or intervention benefit.

---

## 4. Timeout, abandonment, reset and duplicate-action fixtures

These are deterministic component/integration fixtures rather than browser captures. They
are the evidence that the lifecycle and duplicate-action semantics hold; the scripted matrix
above covers only canonical completion.

| Fixture | Where | What it proves | Label |
| --- | --- | --- | --- |
| Timeout → `Failed` | [task_diversification.test.tsx:137](../../../../../tests/task_diversification.test.tsx#L137) | Expiry emits `task_fail` with reason `timeout`, status `Failed`, not `Abandoned` | **Verified** |
| Reset mid-task → abandonment | [task_wiring.test.tsx:376](../../../../../tests/task_wiring.test.tsx#L376) | Reset Trial records `task_abandon` reason `reset` and returns to `Idle` | **Verified** |
| Reset after completion | [task_diversification.test.tsx:288](../../../../../tests/task_diversification.test.tsx#L288) | A completed trial is not re-labelled as abandoned by a later reset | **Verified** |
| Replacement by a new task | [task_diversification.test.tsx:308](../../../../../tests/task_diversification.test.tsx#L308) | Starting another task mid-trial abandons the first with reason `replaced` | **Verified** |
| Reset clears the timeout | [task_diversification.test.tsx:325](../../../../../tests/task_diversification.test.tsx#L325) | A reset trial cannot later fail on the previous trial's timer | **Verified** |
| Checkbox companion events | [task_diversification.test.tsx:175](../../../../../tests/task_diversification.test.tsx#L175) | `click` + `input` + `change` from one checkbox action produce no task error | **Verified** |
| Apply submit companion | [task_diversification.test.tsx:186](../../../../../tests/task_diversification.test.tsx#L186) | The form `submit` after the Apply click is benign | **Verified** |
| Submit companion on a click target | [task_diversification.test.tsx:222](../../../../../tests/task_diversification.test.tsx#L222) | A stray `submit` on a click-only control is not an error and does not complete a step | **Verified** |
| Wrong action on a required control | [task_diversification.test.tsx:317](../../../../../tests/task_diversification.test.tsx#L317) | A genuinely wrong action increments `errors` exactly once | **Verified** |
| TD3 completion without pre-Apply empty state | [task_diversification.test.tsx:230](../../../../../tests/task_diversification.test.tsx#L230) | An empty state observed before Apply is not recovery evidence | **Verified** |
| Non-Apply interaction as apply evidence | [task_diversification.test.tsx:254](../../../../../tests/task_diversification.test.tsx#L254) | A region change does not satisfy TD2's Apply evidence | **Verified** |
| Filter disclosure reset at trial boundary | [task_wiring.test.tsx:342](../../../../../tests/task_wiring.test.tsx#L342) | A trial cannot inherit the previous trial's open filter sections | **Verified** |
| Locked-state explanation during an incomplete trial | [task_wiring.test.tsx:249](../../../../../tests/task_wiring.test.tsx#L249) | A later TD2 start date leaves the trial open; an `aria-live` note explains the disabled controls and names Reset Trial, which stays available; completion removes the note | **Verified** |
| Exact step targets rendered | [task_wiring.test.tsx:232](../../../../../tests/task_wiring.test.tsx#L232) | The participant sees the exact date/category values the predicate checks; the panel does not repeat the full brief | **Verified** |
| Scripted captures duplicate-action check | `record_scripted_traces.py` assertion | Every capture: `task.errors = 0` and zero `task_error` events | **Verified** |

---

## 5. Semantic outcome coverage

The vocabulary is application-owned
([semanticOutcomes.ts:29](../../../../../src/testbed/config/semanticOutcomes.ts#L29)); the
framework records it and the verifier checks attribution, not membership.

| Task | Required by the driver | Observed (both conditions) |
| --- | --- | --- |
| TD1 | `open_filter_section`, `select_region`, `apply_filter`, `export_report` | all four |
| TD2 | `select_date_range`, `select_category`, `apply_filter` | all three (plus `open_filter_section`) |
| TD3 | `apply_filter`, `reset_filter` | both (plus region/category/date/section) |
| TD4 | `select_report`, `export_report` | both (plus `navigate_reports`) |

**Inferred:** the first action of a trial can fall inside the first MicroTensor window and
therefore has no earlier window whose lookahead can label it. In TD1/TD2/TD3 the first action
(`nav-Analytics` or the first section open) is not always represented as a semantic outcome.
The records were not back-filled; the trace states what the pipeline actually produced.

Each semantic outcome carries its vocabulary version; each task event carries `TD-v2`; the
metadata repeats both. The verifier rejects a trace whose records and metadata disagree.

---

## 6. Residual gaps

| Item | Status | Detail |
| --- | --- | --- |
| Adaptive actuation on the canonical path | **Not observed** | Policy declined; intervention verification is WS60 work |
| Deployed-origin scripted run | **Blocked** | This pass targets the local testbed origin; the deployment runbook covers the deployed check |
| Live Supabase write from these captures | **Blocked** | No project credentials in this environment; the collection path is verified structurally and in tests |
| Participant collection | **Blocked** | Study protocol (consent, counterbalancing, participant counts) is out of scope for this milestone |
| First-action semantic outcome | **Inferred limitation** | No preceding window to carry the horizon label |
| Multiple trials per condition | Not run | One trial per task/condition pair is the 30.1 acceptance requirement; repeat runs are a study-protocol decision |
| Participant-facing wording | **Inferred** | The refined lock note and exact step labels should be confirmed in the study-protocol review; no step id, component, action or completion predicate changed |
