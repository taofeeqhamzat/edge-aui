# ADR-014: Deferred Target-UI Features and Outstanding Deferments

- **Status:** Accepted — this is the index of what is deliberately not being built
- **Date:** 2026-09-24
- **Related:** All ADRs

## 1. Context

Brief §19 requires an explicit deferment log, and §20 forbids claiming the deployable participant
pipeline is complete until the shareability and deployment boundaries are actually implemented
and tested. Brief §21 fixes the implementation order and forbids jumping to deployment packaging
before the intervention-head experiment works end to end.

This record collects the deferments that are not naturally owned by another ADR, so that "we did
not build that" is a recorded decision rather than an omission.

## 2. Problem

Without a single index, deferments scatter across documents and are later misread as gaps or as
completed work.

## 3. Options considered

| Option | Description |
| --- | --- |
| **A. Inline deferment blocks only** | Each ADR owns its own deferments. |
| **B. Inline deferment blocks + this index** | As A, plus one place listing what is out of scope. |

## 4. Evidence available

The deferments below are each grounded in a specific measurement or a specific brief instruction,
cited inline.

## 5. Decision required

Whether the items below may remain deferred for the intervention-head milestone.

## 6. Recommended option

**Option B — keep inline deferments and maintain this index.** Recommended: approve the deferment
list below as the explicit scope boundary of plan 1.

### Deferred items

**D1 — Participant deployment hardening.**
> **Decision:** Privacy controls, consent flow, retention UI, multi-participant pooling.
> **Deferred until:** A participant study is scheduled.
> **Reason:** Brief §20: "It is acceptable to defer participant deployment hardening."
> **Current workaround:** Scripted testbed traces (ADR-013).
> **Risk:** Medium — deferred work becomes critical-path work at study time.
> **Evidence required to revisit:** A scheduled study or ethics submission.

**D2 — `@edge-aui/*` package split and publication.**
> **Decision:** Package modularization and external npm registry publication.
> **Deferred until:** A second UI is adapted against the adapter interface.
> **Reason:** Brief §15 — do not package for naming purposes.
> **Current workaround:** Directory-level module boundaries.
> **Risk:** Low.
> **Evidence required to revisit:** ADR-011 §9 conditions.

**D3 — Edge payload reduction.**
> **Decision:** Custom tree-shaken ORT WASM compilation or CDN decoupling.
> **Deferred until:** The intervention-head experiment works end to end.
> **Reason:** Brief §20 — vertical slice over broad generalisation; ADR-008.
> **Current workaround:** Payload reported as NOT MET with the measured figure.
> **Risk:** High for the deployment goal.
> **Evidence required to revisit:** ADR-008 §9 conditions.

**D4 — Browser coverage beyond Chromium.**
> **Decision:** Automated cross-browser test matrix and validation (Firefox, Safari, mobile).
> **Deferred until:** After the runtime contract is stable.
> **Reason:** All measurements to date come from headless Chrome 153 on macOS; Firefox, Safari and
> GPU-less fallback paths are unexercised (implementation record §4.9).
> **Current workaround:** Provider fallback is implemented but untested on those browsers.
> **Risk:** Medium — the "browser-side inference" claim is currently Chromium-only.
> **Evidence required to revisit:** A cross-browser smoke run of the production build.

**D5 — `dwellTimeMs` construct validity.**
> **Decision:** Independent physical hover tracking replacing event-count proxy.
> **Deferred until:** Independently measured hover duration exists.
> **Reason:** Both implementations use a `count × 40 ms` proxy; parity holds, meaning does not
> (ADR-004).
> **Current workaround:** Documented as a proxy.
> **Risk:** Medium for research validity.
> **Evidence required to revisit:** ADR-004 §9 conditions.

**D6 — Legacy module removal (`src/main.ts`, `src/core/pipeline.ts`, `src/counter.ts`, `SlidingWindowBuffer`).**
> **Decision:** Deletion of dead prototype modules.
> **Deferred until:** A task already touches the surrounding area.
> **Reason:** Removal is safe but was deferred to avoid churn.
> **Current workaround:** Documented as unused.
> **Risk:** Low — dead code can mislead a reader into thinking it is live.
> **Evidence required to revisit:** Any task that edits those files or their importers.

