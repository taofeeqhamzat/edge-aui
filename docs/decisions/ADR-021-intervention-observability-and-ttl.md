# ADR-021: Intervention Observability and Adaptation Lifetime

- **Status:** Accepted — resolves the TTL decision deferred by ADR-006 and F-03
- **Date:** 2026-10-02
- **Related:** ADR-006, ADR-010, ADR-017

## 1. Context

Two defects made it impossible to demonstrate, live or post hoc, that the adaptive system had
intervened:

**F-03 — adaptations never expired.** `policy.ttlMs` and `actuation.defaultTtlMs` were both defined
as 8 000 ms and read by nothing. No producer set `ttlMs` on a command, so `UIActuator`'s TTL path —
which is unit-tested — was never reached in production. Live evidence: `edge-aui-simplified` remained
on the filter drawer at the end of a trial, with an `applied` event and no matching `reverted` or
`dismissed`. A single early decision therefore altered the participant's interface for the rest of
the session, and the intervention-history signal in the trace was biased accordingly.

**F-05 — an applied intervention left no correlatable DOM footprint.** Only
`highlight_primary_action` set `data-aui-active-adaptation`; `simplify_options`, `expand_tooltip` and
`offer_assistance` set nothing. A verification query for the attribute returned `[]` while
`.edge-aui-simplified` was visibly applied. The `intervention_terminal_states` check therefore failed
on real captures.

**F-08 — the research panel could not answer "why?"** The panel omitted `windowId`, `matchedGate`,
`mappingSource`, intervention confidence, cooldown remaining, `executionProvider`, `modelLoaded`,
`slowGateMode` and runtime counters; it also overwrote `latestMacroSequence` with `undefined` every
500 ms, so it reported "No macro events recorded" while the recorder held dozens, and it labelled an
evaluation-span measurement as "Feature Extr. Latency".

**A related defect found while fixing the above:** the `issued`/`accepted` record was written with
the *previous* episode id, because `beginEpisode()` ran after the record rather than before it, so
issued↔applied episode linkage never matched.

## 2. Problem

How does a researcher determine, from the interface and from the record, that an intervention
occurred, why it occurred, why it did not occur, and whether it is still active?

## 3. Options considered

**Adaptation lifetime:**

| Option | Description | Consequence |
| --- | --- | --- |
| A. Session-persistent, documented | No code change | Biases the rest of the session; "expired" is unreachable in a trace |
| B. Revert on next qualifying user action | No timer | "Expired" still unreachable; behaviour depends on unrelated actions |
| C. Configurable TTL with a terminal expiry event | `actuation.defaultTtlMs` wired into every accepted command | Restores the reversible-adaptation claim; gives the trace a real terminal state |

**DOM correlation:**

| Option | Description |
| --- | --- |
| A. Rely on CSS class names per adaptation type | Each type needs its own verifier logic and its own class |
| B. One attribute naming the adaptation + one carrying the episode id | A single join key between the trace and the interface for every type |

**Panel visibility:**

| Option | Description |
| --- | --- |
| A. Log to the console and read it | Explicitly excluded by the brief: the researcher must not have to read raw output |
| B. Render an explicit decision state plus the fields behind it | The panel answers "why" without inference |

## 4. Evidence available

**Verified:** the dead TTL keys and the absence of any producer setting `ttlMs`; the live
`.edge-aui-simplified` with an empty `[data-aui-active-adaptation]` query; the panel's omission list
against a live panel dump; the 500 ms `latestMacroSequence` clobber; the episode-id ordering defect.

**Verified after the change:** `tests/actuator.test.ts` covers the correlation attribute and cleared
TTL timers; `tests/deployed_acceptance.test.ts` asserts, on a real capture, that any visible
adaptation's `data-aui-adaptation-episode` matches an `applied` record in the trace and that every
applied episode is either still visible or terminated with a typed reason.

## 5. Decision required

Whether adaptations expire, how a visible adaptation is tied to the record, and what the panel must
show.

## 6. Decision

**Option C for lifetime, option B for correlation, option B for the panel.**

### Lifetime

`actuation.defaultTtlMs` (default 8 000 ms) is attached to every accepted command at the single point
every accepted command passes through — `InterventionPolicy.accept` — so no producer can forget it.
`policy.ttlMs` remains the policy's own default source. Expiry emits a terminal `reverted` event
carrying the episode id and `reason: 'ttl'`, which makes "expired" a state the trace can contain.

