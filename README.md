# Edge-AUI Target Testbed

A browser-only research testbed for **behavioural pattern extraction and adaptive UI
recommendation on the web**. It is the target environment for the
[`edge-aui-model-preparation`](https://github.com/taofeeqhamzat/edge-aui-model-preparation)
pipeline: it passively observes interaction, reduces it to an 18-dimensional MicroTensor
stream, matches macro-interaction sequences deterministically and probabilistically, and
applies non-destructive interface adaptations — recording everything needed to replay and
evaluate the result offline.

Nothing leaves the browser. There is no server, no telemetry egress, and no local storage.

## What runs

```
DOM events → TelemetryObserver → BehaviourEvent
                                    ├─ RollingWindowBuffer → 18-D MicroTensor (500/250 ms)
                                    ├─ OutcomeDeriver      → OutcomeEvent (lookahead [500,1500] ms)
                                    └─ MacroInteractionStream → symbol sequence
                                                                   │
                         worker: SequenceBuilder (T=8) ────────────┤
                                 │                                 │
                                 ▼                                 │
                      AdaptiveInferenceEngine                      │
                        ├── Fast Gate  (PrefixSpan over symbols, WASM)
                        └── Slow Gate  (INT8 GRU, ONNX Runtime Web, WebGPU)
                                 │
                                 ▼
                      InterventionPolicy → UIActuator → DOM (reversible)
                                 │
                                 ▼
                        ExperimentRecorder → local JSON trace
```

Two experimental conditions are supported. In `baseline` the pipeline still observes,
windows, mines, derives outcomes and records predictions, but never mutates the DOM — so the
two conditions can be compared like for like.

Full details, including the windowing contract, feature table, macro vocabulary, gate
semantics, and every schema, are in [`docs/architecture.md`](docs/architecture.md).

## Requirements

- Node.js 18+ and npm
- `wasm-pack` and a Rust toolchain, only for `npm run build:wasm`
- An ONNX Runtime Web-compatible browser for the Slow Gate (WebGPU preferred, WASM fallback)

## Getting started

```bash
npm install
npm run dev            # http://localhost:5173
```

The application renders a small analytics dashboard. Use the **Experimental Trial** controls
on the Analytics view to start task T1/T2/T3 and to switch between the `baseline` and
`adaptive` conditions. The **AUI Debug** panel shows live session, gate and latency state and
exports the experiment trace as JSON. In development, `window.__EDGE_AUI__` exposes the same
state programmatically.

### Model artifact

The Slow Gate graph is committed at `public/models/model_int8.onnx` so the testbed runs and
the ONNX contract test passes without a model-preparation checkout. `*.onnx` is otherwise
gitignored because model files are build outputs; `public/models/` is an explicit exception.

To regenerate it from a trained checkpoint:

```bash
# in the model-preparation checkout
.venv/bin/python -c "from src.export import export_and_quantize; export_and_quantize()"
cp models/model.onnx models/model_int8.onnx /path/to/edge-aui-framework/public/models/
```

If the artifact is missing, the runtime falls back to a deterministic Slow Gate and reports
the downgrade in the console and in `workerStatus` — it does not silently pretend a model is
running.

## Testing and verification

```bash
npm run typecheck          # tsc --noEmit
npm test                   # vitest run
npm run parity:check       # fail if the MicroTensor fixture diverges from the Python reference
npm run benchmark:runtime  # FPS, heap and inference latency, measured in a real browser
```

`npm test` runs `sync-config` first, which regenerates `src/config/pipelineConfig.json` from
`model-preparation/src/config.yaml`. The Python configuration is the single source of truth
for windowing, feature order, scale constants and the outcome taxonomy.

## Related repositories

- **Model preparation:** [taofeeqhamzat/edge-aui-model-preparation](https://github.com/taofeeqhamzat/edge-aui-model-preparation)
- **Datasets:** [T40/edge-aui-framework-data](https://huggingface.co/datasets/T40/edge-aui-framework-data)

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Implemented architecture, contracts and schemas |
| [`docs/assessments/target-testbed-quality-assessment.md`](docs/assessments/target-testbed-quality-assessment.md) | The audit that produced this design |
| [`docs/assessments/target-testbed-implementation-record.md`](docs/assessments/target-testbed-implementation-record.md) | What was implemented, measured, and still open |
| [`docs/testbed/prd.md`](docs/testbed/prd.md) | Product requirements for the target UI |
| [`AGENTS.md`](AGENTS.md) | Architectural constraints and engineering guidance |

`docs/plan/` is gitignored and kept as a local working document rather than part of the
repository record.
