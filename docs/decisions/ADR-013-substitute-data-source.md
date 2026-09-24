# ADR-013: Substitute Data Source for the First Intervention-Head Experiment

- **Status:** Accepted for the first experiment only — with a hard provenance boundary
- **Date:** 2026-09-24
- **Related:** ADR-010, ADR-014

## 1. Context

Brief §9 permits an existing data source to stand in for participant data for the first
model-preparation experiment, subject to explicit identification, versioning, documentation,
transformation through the same preparation interface, clear distinction from real participant
data, and a prohibition on presenting unsuitable assumptions as participant evidence.

The purpose of the first run is to validate:

```text
dataset → preparation → training → export → runtime integration
```

not to make claims about human participants.

## 2. Problem

Which substitute source, and what exactly does an experiment on it entitle the project to claim?

The tempting choice is `AdSERP` (already wired as the MVP foundation source in
`model-preparation/src/config.yaml`, `mode: minimal`). But `AdSERP` has **no intervention labels
and no `UIContext`** — the very two things `TargetInterventionHead` consumes. Using it as the
primary source would require synthesising both, so its apparent realism would not transfer to the
target contract.

## 3. Options considered

| Option | Description | Proves the vertical slice? | Has intervention targets? |
| --- | --- | --- | --- |
| **A. Scripted testbed traces, both conditions** | Record the real testbed via the real exporter; derive labels with a documented scripted policy. | **Yes — end to end** | Yes, scripted |
| **B. AdSERP primary + testbed parity slice** | Richer real motor telemetry; labels still synthesised. | Partially | No |
| **C. Synthetic generator only** | Fully deterministic, no recorded traces. | No — bypasses the real export interface | Synthetic |
| **D. Wait for participants** | None. | N/A | Real, eventually |

## 4. Evidence available

**Verified**

- The testbed export path works; `docs/experiments/` holds real exported traces.
- The condition switch (`baseline` / `adaptive`) is implemented and tested.
- Trace schema `1.1.0` carries correlation identifiers.
- The intervention taxonomy is fixed at five classes, matching `TargetInterventionHead`'s
  `num_classes: 5`.

**Known and decisive**

- A previous audit recorded the slow-gated path never producing a live intervention because the
  untrained head's confidence sat below threshold. A **labelled** target-domain dataset is the
  missing ingredient — which is exactly what Option A produces.
- Scripted-trace volume will be small. Class balance and label quality will be poor.

## 5. Decision required

The substitute source, and the precise claim boundary the project accepts when reporting results
from it.

## 6. Recommended option

**Option A — scripted testbed traces from both conditions, transformed through the real
preparation interface, with a documented scripted intervention-target label.**

Rationale: it is the only option that exercises every arrow in the §22 definition of done,
including `trace → dataset` and `dataset → model → runtime`, in the same event vocabulary and the
same `18`-D tensor contract the runtime uses. It also produces the labelled target-domain data
whose absence blocks the slow-gated path.

**The label is scripted, not observed.** The deterministic `outcome → intervention` mapping is
used to assign the target class. This is stated as a *scripted policy label* everywhere
downstream.

**Mandatory claim boundary.** Results from this dataset may be reported as:

- "the dataset → preparation → training → export → runtime path executes end to end";
- "the learned head loads in the browser and produces logits of the expected shape";
- engineering and pipeline findings.

Results from this dataset may **not** be reported as:

- evidence about human participants;
- evidence about usability, task performance, or intervention benefit;
- evidence that learned intervention prediction outperforms the deterministic policy — a model
  trained on labels produced by that policy is being compared against its own teacher. This is
  the specific trap this ADR exists to prevent.

## 7. Consequences

- The dataset manifest must carry a `data_source: scripted_testbed` field and a provenance record
  naming the sessions, condition and label policy version (plan 1 task 16.2).
- Every experiment report must restate the claim boundary. `AdSERP` remains the foundation
  training source and is unaffected.
- The intended replacement path must be preserved: the ingestion layer reads a canonical dataset
  interface, so swapping in real participant traces later requires no downstream redesign
  (brief §9, closing requirement).

## 8. What is being deferred

> **Decision:** Collecting real participant telemetry for target-domain fine-tuning.
> **Deferred until:** A participant study is scheduled and ethics approval exists.
> **Reason:** Not required for the immediate milestone, and brief §9 explicitly permits
> substitution.
> **Current workaround:** Scripted testbed traces.
> **Risk:** The learned head will not generalise to real interaction. This is expected and stated.
> **Evidence required to revisit:** A scheduled study.

> **Decision:** Establishing construct validity of the scripted label policy.
> **Deferred until:** Real participant traces exist to compare against.
> **Reason:** A scripted policy cannot be validated against itself.

## 9. Conditions that would force this decision to be revisited

- The scripted dataset is too small or too imbalanced for any training signal to appear.
- A real labelled source becomes available.
- Someone reports a result from this dataset as participant evidence — the boundary has failed and
  must be restated more forcefully.
