/**
 * Typed Web Worker Message Protocols for Edge-AUI Runtime
 * Implements Stage 9.1 specifications from docs/testbed/prd.md Sections 39, 40 & docs/plan/tasks/9.1.md.
 * 
 * Supports transferable ArrayBuffer / Float32Array passing to eliminate serialization
 * latency and guarantee zero main-thread blocking.
 */

import { MacroInteraction } from '../telemetry/events';
import { UIContext } from '../types/uiContext.js';
import { InferenceResult } from '../gates/arbitration';
import { SequenceConfig } from '../microtensor/schema';
import { PatternIntervention } from '../gates/fast/mockFastGate';
import { StageTimingRecord } from './instrumentation';

export const RUNTIME_WORKER_VERSION = '1.0';

// =========================================================================
// Request Types
// =========================================================================

export type RuntimeWorkerRequestType =
  | 'INIT'
  | 'PUSH_WINDOW'
  | 'PUSH_MACRO'
  | 'EVALUATE'
  | 'RESET'
  | 'MINE_PATTERNS'
  | 'PING';

/**
 * Fast Gate selection strategy.
 * - `mock`       : deterministic registered-pattern matcher (default, no WASM needed)
 * - `prefixspan` : real Rust/WASM PrefixSpan mining over the macro sequence corpus
 */
export type FastGateMode = 'mock' | 'prefixspan';

/**
 * Slow Gate selection strategy.
 * - `mock` : deterministic fixed-outcome gate (default, no model required)
 * - `onnx` : the real INT8 GRU graph behind the same interface
 */
export type SlowGateMode = 'mock' | 'onnx';

export interface RuntimeInitRequest {
  id: string;
  type: 'INIT';
  payload?: {
    sequenceConfig?: Partial<SequenceConfig>;
    /** Declared pattern → intervention map for the Fast Gate. */
    fastGatePatterns?: Record<string, PatternIntervention>;
    /** Which Fast Gate implementation to construct. Default 'mock'. */
    fastGateMode?: FastGateMode;
    /** Minimum support passed to the PrefixSpan miner. */
    minPatternSupport?: number;
    /** Minimum confidence required to accept a mined pattern. */
    minPatternConfidence?: number;
    /** Which Slow Gate implementation to construct. Default 'mock'. */
    slowGateMode?: SlowGateMode;
    /** Model URL for the foundation ONNX Slow Gate. */
    modelUrl?: string;
    /** Model URL for the target intervention head ONNX Slow Gate. */
    interventionModelUrl?: string;
    /** Explicit ablation arm: use deterministic mapping instead of learned head. */
    useDeterministicMapping?: boolean;
    /** Minimum outcome confidence required to emit an intervention. */
    minOutcomeConfidence?: number;
    /** Context vector dimension expected by the Slow Gate head. */
    contextDim?: number;
    enableFastGate?: boolean;
    enableSlowGate?: boolean;
    /**
     * Fast Gate execution bounds. Sent from the resolved runtime configuration so an
     * experiment can change them without a code change. Omitting them leaves the worker's
     * safe defaults in place (assessment F-02).
     */
    fastGateBounds?: {
      maxPatterns?: number;
      maxPatternLength?: number;
      maxCorpusSequences?: number;
      miningTimeoutMs?: number;
    };
  };
}

export interface RuntimePushWindowRequest {
  id: string;
  type: 'PUSH_WINDOW';
  payload: {
    windowId: number;
    windowStart: number;
    windowEnd: number;
    values: Float32Array; // Transferable buffer (length 18)
    eventCount?: number;
    inactive?: boolean;
  };
}

export interface RuntimePushMacroRequest {
  id: string;
  type: 'PUSH_MACRO';
  payload: {
    macro: MacroInteraction;
  };
}

export interface RuntimeEvaluateRequest {
  id: string;
  type: 'EVALUATE';
  payload: {
    uiContext: UIContext;
    macroSequence?: MacroInteraction[];
  };
}

export interface RuntimeResetRequest {
  id: string;
  type: 'RESET';
}

export interface RuntimeMinePatternsRequest {
  id: string;
  type: 'MINE_PATTERNS';
  payload: {
    sequences: string[][];
    minSupport: number;
  };
}

export interface RuntimePingRequest {
  id: string;
  type: 'PING';
}

