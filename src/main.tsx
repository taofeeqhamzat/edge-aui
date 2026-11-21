import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./app/App";
import "./style.css";
import {
  bootRuntime,
  getLastCompletedTrialTrace,
  registerRuntimeDefaults,
  stopTestbed,
} from "./runtime/boot";
import { testbedAdapter } from "./testbed/adapter";
import { TESTBED_MACRO_MAPPER } from "./testbed/config/macroVocabulary";
import { TESTBED_CONTEXT_ENCODING_CONFIG } from "./testbed/config/contextEncoding";
import {
  TESTBED_FAST_GATE_DECLARATIONS,
  TESTBED_FAST_GATE_PATTERN_VERSION,
} from "./testbed/config/fastGatePatterns";
import { TESTBED_EXPERIMENT_CONFIG } from "./testbed/config/experiment";
import {
  createTestbedCandidateResolver,
  TESTBED_PASSIVE_ACTIONS,
} from "./testbed/config/policyAdapter";
import { createTestbedTargetResolver } from "./testbed/config/interventionTargets";
import { SemanticOutcomeDeriver } from "./outcome/semantic";
import {
  TESTBED_SEMANTIC_VOCABULARY,
  createTestbedSemanticRules,
} from "./testbed/config/semanticOutcomes";
import { parseBundleManifest } from "./config/modelManifest";
import semanticBundle from "../public/models/task_outcome_head_v2.bundle.json";
import { startRuntimeDiagnostics } from "./runtime/diagnostics";
import { installTestbedGate } from "./testbed/entry/entryGate";

const slowGateManifest = parseBundleManifest(semanticBundle);

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
  fastGatePatterns: TESTBED_FAST_GATE_DECLARATIONS,
  fastGatePatternVersion: TESTBED_FAST_GATE_PATTERN_VERSION,
  outcomeVocabulary: TESTBED_SEMANTIC_VOCABULARY,
  candidateResolver: createTestbedCandidateResolver(),
  targetResolver: createTestbedTargetResolver(),
  manifest: slowGateManifest,
  policyConfig: {
    confidenceThreshold: 0.35,
    confidenceThresholdByType: {
      highlight_primary_action: 0.3,
      simplify_options: 0.35,
      offer_assistance: 0.25,
      expand_tooltip: 0.25,
    },
    ttlMs: 4000,
    ttlMsByType: {
      highlight_primary_action: 3500,
      expand_tooltip: 4000,
      offer_assistance: 4500,
    },
    cooldownMs: 8000,
    dismissalCooldownMs: 15000,
    acceptanceCooldownMs: 15000,
    maxInterventionsPerTaskStep: 4,
    requiredConsecutiveWindows: 1,
    passiveActions: [...TESTBED_PASSIVE_ACTIONS],
  },
  // Semantic outcomes are application vocabulary: the testbed supplies its own rules and
  // the framework records whatever it derives (Task 20.4).
  semanticOutcomes: new SemanticOutcomeDeriver({
    vocabulary: TESTBED_SEMANTIC_VOCABULARY,
    rules: createTestbedSemanticRules(),
  }),
  experiment: TESTBED_EXPERIMENT_CONFIG,
});

/**
 * Pre-session supported-device gate.
 *
 * This is intentionally the boundary between the browser and the study. `bootRuntime()` is
 * the only pre-task path that calls `sessionManager.startSession()`, and it also starts the
 * observer and research collection. Until `onAccessGranted` runs, no participant identity,
 * task session, local store record or behavioural trace exists.
 *
 * The gate is not part of the collection pipeline: it only decides whether the pipeline may
 * be composed at all. Re-evaluation on capability/navigation events is handled inside the
 * gate so a responsive layout change or orientation change cannot reveal the testbed.
 */
const rootElement = document.getElementById("app")!;
let reactRoot: Root | null = null;

installTestbedGate({
  root: rootElement,
  onAccessGranted: () => {
    reactRoot = createRoot(rootElement);
    reactRoot.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    void start();
  },
  onAccessRevoked: () => {
    // Stop observation/actuation while the DOM still exists, then unmount the testbed.
    stopTestbed();
    reactRoot?.unmount();
    reactRoot = null;
  },
});

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
    // The condition is resolved from `VITE_AUI_EXPERIMENT_CONDITION` / `?auiCondition=`
    // here, before `bootRuntime()` creates the participant session.
    const runtime = await bootRuntime();
    const status = runtime.getStatus();

    console.log("[Edge-AUI] Adaptive runtime started", {
      sessionId: status.sessionId,
      experimentId: status.experimentId,
      conditionId: status.conditionId,
    });

    // Development diagnostics: proves the pipeline produces telemetry end to end.
    startRuntimeDiagnostics(runtime, {
      getCompletedTrace: getLastCompletedTrialTrace,
    });
  } catch (err) {
    console.error("[Edge-AUI] Failed to start the adaptive runtime:", err);
  }
}
