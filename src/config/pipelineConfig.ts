/**
 * Strongly-typed accessors for pipeline configuration derived directly from config.yaml.
 * Acts as the canonical bridge ensuring zero covariate shift between Python model-preparation
 * and client-side TypeScript execution.
 */

import rawConfig from './pipelineConfig.json';

export interface NormalizationConfig {
  mean_velocity_scale: number;
  max_velocity_scale: number;
  mean_acceleration_scale: number;
  hesitation_scale: number;
  trajectory_scale: number;
  scroll_velocity_scale: number;
}

export interface PreprocessingConfig {
  window_size_ms: number;
  stride_ms: number;
  reference_viewport: [number, number];
  core_features: string[];
  contextual_features: string[];
  num_features: number;
  input_dim: number;
  min_events_per_window: number;
  normalization: NormalizationConfig;
}

export interface PipelineConfig {
  mode: string;
  preprocessing: PreprocessingConfig;
  target_generation: {
    lookahead_horizon_ms: [number, number];
    outcome_taxonomy: Record<string, string>;
    priority_hierarchy: string[];
    target_intervention_vocabulary: Record<string, string>;
  };
  training: {
    batch_size: number;
    epochs: number;
    learning_rate: number;
    hidden_dim: number;
    num_layers: number;
    foundation_classes: number;
    target_classes: number;
    device: string;
  };
  export: {
    output_dir: string;
    onnx_filename: string;
    quantized_filename: string;
    quantization_type: string;
    opset_version: number;
    max_memory_mb: number;
    target_latency_ms: number;
  };
}

export const PIPELINE_CONFIG: PipelineConfig = (rawConfig as unknown) as PipelineConfig;

export const PREPROCESSING_CONFIG: PreprocessingConfig = PIPELINE_CONFIG.preprocessing;
export const NORMALIZATION_CONFIG: NormalizationConfig = PIPELINE_CONFIG.preprocessing.normalization;
export const TARGET_INTERVENTION_VOCABULARY: Record<string, string> =
  PIPELINE_CONFIG.target_generation.target_intervention_vocabulary;
export const OUTCOME_TAXONOMY: Record<string, string> =
  PIPELINE_CONFIG.target_generation.outcome_taxonomy;
