/**
 * WASM Worker (Deterministic Gate / Fast Brain)
 * Executes Rust-compiled WebAssembly for zero-jank vectorization and PrefixSpan pattern mining.
 */

import initWasm, {
  get_wasm_gate_version,
  extract_micro_tensor,
  process_interaction_batch,
  mine_macro_patterns
} from '../../../wasm-vectorizer/pkg/wasm_vectorizer.js';

import type {
  WasmWorkerRequest,
  WasmWorkerResponse
} from '../../types/worker-messages.js';

let isWasmInitialized = false;
let initPromise: Promise<void> | null = null;

async function ensureWasmInitialized(): Promise<void> {
  if (isWasmInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      await initWasm();
      isWasmInitialized = true;
    })();
  }
  return initPromise;
}

self.addEventListener('message', async (event: MessageEvent<WasmWorkerRequest>) => {
  const request = event.data;
  if (!request || !request.id || !request.type) return;

  const startTime = performance.now();

  try {
    switch (request.type) {
      case 'WASM_INIT': {
        await ensureWasmInitialized();
        const version = get_wasm_gate_version();
        const response: WasmWorkerResponse<{ version: string }> = {
          id: request.id,
          type: 'WASM_READY',
          success: true,
          data: { version },
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      case 'EXTRACT_MICRO_TENSOR': {
        await ensureWasmInitialized();
        const { points, dwellTimeMs, scrollDepthPercentage, scrollVelocity, timestamp } = request.payload;
        const tensor = extract_micro_tensor(
          points,
          dwellTimeMs,
          scrollDepthPercentage,
          scrollVelocity,
          timestamp
        );
        const response: WasmWorkerResponse = {
          id: request.id,
          type: 'MICRO_TENSOR_RESULT',
          success: true,
          data: tensor,
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      case 'PROCESS_INTERACTION_BATCH': {
        await ensureWasmInitialized();
        const {
          sessionId,
          windowDurationMs,
          points,
          macroEvents,
          dwellTimeMs,
          scrollDepthPercentage,
          scrollVelocity,
          timestamp
        } = request.payload;

        const packet = process_interaction_batch(
          sessionId,
          windowDurationMs,
          points,
          macroEvents,
          dwellTimeMs,
          scrollDepthPercentage,
          scrollVelocity,
          timestamp
        );

        const response: WasmWorkerResponse = {
          id: request.id,
          type: 'INTERACTION_PACKET_RESULT',
          success: true,
          data: packet,
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      case 'MINE_PATTERNS': {
        await ensureWasmInitialized();
        const { sequences, minSupport } = request.payload;
        const patterns = mine_macro_patterns(sequences, minSupport);

        const response: WasmWorkerResponse = {
          id: request.id,
          type: 'PATTERNS_RESULT',
          success: true,
          data: patterns,
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      case 'PING': {
        const response: WasmWorkerResponse<{ initialized: boolean }> = {
          id: request.id,
          type: 'PONG',
          success: true,
          data: { initialized: isWasmInitialized },
          durationMs: performance.now() - startTime
        };
        self.postMessage(response);
        break;
      }

      default: {
        const unknownReq = request as { id: string; type: string };
        const response: WasmWorkerResponse = {
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
    const response: WasmWorkerResponse = {
      id: request.id,
      type: 'ERROR',
      success: false,
      error: errorMsg,
      durationMs: performance.now() - startTime
    };
    self.postMessage(response);
  }
});
