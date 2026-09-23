import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './style.css';
import { bootTestbed } from './runtime/boot';
import { startRuntimeDiagnostics } from './runtime/diagnostics';

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/**
 * Composition root.
 *
 * This previously booted the legacy `EdgeAUIFramework` (raw ClientBehaviorTracker plus
 * cognitive-state heuristics), which never exercised the research pipeline
 * (assessment §4.1 / §25 P0-1). It now starts the composed adaptive runtime:
 * passive observer → rolling MicroTensor window → macro stream → dual-gate
 * arbitration → intervention policy → actuator → experiment trace.
 */
async function start(): Promise<void> {
  try {
    const runtime = await bootTestbed('adaptive');
    const status = runtime.getStatus();

    console.log('[Edge-AUI] Adaptive runtime started', {
      sessionId: status.sessionId,
      experimentId: status.experimentId,
      conditionId: status.conditionId
    });

    // Development diagnostics: proves the pipeline produces telemetry end to end.
    startRuntimeDiagnostics(runtime);
  } catch (err) {
    console.error('[Edge-AUI] Failed to start the adaptive runtime:', err);
  }
}

void start();
