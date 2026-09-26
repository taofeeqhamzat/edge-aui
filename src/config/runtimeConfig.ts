/**
 * Runtime Configuration Surface
 *
 * Implements Stage 4.2 specifications from docs/plan/1/tasks/4.2.md and ADR-012.
 *
 * Defines the framework-owned Layer 2 runtime configuration covering all nine
 * parameter groups specified in research brief §7:
 *   1. Telemetry
 *   2. Windowing
 *   3. MicroTensor
 *   4. Macro sequences
 *   5. Fast Gate
 *   6. Slow Gate
 *   7. Policy
 *   8. Actuation
 *   9. Experiment
 *
 * Provides typed defaults so that an application or trial can start collecting telemetry
 * with an empty `{}` configuration.
 */

import { PREPROCESSING_CONFIG } from './pipelineConfig';
import { InterventionType } from '../intervention/types';
import { EXPERIMENT_TRACE_SCHEMA_VERSION } from '../telemetry/traceSchema';

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? U[]
    : T[P] extends ReadonlyArray<infer U>
    ? ReadonlyArray<U>
    : T[P] extends Record<string, any>
    ? Partial<T[P]>
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

// =============================================================================
// Parameter Group 1: Telemetry
// =============================================================================
export interface TelemetryConfig {
  enabledEventTypes: string[];
  sampleIntervalMs: number;
  captureGeometry: boolean;
  maxBufferSize: number;
  sessionSettings: {
    idleTimeoutMs: number;
    storagePrefix: string;
  };
}

// =============================================================================
// Parameter Group 2: Windowing
// =============================================================================
export interface WindowingConfig {
  windowDurationMs: number;
  strideMs: number;
  minEventCount: number;
  inactivityThresholdMs: number;
  lateEventPolicy: 'drop' | 'reassign' | 'settle';
  settlementDelayMs: number;
  pendingOutcomeGraceMs: number;
  emitInactiveWindows: boolean;
}

// =============================================================================
// Parameter Group 3: MicroTensor
// =============================================================================
export interface MicroTensorConfig {
  schemaVersion: string;
  inputDim: number;
  featureNames: string[];
  normalization: Record<string, number>;
}

// =============================================================================
// Parameter Group 4: Macro Sequences
// =============================================================================
export interface MacroConfig {
  groupingIntervalMs: number;
  maxHistoryLength: number;
  maxRecentSymbols: number;
  recentSequenceLookback: number;
}

// =============================================================================
// Parameter Group 5: Fast Gate
// =============================================================================
export interface FastGateConfig {
  miner: 'wasm' | 'mock';
  minSupport: number;
  minConfidence: number;
  maxPatternLength: number;
  rankingStrategy: 'confidence' | 'length' | 'support';
  patternInterventionMap: Record<string, InterventionType>;
}

// =============================================================================
// Parameter Group 6: Slow Gate
// =============================================================================
export interface SlowGateConfig {
  modelPath: string;
  executionProvider: 'webgpu' | 'wasm' | 'auto';
  sequenceLength: number;
  batchSize: number;
  confidenceThreshold: number;
  targetContextEncoding: 'R6' | 'none';
  fallbackBehavior: 'mock' | 'no_op' | 'fast_only';
  enabled: boolean;
}

// =============================================================================
// Parameter Group 7: Policy
// =============================================================================
export interface PolicyRuntimeConfig {
  confidenceThreshold: number;
  requiredConsecutiveWindows: number;
  sustainedConfidenceDurationMs: number;
  cooldownMs: number;
  dismissalCooldownMs: number;
  ttlMs: number;
  maxInterventionsPerTask: number;
  conflictResolution: 'highest_confidence' | 'first' | 'last';
  enforceContextEligibility: boolean;
}

// =============================================================================
// Parameter Group 8: Actuation
// =============================================================================
export interface ActuationConfig {
  defaultMechanism: 'css_class' | 'aria' | 'dom';
  defaultTtlMs: number;
  revertBehavior: 'on_reset' | 'on_ttl' | 'on_action';
  defaultAssistanceText?: string;
}

// =============================================================================
// Parameter Group 9: Experiment
// =============================================================================
export interface ExperimentRuntimeConfig {
  experimentId: string;
  conditionId: 'baseline' | 'adaptive';
  trialOrder: string[];
  taskTimeoutsMs: Record<string, number>;
  traceSchemaVersion: string;
}

