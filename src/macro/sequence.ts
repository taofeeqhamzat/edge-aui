/**
 * Macro Interaction Stream & Sequential History
 * Implements Stage 6.2 specifications from clipboard.9.md Section 16 & docs/plan/tasks/6.2.md.
 * Manages bounded, rolling chronological history of semantic user actions for the Fast Gate PrefixSpan engine.
 */

import { BehaviourEvent, MacroInteraction } from '../telemetry/events';
import { experimentRecorder } from '../telemetry/recorder';
import { deriveMacroSymbol } from './symbols';

export type MacroInteractionListener = (interaction: MacroInteraction) => void;

export interface MacroInteractionStreamOptions {
  maxCapacity?: number; // default: 100
  autoRecordToTrace?: boolean; // default: true
}

export class MacroInteractionStream {
  private buffer: MacroInteraction[] = [];
  private readonly maxCapacity: number;
  private readonly autoRecordToTrace: boolean;
  private listeners: Set<MacroInteractionListener> = new Set();

  constructor(options: MacroInteractionStreamOptions = {}) {
    this.maxCapacity = options.maxCapacity ?? 100;
    this.autoRecordToTrace = options.autoRecordToTrace ?? true;
  }

  /**
   * Records a validated MacroInteraction token into the bounded history.
   */
  public record(interaction: MacroInteraction): void {
    this.buffer.push(interaction);

    if (this.buffer.length > this.maxCapacity) {
      this.buffer.shift();
    }

    if (this.autoRecordToTrace) {
      experimentRecorder.recordMacroInteraction(interaction);
    }

    this.emit(interaction);
  }

  /**
   * Attempts to derive a MacroInteraction from a canonical BehaviourEvent.
   * If derived, automatically records it to the stream and returns the token.
   */
  public recordFromBehaviourEvent(event: BehaviourEvent): MacroInteraction | null {
    const symbol = deriveMacroSymbol(event);
    if (!symbol) {
      return null;
    }

    const interaction: MacroInteraction = {
      timestamp: event.timestamp,
      symbol,
      componentId: event.componentId,
      action: event.action
    };

    this.record(interaction);
    return interaction;
  }

  /**
   * Returns up to k most recent MacroInteractions in chronological order.
   */
  public getRecent(k?: number): MacroInteraction[] {
    if (k === undefined || k >= this.buffer.length) {
      return [...this.buffer];
    }
    return this.buffer.slice(this.buffer.length - Math.max(0, k));
  }

  /**
   * Returns up to k most recent MacroSymbols as string array.
   */
  public getRecentSymbols(k?: number): string[] {
    return this.getRecent(k).map((i) => i.symbol);
  }

  /**
   * Formats the recent macro symbols into a pattern string for Fast Gate matching.
   * Example: "NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION"
   */
  public toPatternString(k?: number, separator = ' > '): string {
    return this.getRecentSymbols(k).join(separator);
  }

  /**
   * Subscribes a listener to emitted MacroInteractions.
   */
  public subscribe(listener: MacroInteractionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Clears the bounded macro interaction history.
   */
  public clear(): void {
    this.buffer = [];
  }

  /**
   * Returns the count of buffered macro interactions.
   */
  public get length(): number {
    return this.buffer.length;
  }

  private emit(interaction: MacroInteraction): void {
    for (const listener of this.listeners) {
      try {
        listener(interaction);
      } catch (err) {
        console.error('[MacroInteractionStream] Listener error:', err);
      }
    }
  }
}

/**
 * Singleton shared macro interaction stream instance.
 */
export const macroStream = new MacroInteractionStream();
