/**
 * Typed Web Worker Message Protocols for Edge-AUI Framework
 */

import type {
  CognitiveState,
  InteractionPacket,
  MacroEvent,
  RawPointerPoint
} from './telemetry.js';

// ==========================================
// WASM Worker Messages (Fast Brain Gate)
// ==========================================

export type WasmWorkerRequestType =
  | 'WASM_INIT'
  | 'EXTRACT_MICRO_TENSOR'
  | 'PROCESS_INTERACTION_BATCH'
  | 'MINE_PATTERNS'
  | 'PING';

export interface WasmInitRequest {
  id: string;
  type: 'WASM_INIT';
}

export interface WasmExtractMicroTensorRequest {
  id: string;
  type: 'EXTRACT_MICRO_TENSOR';
  payload: {
    points: RawPointerPoint[];
    dwellTimeMs: number;
    scrollDepthPercentage: number;
    scrollVelocity: number;
    timestamp: number;
  };
}

export interface WasmProcessBatchRequest {
  id: string;
  type: 'PROCESS_INTERACTION_BATCH';
  payload: {
    sessionId: string;
    windowDurationMs: number;
    points: RawPointerPoint[];
    macroEvents: MacroEvent[];
    dwellTimeMs: number;
    scrollDepthPercentage: number;
    scrollVelocity: number;
    timestamp: number;
  };
}

export interface WasmMinePatternsRequest {
  id: string;
  type: 'MINE_PATTERNS';
  payload: {
    sequences: string[][];
    minSupport: number;
  };
}

export interface WasmPingRequest {
  id: string;
  type: 'PING';
}

export type WasmWorkerRequest =
  | WasmInitRequest
  | WasmExtractMicroTensorRequest
  | WasmProcessBatchRequest
  | WasmMinePatternsRequest
  | WasmPingRequest;

export type WasmWorkerResponseType =
  | 'WASM_READY'
  | 'MICRO_TENSOR_RESULT'
  | 'INTERACTION_PACKET_RESULT'
  | 'PATTERNS_RESULT'
  | 'PONG'
  | 'ERROR';

export interface WasmWorkerResponse<T = unknown> {
  id: string;
  type: WasmWorkerResponseType;
  success: boolean;
  data?: T;
  error?: string;
  durationMs?: number;
}

// ==========================================
// ONNX Worker Messages (Slow Brain Gate)
// ==========================================

export type OnnxWorkerRequestType =
  | 'ONNX_INIT'
  | 'INFER_COGNITIVE_STATE'
  | 'PING';

export interface OnnxInitRequest {
  id: string;
  type: 'ONNX_INIT';
  payload?: {
    modelUrl?: string;
    preferredExecutionProvider?: 'webgpu' | 'wasm' | 'cpu';
  };
}

export interface OnnxInferRequest {
  id: string;
  type: 'INFER_COGNITIVE_STATE';
  payload: {
    packet: InteractionPacket;
  };
}

export interface OnnxPingRequest {
  id: string;
  type: 'PING';
}

export type OnnxWorkerRequest =
  | OnnxInitRequest
  | OnnxInferRequest
  | OnnxPingRequest;

export type OnnxWorkerResponseType =
  | 'ONNX_READY'
  | 'INFERENCE_RESULT'
  | 'PONG'
  | 'ERROR';

export interface OnnxWorkerResponse<T = unknown> {
  id: string;
  type: OnnxWorkerResponseType;
  success: boolean;
  data?: T;
  error?: string;
  durationMs?: number;
}

export interface OnnxInitResultData {
  executionProvider: 'webgpu' | 'wasm' | 'cpu' | 'heuristic';
  gpuSupported: boolean;
  modelLoaded: boolean;
}

export type OnnxInferenceResultData = CognitiveState;