**D7 — Multi-participant experiment design (counterbalancing, randomisation, order effects).**
> **Decision:** Automated Latin-square condition rotation and participant balancing.
> **Deferred until:** A participant study is designed.
> **Reason:** Only a single-participant scripted trial has been exercised; the condition switch is
> manual.
> **Current workaround:** Manual condition selection, recorded in the trace.
> **Risk:** Medium for the experimental-validity chapter.
> **Evidence required to revisit:** Study protocol drafting.

**D8 — Online support tuning for the PrefixSpan miner.**
> **Decision:** Adaptive min_support scaling as the live macro interaction corpus grows.
> **Deferred until:** The Fast/Slow routing experiment (plan 1 task 6.1) produces per-gate outcome data.
> **Reason:** Support is currently a fixed configured value; there is no evidence yet about what a session-length corpus requires.
> **Current workaround:** `support` is a configuration field (plan 1 task 4.2).
> **Risk:** Low — a mis-set support changes gate hit rate, not correctness; it is observable via `gateHits`.
> **Evidence required to revisit:** Gate hit/miss ratios and false-match rate over several complete tasks (ADR-002 §8).

**D9 — Retroactive window revision for late events.**
> **Decision:** Whether late events are re-admitted to an already-emitted window (retroactive revision).
> **Deferred until:** Delayed settlement is measured as insufficient (ADR-005 §8).
> **Reason:** Retroactive revision would make previously emitted tensors non-final, which breaks the "deterministic window boundaries" property and the trace's append-only assumption.
> **Current workaround:** `lateEvents` is counted and events outside the settlement window are dropped.
> **Risk:** Low — this is the conservative choice.
> **Evidence required to revisit:** A measured late-event tail that extends beyond the chosen settlement delay for a meaningful share of windows.

**D10 — Participant telemetry persistence and retention controls.**
> **Decision:** Implementing local storage persistence (IndexedDB) and user deletion controls.
> **Deferred until:** A participant study is scheduled; the immediate milestone uses scripted testbed traces.
> **Reason:** The immediate milestone does not involve participants, and storage sizing depends on an unmeasured trace size (ADR-009 / ADR-010).
> **Current workaround:** In-memory buffers plus manual JSON export.
> **Risk:** Low now; medium at study time if sizing is discovered late.
> **Evidence required to revisit:** Measured trace size per completed task and per session.

**D11 — WebGPU provider claim re-verification.**
> **Decision:** Empirical re-verification of the WebGPU acceleration claim.
> **Deferred until:** The inference-runtime decision (ADR-007) is made.
> **Reason:** The current provider reporting is honest, but the WebGPU claim would be invalidated by any runtime replacement. The claim must be re-earned, not inherited.
> **Current workaround:** Provider reporting records actual provider (`webgpu` / `wasm`).
> **Risk:** High for architectural claim integrity.
> **Evidence required to revisit:** Measured runtime provider output on candidate runtime.

**D12 — Hot-reload / configuration UI.**
> **Decision:** Whether the framework should support runtime configuration hot-reload or a config UI.
> **Deferred until:** The configurability refactor lands and its ergonomics are observed in use (ADR-012 §8).
> **Reason:** Hot-reload is a convenience, not a requirement, and it interacts badly with the reproducibility guarantee.
> **Current workaround:** Restart with a different configuration; the configuration is recorded in the trace.
> **Risk:** Low.
> **Evidence required to revisit:** Reported friction during ablation runs.

## 7. Consequences

- Plan 1's task list does **not** include tasks for D1–D12. Their absence is intentional and
  traceable to this record.
- The final agent report's "Deferments" section is generated from this index plus the per-ADR
  deferment blocks — it is not an open-ended list.
- The larger-project definition of done (brief §23) is **not** satisfied while D1–D3 and D11 are
  open. Any claim of a "complete deployable participant pipeline" is false until they close.

## 8. What is being deferred

The items above. This record is itself the deferment register.

## 9. Conditions that would force this decision to be revisited

- A participant study is scheduled: D1, D2, D6, D7, D10 become critical path.
- The edge payload target is treated as a hard acceptance criterion: D3 and D11 become critical
  path.
- Any report claims the deployable pipeline is complete: this record contradicts it.
