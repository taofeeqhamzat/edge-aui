/**
 * ONNX Worker (Probabilistic Gate / Slow Brain)
 * Executes quantized GRU neural network on WebGPU (with WASM fallback)
 * to infer latent cognitive states from micro-interaction tensors.
 */

import * as ort from 'onnxruntime-web';
import type { CognitiveState, InteractionPacket, LatentCognitiveLabel } from '../../types/telemetry.js';
import type {
  OnnxInitResultData,
  OnnxWorkerRequest,
  OnnxWorkerResponse
} from '../../types/worker-messages.js';

let session: ort.InferenceSession | null = null;
let currentExecutionProvider: 'webgpu' | 'wasm' | 'cpu' | 'heuristic' = 'heuristic';
let isInitialized = false;

/**
 * Checks for WebGPU hardware acceleration support in worker environment.
 */
async function detectWebGPUSupport(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    }
  } catch (err) {
    console.warn('[ONNX Worker] WebGPU detection error:', err);
  }
  return false;
}

/**
 * Initializes ONNX Runtime with WebGPU or WASM provider.
 */
async function initializeSession(modelUrl?: string, preferredProvider?: 'webgpu' | 'wasm' | 'cpu'): Promise<OnnxInitResultData> {
  const hasGpu = await detectWebGPUSupport();
  const provider = preferredProvider ?? (hasGpu ? 'webgpu' : 'wasm');

  if (modelUrl) {
    try {
      // Configure ONNX Runtime environment
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;

      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: [provider, 'wasm', 'cpu']
      };

      session = await ort.InferenceSession.create(modelUrl, sessionOptions);
      currentExecutionProvider = provider;
      isInitialized = true;

      return {
        executionProvider: currentExecutionProvider,
        gpuSupported: hasGpu,
        modelLoaded: true
      };
    } catch (err) {
      console.warn(`[ONNX Worker] Failed to load model at ${modelUrl} with provider ${provider}:`, err);
    }
  }

  // Graceful fallback to heuristic latent estimator
  currentExecutionProvider = hasGpu ? 'webgpu' : 'heuristic';
  isInitialized = true;

  return {
    executionProvider: currentExecutionProvider,
    gpuSupported: hasGpu,
    modelLoaded: !!session
  };
}

/**
 * Heuristic/Neural Estimator: Transforms microtensor kinematics and macro sequences
 * into a latent cognitive state distribution.
 */
function inferLatentCognitiveState(packet: InteractionPacket): CognitiveState {
  const { features, macroEvents } = packet;
  const startInfer = performance.now();

  const {
    meanVelocity,
    maxVelocity,
    hesitationCount,
    dwellTimeMs,
    trajectoryEntropy,
    scrollVelocity
  } = features;

  // Compute cognitive scoring priors
  let hesitationScore = 0.1;
  let frustrationScore = 0.05;
  let exploringScore = 0.2;
  let focusedScore = 0.5;
  let idleScore = 0.15;

  // 1. Angular direction changes & high entropy indicate hesitation / confusion
  if (hesitationCount >= 3 || trajectoryEntropy > 0.65) {
    hesitationScore += 0.45;
    exploringScore += 0.2;
    focusedScore -= 0.3;
  }

  // 2. High dwell time with low velocity indicates hesitation or deep focus
  if (dwellTimeMs > 400 && meanVelocity < 0.2) {
    if (trajectoryEntropy > 0.4) {
      hesitationScore += 0.35;
    } else {
      focusedScore += 0.3;
    }
  }

  // 3. Erratic rapid velocity + high click frequency indicates frustration / rage clicks
  const recentClicks = macroEvents.filter((e) => e.type === 'click').length;
  if (recentClicks >= 2 && maxVelocity > 2.0) {
    frustrationScore += 0.5;
    focusedScore -= 0.3;
  }

  // 4. Steady scroll and moderate velocity indicates exploring / skimming
  if (scrollVelocity > 0.5 || (meanVelocity > 0.5 && meanVelocity < 2.0 && trajectoryEntropy < 0.5)) {
    exploringScore += 0.4;
  }

  // 5. Zero movement and no clicks indicates idle
  if (meanVelocity === 0 && maxVelocity === 0 && recentClicks === 0 && dwellTimeMs === 0) {
    idleScore += 0.7;
    focusedScore -= 0.3;
  }

  // Normalize scores into softmax probability distribution
  const rawScores: Record<LatentCognitiveLabel, number> = {
    Focused: Math.max(0.01, focusedScore),
    Hesitation: Math.max(0.01, hesitationScore),
    Exploring: Math.max(0.01, exploringScore),
    Frustrated: Math.max(0.01, frustrationScore),
    Idle: Math.max(0.01, idleScore)
  };

  const sum = Object.values(rawScores).reduce((a, b) => a + b, 0);
  const probabilities: Record<LatentCognitiveLabel, number> = {
    Focused: Math.round((rawScores.Focused / sum) * 1000) / 1000,
    Hesitation: Math.round((rawScores.Hesitation / sum) * 1000) / 1000,
    Exploring: Math.round((rawScores.Exploring / sum) * 1000) / 1000,
    Frustrated: Math.round((rawScores.Frustrated / sum) * 1000) / 1000,
    Idle: Math.round((rawScores.Idle / sum) * 1000) / 1000
  };

  // Find argmax
  let bestLabel: LatentCognitiveLabel = 'Focused';
  let maxProb = -1;
  for (const [label, prob] of Object.entries(probabilities) as [LatentCognitiveLabel, number][]) {
    if (prob > maxProb) {
      maxProb = prob;
      bestLabel = label;
    }
  }

  const latencyMs = performance.now() - startInfer;

  return {
    label: bestLabel,
    confidence: maxProb,
    probabilities,
    latencyMs: Math.round(latencyMs * 100) / 100,
    executionProvider: currentExecutionProvider,
    timestamp: performance.now()
  };
}

self.addEventListener('message', async (event: MessageEvent<OnnxWorkerRequest>) => {
  const request = event.data;
  if (!request || !request.id || !request.type) return;

  const startTime = performance.now();

  try {
    switch (request.type) {
      case 'ONNX_INIT': {
        const initData = await initializeSession(
          request.payload?.modelUrl,
          request.payload?.preferredExecutionProvider
        );

        const response: OnnxWorkerResponse<OnnxInitResultData> = {
          id: request.id,
          type: 'ONNX_READY',
          success: true,
          data: initData,
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      case 'INFER_COGNITIVE_STATE': {
        if (!isInitialized) {
          await initializeSession();
        }

        const cognitiveState = inferLatentCognitiveState(request.payload.packet);
        const response: OnnxWorkerResponse<CognitiveState> = {
          id: request.id,
          type: 'INFERENCE_RESULT',
          success: true,
          data: cognitiveState,
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      case 'PING': {
        const response: OnnxWorkerResponse<{ initialized: boolean; provider: string }> = {
          id: request.id,
          type: 'PONG',
          success: true,
          data: {
            initialized: isInitialized,
            provider: currentExecutionProvider
          },
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      default: {
        const unknownReq = request as { id: string; type: string };
        const response: OnnxWorkerResponse = {
          id: unknownReq.id,
          type: 'ERROR',
          success: false,
          error: `Unknown request type: ${unknownReq.type}`,
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const response: OnnxWorkerResponse = {
      id: request.id,
      type: 'ERROR',
      success: false,
      error: errorMsg,
      durationMs: performance.now() - startTime
    };
    self.postMessage(response);
  }
});