// =============================================================================
// Master Runtime Configuration
// =============================================================================
export interface RuntimeConfig {
  telemetry: TelemetryConfig;
  windowing: WindowingConfig;
  microtensor: MicroTensorConfig;
  macro: MacroConfig;
  fastGate: FastGateConfig;
  slowGate: SlowGateConfig;
  policy: PolicyRuntimeConfig;
  actuation: ActuationConfig;
  experiment: ExperimentRuntimeConfig;
}

/**
 * Production-ready default configuration across all nine parameter groups.
 * Enables zero-configuration startup of the AdaptiveRuntime.
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  telemetry: {
    enabledEventTypes: ['mousemove', 'mousedown', 'mouseup', 'click', 'scroll', 'input', 'change', 'submit'],
    sampleIntervalMs: 0,
    captureGeometry: true,
    maxBufferSize: 10000,
    sessionSettings: {
      idleTimeoutMs: 1800000, // 30 minutes
      storagePrefix: 'edge_aui_'
    }
  },
  windowing: {
    windowDurationMs: PREPROCESSING_CONFIG.window_size_ms ?? 500,
    strideMs: PREPROCESSING_CONFIG.stride_ms ?? 250,
    minEventCount: PREPROCESSING_CONFIG.min_events_per_window ?? 5,
    inactivityThresholdMs: 2000,
    lateEventPolicy: 'settle',
    settlementDelayMs: PREPROCESSING_CONFIG.settlement_delay_ms ?? PREPROCESSING_CONFIG.stride_ms ?? 250,
    pendingOutcomeGraceMs: 2000,
    emitInactiveWindows: true
  },
  microtensor: {
    schemaVersion: '1.0.0',
    inputDim: PREPROCESSING_CONFIG.input_dim ?? 18,
    featureNames: [
      ...PREPROCESSING_CONFIG.core_features,
      ...PREPROCESSING_CONFIG.contextual_features
    ],
    normalization: { ...(PREPROCESSING_CONFIG.normalization as unknown as Record<string, number>) }
  },
  macro: {
    groupingIntervalMs: 2000,
    maxHistoryLength: 400,
    maxRecentSymbols: 6,
    recentSequenceLookback: 40
  },
  fastGate: {
    miner: 'wasm',
    minSupport: 1,
    minConfidence: 0.60,
    maxPatternLength: 4,
    rankingStrategy: 'confidence',
    patternInterventionMap: {
      'OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
      'NAV_ANALYTICS > OPEN_FILTERS': 'simplify_options',
      'NAV_ANALYTICS > OPEN_FILTERS > APPLY_FILTER': 'highlight_primary_action',
      'SELECT_DATE > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER': 'highlight_primary_action',
      'HOVER_KPI > HOVER_KPI': 'expand_tooltip'
    }
  },
  slowGate: {
    modelPath: '/models/gru_edge_aui.onnx',
    executionProvider: 'auto',
    sequenceLength: 8,
    batchSize: 1,
    confidenceThreshold: 0.75,
    targetContextEncoding: 'R6',
    fallbackBehavior: 'mock',
    enabled: true
  },
  policy: {
    confidenceThreshold: 0.75,
    requiredConsecutiveWindows: 2,
    sustainedConfidenceDurationMs: 500,
    cooldownMs: 5000,
    dismissalCooldownMs: 15000,
    ttlMs: 8000,
    maxInterventionsPerTask: 2,
    conflictResolution: 'highest_confidence',
    enforceContextEligibility: true
  },
  actuation: {
    defaultMechanism: 'css_class',
    defaultTtlMs: 8000,
    revertBehavior: 'on_reset',
    defaultAssistanceText: 'Can we help with this step?'
  },
  experiment: {
    experimentId: 'exp-default',
    conditionId: 'adaptive',
    trialOrder: ['T1', 'T2', 'T3'],
    taskTimeoutsMs: {
      T1: 120000,
      T2: 90000,
      T3: 150000
    },
    traceSchemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION
  }
};

/**
 * Validates a resolved runtime configuration against physical and logical invariants.
 * Throws actionable Error if any parameter is out of bounds.
 */
