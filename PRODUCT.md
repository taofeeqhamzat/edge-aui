# Product

## Register

product

## Users

Dual-audience operational context:
- **Study Participants**: Performing realistic web-based data search, filtering, and retrieval tasks (tasks T1, T2, T3) within a realistic SERP-meets-SaaS analytics environment. Context is task completion without cognitive clutter or artificial experimental artifacts.
- **Researchers & Evaluators**: Monitoring live trial progress, validating baseline vs. adaptive conditions, inspecting real-time behavioral telemetry, checking model/provider provenance, and exporting reproducible JSON experiment traces.

## Product Purpose

An edge-native, browser-only scientific testbed for research into lightweight AI-assisted behavioral pattern extraction and adaptive UI recommendations. It passively observes continuous micro-interaction streams, derives interaction outcomes without server egress, arbitrates between deterministic (Fast Gate WASM) and probabilistic (Slow Gate INT8 GRU) inference engines, and applies non-destructive, TTL-bounded UI interventions. Success means reliable, reproducible experimental runs, zero main-thread layout thrashing (60 FPS / <50ms TBT), and transparent real-time telemetry visibility.

## Brand Personality

- **Voice & Tone**: Utilitarian, rigorous, restrained, and scientifically precise.
- **Three-word Personality**: Minimalist, Focused, Instrument-grade.
- **Emotional Goals**: Quiet confidence, zero cognitive distraction, and absolute diagnostic clarity.

## Anti-references

- **Flashy Consumer SaaS Clichés**: Decorative linear/radial gradients, floating glassmorphism/backdrop-blur cards, cartoon doodles, marketing banners, and theatrical bouncy physics.
- **Over-rounded Codex Tropes**: 32px+ pill-shaped structural containers, soft 20px+ drop-shadows with 1px borders ("ghost cards"), and arbitrary decorative badges.
- **Cluttered BI Bloat**: Endless nested accordions, illegible dense micro-charts, noisy walls of knobs, and confusing multi-modal popups.
- **Amateur Lab Prototype**: Raw unstyled HTML, mismatched alignments, jerky layout shifts during adaptations, and harsh uncalibrated neon highlights.

## Design Principles

1. **Distraction-Free Realism**: The testbed environment (SERP & analytics table) must feel authentic, boring, and clean so participant motor control and micro-interaction dynamics reflect genuine web behavior rather than confusion from experimental apparatus.
2. **Telemetry & State Observability**: Instrument all critical states (session, condition, intervention episode, gate arbitration, egress gate) with high diagnostic clarity, keeping experimental controls accessible to researchers without cluttering the primary task canvas.
3. **Non-Destructive Reversibility**: Adaptations (`highlight_primary_action`, `simplify_options`, `expand_tooltip`, `offer_assistance`) must never cause layout shift, hijack or displace focus, or distort the accessibility tree. Every intervention must be strictly TTL-bounded and cleanly reversible.
4. **Instrument-Grade Restraint**: Ground the UI in a crisp, monochrome-dominant surface where color is reserved strictly for semantic state: active condition indicator, live intervention feedback, and metric status.

## Accessibility & Inclusion

- **WCAG 2.1 AA Compliance**: Strict body text contrast ≥4.5:1 against surfaces; large headers and active UI controls ≥3:1.
- **Predictable Keyboard Navigation**: Full keyboard tab order and visible, high-contrast focus rings throughout the table, filter drawer, trial controls, and diagnostics.
- **Adaptive DOM Invariance**: Dynamic adaptations must announce state changes to assistive technologies via appropriate ARIA roles/live-regions and preserve focus states seamlessly.
- **Motion Restraint**: Full adherence to `prefers-reduced-motion: reduce`, replacing all transitions and micro-interactions with immediate or simple opacity state changes.
