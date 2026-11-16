import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './style.css';
import { bootRuntime, registerRuntimeDefaults } from './runtime/boot';
import { testbedAdapter } from './testbed/adapter';
import { TESTBED_MACRO_MAPPER } from './testbed/config/macroVocabulary';
import { TESTBED_CONTEXT_ENCODING_CONFIG } from './testbed/config/contextEncoding';
import {
  TESTBED_FAST_GATE_PATTERNS,
  TESTBED_FAST_GATE_PATTERN_VERSION
} from './testbed/config/fastGatePatterns';
import { TESTBED_EXPERIMENT_CONFIG } from './testbed/config/experiment';
import { createTestbedCandidateResolver } from './testbed/config/policyAdapter';
import { startRuntimeDiagnostics } from './runtime/diagnostics';

/**
 * The testbed supplies every piece of application vocabulary and application policy the
 * runtime consumes: its UI adapter, macro symbols, context encoding, declared Fast Gate
 * patterns, outcome→adaptation mapping and study schedule. Framework core holds none of
 * them (Task 20.2).
 */
registerRuntimeDefaults({
  adapter: testbedAdapter,
  macroMapper: TESTBED_MACRO_MAPPER,
  contextEncoding: TESTBED_CONTEXT_ENCODING_CONFIG,
  fastGatePatterns: TESTBED_FAST_GATE_PATTERNS,
  fastGatePatternVersion: TESTBED_FAST_GATE_PATTERN_VERSION,
  candidateResolver: createTestbedCandidateResolver(),
  experiment: TESTBED_EXPERIMENT_CONFIG
});

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
    const runtime = await bootRuntime('adaptive');
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
