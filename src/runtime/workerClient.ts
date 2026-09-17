/**
 * Main-Thread RPC Client for the Edge-AUI Runtime Worker
 * Implements Stage 9.1 specifications from clipboard.9.md Sections 39, 40 & docs/plan/tasks/9.1.md.
 * 
 * Provides typed, asynchronous Promise-based messaging with transferable buffer support
 * and automatic fallback handling.
 */

import { MacroInteraction, MicroTensorWindow } from '../telemetry/events';
import { UIContext } from '../types/telemetry';
import { InferenceResult } from '../gates/arbitration';
import {
  RuntimeWorkerRequest,
  RuntimeWorkerResponse,
  RuntimeInitRequest,
  getTransferablesForRequest
} from './messages';
import { RuntimeWorkerCore } from './worker';

export interface RuntimeWorkerClientOptions {
  workerUrl?: URL | string;
  useFallback?: boolean;
}

export class RuntimeWorkerClient {
  private worker: Worker | null = null;
  private fallbackCore: RuntimeWorkerCore | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private isInitialized = false;

  constructor(options: RuntimeWorkerClientOptions = {}) {
    if (options.useFallback || typeof Worker === 'undefined') {
      this.fallbackCore = new RuntimeWorkerCore();
    } else {
      try {
        const url = options.workerUrl ?? new URL('./worker.ts', import.meta.url);
        this.worker = new Worker(url, { type: 'module' });

        this.worker.addEventListener('message', (event: MessageEvent<RuntimeWorkerResponse>) => {
          this.handleWorkerResponse(event.data);
        });

        this.worker.addEventListener('error', (err) => {
          console.error('[RuntimeWorkerClient] Worker thread error:', err);
        });
      } catch (err) {
        console.warn('[RuntimeWorkerClient] Worker instantiation failed; falling back to in-memory core:', err);
        this.fallbackCore = new RuntimeWorkerCore();
      }
    }
  }

  public async init(payload?: RuntimeInitRequest['payload']): Promise<void> {
    const res = await this.sendRequest<any>({
      id: this.nextId(),
      type: 'INIT',
      payload
    });
    this.isInitialized = true;
    return res;
  }

  public async pushWindow(
    window: MicroTensorWindow,
    transferBuffer = true
  ): Promise<{ windowCount: number; isFull: boolean }> {
    const req: RuntimeWorkerRequest = {
      id: this.nextId(),
      type: 'PUSH_WINDOW',
      payload: {
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        values: window.values
      }
    };
    return this.sendRequest(req, transferBuffer ? getTransferablesForRequest(req) : []);
  }

  public async pushMacro(macro: MacroInteraction): Promise<{ macroCount: number }> {
    return this.sendRequest({
      id: this.nextId(),
      type: 'PUSH_MACRO',
      payload: { macro }
    });
  }

  public async evaluate(
    uiContext: UIContext,
    macroSequence?: MacroInteraction[]
  ): Promise<InferenceResult> {
    return this.sendRequest({
      id: this.nextId(),
      type: 'EVALUATE',
      payload: {
        uiContext,
        macroSequence
      }
    });
  }

  public async reset(): Promise<void> {
    await this.sendRequest({
      id: this.nextId(),
      type: 'RESET'
    });
  }

  public async ping(): Promise<number> {
    const res = await this.sendRequest<{ timestamp: number }>({
      id: this.nextId(),
      type: 'PING'
    });
    return res.timestamp;
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  public terminate(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RuntimeWorkerClient terminated'));
    }
    this.pendingRequests.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.fallbackCore = null;
    this.isInitialized = false;
  }

  private nextId(): string {
    return `rt_req_${++this.requestIdCounter}_${Date.now()}`;
  }

  private sendRequest<T>(request: RuntimeWorkerRequest, transferables: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Direct in-memory dispatch if using fallback core
      if (this.fallbackCore) {
        this.fallbackCore
          .handleRequest(request)
          .then((response) => {
            if (response.success) {
              resolve((response as any).data);
            } else {
              reject(new Error(response.error ?? 'Unknown worker error'));
            }
          })
          .catch(reject);
        return;
      }

      if (!this.worker) {
        reject(new Error('Worker is not available or has been terminated'));
        return;
      }

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error(`Worker request ${request.type} timed out`));
        }
      }, 5000);

      this.pendingRequests.set(request.id, { resolve, reject, timer });

      if (transferables.length > 0) {
        this.worker.postMessage(request, transferables);
      } else {
        this.worker.postMessage(request);
      }
    });
  }

  private handleWorkerResponse(response: RuntimeWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timer);

    if (response.success) {
      pending.resolve((response as any).data);
    } else {
      pending.reject(new Error(response.error ?? 'Unknown worker error'));
    }
  }
}

export function createRuntimeWorkerClient(
  options?: RuntimeWorkerClientOptions
): RuntimeWorkerClient {
  return new RuntimeWorkerClient(options);
}
