/**
 * Edge-AUI Framework: Unified Capture-Transform-React Pipeline
 * Orchestrates Main-Thread Telemetry, WASM Deterministic Gate, and ONNX Probabilistic Gate.
 */

import { ClientBehaviorTracker } from './telemetry/ClientBehaviorTracker.js';
import { WasmGateClient } from '../workers/wasm-gate/WasmGateClient.js';
import { OnnxGateClient } from '../workers/onnx-gate/OnnxGateClient.js';

import type {
  CognitiveState,
  InteractionPacket,
  PrefixSpanPattern,
  UIRecommendation
} from '../types/telemetry.js';

export interface FrameworkConfig {
  sessionId?: string;
  bufferWindowMs?: number;
  trackableSelector?: string;
  onnxModelUrl?: string;
  preferredExecutionProvider?: 'webgpu' | 'wasm' | 'cpu';
  minPatternSupport?: number;
  hesitationConfidenceThreshold?: number;
}

export type RecommendationListener = (recommendation: UIRecommendation) => void;
export type PacketListener = (packet: InteractionPacket) => void;
export type StateListener = (state: CognitiveState) => void;

export class EdgeAUIFramework {
  private tracker: ClientBehaviorTracker | null = null;
  private wasmGate: WasmGateClient;
  private onnxGate: OnnxGateClient;
  private config: Required<FrameworkConfig>;

  private historicalMacroSequences: string[][] = [];
  private recommendationListeners: Set<RecommendationListener> = new Set();
  private packetListeners: Set<PacketListener> = new Set();
  private stateListeners: Set<StateListener> = new Set();

  private isRunning = false;

  constructor(config: FrameworkConfig = {}) {
    this.config = {
      sessionId: config.sessionId ?? `sess_${Math.random().toString(36).substring(2, 10)}`,
      bufferWindowMs: config.bufferWindowMs ?? 500,
      trackableSelector: config.trackableSelector ?? '[data-trackable]',
      onnxModelUrl: config.onnxModelUrl ?? '',
      preferredExecutionProvider: config.preferredExecutionProvider ?? 'webgpu',
      minPatternSupport: config.minPatternSupport ?? 2,
      hesitationConfidenceThreshold: config.hesitationConfidenceThreshold ?? 0.4
    };

    this.wasmGate = new WasmGateClient();
    this.onnxGate = new OnnxGateClient();
  }

  /**
   * Initializes the dual-gate engine (WASM & ONNX Web Workers).
   */
  public async init(): Promise<void> {
    await Promise.all([
      this.wasmGate.init(),
      this.onnxGate.init(this.config.onnxModelUrl, this.config.preferredExecutionProvider)
    ]);
  }

  /**
   * Starts the Capture-Transform-React pipeline.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.tracker = new ClientBehaviorTracker({
      sessionId: this.config.sessionId,
      bufferWindowMs: this.config.bufferWindowMs,
      trackableSelector: this.config.trackableSelector,
      onFlush: (packet) => this.handleWindowFlush(packet)
    });
  }

  /**
   * Processes each 500ms sliding window packet through the dual-gate architecture.
   */
  private async handleWindowFlush(packet: InteractionPacket): Promise<void> {
    try {
      // 1. Notify raw packet listeners
      for (const listener of this.packetListeners) {
        listener(packet);
      }

      // Record macro interaction sequence if present
      if (packet.macroEvents.length > 0) {
        const sequence = packet.macroEvents.map((e) => `${e.type}:${e.targetId}`);
        this.historicalMacroSequences.push(sequence);
        // Keep memory bounded to last 100 interaction sequences (<20MB constraint)
        if (this.historicalMacroSequences.length > 100) {
          this.historicalMacroSequences.shift();
        }
      }

      // 2. Slow Brain: Infer latent cognitive state
      const cognitiveState = await this.onnxGate.inferCognitiveState(packet);

      for (const listener of this.stateListeners) {
        listener(cognitiveState);
      }

      // 3. React Phase: Evaluate adaptive recommendation triggers
      await this.evaluateAdaptiveTrigger(packet, cognitiveState);
    } catch (err) {
      console.error('[EdgeAUIFramework] Pipeline transformation error:', err);
    }
  }

  /**
   * Evaluates cognitive state and sequential patterns to synthesize UI recommendations.
   */
  private async evaluateAdaptiveTrigger(
    packet: InteractionPacket,
    cognitiveState: CognitiveState
  ): Promise<void> {
    const lastMacro = packet.macroEvents[packet.macroEvents.length - 1];
    const targetElementId = lastMacro?.targetId || 'unknown_context';

    let action: UIRecommendation['action'] = 'none';
    let reason = '';

    // Fast Brain + Slow Brain Fusion
    if (
      cognitiveState.label === 'Hesitation' &&
      cognitiveState.confidence >= this.config.hesitationConfidenceThreshold
    ) {
      action = 'simplify_options';
      reason = `User hesitating (confidence: ${Math.round(cognitiveState.confidence * 100)}%, trajectory entropy: ${packet.features.trajectoryEntropy}, hesitation count: ${packet.features.hesitationCount})`;
    } else if (cognitiveState.label === 'Frustrated') {
      action = 'offer_assistance';
      reason = `Frustration detected (rapid velocity: ${packet.features.maxVelocity} px/ms, dwell: ${packet.features.dwellTimeMs}ms)`;
    } else if (cognitiveState.label === 'Exploring' && packet.features.dwellTimeMs > 400) {
      action = 'expand_tooltip';
      reason = `Sustained exploration over trackable component (${packet.features.dwellTimeMs}ms dwell time)`;
    }

    if (action !== 'none') {
      let matchedPattern: PrefixSpanPattern | undefined;

      // Check PrefixSpan patterns if we have enough sequences
      if (this.historicalMacroSequences.length >= this.config.minPatternSupport) {
        try {
          const patterns = await this.wasmGate.minePatterns(
            this.historicalMacroSequences,
            this.config.minPatternSupport
          );
          if (patterns.length > 0) {
            matchedPattern = patterns[0];
          }
        } catch (err) {
          console.warn('[EdgeAUIFramework] Pattern mining non-critical failure:', err);
        }
      }

      const recommendation: UIRecommendation = {
        id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        targetElementId,
        action,
        reason,
        cognitiveState,
        matchedPattern,
        timestamp: performance.now()
      };

      for (const listener of this.recommendationListeners) {
        listener(recommendation);
      }
    }
  }

  /**
   * Deterministic Gate: Mines frequent macro interaction sequences on demand.
   */
  public async minePatterns(minSupport?: number): Promise<PrefixSpanPattern[]> {
    return this.wasmGate.minePatterns(
      this.historicalMacroSequences,
      minSupport ?? this.config.minPatternSupport
    );
  }

  /**
   * Adds listener for adaptive UI recommendations.
   */
  public onRecommendation(listener: RecommendationListener): () => void {
    this.recommendationListeners.add(listener);
    return () => this.recommendationListeners.delete(listener);
  }

  /**
   * Adds listener for 500ms interaction packets.
   */
  public onPacket(listener: PacketListener): () => void {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }

  /**
   * Adds listener for inferred cognitive states.
   */
  public onCognitiveState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.tracker?.stop();
  }

  public destroy(): void {
    this.stop();
    this.tracker?.destroy();
    this.tracker = null;
    this.wasmGate.destroy();
    this.onnxGate.destroy();
    this.recommendationListeners.clear();
    this.packetListeners.clear();
    this.stateListeners.clear();
    this.historicalMacroSequences = [];
  }
}