export function validateRuntimeConfig(config: RuntimeConfig): void {
  if (config.windowing.windowDurationMs <= 0) {
    throw new Error(`Invalid windowDurationMs: ${config.windowing.windowDurationMs}. Must be > 0.`);
  }
  if (config.windowing.strideMs <= 0) {
    throw new Error(`Invalid strideMs: ${config.windowing.strideMs}. Must be > 0.`);
  }
  if (config.windowing.strideMs > config.windowing.windowDurationMs) {
    throw new Error(
      `Invalid windowing configuration: strideMs (${config.windowing.strideMs}) cannot exceed windowDurationMs (${config.windowing.windowDurationMs}).`
    );
  }
  if (config.windowing.minEventCount < 1) {
    throw new Error(`Invalid minEventCount: ${config.windowing.minEventCount}. Must be >= 1.`);
  }
  if (config.slowGate.confidenceThreshold < 0 || config.slowGate.confidenceThreshold > 1) {
    throw new Error(
      `Invalid slowGate.confidenceThreshold: ${config.slowGate.confidenceThreshold}. Must be between 0 and 1.`
    );
  }
  if (config.policy.confidenceThreshold < 0 || config.policy.confidenceThreshold > 1) {
    throw new Error(`Invalid policy.confidenceThreshold: ${config.policy.confidenceThreshold}. Must be between 0 and 1.`);
  }
  if (config.policy.requiredConsecutiveWindows < 1) {
    throw new Error(`Invalid policy.requiredConsecutiveWindows: ${config.policy.requiredConsecutiveWindows}. Must be >= 1.`);
  }
  if (config.fastGate.minSupport < 1) {
    throw new Error(`Invalid fastGate.minSupport: ${config.fastGate.minSupport}. Must be >= 1.`);
  }
  if (config.fastGate.minConfidence < 0 || config.fastGate.minConfidence > 1) {
    throw new Error(`Invalid fastGate.minConfidence: ${config.fastGate.minConfidence}. Must be between 0 and 1.`);
  }
  if (config.macro.groupingIntervalMs <= 0) {
    throw new Error(`Invalid macro.groupingIntervalMs: ${config.macro.groupingIntervalMs}. Must be > 0.`);
  }
}

function cleanDefined<T extends Record<string, any>>(obj?: Partial<T>): Partial<T> {
  if (!obj) return {};
  const res: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      res[k] = v;
    }
  }
  return res;
}

/**
 * Deep merges a user configuration over the default runtime configuration
 * and validates the resulting configuration.
 */
export function resolveRuntimeConfig(userConfig?: DeepPartial<RuntimeConfig>): RuntimeConfig {
  if (!userConfig) {
    return JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
  }

  const resolved: RuntimeConfig = {
    telemetry: {
      ...DEFAULT_RUNTIME_CONFIG.telemetry,
      ...(userConfig.telemetry ?? {}),
      enabledEventTypes: userConfig.telemetry?.enabledEventTypes
        ? [...userConfig.telemetry.enabledEventTypes]
        : DEFAULT_RUNTIME_CONFIG.telemetry.enabledEventTypes,
      sessionSettings: {
        ...DEFAULT_RUNTIME_CONFIG.telemetry.sessionSettings,
        ...(userConfig.telemetry?.sessionSettings ?? {})
      }
    },
    windowing: {
      ...DEFAULT_RUNTIME_CONFIG.windowing,
      ...(userConfig.windowing ?? {})
    },
    microtensor: {
      ...DEFAULT_RUNTIME_CONFIG.microtensor,
      ...(userConfig.microtensor ?? {}),
      normalization: {
        ...DEFAULT_RUNTIME_CONFIG.microtensor.normalization,
        ...(cleanDefined(userConfig.microtensor?.normalization) as Record<string, number>)
      }
    },
    macro: {
      ...DEFAULT_RUNTIME_CONFIG.macro,
      ...(userConfig.macro ?? {})
    },
    fastGate: {
      ...DEFAULT_RUNTIME_CONFIG.fastGate,
      ...(userConfig.fastGate ?? {}),
      patternInterventionMap: {
        ...DEFAULT_RUNTIME_CONFIG.fastGate.patternInterventionMap,
        ...(cleanDefined(userConfig.fastGate?.patternInterventionMap) as Record<string, InterventionType>)
      }
    },
    slowGate: {
      ...DEFAULT_RUNTIME_CONFIG.slowGate,
      ...(userConfig.slowGate ?? {})
    },
    policy: {
      ...DEFAULT_RUNTIME_CONFIG.policy,
      ...(userConfig.policy ?? {})
    },
    actuation: {
      ...DEFAULT_RUNTIME_CONFIG.actuation,
      ...(userConfig.actuation ?? {})
    },
    experiment: {
      ...DEFAULT_RUNTIME_CONFIG.experiment,
      ...(userConfig.experiment ?? {}),
      taskTimeoutsMs: {
        ...DEFAULT_RUNTIME_CONFIG.experiment.taskTimeoutsMs,
        ...(cleanDefined(userConfig.experiment?.taskTimeoutsMs) as Record<string, number>)
      }
    }
  };

  validateRuntimeConfig(resolved);
  return resolved;
}
