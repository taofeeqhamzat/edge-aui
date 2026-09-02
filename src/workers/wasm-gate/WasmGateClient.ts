/**
 * WasmGateClient: Main-thread RPC client for the WASM Deterministic Gate
 */

import type {
  InteractionPacket,
  MacroEvent,
  MicroTensor,
  PrefixSpanPattern,
  RawPointerPoint
} from '../../types/telemetry.js';

import type {
  WasmWorkerRequest,
  WasmWorkerResponse
} from '../../types/worker-messages.js';

export class WasmGateClient {
  private worker: Worker | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: number }
  >();
  private isReady = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.init();
  }

  public async init(): Promise<void> {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        if (typeof Worker === 'undefined') {
          console.warn('[WasmGateClient] Web Workers not supported in current environment.');
          resolve();
          return;
        }

        this.worker = new Worker(
          new URL('./wasm.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.addEventListener('message', (event: MessageEvent<WasmWorkerResponse>) => {
          this.handleWorkerMessage(event.data);
        });

        this.worker.addEventListener('error', (error) => {
          console.error('[WasmGateClient] Worker error:', error);
        });

        // Initialize WASM inside worker
        this.sendRequest<{ version: string }>({
          id: this.nextId(),
          type: 'WASM_INIT'
        })
          .then((res) => {
            this.isReady = true;
            console.log(`[WasmGateClient] WASM Gate ready: ${res?.version}`);
            resolve();
          })
          .catch((err) => {
            console.error('[WasmGateClient] Failed to initialize WASM in worker:', err);
            reject(err);
          });
      } catch (err) {
        console.error('[WasmGateClient] Failed to create worker:', err);
        reject(err);
      }
    });

    return this.initPromise;
  }

  private nextId(): string {
    return `wasm_req_${++this.requestIdCounter}_${Date.now()}`;
  }

  private sendRequest<T>(request: WasmWorkerRequest, timeoutMs = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('WASM Worker is not initialized'));
        return;
      }

      const timer = window.setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error(`WASM request ${request.type} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(request.id, { resolve, reject, timer });
      this.worker.postMessage(request);
    });
  }

  private handleWorkerMessage(response: WasmWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);
    window.clearTimeout(pending.timer);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      pending.reject(new Error(response.error ?? 'Unknown worker error'));
    }
  }

  /**
   * Fast Brain: Vectorizes raw pointer coordinates into dense MicroTensor.
   */
  public async extractMicroTensor(
    points: RawPointerPoint[],
    dwellTimeMs: number,
    scrollDepthPercentage: number,
    scrollVelocity: number,
    timestamp: number = performance.now()
  ): Promise<MicroTensor> {
    await this.init();
    return this.sendRequest<MicroTensor>({
      id: this.nextId(),
      type: 'EXTRACT_MICRO_TENSOR',
      payload: {
        points,
        dwellTimeMs,
        scrollDepthPercentage,
        scrollVelocity,
        timestamp
      }
    });
  }

  /**
   * Processes a complete 500ms interaction batch into an InteractionPacket.
   */
  public async processInteractionBatch(
    sessionId: string,
    windowDurationMs: number,
    points: RawPointerPoint[],
    macroEvents: MacroEvent[],
    dwellTimeMs: number,
    scrollDepthPercentage: number,
    scrollVelocity: number,
    timestamp: number = performance.now()
  ): Promise<InteractionPacket> {
    await this.init();
    return this.sendRequest<InteractionPacket>({
      id: this.nextId(),
      type: 'PROCESS_INTERACTION_BATCH',
      payload: {
        sessionId,
        windowDurationMs,
        points,
        macroEvents,
        dwellTimeMs,
        scrollDepthPercentage,
        scrollVelocity,
        timestamp
      }
    });
  }

  /**
   * Deterministic Gate: Mines frequent macro patterns via PrefixSpan.
   */
  public async minePatterns(
    sequences: string[][],
    minSupport: number = 2
  ): Promise<PrefixSpanPattern[]> {
    await this.init();
    return this.sendRequest<PrefixSpanPattern[]>({
      id: this.nextId(),
      type: 'MINE_PATTERNS',
      payload: {
        sequences,
        minSupport
      }
    });
  }

  public destroy(): void {
    for (const [, req] of this.pendingRequests) {
      window.clearTimeout(req.timer);
      req.reject(new Error('WasmGateClient destroyed'));
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
