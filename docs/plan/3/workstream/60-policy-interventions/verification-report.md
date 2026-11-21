# Workstream 60 — Intervention Verification Report

- **Date:** 2026-11-20
- **Scope:** Task 60.2 verification of every in-scope intervention, and the Task 60.1
  changes it exercised. Read with
  [`work.md`](work.md), [`60.1`](tasks/60.1-outcome-policy-and-target-resolution.md) and
  [`60.2`](tasks/60.2-intervention-verification-and-refinement.md).
- **Status:** Functional verification complete; visual verification complete for all five
  intervention types; refinements listed in §8. One pre-existing test-environment failure
  remains and is not caused by this workstream (§12).
- **What this report does not claim:** that any intervention is useful, improves task
  performance, or reduces errors. Only mechanism, targeting, visibility, reversibility and
  non-disruption are verified. No participant study was run.

---

## 1. Method and evidence classes

Three kinds of evidence are kept apart because they prove different things.

| Class | What it proves | Where |
| --- | --- | --- |
| **Functional** (jsdom) | The code path does what the contract says on the rendered React testbed: correct element, attributes, focus, dismissal, exact reversal, missing-target safety | `tests/intervention_verification.test.tsx`, `tests/testbed_intervention_targets.test.ts`, `tests/actuator.test.ts`, `tests/policy_cooldown_ttl.test.ts`, `tests/policy_adapter_wiring.test.ts` |
| **Visual** (live browser) | The adaptation is actually visible, in the intended place, at the intended viewport, and does not move the page | `evidence/*.png` (§5–§7) |
| **Trace** (live runtime) | The intervention came from the real pipeline — a real prediction, the policy, an episode with a `predictionId`, and a terminal event — not from the screenshot harness | `evidence/real-pipeline-trace-summary.json` (§7) |

### 1.1 How the visual screenshots were triggered

Two triggers were used, and every image states which one produced it (§5).

1. **Real pipeline** (images `07`–`09`). Three real clicks on the Date Range accordion
   (open → close → open) produced the macro sequence `… CLOSE_FILTERS, OPEN_FILTERS`; the
   Fast Gate matched the declared participant pattern, the policy accepted
   `simplify_options`, and the actuator applied it. Nothing was injected.
2. **Policy-chain harness** (images `00`–`06`). The page loaded the real application
   modules from the dev server and fed a **synthetic** `PredictionResult` through the real
   testbed mapping (`policyAdapter.ts`), the real `InterventionPolicy` with production gate
   semantics, the real `UIActuator` and the real testbed target resolver
   (`interventionTargets.ts`). The DOM, CSS and rendered targets are the real testbed. The
   prediction is synthetic because the semantic Slow Gate cannot be steered deterministically
   to a chosen class; the report labels these images as harness-triggered rather than
   model-triggered.

No application source file was added or changed to make the harness work: it used the dev
server's module graph (`import('/src/…')`) and left no artifact in the shipped build.

## 2. Environment

| Item | Value |
| --- | --- |
| Host | macOS 27.3 (build 26C5035r) |
| Browser | Google Chrome 157.0.8103.79, headless, driven over CDP |
| Viewport | **1440 × 900**, device pixel ratio 1 |
| Application | `npx vite --port 5199 --strictPort` at `http://localhost:5199/` (dev build) |
| Condition | `adaptive` (screenshots 07–09); harness pages also `adaptive` |
| Runtime | ONNX Runtime Web, execution provider `wasm`; `slowGateMode: onnx`; model `TargetInterventionHead-v1.0.0-int8`; policy `1.0.0`; trace schema `1.4.0`; provenance `scripted` |
| Commit at capture | the workstream-60 working tree on `feat/refinement` (recorded in the commit that adds this report) |

The browser was launched separately and agent-browser attached to it with `--cdp 9333`
because agent-browser's own socket directory lives outside the workspace sandbox.

## 3. Functional verification matrix

All rows are asserted by `tests/intervention_verification.test.tsx` against
`<App />` rendered on the Analytics page unless stated otherwise.

