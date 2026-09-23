/**
 * Authoritative MicroTensor Schema & Configuration Contracts
 * Governed directly by model-preparation/src/config.yaml.
 * Ensures strict 18-dimensional parity (9 features + 9 binary modality mask flags).
 */

import {
  PREPROCESSING_CONFIG,
  NORMALIZATION_CONFIG,
  NormalizationConfig
} from '../config/pipelineConfig';

export const CORE_FEATURE_NAMES = [...PREPROCESSING_CONFIG.core_features] as const;
export const CONTEXTUAL_FEATURE_NAMES = [...PREPROCESSING_CONFIG.contextual_features] as const;

export const FEATURE_NAMES = [
  ...CORE_FEATURE_NAMES,
  ...CONTEXTUAL_FEATURE_NAMES
] as const;

export type FeatureName = typeof FEATURE_NAMES[number];

export const NUM_BEHAVIOURAL_FEATURES: number = PREPROCESSING_CONFIG.num_features; // 9
export const MICROTENSOR_DIM: number = PREPROCESSING_CONFIG.input_dim; // 18

import type { MicroTensorWindow } from '../telemetry/events';

export { NORMALIZATION_CONFIG };
export type { NormalizationConfig, MicroTensorWindow };

/**
 * Configuration parameters for rolling temporal buffer and sequence tensor shape
 */
export interface SequenceConfig {
  windowMs: number;
  strideMs: number;
  sequenceLength: number;
}

export const DEFAULT_SEQUENCE_CONFIG: SequenceConfig = {
  windowMs: PREPROCESSING_CONFIG.window_size_ms,
  strideMs: PREPROCESSING_CONFIG.stride_ms,
  sequenceLength: 8
};

/**
 * Sequence representation aggregating T consecutive MicroTensorWindows
 */
export interface MicroTensorSequence {
  windows: MicroTensorWindow[];
  sequenceLength: number;
  strideMs: number;
  windowMs: number;
  sessionId?: string;
}

/**
 * Capabilities of the underlying telemetry listeners and environment sensors.
 * Per ADR-001 / docs/testbed/prd.md Section 13, mask represents recording capability, NOT whether an event occurred.
 */
export interface ModalitySupport {
  pointer: boolean;
  dom: boolean;
  scroll: boolean;
}

export const DEFAULT_MODALITY_SUPPORT: ModalitySupport = {
  pointer: true,
  dom: true,
  scroll: true
};
