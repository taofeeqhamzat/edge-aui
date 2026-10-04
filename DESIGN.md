---
name: Edge-AUI Framework
description: Scientific testbed and analytics workbench for edge-native behavioural pattern extraction and adaptive UI recommendation
colors:
  bg-primary: "#f8f9fa"
  bg-surface: "#ffffff"
  bg-elevated: "#f1f5f9"
  border: "#cbd5e1"
  border-active: "#0284c7"
  text-main: "#0f172a"
  text-muted: "#475569"
  accent-cyan: "#0284c7"
  accent-purple: "#7c3aed"
  accent-amber: "#d97706"
  accent-emerald: "#059669"
  accent-rose: "#dc2626"
typography:
  display:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  none: "0px"
  sm: "0px"
  md: "0px"
  lg: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-main}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.bg-elevated}"
  card:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.none}"
    padding: "20px"
---

# Design System: Edge-AUI Framework

## 1. Overview

**Creative North Star: "The Instrument Bench" (Persistent Light Theme)**

The Edge-AUI interface is an instrument-grade research testbed and analytics workbench engineered for rigorous edge-AI behavioral evaluation. It is rendered in a persistent, high-contrast light theme built upon an architectural blueprint foundation: pure, unrounded 0px corners, sharp 1px structural borders, and calibrated dark typography on pristine white and light-slate surfaces.

The visual system rejects consumer decoration, rounded pill cards, and warm-cream tropes in favor of strict technical precision. It serves two parallel audiences: study participants executing authentic SERP-meets-SaaS data workflows (tasks T1–T3) without distraction, and researchers monitoring real-time edge model latency, gate arbitration, and non-destructive interface adaptations.

**Key Characteristics:**
- **Zero Border Radius**: Pure square corners (`border-radius: 0`) across all elements, communicating architectural rigor and data-sheet utility.
- **Pristine Light Chassis**: Crisp off-white base (`#f8f9fa`) with pure white surfaces (`#ffffff`) and stepped elevation (`#f1f5f9`).
- **High-Contrast Typography**: Deep slate-900 black ink (`#0f172a`, contrast > 15:1) paired with slate-600 metadata ink (`#475569`, contrast > 5.4:1).
- **Calibrated Semantic Signals**: Technical cyan (`#0284c7`), emerald (`#059669`), amber (`#d97706`), rose (`#dc2626`), and purple (`#7c3aed`) tuned for full WCAG AA contrast against white surfaces.

## 2. Colors

An instrument-grade persistent light theme with stepped neutral elevations and high-contrast semantic signal colors.

### Primary
- **Signal Cyan** (`#0284c7`): Primary active telemetry highlight, interactive exploration cues, and focus indication.
- **Verification Emerald** (`#059669`): Healthy operational status, baseline condition badges, and successful trial completions.

### Secondary
- **Attention Amber** (`#d97706`): Hesitation indicators, transient warnings, and TTL-bounded intervention notices.
- **Alert Rose** (`#dc2626`): Task abandonment, engine fallback warnings, and critical diagnostic alerts.
- **Arbitration Purple** (`#7c3aed`): Fast/Slow gate arbitration state and model inference triggers.

### Neutral
- **Chassis Base** (`#f8f9fa`): Root application background; pristine light-slate technical foundation.
- **Surface Layer** (`#ffffff`): Primary card, sidebar, and container background.
- **Elevated Workbench** (`#f1f5f9`): Interactive control panels, table header surfaces, and nested blocks.
- **Crisp Structural Stroke** (`#cbd5e1`): Default 1px dividing border across panels, cards, and table rows.
- **Active Structural Stroke** (`#0284c7`): Hovered or active control border.
- **Main Readout Ink** (`#0f172a`): Primary high-contrast typography and metric labels (contrast ratio ≥ 15:1).
- **Muted Readout Ink** (`#475569`): Secondary labels, descriptive hints, and table column headers (contrast ratio ≥ 5.4:1).

### Named Rules
**The Semantic Signal Rule.** Accent colors are reserved strictly for operational status, experimental condition indicators, and live intervention episodes. Never use accent colors as decorative full-bleed backgrounds, gradients, or ambient glow washes.

## 3. Typography

**Display / Body Font:** `Inter`, system-ui, -apple-system, sans-serif
**Label / Mono Font:** `JetBrains Mono`, ui-monospace, SFMono-Regular, monospace

**Character:** Technical, neutral, and highly legible across dense data grids and live telemetry feeds. Numbers and status metrics always render in monospace to preserve tabular alignment and rhythm.

