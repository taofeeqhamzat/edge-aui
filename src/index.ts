/**
 * Edge-AUI Framework — public library surface
 *
 * Client-side framework for behavioural pattern extraction and adaptive UI recommendations.
 * The runnable testbed application does not import this barrel; it exists for an application
 * embedding the pipeline.
 *
 * Several modules deliberately export the same names (for example the gate interfaces and
 * their mock implementations), so import those from their concrete paths rather than through
 * this barrel.
 */

// Canonical behavioural schemas and pipeline stages
export * from './telemetry/events.js';
export * from './telemetry/session.js';
export * from './telemetry/recorder.js';
export * from './telemetry/traceSchema.js';
export * from './microtensor/schema.js';
export * from './microtensor/features.js';
export * from './microtensor/window.js';
export * from './microtensor/sequence.js';
export * from './macro/symbols.js';
export * from './outcome/derive.js';

// Gates, policy and actuation
export * from './gates/arbitration.js';
export * from './gates/fast/types.js';
export { MockFastGate } from './gates/fast/mockFastGate.js';
export type { PatternIntervention } from './gates/fast/mockFastGate.js';
export { PrefixSpanFastGate, createPrefixSpanFastGate } from './gates/fast/prefixSpanFastGate.js';
export type {
  MinedPattern,
  PatternMiner,
  PrefixSpanFastGateOptions
} from './gates/fast/prefixSpanFastGate.js';
export * from './gates/slow/types.js';
export * from './gates/slow/mockSlowGate.js';
export * from './intervention/types.js';
export * from './intervention/policy.js';
export * from './intervention/actuator.js';

// Runtime composition
export * from './runtime/adaptiveRuntime.js';
export * from './runtime/boot.js';
export * from './runtime/messages.js';
export * from './runtime/workerClient.js';

// Configuration and UI context
export * from './config/pipelineConfig.js';
export * from './types/uiContext.js';
export * from './types/contextVector.js';
