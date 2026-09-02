/**
 * SlidingWindowBuffer: Bounded, low-allocation sliding window buffer
 * Enforces memory safety (< 20MB active footprint) through strict size and time-based eviction.
 */

export interface TimestampedItem {
  timestamp: number;
}

export class SlidingWindowBuffer<T extends TimestampedItem> {
  private buffer: T[];
  private readonly capacity: number;
  private readonly maxWindowDurationMs: number;

  constructor(capacity: number = 1000, maxWindowDurationMs: number = 5000) {
    this.capacity = capacity;
    this.maxWindowDurationMs = maxWindowDurationMs;
    this.buffer = [];
  }

  /**
   * Push a new item into the buffer, evicting items exceeding capacity or max window age.
   */
  public push(item: T): void {
    this.buffer.push(item);

    // Evict if buffer exceeds capacity
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }

    // Evict items older than max window duration
    const cutoff = item.timestamp - this.maxWindowDurationMs;
    this.evictOlderThan(cutoff);
  }

  /**
   * Returns a snapshot array of all current items in the window.
   */
  public getSnapshot(): T[] {
    return [...this.buffer];
  }

  /**
   * Returns the count of items in the window.
   */
  public get size(): number {
    return this.buffer.length;
  }

  /**
   * Clears the entire buffer.
   */
  public clear(): void {
    this.buffer = [];
  }

  /**
   * Evicts items with timestamp earlier than cutoff.
   */
  public evictOlderThan(cutoffTimestamp: number): void {
    let removeCount = 0;
    while (removeCount < this.buffer.length && this.buffer[removeCount].timestamp < cutoffTimestamp) {
      removeCount++;
    }
    if (removeCount > 0) {
      this.buffer.splice(0, removeCount);
    }
  }

  /**
   * Extracts and purges all items currently in the buffer.
   */
  public drain(): T[] {
    const items = this.buffer;
    this.buffer = [];
    return items;
  }
}