export type RuntimeWorkerRequest =
  | RuntimeInitRequest
  | RuntimePushWindowRequest
  | RuntimePushMacroRequest
  | RuntimeEvaluateRequest
  | RuntimeResetRequest
  | RuntimeMinePatternsRequest
  | RuntimePingRequest;

// =========================================================================
// Response Types
// =========================================================================

export type RuntimeWorkerResponseType =
  | 'INIT_OK'
  | 'WINDOW_PROCESSED'
  | 'MACRO_PROCESSED'
  | 'EVALUATION_RESULT'
  | 'RESET_OK'
  | 'MINE_RESULT'
  | 'PONG'
  | 'ERROR';

export interface RuntimeInitOkResponse {
  id: string;
  type: 'INIT_OK';
  success: true;
  timings?: StageTimingRecord[];
  data: {
    version: string;
    fastGateMode?: FastGateMode;
    slowGateMode?: SlowGateMode;
    /** The execution provider that actually served the session, if a model loaded. */
    executionProvider?: string;
    modelLoaded?: boolean;
    interventionModelLoaded?: boolean;
    /**
     * Identity of the model graph that was actually loaded, as reported by the gate.
     *
     * This exists so the trace records the deployed model rather than a hardcoded literal
     * that could not distinguish two different exported graphs (F-19).
     */
    modelVersion?: string;
    executionProviders?: {
      foundation?: string;
      intervention?: string;
    };
  };
}

export interface RuntimeWindowProcessedResponse {
  id: string;
  type: 'WINDOW_PROCESSED';
  success: true;
  timings?: StageTimingRecord[];
  data: {
    windowCount: number;
    isFull: boolean;
  };
}

export interface RuntimeMacroProcessedResponse {
  id: string;
  type: 'MACRO_PROCESSED';
  success: true;
  timings?: StageTimingRecord[];
  data: {
    macroCount: number;
  };
}

export interface WorkerEvaluationDiagnostics {
  fastGateMode: FastGateMode;
  slowGateMode: SlowGateMode;
  minPatternSupport: number;
  workerMacroHistory: number;
  workerCorpusSize: number;
  evaluatedSequenceLength: number;
  /** Bounds the Fast Gate was actually constructed with inside the worker. */
  fastGateBounds?: {
    maxPatterns: number;
    maxPatternLength: number;
    maxCorpusSequences: number;
    miningTimeoutMs: number;
  };
  /**
   * Cumulative Fast Gate evaluation outcomes for the worker's lifetime. Cumulative rather
   * than per-call so a superseded or timed-out evaluation cannot disappear (F-02).
   */
  miningOutcomes?: Record<string, number>;
}

export interface RuntimeEvaluationResponse {
  id: string;
  type: 'EVALUATION_RESULT';
  success: true;
  timings?: StageTimingRecord[];
  data: InferenceResult & { diagnostics?: WorkerEvaluationDiagnostics };
}

export interface RuntimeResetOkResponse {
  id: string;
  type: 'RESET_OK';
  success: true;
  timings?: StageTimingRecord[];
}

export interface RuntimeMineResultResponse {
  id: string;
  type: 'MINE_RESULT';
  success: true;
  timings?: StageTimingRecord[];
  data: {
    /** Null when no miner is available in the worker scope. */
    patterns: { pattern: string[]; support: number; confidence: number }[] | null;
    minerAvailable: boolean;
  };
}

export interface RuntimePongResponse {
  id: string;
  type: 'PONG';
  success: true;
  timings?: StageTimingRecord[];
  data: {
    timestamp: number;
  };
}

export interface RuntimeErrorResponse {
  id: string;
  type: 'ERROR';
  success: false;
  timings?: StageTimingRecord[];
  error: string;
}

export type RuntimeWorkerResponse =
  | RuntimeInitOkResponse
  | RuntimeWindowProcessedResponse
  | RuntimeMacroProcessedResponse
  | RuntimeEvaluationResponse
  | RuntimeResetOkResponse
  | RuntimeMineResultResponse
  | RuntimePongResponse
  | RuntimeErrorResponse;

/**
 * Extracts transferable ArrayBuffers from a request payload if present.
 */
export function getTransferablesForRequest(request: RuntimeWorkerRequest): Transferable[] {
  if (request.type === 'PUSH_WINDOW') {
    if (request.payload.values && request.payload.values.buffer) {
      return [request.payload.values.buffer];
    }
  }
  return [];
}
