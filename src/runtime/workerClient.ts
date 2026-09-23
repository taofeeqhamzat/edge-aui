/**
 * Main-Thread RPC Client for the Edge-AUI Runtime Worker
 * Implements Stage 9.1 specifications from docs/testbed/prd.md Sections 39, 40 & docs/plan/tasks/9.1.md.
 * 
 * Provides typed, asynchronous Promise-based messaging with transferable buffer support
 * and automatic fallback handling.
 */

import { MacroInteraction, MicroTensorWindow } from '../telemetry/events';
import { UIContext } from '../types/uiContext.js';
import { InferenceResult } from '../gates/arbitration';
import {
  RuntimeWorkerRequest,
  RuntimeWorkerResponse,
  RuntimeInitRequest,
  RuntimeInitOkResponse,
  getTransferablesForRequest
} from './messages';
import type { RuntimeWorkerCore } from './worker/core';

/** Default round-trip timeout for worker requests. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/** INIT additionally loads and warms the ONNX graph, so it gets a larger budget. */
const INIT_TIMEOUT_MS = 60_000;

export interface RuntimeWorkerClientOptions {
  workerUrl?: URL | string;
  useFallback?: boolean;
}

export class RuntimeWorkerClient {
  private worker: Worker | null = null;
  private fallbackCore: RuntimeWorkerCore | null = null;
  /**
   * Lazily loaded in-process fallback.
   *
   * The fallback core transitively imports the ONNX Slow Gate and therefore the whole of
   * ONNX Runtime Web. Importing it statically pulled ~400 kB of inference code into the
   * main-thread bundle even when a real worker was doing the work, defeating the thread
   * isolation the architecture depends on. It is now loaded only when no worker can run.
   */
  private fallbackPromise: Promise<RuntimeWorkerCore> | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private isInitialized = false;

  constructor(options: RuntimeWorkerClientOptions = {}) {
    if (options.useFallback || typeof Worker === 'undefined') {
      void this.ensureFallbackCore();
    } else {
      try {
        // The URL literal must stay inline in the constructor call: that is the form Vite
        // statically analyses to bundle the worker. `options.workerUrl` remains available for
        // tests that supply their own worker.
        this.worker = options.workerUrl
          ? new Worker(options.workerUrl, { type: 'module' })
          : new Worker(new URL('./worker/entry.ts', import.meta.url), { type: 'module' });

        this.worker.addEventListener('message', (event: MessageEvent<RuntimeWorkerResponse>) => {
          this.handleWorkerResponse(event.data);
        });

        this.worker.addEventListener('error', (err) => {
          console.error('[RuntimeWorkerClient] Worker thread error:', err);
        });
      } catch (err) {
        console.warn('[RuntimeWorkerClient] Worker instantiation failed; falling back to in-memory core:', err);
        void this.ensureFallbackCore();
      }
    }
  }

  /**
   * Initialises the worker. A generous timeout is used because `INIT` compiles and warms
   * the ONNX graph, which legitimately takes longer than a normal round trip. The
   * previous 5 s default caused a silent downgrade to the in-process fallback gate.
   */
  public async init(
    payload?: RuntimeInitRequest['payload'],
    timeoutMs = INIT_TIMEOUT_MS
  ): Promise<RuntimeInitOkResponse['data']> {
    const res = await this.sendRequest<RuntimeInitOkResponse['data']>(
      {
        id: this.nextId(),
        type: 'INIT',
        payload
      },
      [],
      timeoutMs
    );
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
        windowId: window.windowId,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        values: window.values,
        eventCount: window.eventCount,
        inactive: window.inactive
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

  /** Runs the in-worker PrefixSpan miner, for diagnostics and tests. */
  public async minePatternsInWorker(
    sequences: string[][],
    minSupport = 1
  ): Promise<{ patterns: { pattern: string[]; support: number; confidence: number }[]; minerAvailable: boolean }> {
    return this.sendRequest({
      id: this.nextId(),
      type: 'MINE_PATTERNS',
      payload: { sequences, minSupport }
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

  /** True when this client is executing in-process instead of on a worker thread. */
  public usingFallback(): boolean {
    return this.fallbackCore !== null;
  }

  /**
   * Loads the in-process fallback core on demand.
   *
   * Note for benchmarks: when this path is active, inference is running synchronously on the
   * main thread, so latency measured through this client does not reflect worker execution.
   */
  private async ensureFallbackCore(): Promise<RuntimeWorkerCore> {
    if (this.fallbackCore) return this.fallbackCore;
    if (!this.fallbackPromise) {
      this.fallbackPromise = import('./worker/core').then((mod) => {
        const core = new mod.RuntimeWorkerCore();
        this.fallbackCore = core;
        return core;
      });
    }
    return this.fallbackPromise;
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
    this.fallbackPromise = null;
    this.isInitialized = false;
  }

  private nextId(): string {
    return `rt_req_${++this.requestIdCounter}_${Date.now()}`;
  }

  private sendRequest<T>(
    request: RuntimeWorkerRequest,
    transferables: Transferable[] = [],
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // In-process dispatch when a worker is unavailable. The first call may await the
      // lazy import of the fallback core.
      if (this.fallbackCore || (this.fallbackPromise && !this.worker)) {
        this.ensureFallbackCore()
          .then((core) => core.handleRequest(request))
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
          reject(new Error(`Worker request ${request.type} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

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
