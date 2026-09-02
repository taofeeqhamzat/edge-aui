/**
 * Telemetry and Kinematic Data Structures for Edge-AUI Framework
 * Implements schemas defined in docs/data_schemas.md and production reference.
 */

export interface RawPointerPoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface MacroEvent {
  type: string;
  targetId: string;
  timestamp: number;
}

export interface InteractionEvent {
  timestamp: number;
  eventType: 'click' | 'mousemove' | 'scroll' | 'hover';
  targetId: string;
  coordinates: [number, number]; // [x, y] normalized to viewport [0, 1]
  scrollDepth: number; // Normalized [0, 1]
  dwellTimeMs: number;
}

export interface MicroTensor {
  meanVelocity: number;           // px/ms
  maxVelocity: number;            // px/ms
  meanAcceleration: number;       // px/ms^2
  hesitationCount: number;        // Direction shifts > 45 degrees
  totalTrajectoryLength: number;  // Cumulative pixels
  dwellTimeMs: number;            // Milliseconds over trackable components
  scrollDepthPercentage: number;  // 0 - 100%
  scrollVelocity: number;         // px/ms
  trajectoryEntropy: number;      // Shannon directional entropy [0, 1]
  timestamp: number;
}

export interface InteractionPacket {
  sessionId: string;
  windowDurationMs: number;
  macroEvents: MacroEvent[];
  features: MicroTensor;
}

export interface PrefixSpanPattern {
  pattern: string[];
  support: number;
  confidence: number;
}

export type LatentCognitiveLabel =
  | 'Focused'
  | 'Hesitation'
  | 'Exploring'
  | 'Frustrated'
  | 'Idle';

export interface CognitiveState {
  label: LatentCognitiveLabel;
  confidence: number;
  probabilities: Record<LatentCognitiveLabel, number>;
  latencyMs: number;
  executionProvider: 'webgpu' | 'wasm' | 'cpu' | 'heuristic';
  timestamp: number;
}

export interface UIRecommendation {
  id: string;
  targetElementId: string;
  action: 'simplify_options' | 'highlight_primary_action' | 'offer_assistance' | 'expand_tooltip' | 'none';
  reason: string;
  cognitiveState: CognitiveState;
  matchedPattern?: PrefixSpanPattern;
  timestamp: number;
}
