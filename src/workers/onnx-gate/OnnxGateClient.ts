/**
 * OnnxGateClient: Main-thread RPC client for the ONNX Probabilistic Gate (Slow Brain)
 */

import type { CognitiveState, InteractionPacket } from '../../types/telemetry.js';
import type {
  OnnxInitResultData,
  OnnxWorkerRequest,
  OnnxWorkerResponse
} from '../../types/worker-messages.js';

export class OnnxGateClient {
  private worker: Worker | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: number }
  >();
  private isReady = false;
  private initPromise: Promise<OnnxInitResultData> | null = null;

  constructor() {
    this.init();
  }

  public async init(modelUrl?: string, preferredProvider?: 'webgpu' | 'wasm' | 'cpu'): Promise<OnnxInitResultData> {
    if (this.isReady && this.initPromise) return this.initPromise;

    this.initPromise = new Promise<OnnxInitResultData>((resolve, reject) => {
      try {
        if (typeof Worker === 'undefined') {
          console.warn('[OnnxGateClient] Web Workers not supported in current environment.');
          resolve({
            executionProvider: 'heuristic',
            gpuSupported: false,
            modelLoaded: false
          });
          return;
        }

        this.worker = new Worker(
          new URL('./onnx.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.addEventListener('message', (event: MessageEvent<OnnxWorkerResponse>) => {
          this.handleWorkerMessage(event.data);
        });

        this.worker.addEventListener('error', (error) => {
          console.error('[OnnxGateClient] Worker error:', error);
        });

        // Initialize ONNX runtime in worker
        this.sendRequest<OnnxInitResultData>({
          id: this.nextId(),
          type: 'ONNX_INIT',
          payload: {
            modelUrl,
            preferredExecutionProvider: preferredProvider
          }
        })
          .then((res) => {
            this.isReady = true;
            console.log(`[OnnxGateClient] ONNX Gate ready with provider: ${res?.executionProvider} (GPU: ${res?.gpuSupported})`);
            resolve(res);
          })
          .catch((err) => {
            console.error('[OnnxGateClient] Failed to initialize ONNX in worker:', err);
            reject(err);
          });
      } catch (err) {
        console.error('[OnnxGateClient] Failed to create ONNX worker:', err);
        reject(err);
      }
    });

    return this.initPromise;
  }

  private nextId(): string {
    return `onnx_req_${++this.requestIdCounter}_${Date.now()}`;
  }

  private sendRequest<T>(request: OnnxWorkerRequest, timeoutMs = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('ONNX Worker is not initialized'));
        return;
      }

      const timer = window.setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error(`ONNX request ${request.type} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(request.id, { resolve, reject, timer });
      this.worker.postMessage(request);
    });
  }

  private handleWorkerMessage(response: OnnxWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);
    window.clearTimeout(pending.timer);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      pending.reject(new Error(response.error ?? 'Unknown ONNX worker error'));
    }
  }

  /**
   * Slow Brain: Infer latent cognitive state from interaction packet.
   */
  public async inferCognitiveState(packet: InteractionPacket): Promise<CognitiveState> {
    await this.init();
    return this.sendRequest<CognitiveState>({
      id: this.nextId(),
      type: 'INFER_COGNITIVE_STATE',
      payload: { packet }
    });
  }

  public destroy(): void {
    for (const [, req] of this.pendingRequests) {
      window.clearTimeout(req.timer);
      req.reject(new Error('OnnxGateClient destroyed'));
    }
    this.pendingRequests.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.initPromise = null;
  }
}
