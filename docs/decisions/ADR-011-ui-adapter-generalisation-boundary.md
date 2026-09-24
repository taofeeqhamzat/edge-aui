# ADR-011: UI Adapter / Generalisation Boundary

- **Status:** Proposed — decision required
- **Date:** 2026-09-24
- **Related:** ADR-003, ADR-004, ADR-009, ADR-012

## 1. Context

The target testbed currently sits *inside* the framework repository: `src/testbed/` holds the
task model, the components, and the mock data, and `src/runtime/adaptiveRuntime.ts` composes the
pipeline against it. Telemetry observation is DOM-driven through `data-aui-*` attributes
(`src/telemetry/observer.ts`).

Phase C of the brief requires the pipeline to be shareable with or deployable to a *different*
target UI without that UI understanding the internal model-preparation pipeline. Phase H asks
for a stable integration boundary and explicitly says the exact package structure is negotiable
and components should not be published prematurely.

## 2. Problem

Where exactly is the seam between "application integration" and "internal telemetry/model
pipeline"? The brief lists what the target UI must supply: component identifiers, task
identifiers, UI context, semantic interaction metadata, session/experiment identifiers and
lifecycle hooks. It does not say what the *shape* of that supply is, and the current
implementation has no adapter object at all — the runtime reaches directly into concrete
modules.

Without a named seam, "a second UI requires configuration/adaptation, not a rewrite" is
unfalsifiable.

## 3. Options considered

| Option | Description | Cost to a second UI |
| --- | --- | --- |
| **A. Configuration only** | A config object describing selectors and task definitions. | Low, but cannot express app-specific context or lifecycle. |
| **B. Adapter interface (ports)** | The UI implements a small interface; the core depends only on that interface. | One adapter module. |
| **C. Full package split now** | Split into `@edge-aui/*` packages with published versions. | Highest; brief warns against premature packaging. |
| **D. Current coupling** | The second UI copies and edits the framework. | A fork. |

## 4. Evidence available

**Verified**

- The `data-aui-*` annotation contract exists and is tested
  (`tests/semantic_dom_annotations.test.tsx`).
- `getActiveUIContext` exists and is tested (`tests/active_ui_context.test.tsx`).
- Core telemetry, windowing, macro, gate, policy, actuator and trace modules are already
  separated by directory with their own barrel exports.

**Not measured / not established**

- No second UI has ever been adapted. `NOT MEASURED` — and by construction, unmeasurable until
  one is attempted.
- The number of files a new UI would need to touch has never been counted.
- `src/testbed/mock-data/tableData.ts` uses `Math.random()` at module load, which would need to
  be adapted rather than configured.

## 5. Decision required

The shape of the integration contract (config-only versus adapter interface), and whether any
package split happens in this plan.

## 6. Recommended option

**Option B — a named adapter interface — with no package split (i.e. not Option C).**

Define a small `UiAdapter` / integration contract that supplies exactly what the brief lists, and
refactor the runtime so the core depends on the adapter rather than on `src/testbed/*`
concretely. Then prove it by making the existing testbed be *the first implementation* of that
adapter.

This is testable in a way "configuration only" is not: a second, deliberately different adapter
can be written in tests to assert the core does not reach past the seam. Do not publish packages
for naming purposes (brief §15).

## 7. Consequences

- The current testbed's modules become an adapter implementation, so a small amount of code moves
  without behaviour change.
- Every future core change must ask "does this leak an application assumption?" — the adapter
  becomes the review boundary.
- The `data-aui-*` attribute contract is retained as the *default* DOM adapter implementation,
  not as the only possible one.

## 8. What is being deferred

> **Decision:** The `@edge-aui/*` package split and publication.
> **Deferred until:** A second real UI has been adapted against the adapter interface.
> **Reason:** Brief §15 — do not package prematurely; the boundary is negotiable until a second
> consumer validates it.
> **Current workaround:** Single repository, directory-level module boundaries and barrel exports.
> **Risk:** Low — premature packaging would be the larger risk.
> **Evidence required to revisit:** The file-level diff required to adapt a second UI.

## 9. Conditions that would force this decision to be revisited

- A second UI is adapted and reveals the adapter interface is insufficient.
- The deliverable must be handed to another project as an installable dependency.
- The adapter interface grows large enough that it is effectively a framework anyway.
