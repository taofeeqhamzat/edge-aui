/**
 * Lightweight Debug Event Bus for Development Inspection
 * Implements Stage 10.2 decoupled telemetry broadcasting without external dependencies.
 */

export interface LiveDebugMetrics {
  sessionTimestamp?: number;
  latestMicroTensor?: number[];
  latestMacroSequence?: string[];
  fastGateStatus?: {
    matched: boolean;
    pattern?: string;
    confidence?: number;
  };
  slowGateStatus?: {
    called: boolean;
    outcome?: string;
    confidence?: number;
  };
  interventionStatus?: {
    type: string;
    source: string;
    confidence?: number;
    state: string;
  };
  inferenceLatencyMs?: number;
  featureLatencyMs?: number;
  workerStatus?: 'ready' | 'busy' | 'uninitialized' | 'error';
}

type DebugListener = (metrics: LiveDebugMetrics) => void;

class DebugBus {
  private metrics: LiveDebugMetrics = {
    workerStatus: 'uninitialized'
  };
  private listeners: Set<DebugListener> = new Set();

  public update(patch: Partial<LiveDebugMetrics>): void {
    this.metrics = {
      ...this.metrics,
      ...patch
    };
    this.notify();
  }

  public getSnapshot(): LiveDebugMetrics {
    return { ...this.metrics };
  }

  public subscribe(listener: DebugListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public reset(): void {
    this.metrics = {
      workerStatus: 'uninitialized'
    };
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[DebugBus] Error notifying listener:', err);
      }
    }
  }
}

export const debugBus = new DebugBus();
