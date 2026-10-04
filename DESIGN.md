---
name: Edge-AUI Framework
description: Scientific testbed and analytics workbench for edge-native behavioural pattern extraction and adaptive UI recommendation
colors:
  bg-primary: "#0f1117"
  bg-surface: "#181b24"
  bg-elevated: "#222634"
  border: "#2d3345"
  border-active: "#4f5979"
  text-main: "#f0f2f8"
  text-muted: "#8e98b0"
  accent-cyan: "#00f0ff"
  accent-purple: "#9d4edd"
  accent-amber: "#ffb703"
  accent-emerald: "#10b981"
  accent-rose: "#f43f5e"
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
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-main}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.border-active}"
  card:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: Edge-AUI Framework

## 1. Overview

**Creative North Star: "The Instrument Bench"**

The Edge-AUI interface is an instrument-grade research testbed and analytics workbench engineered for rigorous edge-AI behavioral evaluation. It balances two parallel requirements: providing study participants with a realistic, distraction-free SERP-meets-SaaS analytics workspace (tasks T1–T3) where interaction dynamics mirror natural web usage, while offering researchers immediate, high-density visibility into edge model inference, dual-gate arbitration, and non-destructive interface adaptations.

The visual language rejects decorative consumer SaaS ornamentation in favor of crisp typography, disciplined monospace metrics, and restrained surface stepping. Color is treated as an active electrical signal rather than ambient decor—present only when communicating operational status, active trial conditions, or live intervention episodes.

**Key Characteristics:**
- **Zero-Friction Utility**: Intentionally unadorned surfaces that eliminate cognitive load and prevent participant hesitation artifacts.
- **Monochrome Chassis**: Deep slate/charcoal foundations (`#0f1117`, `#181b24`, `#222634`) structured by crisp 1px borders (`#2d3345`).
- **Semantic Signal Accents**: Cyan, Emerald, Amber, Rose, and Purple applied strictly as telemetry indicators and state badges.
- **Non-Destructive Invariance**: Visual adaptations occur without cumulative layout shifts or focus displacement.

## 2. Colors

An instrument-grade dark chassis with three stepped neutral elevations and calibrated high-contrast semantic signal colors.

### Primary
- **Signal Cyan** (`#00f0ff`): Primary active telemetry highlight, interactive exploration cues, and focus indication.
- **Verification Emerald** (`#10b981`): Healthy operational status, baseline condition badges, and successful trial completions.

### Secondary
- **Attention Amber** (`#ffb703`): Hesitation indicators, transient warnings, and TTL-bounded intervention notices.
- **Alert Rose** (`#f43f5e`): Task abandonment, engine fallback warnings, and critical diagnostic alerts.
- **Arbitration Purple** (`#9d4edd`): Fast/Slow gate arbitration state and model inference triggers.

### Neutral
- **Chassis Base** (`#0f1117`): Root application background; deepest black-slate foundation.
- **Surface Layer** (`#181b24`): Primary card, sidebar, and container background.
- **Elevated Workbench** (`#222634`): Interactive control panels, table header surfaces, and nested blocks.
- **Crisp Structural Stroke** (`#2d3345`): Default 1px dividing border across panels, cards, and table rows.
- **Active Structural Stroke** (`#4f5979`): Hovered or active control border.
- **Main Readout Ink** (`#f0f2f8`): Primary high-contrast typography and metric labels (contrast ratio ≥ 11:1).
- **Muted Readout Ink** (`#8e98b0`): Secondary labels, descriptive hints, and table column headers (contrast ratio ≥ 4.8:1).

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

The system is flat by design. Depth is conveyed strictly through surface tone stepping (`#0f1117` base → `#181b24` surface → `#222634` elevated) separated by crisp 1px strokes (`#2d3345`).

### Shadow Vocabulary
- **Zero Decorative Shadows**: Cards, tables, and buttons carry `box-shadow: none` at rest and on hover.
- **Overlay Border**: Floating panels (such as the AUI Debug Panel) rely on a solid 1px border (`#334155` / `#475569`) rather than diffuse shadows.

### Named Rules
**The Zero-Blur Shadow Rule.** No diffuse, fuzzy, or glowing drop shadows (`blur >= 4px`) are permitted. Depth and focus are established through tonal contrast, border strokes, and solid 2px outline rings.

## 5. Components

### Buttons
- **Shape:** Compact rectangular with subtle 4px radius (`border-radius: 4px`).
- **Primary / Action:** Background `#181b24`, border `1px solid #2d3345`, text `#f0f2f8`, padding `8px 14px`.
- **Hover / Focus:** Hover shifts background to `#4f5979` and border to `#00f0ff`. Focus-visible renders a crisp `2px solid #00f0ff` ring with 2px offset.
- **Active:** Transform `scale(0.98)` for immediate tactile response.

### Status Pills / Chips
- **Shape:** Rounded pill (`border-radius: 20px`), padding `4px 10px`, font size `11px`, monospace.
- **Variants:**
  - `Baseline`: Background `rgba(16, 185, 129, 0.15)`, text `#10b981`, border `1px solid #10b981`.
  - `Adaptive`: Background `rgba(0, 240, 255, 0.15)`, text `#00f0ff`, border `1px solid #00f0ff`.
  - `Warning / TTL`: Background `rgba(255, 183, 3, 0.15)`, text `#ffb703`, border `1px solid #ffb703`.

### Cards & Data Containers
- **Corner Style:** Restrained 8px–12px radius (`border-radius: 8px` for inner widgets, `12px` for major shell cards).
- **Background:** `var(--bg-surface)` (`#181b24`).
- **Border:** `1px solid var(--border)` (`#2d3345`).
- **Padding:** `16px` to `20px` internal padding.

### Data Tables & Results Grid
- **Header:** Background `#222634`, text `#8e98b0`, 11px uppercase monospace, border-bottom `1px solid #2d3345`.
- **Row:** Padding `10px 14px`, border-bottom `1px solid #2d3345`, hover state background `#222634`.
- **Adaptation Highlighting:** Interventions (e.g. `highlight_primary_action`) apply a high-contrast 1px border and subtle outline, never shifting row dimensions.

### Diagnostics & Floating Windows
- **Structure:** Solid `#0f172a` container, 1px `#334155` border, monospace typography, fixed positioning at `bottom: 16px, right: 16px`.

## 6. Do's and Don'ts

### Do:
- **Do** maintain strict WCAG 2.1 AA contrast (body text ≥ 4.5:1 against dark surfaces, headers and active pills ≥ 3:1).
- **Do** use `JetBrains Mono` for all numeric readouts, model latencies, session IDs, and status pills.
- **Do** ensure all AUI adaptations (`highlight_primary_action`, `simplify_options`, `expand_tooltip`) are non-destructive, reversible, and TTL-bounded without layout shift.
- **Do** respect `prefers-reduced-motion: reduce` by replacing all transitions with immediate state switches.
- **Do** use solid 1px borders (`#2d3345`) and surface stepping for visual hierarchy instead of drop shadows.

### Don't:
- **Don't** use decorative multi-color gradients, neon glow halos, or `background-clip: text`.
- **Don't** apply `border-radius: 32px+` on content cards or container panels.
- **Don't** use `border-left` or `border-right` stripes greater than 1px as accent decorations.
- **Don't** combine a 1px border with a soft wide drop shadow (≥ 16px blur) to create ghost cards.
- **Don't** use decorative glassmorphism (`backdrop-filter: blur(...)`) on data containers or tables.
- **Don't** describe system interventions as detecting frustration or cognitive affect; frame all predictions around observable interaction outcomes.