### Hierarchy
- **Display** (Bold 700, `24px`, line-height `1.2`, letter-spacing `-0.02em`): Page titles and primary screen views.
- **Headline** (Bold 700, `20px`, line-height `1.3`, letter-spacing `-0.01em`): Section headings and card headers.
- **Title** (Semi-bold 600, `15px`, line-height `1.4`, letter-spacing `normal`): Component group titles and modal headers.
- **Body** (Regular 400, `13px`, line-height `1.5`, letter-spacing `normal`): Data table cells, descriptive paragraphs, and filter options (line length max 75ch).
- **Label / Metric** (Medium 500, `11px`, line-height `1.4`, letter-spacing `0.05em`, uppercase where appropriate): Telemetry counters, timestamps, status pills, and column keys.

### Named Rules
**The Telemetry Precision Rule.** Every quantitative value, inference latency readout, session token, and status code must render in monospace (`--font-mono`) to guarantee tabular spacing and zero jitter during live updates.

## 4. Elevation

The system is strictly flat and architectural. Depth is conveyed purely through surface tone stepping (`#f8f9fa` base → `#ffffff` surface → `#f1f5f9` elevated) separated by crisp 1px strokes (`#cbd5e1`).

### Shadow Vocabulary
- **Zero Decorative Shadows**: Cards, tables, inputs, and buttons carry `box-shadow: none` at rest and on hover.
- **Floating Overlays**: Diagnostic panels and floating assistance banners rely on solid 1px borders (`#94a3b8` / `#cbd5e1`) and restrained technical drop-shadows (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1)`).

### Named Rules
**The Zero-Radius Blueprint Rule.** All border radii are strictly 0px (`border-radius: 0`). Sharp rectangular corners communicate architectural precision, eliminate visual softness, and maximize usable data space.

## 5. Components

### Buttons
- **Shape:** Pure rectangular with zero radius (`border-radius: 0`).
- **Primary / Action:** Background `#ffffff`, border `1px solid #cbd5e1`, text `#0f172a`, padding `8px 14px`.
- **Hover / Focus:** Hover shifts background to `#f1f5f9` and border to `#0284c7`. Focus-visible renders a crisp `2px solid #0284c7` outline with 1px offset.
- **Active:** Transform `scale(0.98)` for immediate tactile response.

### Status Badges
- **Shape:** Crisp rectangular badge (`border-radius: 0`), padding `2px 8px`, font size `11px`, monospace.
- **Variants:**
  - `Completed`: Background `#ecfdf5`, text `#047857`, border `1px solid #a7f3d0`.
  - `Pending`: Background `#fffbeb`, text `#b45309`, border `1px solid #fde68a`.
  - `Failed`: Background `#fef2f2`, text `#b91c1c`, border `1px solid #fecaca`.
  - `Adaptive`: Background `#f0f9ff`, text `#0284c7`, border `1px solid #0284c7`.

### Cards & Data Containers
- **Corner Style:** Strict square corners (`border-radius: 0`).
- **Background:** `var(--bg-surface)` (`#ffffff`).
- **Border:** `1px solid var(--border)` (`#cbd5e1`).
- **Padding:** `14px` to `18px` internal padding.

### Data Tables & Results Grid
- **Header:** Background `#f1f5f9`, text `#475569`, 11px uppercase monospace, border-bottom `1px solid #cbd5e1`, `border-radius: 0`.
- **Row:** Padding `9px 14px`, border-bottom `1px solid #cbd5e1`, hover state background `#f8fafc`.
- **Layout:** `table-layout: fixed` with explicit proportional column widths to guarantee zero horizontal shift during filtering.

### Diagnostics & Floating Windows
- **Structure:** Solid `#ffffff` container, 1px `#94a3b8` border, monospace typography, fixed positioning at `bottom: 16px, right: 16px`, `border-radius: 0`.

## 6. Do's and Don'ts

### Do:
- **Do** maintain strictly zero border radius (`border-radius: 0`) across all elements and components.
- **Do** ensure high-contrast light theme readability (body text ≥ 4.5:1 against light surfaces, headers ≥ 3:1).
- **Do** use `JetBrains Mono` for all numeric readouts, model latencies, session IDs, and status badges.
- **Do** ensure all AUI adaptations (`highlight_primary_action`, `simplify_options`, `expand_tooltip`) are non-destructive, reversible, and TTL-bounded without layout shift.
- **Do** respect `prefers-reduced-motion: reduce` by replacing all transitions with immediate state switches.
- **Do** use solid 1px borders (`#cbd5e1`) and surface stepping for visual hierarchy instead of drop shadows.

### Don't:
- **Don't** add rounded corners (`border-radius > 0`) anywhere in the layout.
- **Don't** use cream, beige, or parchment tones for body backgrounds (`--bg-primary` is crisp `#f8f9fa`).
- **Don't** use low-contrast light grays for text; body ink must hit ≥ 4.5:1.
- **Don't** use decorative multi-color gradients, neon glow halos, or `background-clip: text`.
- **Don't** use decorative glassmorphism (`backdrop-filter: blur(...)`) on data containers or tables.
- **Don't** describe system interventions as detecting frustration or cognitive affect; frame all predictions around observable interaction outcomes.
