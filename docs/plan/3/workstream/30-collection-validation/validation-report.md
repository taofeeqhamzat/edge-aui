# Workstream 30 — Validation Report

- **Workstream:** 30 — Scripted validation and participant trace readiness
- **Date:** 2026-11-17
- **Status:** Tasks 30.1 and 30.2 complete; participant protocol items remain deferred
- **Framework commit:** `5f5f734` (`feat/refinement`)
- **Model-preparation commit:** `963ae54` (`explore/pipeline/revision/2`)
- **Evidence labels:** **Verified** / **Inferred** / **Blocked** / **Not observed**

> Scripted captures are engineering evidence. They are `provenance: scripted` and are not
> participant evidence. Nothing in this report is a usability, performance or intervention
> result.

---

## 1. Outcome

| Exit criterion | Result | Where |
| --- | --- | --- |
| Eight scripted runs (TD1–TD4 × baseline/adaptive) complete and export `1.4.0` traces | **Verified** — 8/8 | [acceptance matrix §1](acceptance-matrix.md#1-scripted-capture-matrix) |
| Each canonical path completes with state evidence and zero canonical-path errors | **Verified** — 8/8, `task.errors = 0`, no `task_error` | [acceptance matrix §2](acceptance-matrix.md#2-canonical-completion-evidence-per-task) |
| Baseline traces contain no adaptive DOM mutation | **Verified** — 0 applied interventions in all four baseline captures | [acceptance matrix §3](acceptance-matrix.md#3-condition-integrity) |
| Adaptive traces contain the configured interventions only | **Verified** — no unconfigured or unattributed applied intervention; **no actuation was observed** | [acceptance matrix §3](acceptance-matrix.md#3-condition-integrity) |
| Trace verifier and ingestion accept the real exports | **Verified** — 15/15 checks per capture; real `1.4.0` captures ingest | §4 below |
| Collection readiness checklist signed off; participant items deferred | **Verified** — engineering path ready; protocol items **Blocked** | [collection-readiness.md](collection-readiness.md) |

The milestone claim is narrow and measured: the **capture → verify → compare → ingest** path
works end to end on the approved task set, in a real browser, for scripted evidence.

---

## 2. What was run

Environment: macOS (arm64), Chrome 157.0.8103.51 (headless), viewport 1920×1080,
`agent-browser 0.36.0`, local Vite dev server. The browser was launched with `--no-sandbox`
because this workspace's sandbox cannot start Chrome's sandbox; that is a harness
environment setting, not a property of the testbed.

```bash
# 1. Capture (model-preparation)
cd model-preparation
python3 scripts/record_scripted_traces.py \
  --tasks TD1 TD2 TD3 TD4 --conditions baseline adaptive \
  --url "http://localhost:5199/?auiDiagnostics=1"
# -> 8/8 recorded, 8/8 verified, exit 0

# 2. Verify each capture (edge-aui-framework)
cd ../edge-aui-framework
node scripts/verify-trace.mjs ../model-preparation/.data/raw/scripted/scripted-TD1-baseline-trial1.json
# -> 15/15 checks, exit 0 (repeated for all eight)

# 3. Compare conditions, once per task
node scripts/compare-condition-traces.mjs \
  --baseline ../model-preparation/.data/raw/scripted/scripted-TD1-baseline-trial1.json \
  --adaptive ../model-preparation/.data/raw/scripted/scripted-TD1-adaptive-trial1.json
# -> integrity checks pass; adaptive actuation reported as not observed

# 4. Cross-repository ingestion
cd ../model-preparation
python3 -m pytest tests/test_trace_ingestion.py -q
# -> 17 passed
```

Manifest and generated report:

- `model-preparation/.data/raw/scripted/manifest.json` — commits, condition, task,
  timestamps, browser, viewport, counts, retries, result.
- `model-preparation/docs/experiments/scripted-recording.md` — human-readable summary.

Framework suite and typecheck: `npx vitest run` → **527 passed**; `npx tsc --noEmit` →
clean. Model-preparation ingestion suite → **17 passed**.

---

## 3. Defects found by the validation and fixed

A validation pass that only reports green would be worthless. Five real defects surfaced when
the pipeline was driven through the browser; each is fixed, tested and committed.

### 3.1 A finished trial was destroyed at the moment it completed

**Cause.** `closeTrial()` rotated the session and cleared the recorder immediately on
`task_complete`. The trace was therefore only obtainable by racing the rotation, and every
participant trace was uploaded without the outcomes of its last lookahead windows — including
the export in TD1/TD4.

**Fix.** The runtime ends the stream, settles the remaining windows, freezes the terminal task
state, exports and retains the trial before closing it. Trial controls await that
finalisation before crossing a trial boundary (`e584b01`).

**Proof.** `tests/trial_completion_upload.test.ts` asserts the retained export contains the
trial's own `task_complete`; all eight captures contain `export_report` in TD1/TD4 and a clean
window→outcome mapping.

### 3.2 A trial trace could contain duplicate `windowId`s

**Cause.** Starting a trial reset the window buffer's id counter but not the recorder, so a
trace could contain pre-trial windows and trial windows under the same ids. This breaks the
primary correlation key used by ingestion and prediction attribution.

**Fix.** A trial boundary is a trace boundary: `resetTrial()` clears the recorder in the same
step it clears the window buffer (`e584b01`).

**Proof.** The driver asserts window-id uniqueness in every capture; the verifier's
prediction→window attribution passes 8/8.

### 3.3 Opening a filter was recorded as closing it

**Cause.** The observer listens in the capture phase, so the `aria-expanded` it read was
always the pre-action value. The semantic rule labelled an opening click
`close_filter_section`, and the macro mapper emitted `CLOSE_FILTERS`.

**Fix.** For a disclosure toggle the post-action state is the negation of the observed state
(`6bc15fe`). Verification used trusted CDP clicks as well as synthetic ones, because the
original comment claimed React had already committed the change.

**Proof.** `tests/semantic_dom_annotations.test.tsx` drives the real drawer through the
observer and asserts `open_filter_section`; all eight captures now report
`open_filter_section`.

### 3.4 The CLI verifier was a second, stale definition of "valid"

**Cause.** `verify-trace.mjs` was a hand-written JavaScript copy that accepted only `1.2.0`
and required T1–T3 step ids, while the TypeScript verifier had moved to `1.4.0`. Running it
on a real capture failed on the schema version.

**Fix.** Both CLI scripts load the TypeScript verifier through Vite's SSR loader
(`5f5f734`). The verifier now checks generic lifecycle consistency instead of application
step ids, plus prediction→window attribution, semantic/task-version attribution and
condition/provenance agreement. Legacy captures are reported, not failed.

**Proof.** 15/15 checks on all eight captures; legacy fixtures still pass with their
limitations named; unknown versions still fail.

### 3.5 Reported confidence was a raw logit

**Cause.** `argmax` reports the winning class's confidence, but both ONNX heads passed it raw
logits. Real captures recorded confidences above 1 (e.g. `2.617`), which the policy compared
against a 0.75 probability threshold.

**Fix.** Rank the softmax probabilities (`c67ea65`).

**Proof.** `tests/trace_mapping_attribution.test.ts` asserts a logit of 5.0 is reported as its
softmax probability (≈0.97), not as 5.0; every adaptive capture now reports confidence in
`[0, 1]`.

Two smaller testbed defects were fixed alongside: filter disclosure was not reset at a trial
boundary (`2cecac2`), and the macro test fixture simulated a toggle without toggling
`aria-expanded` (`6bc15fe`).

---

## 4. Verification detail

### 4.1 Verifier checks applied to every capture

`structural_validity`, `schema_version`, `canonical_clock`, `correlation_identifiers`,
`task_lifecycle_consistency`, `window_outcome_completeness`, `intervention_terminal_states`,
`policy_decision_recording`, `prediction_window_attribution`,
`episode_prediction_attribution`, `baseline_zero_mutations`, `semantic_outcome_contract`,
`condition_provenance_consistency`, `provenance_declared`, `export_integrity_warnings`.

All 15 pass on all eight captures. Legacy `1.1.0`–`1.3.0` captures remain readable, with the
guarantees they cannot satisfy reported as messages rather than failures.

### 4.2 Condition comparison

Four comparisons (one per task) pass integrity. Every applied intervention would have to be
in the configured vocabulary and attributable to an accepted policy decision; none was
applied, so those checks pass vacuously and the report says **actuation not observed**. A
declined policy is reported as `NO (policy declined)` and is not treated as a broken capture.

### 4.3 Cross-repository ingestion

The ingestion layer now accepts `1.4.0` while continuing to reject unknown versions loudly.
The smoke test ingests the real exported captures under
`model-preparation/.data/raw/scripted/`, not a hand-built dict. The obsolete T1–T3 `1.1.0`
captures were removed because they describe the superseded task set; the new manifest is the
scripted record for this milestone.

---

## 5. Verified, inferred, blocked

### Verified

- Eight `1.4.0` captures, one per task/condition pair, completed on the canonical path with
  the approved state evidence and zero task errors.
- Every trace is `provenance: scripted`, carries `TD-v2` and the semantic vocabulary version,
  and passes the full verifier.
- Baseline captures contain no applied intervention.
- Adaptive captures ran the real ONNX Slow Gate (`wasm`, `TargetInterventionHead-v1.0.0-int8`)
  and recorded a policy verdict for every prediction.
- The condition comparison, the ingestion layer and the model-preparation tests accept the
  real exports.
- Collection readiness: provenance gate, local persistence, recovery, retry and export paths
  behave as documented.

### Inferred

- The first action of a trial may fall inside the first MicroTensor window and therefore have
  no preceding window to carry its semantic outcome. Traces were not back-filled.
- Because the policy declined in both conditions, the scripted comparison demonstrates
  integrity and accounting, not a behavioural difference between conditions.

### Not observed

- A visible adaptive intervention on the canonical TD path. TD1's Fast Gate candidate
  (`simplify_options`, confidence 1.0) was rejected by the two-consecutive-window persistence
  rule; the recorded refusal reasons are `below_threshold`, `pending_persistence` and
  `no_prediction`. Triggering and verifying interventions is Workstream 60.

### Blocked

- Deployed-origin scripted run. This pass targets the local testbed origin.
- Live Supabase write from these captures (no project credentials here). The write path was
  observed on the deployed origin on 2026-10-04 and is recorded in the
  [verification runbook](../../../../deploy/verification-runbook.md).
- Participant collection: consent, participant identifier, counterbalancing, sample size,
  withdrawal and deletion. These are study-protocol decisions, not code gaps.

---

## 6. Participant-facing clarification (post-validation review, 2026-11-17)

**Observation.** TD2's brief said "Books sold on or after 1 June 2025", but its completion
predicate requires the exact state `dateFrom = 2025-06-01`, only Books, and five rows. A
participant who chose a later start date was doing a reasonable reading of the instruction
and still could not complete the trial. The task stayed `In Progress`, so the task and
condition controls correctly stayed locked — with nothing on screen explaining why. The task
brief itself was also never rendered; participants saw only a short name and a step label.

**Change.** The completion predicate is unchanged: the approved task requires that exact
state, and accepting a date range would make the row count (and every downstream target)
non-deterministic. Instead the interface now says what the task expects:

- the active task's full brief is rendered above the status row
  (`data-aui-component="trial-instruction"`);
- step labels name the exact targets: "Set the start date to 1 June 2025",
  "Select only Books", "Select the Europe region";
- while a trial is in progress, a visible note
  (`data-aui-component="trial-lock-note"`) explains that task and condition controls are
  locked until the trial ends and that Reset Trial ends it early; the note is an
  `aria-live="polite"` region and is referenced by `aria-describedby` from both control
  groups;
- when every step has been visited but the required state is still not met, the step line
  says so ("All steps visited — the task's required state is not met yet") instead of
  reading `N/A`.

**Proof.** `tests/task_wiring.test.tsx` starts TD2, applies a later start date, asserts the
trial stays incomplete with the explanation visible and Reset Trial still available, then
corrects the date and asserts completion removes the explanation and unlocks the controls.
A second test asserts the brief and the exact step instruction are rendered
(`528 passed` framework suite).

**Inferred.** The wording is participant-facing; it should be confirmed in the study-protocol
review rather than treated as approved copy. No task definition, completion predicate or
capture was changed, so the eight captures in this report remain valid.

---

## 7. Reproduction notes

- The harness needs a running Vite server (it starts one if the port is free), a
  diagnostics-enabled origin (`?auiDiagnostics=1`), and `agent-browser`.
- Each trial reloads the page first. A trial boundary resets the recorder, task state and
  filter values, but browser UI state such as open sections would otherwise leak between
  trials; one failed trial would also cascade into every later trial.
- Only browser-transport failures are retried. A missing element or an incomplete task fails
  the run immediately; the attempt history is recorded in the manifest.
- The capture filenames and the manifest carry `scripted` so these files can never be pooled
  with participant traces accidentally.
