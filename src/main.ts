/**
 * Edge-AUI Framework - Phase 1 Test Harness
 * Demonstrates real-time 500ms sliding window buffering, WASM vectorization, and ONNX Web Worker inference.
 */

import './style.css';
import { EdgeAUIFramework } from './core/pipeline.js';
import type { CognitiveState, InteractionPacket, UIRecommendation } from './types/telemetry.js';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header class="header-card">
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div class="brand-info">
        <h1>Edge-AUI Framework</h1>
        <p>Phase 1: Deterministic Gate (WASM) & Probabilistic Gate (Web Worker)</p>
      </div>
    </div>
    <div class="status-pills">
      <div class="status-pill" id="pill-pipeline">
        <span class="pill-dot dot-green"></span> Pipeline: Active (500ms Window)
      </div>
      <div class="status-pill" id="pill-wasm">
        <span class="pill-dot dot-cyan"></span> Fast Brain: Rust WASM (PrefixSpan)
      </div>
      <div class="status-pill" id="pill-onnx">
        <span class="pill-dot dot-purple"></span> Slow Brain: WebGPU / WASM
      </div>
    </div>
  </header>

  <div class="dashboard-grid">
    <!-- Left Column: Interactive Sandbox -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Interactive Interaction Sandbox</span>
        <span style="font-size: 12px; color: var(--text-muted);">60 FPS Passive Tracking</span>
      </div>

      <div class="sandbox-area">
        <div class="sandbox-instructions">
          Move your cursor around, hover over trackable components, or click options to observe real-time kinematics extraction.
        </div>

        <!-- Confusing Choice (Simulates Hesitation) -->
        <div class="interactive-box hesitation-zone" data-trackable="hesitation_challenge_box">
          <strong>⚡ Hesitation Challenge Box (Hover & Meander Cursor)</strong>
          <p style="font-size: 12px; color: var(--text-muted);">
            Hover here while shifting directions rapidly (&gt;45° angle) to trigger angular hesitation & entropy.
          </p>
          <div class="btn-group">
            <button class="track-btn" data-trackable="option_alpha">Option Alpha</button>
            <button class="track-btn" data-trackable="option_beta">Option Beta</button>
            <button class="track-btn" data-trackable="option_gamma">Option Gamma</button>
          </div>
        </div>

        <!-- Rapid Action Target (Simulates Frustration) -->
        <div class="interactive-box" data-trackable="rapid_action_container">
          <strong>🎯 Rapid Action Target (Rage Click Area)</strong>
          <p style="font-size: 12px; color: var(--text-muted);">
            Click rapidly with high cursor velocity to trigger frustration heuristics.
          </p>
          <div class="btn-group">
            <button class="track-btn" id="btn-counter" data-trackable="action_counter_btn">
              Clicked 0 times
            </button>
            <button class="track-btn" data-trackable="action_refresh_btn">
              Refresh State
            </button>
          </div>
        </div>

        <!-- Content Exploration (Simulates Exploring / Dwell) -->
        <div class="interactive-box" data-trackable="detailed_product_card">
          <strong>📦 Deep Exploration Product Card</strong>
          <p style="font-size: 12px; color: var(--text-muted);">
            Rest and dwell over this element to accumulate attention and dwell time metrics.
          </p>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.6;">
            Latency constraint: &lt;50ms TBT • Storage payload: &lt;500KB • Memory footprint: &lt;20MB.
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Live Telemetry & Inference Feed -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Live Kinematic MicroTensor (WASM)</span>
        <span id="window-counter" style="font-size: 12px; font-family: var(--font-mono); color: var(--accent-cyan);">Window: #0</span>
      </div>

      <!-- Telemetry Tiles -->
      <div class="telemetry-grid">
        <div class="metric-tile">
          <span class="metric-label">Mean Velocity</span>
          <span class="metric-value" id="val-mean-vel">0.00</span>
          <span class="metric-sub">px / ms</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">Max Velocity</span>
          <span class="metric-value" id="val-max-vel">0.00</span>
          <span class="metric-sub">px / ms</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">Hesitation Count</span>
          <span class="metric-value" id="val-hesitation">0</span>
          <span class="metric-sub">&gt; 45° shifts</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">Trajectory Entropy</span>
          <span class="metric-value" id="val-entropy">0.00</span>
          <span class="metric-sub">Shannon [0, 1]</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">Dwell Time</span>
          <span class="metric-value" id="val-dwell">0</span>
          <span class="metric-sub">ms on components</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">Scroll Depth</span>
          <span class="metric-value" id="val-scroll">0%</span>
          <span class="metric-sub">viewport %</span>
        </div>
      </div>

      <!-- Cognitive State Hero -->
      <div class="cognitive-card">
        <div class="cognitive-hero">
          <div>
            <span class="metric-label">Inferred Cognitive State (Slow Brain)</span>
            <div id="state-badge-container" style="margin-top: 6px;">
              <div class="state-badge badge-Focused" id="state-badge">
                <span id="state-icon">🎯</span>
                <span id="state-label">Focused</span>
              </div>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="metric-label">Inference Latency</span>
            <div id="val-latency" style="font-size: 18px; font-family: var(--font-mono); font-weight: 700; color: var(--accent-emerald);">
              0.4 ms
            </div>
            <span id="val-provider" style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">
              Provider: webgpu
            </span>
          </div>
        </div>

        <!-- Probabilities Distribution -->
        <div class="prob-bars">
          <div class="prob-row">
            <span class="prob-label">Focused:</span>
            <div class="prob-track"><div class="prob-fill" id="prob-fill-Focused" style="width: 50%;"></div></div>
            <span class="prob-val" id="prob-val-Focused">0.50</span>
          </div>
          <div class="prob-row">
            <span class="prob-label">Hesitation:</span>
            <div class="prob-track"><div class="prob-fill" id="prob-fill-Hesitation" style="width: 10%; background: var(--accent-amber);"></div></div>
            <span class="prob-val" id="prob-val-Hesitation">0.10</span>
          </div>
          <div class="prob-row">
            <span class="prob-label">Exploring:</span>
            <div class="prob-track"><div class="prob-fill" id="prob-fill-Exploring" style="width: 20%;"></div></div>
            <span class="prob-val" id="prob-val-Exploring">0.20</span>
          </div>
          <div class="prob-row">
            <span class="prob-label">Frustrated:</span>
            <div class="prob-track"><div class="prob-fill" id="prob-fill-Frustrated" style="width: 5%; background: var(--accent-rose);"></div></div>
            <span class="prob-val" id="prob-val-Frustrated">0.05</span>
          </div>
          <div class="prob-row">
            <span class="prob-label">Idle:</span>
            <div class="prob-track"><div class="prob-fill" id="prob-fill-Idle" style="width: 15%; background: var(--text-muted);"></div></div>
            <span class="prob-val" id="prob-val-Idle">0.15</span>
          </div>
        </div>
      </div>

      <!-- Adaptive Recommendations Feed -->
      <div>
        <span class="metric-label">Adaptive UI Actuation Feed</span>
        <div class="rec-feed" id="rec-feed" style="margin-top: 8px;">
          <div class="rec-item">
            <div class="rec-header">
              <span>Framework Initialized</span>
              <span>Just now</span>
            </div>
            <div class="rec-reason">Awaiting interaction triggers to generate UI recommendations.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

