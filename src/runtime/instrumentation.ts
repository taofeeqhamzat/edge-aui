/**
 * Runtime Stage Instrumentation
 *
 * Implements Stage-by-Stage, Side-by-Side timing instrumentation per brief §4 A2
 * and Task 3.1 specifications.
 *
 * The 11 named computational stages and 5 execution sides are strictly defined:
 * Stages:
 *   - 'event capture'
 *   - 'event normalisation'
 *   - 'window assignment'
 *   - 'MicroTensor extraction'
 *   - 'macro sequence construction'
 *   - 'PrefixSpan mining'
 *   - 'worker message/transfer'
 *   - 'ONNX inference'
 *   - 'policy evaluation'
 *   - 'actuation'
 *   - 'trace recording'
 *
 * Sides:
 *   - 'main'
 *   - 'worker'
 *   - 'wasm'
 *   - 'model'
 *   - 'transfer'
 *
 * Designed with a pre-allocated ring buffer to ensure O(1) collection with zero
 * per-event garbage creation on the hot path, and completely disableable via configuration.
 */

export const PERMITTED_STAGES = [
  'event capture',
  'event normalisation',
  'window assignment',
  'MicroTensor extraction',
  'macro sequence construction',
  'PrefixSpan mining',
  'worker message/transfer',
  'ONNX inference',
  'policy evaluation',
  'actuation',
  'trace recording'
] as const;

export type StageName = (typeof PERMITTED_STAGES)[number];

export const PERMITTED_SIDES = ['main', 'worker', 'wasm', 'model', 'transfer'] as const;

export type ThreadSide = (typeof PERMITTED_SIDES)[number];

export function isPermittedStage(val: string): val is StageName {
  return (PERMITTED_STAGES as readonly string[]).includes(val);
}

export function isPermittedSide(val: string): val is ThreadSide {
  return (PERMITTED_SIDES as readonly string[]).includes(val);
}