| Intervention | Correct target | Visible state | Focus | Reversal / dismissal | No unintended mutation |
| --- | --- | --- | --- | --- | --- |
| `highlight_primary_action` | `btn-export` (`data-aui-role="primary-action"`) | `.edge-aui-highlight` + `data-aui-active-adaptation="highlight"` | focus on `nav-Analytics` unchanged | `clear()` restores the exact prior `class` and removes both data attributes | sibling count unchanged (paint-only); a second apply keeps one active episode |
| `simplify_options` | `filter-drawer` (`filter-options` target) | `.edge-aui-simplified` on the drawer; expanded section collapses (`aria-expanded="false"`) | focus outside the drawer unchanged; a focused section is **not** collapsed | accordion and drawer class restored; section re-expands | only accordions inside the declared surface are touched; the other sections' state is unchanged |
| `expand_tooltip` | `tooltip-region` | `.edge-aui-tooltip-expanded`, `role="tooltip"` bubble with the target's own `title`, `aria-describedby` linked | focus on `nav-Analytics` unchanged | Escape dismisses (event `dismissed`) and `clear()` removes the bubble, `aria-expanded` and `aria-describedby`; `title` restored | `tooltip-status` is not expanded; a tooltip with no `title`/`data-tooltip` is refused with no mutation |
| `offer_assistance` | global banner (no element target) | `role="status" aria-live="polite"` banner, configured text | focus unchanged | dismiss button removes the node and emits `dismissed`; Escape also dismisses | no page content changes; banner is fixed-position |
| `no_op` | — | none | unchanged | n/a | rendered page `innerHTML` byte-identical |

Missing target, per applicable type, is asserted in both
`tests/testbed_intervention_targets.test.ts` (fixture DOM) and
`tests/intervention_verification.test.tsx` (rendered app):

- primary action removed → `apply()` returns `false`, the page is unchanged, and
  `btn-apply-filters` (the submit action) is **not** highlighted as a fallback;
- filter drawer removed → no `edge-aui-simplified` anywhere;
- tooltip text removed → no bubble;
- an actionable command with no declared target → refused.

Policy-level guarantees are asserted in `tests/policy_cooldown_ttl.test.ts` and
`tests/testbed_intervention_targets.test.ts`: transient first window refused, persistence
required, cooldown after acceptance, dismissal suppression, one adaptation per observed act,
and unmapped outcomes recorded as decision-only `no_op`.

## 4. Visual verification matrix

Every image is 1440 × 900 PNG in [`evidence/`](evidence/). Open them at full size; the
adaptation is a small state change and the images are not annotated.