// Initialize Framework Orchestrator
const framework = new EdgeAUIFramework({
  bufferWindowMs: 500,
  trackableSelector: '[data-trackable]',
  hesitationConfidenceThreshold: 0.35
});

let windowIndex = 0;
let clickCounter = 0;

// Interactive Counter Button
const counterBtn = document.getElementById('btn-counter');
if (counterBtn) {
  counterBtn.addEventListener('click', () => {
    clickCounter++;
    counterBtn.textContent = `Clicked ${clickCounter} times`;
  });
}

// DOM Element References
const elWindowCounter = document.getElementById('window-counter')!;
const elMeanVel = document.getElementById('val-mean-vel')!;
const elMaxVel = document.getElementById('val-max-vel')!;
const elHesitation = document.getElementById('val-hesitation')!;
const elEntropy = document.getElementById('val-entropy')!;
const elDwell = document.getElementById('val-dwell')!;
const elScroll = document.getElementById('val-scroll')!;

const elStateBadge = document.getElementById('state-badge')!;
const elStateIcon = document.getElementById('state-icon')!;
const elStateLabel = document.getElementById('state-label')!;
const elLatency = document.getElementById('val-latency')!;
const elProvider = document.getElementById('val-provider')!;
const elRecFeed = document.getElementById('rec-feed')!;

const stateIcons: Record<string, string> = {
  Focused: '🎯',
  Hesitation: '🤔',
  Exploring: '🧭',
  Frustrated: '😤',
  Idle: '⏳'
};

// 1. Listen to 500ms interaction packets
framework.onPacket((packet: InteractionPacket) => {
  windowIndex++;
  elWindowCounter.textContent = `Window: #${windowIndex}`;

  const { features } = packet;
  elMeanVel.textContent = features.meanVelocity.toFixed(2);
  elMaxVel.textContent = features.maxVelocity.toFixed(2);
  elHesitation.textContent = String(features.hesitationCount);
  elEntropy.textContent = features.trajectoryEntropy.toFixed(2);
  elDwell.textContent = String(Math.round(features.dwellTimeMs));
  elScroll.textContent = `${Math.round(features.scrollDepthPercentage)}%`;
});

// 2. Listen to inferred cognitive states
framework.onCognitiveState((state: CognitiveState) => {
  elStateBadge.className = `state-badge badge-${state.label}`;
  elStateIcon.textContent = stateIcons[state.label] || '🎯';
  elStateLabel.textContent = `${state.label} (${Math.round(state.confidence * 100)}%)`;
  elLatency.textContent = `${state.latencyMs} ms`;
  elProvider.textContent = `Provider: ${state.executionProvider}`;

  for (const [label, prob] of Object.entries(state.probabilities)) {
    const fillEl = document.getElementById(`prob-fill-${label}`);
    const valEl = document.getElementById(`prob-val-${label}`);
    if (fillEl) fillEl.style.width = `${Math.round(prob * 100)}%`;
    if (valEl) valEl.textContent = prob.toFixed(2);
  }
});

// 3. Listen to Adaptive UI recommendations
framework.onRecommendation((rec: UIRecommendation) => {
  const item = document.createElement('div');
  const typeClass = rec.cognitiveState.label === 'Hesitation' ? 'hesitation' : rec.cognitiveState.label === 'Frustrated' ? 'frustrated' : '';
  item.className = `rec-item ${typeClass}`;
  item.innerHTML = `
    <div class="rec-header">
      <span style="color: var(--accent-cyan); font-family: var(--font-mono);">${rec.action}</span>
      <span style="color: var(--text-muted); font-size: 11px;">Target: ${rec.targetElementId}</span>
    </div>
    <div class="rec-reason">${rec.reason}</div>
  `;

  elRecFeed.prepend(item);
  if (elRecFeed.children.length > 5) {
    elRecFeed.lastElementChild?.remove();
  }
});

// Start framework
framework.init().then(() => {
  framework.start();
  console.log('[Edge-AUI] Framework running with dual-gate inference.');
});
