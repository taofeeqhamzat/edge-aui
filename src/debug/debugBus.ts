/**
 * Lightweight Debug Event Bus for Development Inspection
 * Implements Stage 10.2 decoupled telemetry broadcasting without external dependencies.
 */

import { StageTimingStats } from '../runtime/instrumentation';

export interface LiveDebugMetrics {
  sessionTimestamp?: number;
  latestMicroTensor?: number[];
  latestMacroSequence?: string[];
  /** True when the currently displayed MicroTensor came from an inactivity window. */
  latestWindowInactive?: boolean;
  /** Event count of the currently displayed MicroTensor window. */
  latestWindowEventCount?: number;
  fastGateStatus?: {
    matched: boolean;
    pattern?: string;
    confidence?: number;
  };
  /** Number of window-tagged macro sequences available to the PrefixSpan miner. */
  fastGateCorpusSize?: number;
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
  /** Which gate actually produced the current decision. */
  matchedGate?: 'fast' | 'slow' | 'none';
  /** Generative mechanism behind the current candidate (ADR-006 / Task 5.3). */
  mappingSource?: string;
  /**
   * Explicit decision state, so the panel never requires the observer to infer
   * "why nothing happened" from an absence of information (F-08).
   */
  policyState?:
    | 'NO PREDICTION'
    | 'FAST MATCH'
    | 'SLOW GATE'
    | 'BELOW THRESHOLD'
    | 'POLICY ACCEPTED'
    | 'POLICY ACCEPTED (BASELINE — NOT APPLIED)'
    | 'POLICY REJECTED'
    | 'ACTUATED'
    | 'EXPIRED'
    | 'DISMISSED'
    | 'ACTUATION FAILED';
  /** Human-readable reason behind the current policy decision. */
  policyReason?: string;
  /** Cooldown remaining in milliseconds at the last decision. */
  policyCooldownRemainingMs?: number;
  /** Consecutive-window persistence count at the last decision. */
  candidateCount?: number;
  /** Episode id of the intervention currently visible in the interface. */
  activeEpisodeId?: string;
  /** Adaptation type currently visible in the interface. */
  activeIntervention?: string;
  /** Declared lifetime of the active adaptation, in milliseconds. */
  activeInterventionTtlMs?: number;
  /** Remaining lifetime of the active adaptation at the time of the last update. */
  activeInterventionExpiresInMs?: number;
  /** Window whose closing state was most recently evaluated. */
  latestWindowId?: number;
  /** Stable id of the most recent prediction, for trace↔panel correlation. */
  latestPredictionId?: string;
  modelVersion?: string;
  inferenceLatencyMs?: number;
  /**
   * Duration of the whole evaluate-and-act cycle. Previously mislabelled
   * `featureLatencyMs`, which implied feature-extraction time it never measured (F-08).
   */
  evaluationCycleLatencyMs?: number;
  workerStatus?: 'ready' | 'busy' | 'uninitialized' | 'error';
  /** Which Slow Gate implementation is active. */
  slowGateMode?: 'mock' | 'onnx';
  /** Execution provider that actually served the model session. */
  executionProvider?: string;
  /** Whether a model graph was successfully loaded. */
  modelLoaded?: boolean;
  /** Counters published by the runtime composition. */
  runtimeCounters?: Record<string, number>;
  /** Bounded Fast Gate execution counters (F-02). */
  miningCounters?: Record<string, number>;
  /** Per-buffer record counts currently held in memory. */
  recorderCounts?: Record<string, number>;
  /** Records discarded by buffer eviction, proving truncation is not silent (F-16). */
  evictedRecords?: number;
  /** Collection/persistence state of the research trace. */
  collectionState?: string;
  /** Detail behind the collection state, for the researcher panel. */
  collectionDetail?: {
    configured: boolean;
    durable: boolean;
    mode: string;
    uploadAttempts: number;
    lastError?: string;
    recoverableSessionId?: string;
    recoverableReason?: string;
  };
  /** Stage timing aggregates by stage and thread side. */
  stageTimings?: Record<string, StageTimingStats>;
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