| # | Image | Trigger | Type | What to look for |
| --- | --- | --- | --- | --- |
| 00 | `00-analytics-baseline.png` | — | none | Analytics in its starting state: all filter sections collapsed, no adaptation. Reference frame. |
| 01 | `01-highlight-primary-action.png` | harness | `highlight_primary_action` | Teal 3 px outline + soft glow around **Export Report**; no other change to the page. |
| 02 | `02-simplify-before.png` | real clicks | — | Date Range section open, so the simplification has something to collapse. |
| 03 | `03-simplify-options.png` | harness | `simplify_options` | Date Range collapsed; a teal inset bar on the left edge of the Filters panel marks the simplified surface. The Filter panel's position and width are unchanged. |
| 04 | `04-expand-tooltip.png` | harness | `expand_tooltip` | Dark tooltip bubble below the Region `[?]` trigger reading "Geographical sales region" (the element's real `title`, not generic text), with an upward pointer. The Status tooltip is unchanged. |
| 05 | `05-offer-assistance.png` | harness | `offer_assistance` | Bottom-right banner "Guidance Tip — Can we help with this step?" with a dismiss control. |
| 05b | `05-assistance-before.png` | — | none | The exact frame used to prove dismissal restores the page (see §6). |
| 06 | `06-restored-after-dismissal.png` | — | none | After dismissing the banner. **Pixel-identical to 05b** (0 differing pixels). |
| 07 | `07-real-pipeline-simplify.png` | **real pipeline** | `simplify_options` | The teal inset bar, applied by the runtime from a real Fast Gate match (`CLOSE_FILTERS > OPEN_FILTERS`), episode `ep_1`. |
| 08 | `08-debug-decision-state.png` | **real pipeline** | — | Pipeline Inspector: decision state `POLICY REJECTED — Cooldown active`, gate `fast`, mapping `fast_gate_pattern`, **Active Intervention Episode** `ep_3 — ACTIVE (simplify_options)`, TTL 8000 ms, Fast Gate `MATCH (CLOSE_FILTERS > OPEN_FILTERS)`. It shows the distinction between the last decision and the live episode. |
| 09 | `09-real-pipeline-after-ttl.png` | **real pipeline** | — | After the TTL elapsed: the drawer is back to its base class, no `data-aui-active-adaptation` remains, and the inspector's **Active Intervention Episode** is empty. The last decision reads `ineligible_context` because focus had moved to the debug panel; the trace summary shows what happened while the participant was idle: 28 predictions, `interventionsApplied` stayed **1**, and 7 decisions were refused as `already_adapted` (§8.6). |

## 5. Geometry and focus measurements (live browser)

`getBoundingClientRect()` was sampled immediately before, during and after each adaptation.
Values are `[x, y, width, height]` in CSS pixels at the recorded viewport.

| State | results table | filter drawer | Export button | Apply button | page height |
| --- | --- | --- | --- | --- | --- |
| Before, and during `highlight_primary_action` | `[565,414,810,476]` | `[285,290,260,349]` | `[1248,427,110,29]` | `[302,537,226,34]` | 931 |
| During `simplify_options` | `[565,414,810,476]` | `[285,290,260,297]` | `[1248,427,110,29]` | `[302,485,226,34]` | 931 |
| After `simplify_options` clear | `[565,414,810,476]` | `[285,290,260,349]` | `[1248,427,110,29]` | `[302,537,226,34]` | 931 |
| Before, during and after `expand_tooltip` | `[565,414,810,476]` | `[285,290,260,349]` | `[1248,427,110,29]` | `[302,537,226,34]` | 931 |
| Before, during and after `offer_assistance` | `[565,414,810,476]` | `[285,290,260,349]` | `[1248,427,110,29]` | `[302,537,226,34]` | 931 |

Interpretation:

- The results table, Export button and page height never move. No adaptation shifts content
  the participant is reading.
- `simplify_options` is the only type that changes geometry, and only **inside** the surface
  it simplified: the drawer shrinks by 52 px because the section it collapsed is gone, and
  the Apply/Reset controls move up with it. That is the intended collapse, not an
  unintended shift; `clear()` restores the drawer to 349 px.
- The tooltip bubble is `[792,514,145,48]` and absolutely positioned, so it overlays without
  participating in layout.
- `offer_assistance` is `position: fixed`, so it cannot displace content.

Focus (live): after applying each type, `document.activeElement` was still the element that
held focus before — `btn-apply-filters` (highlight), `filter-date-input` (simplify; its
section stayed open), `nav-Analytics` (tooltip and assistance).

## 6. Exact restoration after dismissal

`05-assistance-before.png` and `06-restored-after-dismissal.png` are the same frame before
and after the banner lifecycle. A pixel comparison (`Pillow`, threshold 12/765) reports
**0 differing pixels of 1,296,000**. The adaptation left no trace in the interface.

## 7. Real-pipeline end-to-end run

Artifact: [`evidence/real-pipeline-trace-summary.json`](evidence/real-pipeline-trace-summary.json).
Trace schema `1.4.0`, condition `adaptive`, provenance `scripted`, provider `wasm`,
model `TargetInterventionHead-v1.0.0-int8`, policy `1.0.0`.

- **Interaction:** three clicks on the Date Range accordion (open → close → open).
- **Fast Gate:** matched `CLOSE_FILTERS > OPEN_FILTERS`; `outcomeId: open_filter_section`,
  confidence 1.0, mapping source `fast_gate_pattern`.
- **Policy:** 28 predictions → 28 recorded decisions:
  1 accepted, 2 `cooldown`, 7 `already_adapted`, 2 `below_threshold`, 13
  `ineligible_context` (after focus moved to the debug panel, whose element is neither an
  accordion nor expandable). Every decision is explainable from its `policyReason`.
- **Intervention:** exactly one episode, `ep_1`, prediction `pred_6`:
  `accepted → applied → reverted (reason: ttl)`. No second episode was opened while the
  participant remained idle, even though predictions continued.
- **DOM:** during the episode the filter drawer carried `edge-aui-simplified` and the
  accordion carried `data-aui-active-adaptation="simplified"` +
  `data-aui-adaptation-episode="ep_1"`; after the TTL both were gone.

This run is also how the over-intervention defect in §8.6 was found: before the fix the
same episode was re-applied every 5 s from one act.

## 8. Refinements made because of verification

Each item is a defect the verification found, not a planned feature.

1. **`simplify_options` had no visible surface state.** In the canonical flow the only
   expanded section is the one containing the participant's focus, which must not be closed
   — so a "simplified" drawer could look identical to an untouched one. Added an inset
   accent bar on the declared surface (`src/intervention/styles.css`): paint only, no layout
   participation. Evidence: `02` vs `03`.
2. **The tooltip bubble inherited table-header typography.** Inside a `<th>` the help text
   rendered uppercase with header tracking. The bubble now resets `text-transform`,
   `letter-spacing` and `font-weight`. Evidence: first capture of `04` showed
   "GEOGRAPHICAL SALES REGION".
3. **The tooltip bubble was positioned against the wrong containing block.** The target was
   not positioned, so `position: absolute` resolved against an ancestor. `.edge-aui-tooltip-expanded`
   is now `position: relative`, and the bubble is placed below the trigger. The pointer was
   moved to the bubble's top edge to match.
4. **The assistance banner displayed an internal mapping sentence.** `UIActuator` renders
   `command.reason` to the participant, and the testbed adapter was putting
   "Testbed mapping: outcome 'BACKTRACK' -> offer_assistance" there. The adapter now leaves
   `reason` unset for `offer_assistance`, so the configured
   `actuation.defaultAssistanceText` is shown ("Can we help with this step?"). Evidence:
   `05`.
5. **Target resolution was permissive.** The framework fell back to the first primary
   action, tooltip or accordion, and the testbed policy fell back to
   `context.activeComponentId`. Both are removed: every element-changing adaptation declares
   a target, the testbed resolver validates that the element can accept it, and an
   unresolved target is a recorded actuation failure with no mutation.
6. **One act produced repeated interventions.** The live run in §7 re-applied the same
   adaptation every cooldown period (5 s) while the participant was idle, because the Fast
   Gate keeps re-evaluating the same macro history. The policy now suppresses a candidate
   whose accepted adaptation already answers the current act
   (`rejectionCategory: 'already_adapted'`), and the runtime re-arms it on each new macro
   interaction (`notifyUserAction`). Evidence: `09` and the 7 `already_adapted` decisions in
   the trace summary; tests in `tests/policy_cooldown_ttl.test.ts`.

## 9. Baseline condition

Functionally verified twice:

- `tests/adaptive_runtime.test.ts` — condition `baseline` records telemetry and applies no
  adaptation (zero `.edge-aui-highlight` / `.edge-aui-assistance-banner`).
- `tests/policy_adapter_wiring.test.ts` — condition `baseline`, real testbed resolver: a
  `baseline_condition` decision-only record is written naming the candidate
  (`expand_tooltip`), `interventionsApplied` is 0, no `applied` event exists, and no DOM
  adaptation attribute is present.

Visually, the baseline condition is the absence of every adaptation, i.e. image `00`; no
separate baseline screenshot is claimed. The condition is resolved before the session starts
and is immutable for it (`src/runtime/boot.ts`).

## 10. Accessibility-tree observations

- `highlight_primary_action` adds a class and one data attribute, then restores the exact
  prior `class`; no node is inserted.
- `simplify_options` sets `aria-expanded="false"` on the collapsed accordion (the control
  remains, so the option can be reopened) and restores `aria-expanded="true"` on reversal.
- `expand_tooltip` adds `role="tooltip"` + `aria-describedby` and `aria-expanded="true"`; the
  bubble is non-modal; reversal removes the bubble and both attributes and restores `title`.
- `offer_assistance` uses `role="status"` + `aria-live="polite"`, adds no focusable trap, and
  is dismissible by button and Escape.
- No adaptation introduces `aria-hidden`, `display: none` on a required control, or a
  keyboard trap. After a full reset, the element count and text content of the page are
  unchanged.

## 11. Visually verified vs source/unit-only

| Claim | Evidence class |
| --- | --- |
| The four adaptations are visible on the real rendered targets at 1440 × 900 | **Visually verified** (`01`, `03`, `04`, `05`) |
| `highlight_primary_action` targets Export and not the Apply/submit button | **Visually verified** (`01`) and functionally asserted |
| `simplify_options` collapses only inside the filter surface, with a visible surface marker | **Visually verified** (`02` vs `03`) and functionally asserted |
| `expand_tooltip` shows the Region tooltip's own text and leaves the Status tooltip alone | **Visually verified** (`04`) and functionally asserted |
| `offer_assistance` is a visible, non-modal, dismissible banner with the configured text | **Visually verified** (`05`) and functionally asserted |
| No layout shift outside the adapted surface | **Visually verified** (screenshots) and **measured** (§5 rects) |
| No focus theft | **Measured live** (§5) and functionally asserted |
| Exact restoration after dismissal | **Visually verified** (0-pixel diff, §6) and functionally asserted |
| `no_op` leaves the page unchanged | Functionally asserted only (nothing to see) |
| Missing-target refusal for each type | Functionally asserted only; no screenshot (the observable result is "no change") |
| Baseline applies no adaptation | Functionally asserted; visually it is image `00` by definition |
| TTL expiry and repeat suppression | **Visually/observably verified live** (`09`) and in the trace; unit-tested |
| The intervention came from the real model pipeline | **Trace-verified** for `simplify_options` (`07`–`09`, trace summary); for the other three types the decision chain was exercised with a synthetic prediction, labelled as such |

Not verified visually: any adaptation on the Overview or Reports pages (no applicable target
was needed for this scope), any mobile/touch layout (participation requires a fine pointer),
and any second browser or platform.

## 12. Limitations and honest gaps

- **No layout-stability metric was measured.** CLS, TBT and paint timings are **NOT
  MEASURED**. §5 reports element geometry, which shows that content did not move; it is not
  a browser performance trace.
- **No user-benefit claim.** The screenshots show that an adaptation is visible and
  reversible; they say nothing about whether it helps. That requires a study (out of scope).
- **Three of the four visual captures used a synthetic prediction.** The mapping, policy,
  actuator, resolver, DOM and CSS were the real ones; the prediction was injected because the
  semantic head cannot be deterministically steered to a chosen class. The one type that was
  driven end-to-end by the real pipeline is `simplify_options`.
- **One browser, one viewport, one platform.** The verification did not cover Chromium
  variants, Safari, Firefox, or a HiDPI display.
- **The assistance banner overlaps the debug-panel toggle** in the bottom-right corner
  (visible in `05`). This is researcher-facing chrome, the banner is dismissible and
  TTL-bound, and it was not changed because placement is a design decision rather than a
  defect. Recorded here so the overlap is not discovered later as a surprise.
- **`ineligible_context` after focus moves to the debug panel** is the context-eligibility
  gate reading the active element. It is correct for the declared policy but means the
  debug panel itself suppresses `simplify_options` while focused.
- **Pre-existing test failure, not caused here:** `tests/experiment_condition.test.ts` fails
  7 tests whenever `.env.local` sets `VITE_AUI_EXPERIMENT_CONDITION`, because Vite inlines
  the value before `vi.stubEnv` can override it. Reproduced identically in a worktree at
  commit `3cec83f` (7 failed / 10 passed) with the same `.env.local`. With that file absent,
  the documented complementary failures in `trial_completion_upload.test.ts` apply.
- **Two artifacts are large binary images.** They are the evidence; nothing generated at
  runtime was uploaded, and all visual runs declare provenance `scripted`.

## 13. Reproduction

```bash
cd edge-aui-framework

# Functional
npm test -- tests/intervention_verification.test.tsx \
            tests/testbed_intervention_targets.test.ts \
            tests/actuator.test.ts \
            tests/policy_cooldown_ttl.test.ts \
            tests/policy_adapter_wiring.test.ts
npm run typecheck

# Full suite (expect only the pre-existing experiment_condition environment failures)
npx vitest run

# Visual (any Chromium/Chrome with CDP; 1440x900)
npx vite --port 5199 --strictPort
# open http://localhost:5199/ , navigate to Analytics, apply each adaptation, capture
# 1440x900 screenshots. The real end-to-end trigger is: click the Date Range accordion
# open, closed, open, and wait ~3 s for the Fast Gate match and the policy's
# two-window persistence.
```

The harness used for the deterministic captures is described in §1.1; it is not committed
because it is a verification method, not application code.

## 14. Evidence inventory

```
evidence/
├── 00-analytics-baseline.png
├── 01-highlight-primary-action.png
├── 02-simplify-before.png
├── 03-simplify-options.png
├── 04-expand-tooltip.png
├── 05-assistance-before.png
├── 05-offer-assistance.png
├── 06-restored-after-dismissal.png
├── 07-real-pipeline-simplify.png
├── 08-debug-decision-state.png
├── 09-real-pipeline-after-ttl.png
└── real-pipeline-trace-summary.json
```
