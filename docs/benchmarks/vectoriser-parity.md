# Vectoriser Parity Report: TypeScript ↔ Rust/WASM

**Task:** 2.2 — Vectoriser Parity Suite (TypeScript ↔ Rust/WASM)  
**Date:** 2026-09-25  
**Tolerance:** \(\le 10^{-4}\) absolute floating-point difference across all 18 MicroTensor dimensions  
**Module Tested:** `wasm-vectorizer/pkg/wasm_vectorizer_bg.wasm` (\(91\,937\text{ B}\)) vs `src/microtensor/features.ts`

---

## 1. Summary of Parity Verification

| Property | Cases Tested | Max Observed Delta | Status |
|---|---|---|---|
| **Numerical Parity** | 5 canonical synthetic scenarios (`stationary_pointer`, `accelerated_movement_turns`, `hover_dwell`, `viewport_scroll`, `masked_modalities_pointer_only`) | \(0.000000\) | **Verified (\(\le 10^{-4}\))** |
| **Boundary Behaviour** | Extreme velocities, out-of-bounds coords (\(x=10, y=10\)), sub-ms timestamps (\(\Delta t = 0.2\text{ ms} \to 1.0\text{ ms}\)) | \(0.000000\) | **Verified (\(\le 10^{-4}\))** |
| **Modality Masks** | All \(2^3 = 8\) capability permutations of `pointer`, `dom`, `scroll` | \(0.000000\) | **Verified (exact match)** |
| **Missing Capabilities** | Active pointer events under masked DOM/scroll sensors | \(0.000000\) | **Verified (exact match)** |
| **Inactivity** | Zero-event window (\(N=0\)) with active sensors | \(0.000000\) | **Verified (exact match)** |
| **Geometry Scaling** | Varied viewports: \(1366\times 768\), \(1920\times 1080\), \(2560\times 1440\), \(3840\times 2160\) | \(0.000000\) | **Verified (\(\le 10^{-4}\))** |
| **Ordering** | Multi-step directional trajectories | \(0.000000\) | **Verified (\(\le 10^{-4}\))** |
| **Malformed Input** | Non-positive viewport (\(\le 0\)), non-positive document (\(\le 0\)) | Typed error thrown | **Verified (behavioural parity)** |

---

## 2. Key Finding: Geometry Ingestion Boundary

During parity testing, an essential architectural nuance was identified and verified:
- In environments where an explicit viewport geometry is not passed in the options object:
  - TypeScript's `getViewportDimensions()` queries `window.innerWidth` (which defaults to \(1024\times 768\) in synthetic jsdom test environments, and to \(1920\times 1080\) in non-DOM/worker environments).
  - Rust/WASM operates without dependency on global browser DOM objects (by design, per ADR-002 and ADR-003 for worker execution) and defaults to canonical reference viewport \(1920\times 1080\).
- **Resolution:** When comparing or executing, identical viewport/document geometry must be passed or canonical events with recorded geometry must be consumed (fulfilling ADR-004 and Schema v1.1.0 geometry encapsulation). When both consume identical geometry, numerical parity holds with zero divergence.

---

## 3. Discrepancies and Mismatches

- **Numerical mismatches exceeding \(10^{-4}\):** `None`. All features matched within \(10^{-6}\).
- **Schema divergence:** `None`. Both paths produce an identical 18-element vector where dimensions 0–8 are normalized features bounded in \([0, 1]\) and dimensions 9–17 are binary modality capability flags in \(\{0.0, 1.0\}\).
- **Error handling divergence:** `None`. Both implementations validate inputs and throw typed errors on non-positive viewport/document geometries.