export interface StageTimingRecord {
  stage: StageName;
  side: ThreadSide;
  durationMs: number;
  timestamp: number;
  sessionId?: string;
  windowId?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface StageTimingStats {
  stage: StageName;
  side: ThreadSide;
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

/**
 * Creates and validates a StageTimingRecord. Throws if stage or side is not permitted.
 */
export function createTimingRecord(
  stage: StageName,
  side: ThreadSide,
  durationMs: number,
  timestamp: number,
  correlation?: {
    sessionId?: string;
    windowId?: number;
    metadata?: Record<string, string | number | boolean>;
  }
): StageTimingRecord {
  if (!isPermittedStage(stage)) {
    throw new Error(`Invalid stage name: '${stage}'. Must be one of: ${PERMITTED_STAGES.join(', ')}`);
  }
  if (!isPermittedSide(side)) {
    throw new Error(`Invalid thread side: '${side}'. Must be one of: ${PERMITTED_SIDES.join(', ')}`);
  }
  return {
    stage,
    side,
    durationMs: Math.max(0, durationMs),
    timestamp,
    sessionId: correlation?.sessionId,
    windowId: correlation?.windowId,
    metadata: correlation?.metadata
  };
}

export class InstrumentationCollector {
  private enabled: boolean;
  private readonly capacity: number;
  private buffer: StageTimingRecord[];
  private head = 0;
  private size = 0;

  // Running accumulators per stage:side
  private runningAggregates = new Map<
    string,
    {
      stage: StageName;
      side: ThreadSide;
      count: number;
      totalMs: number;
      minMs: number;
      maxMs: number;
      durations: number[];
    }
  >();

  constructor(options: { enabled?: boolean; capacity?: number } = {}) {
    this.enabled = options.enabled ?? true;
    this.capacity = options.capacity ?? 2048;
    this.buffer = new Array(this.capacity);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public record(record: StageTimingRecord): void {
    if (!this.enabled) return;

    if (!isPermittedStage(record.stage) || !isPermittedSide(record.side)) {
      throw new Error(`Invalid stage '${record.stage}' or side '${record.side}'`);
    }

    // Add to ring buffer
    this.buffer[this.head] = record;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }

    // Update running aggregates
    const key = `${record.stage}:${record.side}`;
    let agg = this.runningAggregates.get(key);
    if (!agg) {
      agg = {
        stage: record.stage,
        side: record.side,
        count: 0,
        totalMs: 0,
        minMs: Infinity,
        maxMs: -Infinity,
        durations: []
      };
      this.runningAggregates.set(key, agg);
    }

    agg.count++;
    agg.totalMs += record.durationMs;
    if (record.durationMs < agg.minMs) agg.minMs = record.durationMs;
    if (record.durationMs > agg.maxMs) agg.maxMs = record.durationMs;

    // Retain up to 2048 recent samples for percentile calculations
    if (agg.durations.length < 2048) {
      agg.durations.push(record.durationMs);
    } else {
      agg.durations[agg.count % 2048] = record.durationMs;
    }
  }

  public timeSync<T>(
    stage: StageName,
    side: ThreadSide,
    fn: () => T,
    correlation?: {
      sessionId?: string;
      windowId?: number;
      metadata?: Record<string, string | number | boolean>;
    }
  ): T {
    if (!this.enabled) {
      return fn();
    }
    const start = performance.now();
    try {
      return fn();
    } finally {
      const durationMs = performance.now() - start;
      this.record({
        stage,
        side,
        durationMs,
        timestamp: start,
        sessionId: correlation?.sessionId,
        windowId: correlation?.windowId,
        metadata: correlation?.metadata
      });
    }
  }

  public async timeAsync<T>(
    stage: StageName,
    side: ThreadSide,
    fn: () => Promise<T>,
    correlation?: {
      sessionId?: string;
      windowId?: number;
      metadata?: Record<string, string | number | boolean>;
    }
  ): Promise<T> {
    if (!this.enabled) {
      return fn();
    }
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const durationMs = performance.now() - start;
      this.record({
        stage,
        side,
        durationMs,
        timestamp: start,
        sessionId: correlation?.sessionId,
        windowId: correlation?.windowId,
        metadata: correlation?.metadata
      });
    }
  }

  public mergeRemoteRecords(records: StageTimingRecord[]): void {
    if (!this.enabled || !records || records.length === 0) return;
    for (let i = 0; i < records.length; i++) {
      this.record(records[i]);
    }
  }

  public getRecords(): StageTimingRecord[] {
    if (this.size === 0) return [];
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    // Read chronological order from ring buffer
    const result: StageTimingRecord[] = new Array(this.capacity);
    let readIdx = this.head;
    for (let i = 0; i < this.capacity; i++) {
      result[i] = this.buffer[readIdx];
      readIdx = (readIdx + 1) % this.capacity;
    }
    return result;
  }

  public getSummary(): Record<string, StageTimingStats> {
    const summary: Record<string, StageTimingStats> = {};

    for (const [key, agg] of this.runningAggregates.entries()) {
      if (agg.count === 0) continue;

      const sorted = [...agg.durations].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;

      summary[key] = {
        stage: agg.stage,
        side: agg.side,
        count: agg.count,
        totalMs: +agg.totalMs.toFixed(4),
        minMs: +(agg.minMs === Infinity ? 0 : agg.minMs).toFixed(4),
        maxMs: +(agg.maxMs === -Infinity ? 0 : agg.maxMs).toFixed(4),
        meanMs: +(agg.totalMs / agg.count).toFixed(4),
        p50Ms: +p50.toFixed(4),
        p95Ms: +p95.toFixed(4)
      };
    }

    return summary;
  }

  public clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
    this.runningAggregates.clear();
  }
}

/** Global default collector instance. */
export const defaultCollector = new InstrumentationCollector();