Teardown also closes live adaptations **before** unsubscribing the recorder, and emits
`reason: 'session_end'`. Previously the reset ran after subscriptions were torn down, so an
adaptation visible at teardown was never recorded as reverted.

### Correlation

Every adaptation type stamps two attributes on the element it adapted:

```
data-aui-active-adaptation="<type token>"      e.g. highlight, simplified, tooltip-expanded, assistance
data-aui-adaptation-episode="<episode id>"     e.g. ep_3
```

The adaptation token vocabulary is preserved from the pre-existing contract (`highlight`) rather than
renamed, because what was missing was the attribute's *presence* for three of four types, not its
spelling. `markAdaptation()` restores and removes both attributes on cleanup, so a reverted
adaptation cannot look active.

The episode id was also added to `InterventionCommand`, which is what lets the actuator stamp it at
all, and `beginEpisode()` now runs before the accepted record is written so one episode id spans the
whole lifecycle.

### Panel

The research panel renders an explicit `policyState` from a closed vocabulary —
`NO PREDICTION | FAST MATCH | SLOW GATE | BELOW THRESHOLD | POLICY ACCEPTED |
POLICY ACCEPTED (BASELINE — NOT APPLIED) | POLICY REJECTED | ACTUATED | EXPIRED | DISMISSED |
ACTUATION FAILED` — alongside the window id, prediction id, matched gate, mapping source, confidence,
policy reason, cooldown remaining, candidate persistence count, active episode id, adaptation TTL,
model version, execution provider, mining counters, eviction count and collection state.

Further fixes in the same area: `latestMacroSequence` is no longer clobbered; an inactivity window is
labelled as such, because `0.000` values are otherwise indistinguishable from an inactive window;
`featureLatencyMs` was renamed to `evaluationCycleLatencyMs` to match what it measures; the panel
gained a stable always-present toggle (the previous toggle existed only while collapsed) and is
reachable in a production build via `?auiDiagnostics=1` or `VITE_AUI_DIAGNOSTICS=1` (it was
previously excluded from production with no way in); and `startRuntimeDiagnostics` re-points at the
new runtime on a condition switch instead of retaining a handle to the terminated one.

### Consequences

- An intervention history recorded in a trace is no longer biased by an adaptation that stayed
  applied for the rest of the session.
- A verifier can prove that the adaptation in the record is the one visible, in both directions.
- The visual treatment of an adaptation is deliberately still minimal; only the *observability* was
  strengthened. The intervention taxonomy and the adaptation semantics are unchanged.
- `adaptation.defaultMechanism`, `policy.sustainedConfidenceDurationMs`,
  `policy.maxInterventionsPerTask` and `policy.conflictResolution` remain declared and unread. They
  are **not** wired by this decision, because each one is a research-methodology parameter rather
  than a correctness fix.

## 7. What is being deferred

> **Decision:** Wiring `policy.sustainedConfidenceDurationMs`, `policy.maxInterventionsPerTask` and `policy.conflictResolution`.
> **Deferred until:** A study design states a requirement for them.
> **Reason:** Each changes intervention rate or selection behaviour and therefore the experimental
> condition. Wiring them speculatively would add surface without a hypothesis.
> **Current workaround:** They remain declared and unread; `boot.ts` sets an explicit policy
> configuration for the deterministic arm.
> **Risk:** Low for the baseline/adaptive contrast; a researcher changing them would change nothing,
> which is why ADR-012's "wire or delete" rule still has an outstanding list.
> **Evidence required to revisit:** A study design that specifies sustained-confidence or per-task
> intervention caps.

> **Decision:** The final visual strength of an intervention.
> **Deferred until:** Supervisor feedback and a pilot discrimination check.
> **Reason:** Too subtle and the intervention cannot be evaluated; too strong and it becomes the
> experiment. That is a design question, not an observability one.
> **Current workaround:** A temporary outline plus a small "Adaptive assistance" indicator carrying
> the episode id, on top of the existing class-based treatment.
> **Risk:** Low — the DOM attribute makes the adaptation verifiable regardless of styling.
> **Evidence required to revisit:** A screenshot comparison and a participant-facing judgement.

## 8. Conditions that would force this decision to be revisited

- A pilot shows that an 8 000 ms adaptation is too brief or too persistent to be experienced.
- A verifier finds a visible adaptation with no matching applied record, or the reverse.
- A study requires session-persistent adaptations by design.
