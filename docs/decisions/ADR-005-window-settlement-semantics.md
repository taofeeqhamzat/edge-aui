# ADR-005: Window Settlement Semantics (Sparse Windows)

- **Status:** Accepted (Option B — Delayed Settlement with fixed delay `settlement_delay_ms = 250`)
- **Date:** 2026-09-25
- **Related:** ADR-004, ADR-012, Assessment: `docs/assessments/sparse-window-loss.md`

## 1. Context

The runtime assigns events to a fixed, monotonic, half-open grid
(`[windowStart, windowEnd)`) with `window_size_ms = 500` and `stride_ms = 250`. Each slot is
processed **once**, when the clock passes it. A slot holding fewer than
`min_events_per_window = 3` events is dropped and counted in `skippedSparseWindows`.

The Python reference (`model-preparation/src/preprocessing.py`) segments a *static* stream. It
visits every slot after the whole stream is known, so a slot that looks sparse at emission time
may be filled by late events.

This is recorded as limitation 1 in
`docs/assessments/target-testbed-implementation-record.md` §4.

## 2. Problem

The live and offline pipelines disagree about which windows exist. Because the live path makes a
final decision with incomplete information, a slot with 1–2 events at emission time is dropped
even when events arrive moments later and would have brought it to the threshold.

This is a **semantics** question, not a performance question:

- Dropping sparse windows removes exactly the low-activity windows that represent hesitation and
  inactivity — behaviour the Slow Gate is meant to see.
- Raising the number of emitted windows by lowering the threshold would change what a window
  *means*, and would break correspondence with the Python reference.

## 3. Options considered

| Option | Description | Preserves determinism? | Preserves Python correspondence? |
| --- | --- | --- | --- |
| **A. Keep drop-once** | Current behaviour. Slot decided at first pass. | Yes | **No** |
| **B. Delayed settlement** | Emit a slot only after a bounded settlement delay has elapsed, so late events can still land in it. | Yes, with a fixed delay | Yes, given a horizon ≥ the delay |
| **C. Two-pass** | Buffer a whole session, settle at the end. | Yes | Yes |
| **D. Emit sparse windows as-is** | Never skip; rely on the mask to mark low input. | Yes | No — changes the offline definition |

Option C is incompatible with online operation. Option D changes the meaning of an emitted
window, which the brief explicitly forbids ("Do not change the semantics merely to increase event
counts").

## 4. Evidence available

**Verified by automated test**

- `tests/windowing_contract.test.ts` asserts half-open boundary exclusivity and inactivity
  emission.
- `tests/microtensor_window.test.ts` (4 tests).

**Observed**

- `skippedSparseWindows` is a live counter; the implementation record records the gap as open.

**Measured (Task 1.1 — `docs/assessments/sparse-window-loss.md`)**
- Measured over 6 recorded participant traces, 14,765 events, 2,281 slots.
- Active-slot sparse loss rate: **10.95%** (exceeding pre-declared 5.0% materiality threshold).
- Lookahead crossing: **66.20%** of sparse slots cross $\ge 3$ events when evaluated across a 500 ms window span.
- The loss was demonstrated to be **material**, justifying delayed settlement.

## 5. Decision
**Option B — Delayed settlement** is adopted.
A fixed settlement delay of one stride (`settlement_delay_ms = 250`) is introduced into the configuration. Each slot is held open for this delay and settled once using all events assigned to it.
A `settledSparseWindows` counter is tracked alongside `skippedSparseWindows` so settlement outcomes are observable.

## 6. Rationale
Delayed settlement satisfies all four preserved properties named in brief §4 A1:
deterministic boundaries, inactivity windows, online operation, and correspondence with the Python preprocessing semantics.
The 250 ms fixed delay allows the 66.20% boundary-straddling sparse slots to be settled accurately while bounding reaction latency to 250 ms.

A delayed-settlement design satisfies all four preserved properties named in the brief:
deterministic boundaries, inactivity windows, online operation, and Python correspondence —
provided the delay is fixed, not adaptive.

## 7. Consequences

- Option B adds a bounded latency between the last event of a window and its emission. The
  Slow Gate becomes slower to react to the most recent 250–500 ms. This is a real cost and must
  be stated in the thesis, not hidden.
- Option B requires a new configuration field and a change to the window emission counter
  semantics; `skippedSparseWindows` becomes `settledSparseWindows` or gains a sibling counter.
- Option B may change the emitted window count, which changes macro sequence contents and
  therefore Fast Gate hit rates. Any before/after comparison must re-baseline.

## 8. What is being deferred

> **Decision:** Whether late events are re-admitted to an already-emitted window (retroactive
> revision).
> **Deferred until:** Delayed settlement is measured and shown to be insufficient.
> **Reason:** Retroactive revision would make previously emitted tensors non-final, which breaks
> the "deterministic window boundaries" property and the trace's append-only assumption.
> **Current workaround:** `lateEvents` is counted and events outside the settlement window are
> dropped.
> **Risk:** Low — this is the conservative choice.
> **Evidence required to revisit:** A measured late-event tail that extends beyond the chosen
> settlement delay for a meaningful share of windows.

## 9. Conditions that would force this decision to be revisited

- Measured loss of sparse windows is material on real traces.
- The Python reference itself changes settlement semantics, breaking the correspondence premise.
- Delayed settlement is shown to delay Slow Gate reaction beyond what the policy's sustained
  confidence window can tolerate.
