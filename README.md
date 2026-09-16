# Edge-Native Adaptive UI: Framework

This repository contains the client-side execution framework for the Edge-Native Adaptive User Interface (AUI) system.

## 1. Purpose

The code in this repository builds a modular Capture-Transform-React pipeline. The pipeline operates entirely on the client side to provide adaptive user interface recommendations. It uses a dual-engine extraction model:
- **Fast Gate:** A WebAssembly module for exact sequence matches.
- **Slow Gate:** A Web Worker that runs a Gated Recurrent Unit (GRU) model.

## 2. References

For full details on the model training and the source datasets, read the referenced repositories:

- **Model Preparation Repository:** [taofeeqhamzat/edge-aui-model-preparation](https://github.com/taofeeqhamzat/edge-aui-model-preparation)
- **Dataset Repository:** [T40/edge-aui-framework-data](https://huggingface.co/datasets/T40/edge-aui-framework-data)

Please refer to the `AGENTS.md` file and `docs/` folder in this repository for deployment instructions and architectural guidelines.
