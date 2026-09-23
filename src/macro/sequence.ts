/**
 * Macro Interaction Stream & Sequential History
 * Implements Stage 6.2 specifications from docs/testbed/prd.md Section 16 & docs/plan/tasks/6.2.md.
 * Manages bounded, rolling chronological history of semantic user actions for the Fast Gate PrefixSpan engine.
 */

import { BehaviourEvent, MacroInteraction, ExperimentalCondition } from '../telemetry/events';
import { experimentRecorder } from '../telemetry/recorder';
import { deriveMacroSymbol } from './symbols';

export type MacroInteractionListener = (interaction: MacroInteraction) => void;

export interface MacroInteractionStreamOptions {
  maxCapacity?: number; // default: 100
  autoRecordToTrace?: boolean; // default: true
}

/**
 * Correlation context stamped onto every macro interaction so a mined pattern can be
 * attributed to an experiment, condition, session and window (assessment §10.3).
 */
export interface MacroContext {
  sessionId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
}

export class MacroInteractionStream {
  private buffer: MacroInteraction[] = [];
  private readonly maxCapacity: number;
  private readonly autoRecordToTrace: boolean;
  private listeners: Set<MacroInteractionListener> = new Set();
  private context: MacroContext = {};
  private windowIdProvider: (() => number | undefined) | null = null;

  constructor(options: MacroInteractionStreamOptions = {}) {
    this.maxCapacity = options.maxCapacity ?? 100;
    this.autoRecordToTrace = options.autoRecordToTrace ?? true;
  }

  /** Sets the correlation context applied to subsequently recorded interactions. */
  public setContext(context: MacroContext): void {
    this.context = { ...context };
  }

  /**
   * Registers a provider for the most recently opened MicroTensor window id, so each
   * macro interaction is tied to the window during which it occurred.
   */
  public setWindowIdProvider(provider: () => number | undefined): void {
    this.windowIdProvider = provider;
  }

  /**
   * Records a validated MacroInteraction token into the bounded history.
   */
  public record(interaction: MacroInteraction): void {
    const enriched: MacroInteraction = {
      ...interaction,
      sessionId: interaction.sessionId ?? this.context.sessionId,
      experimentId: interaction.experimentId ?? this.context.experimentId,
      conditionId: interaction.conditionId ?? this.context.conditionId,
      windowId: interaction.windowId ?? this.windowIdProvider?.()
    };

    this.buffer.push(enriched);

    if (this.buffer.length > this.maxCapacity) {
      this.buffer.shift();
    }

    if (this.autoRecordToTrace) {
      experimentRecorder.recordMacroInteraction(enriched);
    }

    this.emit(enriched);
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
      action: event.action,
      route: event.route
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
