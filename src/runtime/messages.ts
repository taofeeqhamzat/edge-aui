/**
 * Typed Web Worker Message Protocols for Edge-AUI Runtime
 * Implements Stage 9.1 specifications from clipboard.9.md Sections 39, 40 & docs/plan/tasks/9.1.md.
 * 
 * Supports transferable ArrayBuffer / Float32Array passing to eliminate serialization
 * latency and guarantee zero main-thread blocking.
 */

import { MacroInteraction } from '../telemetry/events';
import { UIContext } from '../types/telemetry';
import { InferenceResult } from '../gates/arbitration';
import { SequenceConfig } from '../microtensor/schema';
import { PatternIntervention } from '../gates/fast/mockFastGate';

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
  | 'PING';

export interface RuntimeInitRequest {
  id: string;
  type: 'INIT';
  payload?: {
    sequenceConfig?: Partial<SequenceConfig>;
    fastGatePatterns?: Record<string, PatternIntervention>;
    enableFastGate?: boolean;
    enableSlowGate?: boolean;
  };
}

export interface RuntimePushWindowRequest {
  id: string;
  type: 'PUSH_WINDOW';
  payload: {
    windowStart: number;
    windowEnd: number;
    values: Float32Array; // Transferable buffer (length 18)
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
  | 'PONG'
  | 'ERROR';

export interface RuntimeInitOkResponse {
  id: string;
  type: 'INIT_OK';
  success: true;
  data: {
    version: string;
  };
}

export interface RuntimeWindowProcessedResponse {
  id: string;
  type: 'WINDOW_PROCESSED';
  success: true;
  data: {
    windowCount: number;
    isFull: boolean;
  };
}

export interface RuntimeMacroProcessedResponse {
  id: string;
  type: 'MACRO_PROCESSED';
  success: true;
  data: {
    macroCount: number;
  };
}

export interface RuntimeEvaluationResponse {
  id: string;
  type: 'EVALUATION_RESULT';
  success: true;
  data: InferenceResult;
}

export interface RuntimeResetOkResponse {
  id: string;
  type: 'RESET_OK';
  success: true;
}

export interface RuntimePongResponse {
  id: string;
  type: 'PONG';
  success: true;
  data: {
    timestamp: number;
  };
}

export interface RuntimeErrorResponse {
  id: string;
  type: 'ERROR';
  success: false;
  error: string;
}

export type RuntimeWorkerResponse =
  | RuntimeInitOkResponse
  | RuntimeWindowProcessedResponse
  | RuntimeMacroProcessedResponse
  | RuntimeEvaluationResponse
  | RuntimeResetOkResponse
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
