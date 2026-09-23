/**
 * Edge-AUI Dedicated Web Worker
 * Implements Stage 9.1 specifications from docs/testbed/prd.md Sections 39, 40 & docs/plan/tasks/9.1.md.
 * 
 * Thread Isolation & Invariants:
 * - Operates in dedicated background worker thread with ZERO DOM access.
 * - Encapsulates MicroTensor window ingestion, SequenceBuilder (T=8), Fast Gate, and Slow Gate.
 * - Eliminates main-thread blocking by processing transferable Float32Array buffers.
 * - Emits declarative InterventionCommands back to the main thread for UIActuator application.
 */

import { SequenceBuilder } from '../../microtensor/sequence';
import { MicroTensorWindow, MacroInteraction } from '../../telemetry/events';
import {
  AdaptiveInferenceEngine,
  createAdaptiveInferenceEngine,
  InferenceResult
} from '../../gates/arbitration';
import { FastGate } from '../../gates/fast/types';
import { MockFastGate, PatternIntervention } from '../../gates/fast/mockFastGate';
import { PrefixSpanFastGate } from '../../gates/fast/prefixSpanFastGate';
import { MockSlowGate } from '../../gates/slow/mockSlowGate';
import { OnnxSlowGate, resetOnnxSlowGateSession } from '../../gates/slow/onnxSlowGate';
import { SlowGate } from '../../gates/slow/types';
import {
  RuntimeWorkerRequest,
  RuntimeWorkerResponse,
  RUNTIME_WORKER_VERSION,
  FastGateMode,
  SlowGateMode
} from '../messages';

export class RuntimeWorkerCore {
  private sequenceBuilder: SequenceBuilder;
  private inferenceEngine: AdaptiveInferenceEngine;
  private macroHistory: MacroInteraction[] = [];
  private options: { modelUrl?: string; minOutcomeConfidence?: number } | null = null;

  private fastGateMode: FastGateMode = 'mock';
  private slowGateMode: SlowGateMode = 'mock';
  private fastGatePatterns: Record<string, PatternIntervention> = {};
  private minPatternSupport = 2;
  private minPatternConfidence = 0;
  private executionProvider = 'none';
  private modelLoaded = false;

  constructor() {
    this.sequenceBuilder = new SequenceBuilder();
    this.inferenceEngine = createAdaptiveInferenceEngine({
      fastGate: this.createFastGate(),
      slowGate: new MockSlowGate()
    });
  }

  /**
   * Builds the configured Slow Gate.
   *
   * In `onnx` mode the real INT8 GRU graph is loaded and warmed up eagerly, so a model
   * that cannot be executed surfaces at initialisation rather than silently degrading
   * to a heuristic at inference time (assessment §19.1).
   */
  private async createSlowGate(): Promise<{ gate: SlowGate; provider: string; modelLoaded: boolean }> {
    if (this.slowGateMode !== 'onnx') {
      return { gate: new MockSlowGate(), provider: 'mock', modelLoaded: false };
    }

    const gate = new OnnxSlowGate({
      modelUrl: this.options?.modelUrl,
      confidenceThreshold: this.options?.minOutcomeConfidence
    });

    try {
      const warm = await gate.warmup();
      return { gate, provider: warm.executionProvider, modelLoaded: warm.modelLoaded };
    } catch (err) {
      console.error('[RuntimeWorkerCore] ONNX Slow Gate unavailable:', err);
      return { gate: new MockSlowGate(), provider: 'unavailable', modelLoaded: false };
    }
  }

  /**
   * Builds the configured Fast Gate.
   *
   * In `prefixspan` mode this returns the real miner-backed gate, whose corpus is the
   * sequence builder's window history so the pattern set grows with the session.
   * The mined patterns are resolved through the declared pattern→intervention map.
   */
  private createFastGate(): FastGate {
    if (this.fastGateMode === 'prefixspan') {
      return new PrefixSpanFastGate({
        getSequences: () => this.getMacroSequences(),
        minSupport: this.minPatternSupport,
        minConfidence: this.minPatternConfidence,
        resolveIntervention: (patternKey) => this.fastGatePatterns[patternKey] ?? null
      });
    }

    return new MockFastGate({ patterns: this.fastGatePatterns });
  }

  /**
   * Groups the macro history into per-window symbol sequences, which is the corpus
   * shape PrefixSpan consumes.
   */
  private getMacroSequences(): string[][] {
    const byWindow = new Map<number, string[]>();
    let fallbackIndex = -1;

    for (const interaction of this.macroHistory) {
      const key = interaction.windowId ?? fallbackIndex--;
      const bucket = byWindow.get(key) ?? [];
      bucket.push(interaction.symbol);
      byWindow.set(key, bucket);
    }

    return Array.from(byWindow.entries())
      .filter(([key]) => key >= 0)
      .sort((a, b) => a[0] - b[0])
      .map(([, symbols]) => symbols);
  }

  /**
   * Runs the PrefixSpan miner inside this worker scope.
   *
   * Returns null when no miner is available (no worker global, or no WebAssembly), which
   * is reported explicitly rather than surfacing as an indistinguishable empty result.
   */
  private async minePatterns(
    sequences: string[][],
    minSupport: number
  ): Promise<{ pattern: string[]; support: number; confidence: number }[] | null> {
    try {
      const { minePatternsDirect } = await import('../../gates/fast/prefixSpanMiner');
      return await minePatternsDirect(sequences, minSupport);
    } catch (err) {
      console.error('[RuntimeWorkerCore] In-worker pattern mining failed:', err);
      return null;
    }
  }

  /** Rebuilds the Fast Gate after the declared pattern map changes. */
  public refreshFastGate(): void {
    this.inferenceEngine.setFastGate(this.createFastGate());
  }

  /**
   * Processes a structured worker request and returns the typed worker response.
   */
  public async handleRequest(request: RuntimeWorkerRequest): Promise<RuntimeWorkerResponse> {
    try {
      switch (request.type) {
        case 'INIT': {
          if (request.payload?.sequenceConfig) {
            this.sequenceBuilder = new SequenceBuilder(request.payload.sequenceConfig);
          }

          this.fastGateMode = request.payload?.fastGateMode ?? 'mock';
          this.slowGateMode = request.payload?.slowGateMode ?? 'mock';
          this.fastGatePatterns = request.payload?.fastGatePatterns ?? {};
          this.minPatternSupport = request.payload?.minPatternSupport ?? 2;
          this.minPatternConfidence = request.payload?.minPatternConfidence ?? 0;
          this.options = {
            modelUrl: request.payload?.modelUrl,
            minOutcomeConfidence: request.payload?.minOutcomeConfidence
          };

          // The Fast Gate is constructed from the registry so the PrefixSpan miner can
          // be re-evaluated against the growing macro corpus on every call.
          const fastGate = this.createFastGate();
          const slow = await this.createSlowGate();
          this.executionProvider = slow.provider;
          this.modelLoaded = slow.modelLoaded;

          this.inferenceEngine = createAdaptiveInferenceEngine({
            fastGate,
            slowGate: slow.gate,
            enableFastGate: request.payload?.enableFastGate ?? true,
            enableSlowGate: request.payload?.enableSlowGate ?? true
          });

          return {
            id: request.id,
            type: 'INIT_OK',
            success: true,
            data: {
              version: RUNTIME_WORKER_VERSION,
              fastGateMode: this.fastGateMode,
              slowGateMode: this.slowGateMode,
              executionProvider: this.executionProvider,
              modelLoaded: this.modelLoaded
            }
          };
        }

        case 'PUSH_WINDOW': {
          const { windowId, windowStart, windowEnd, values, eventCount, inactive } = request.payload;
          const window: MicroTensorWindow = {
            windowId,
            windowStart,
            windowEnd,
            values,
            eventCount,
            inactive
          };

          this.sequenceBuilder.push(window);

          return {
            id: request.id,
            type: 'WINDOW_PROCESSED',
            success: true,
            data: {
              windowCount: this.sequenceBuilder.length,
              isFull: this.sequenceBuilder.isFull()
            }
          };
        }

        case 'PUSH_MACRO': {
          this.macroHistory.push(request.payload.macro);
          // Keep bounded to last 100 macro events to respect <20MB memory constraint
          if (this.macroHistory.length > 100) {
            this.macroHistory.shift();
          }

          return {
            id: request.id,
            type: 'MACRO_PROCESSED',
            success: true,
            data: {
              macroCount: this.macroHistory.length
            }
          };
        }

        case 'EVALUATE': {
          const tensor = this.sequenceBuilder.getTensor();
          const shape = this.sequenceBuilder.getShape();
          const macroSequence = request.payload.macroSequence ?? [...this.macroHistory];

          const result: InferenceResult = await this.inferenceEngine.evaluate({
            macroSequence,
            microTensorSequence: tensor,
            tensorShape: shape,
            uiContext: request.payload.uiContext
          });

          return {
            id: request.id,
            type: 'EVALUATION_RESULT',
            success: true,
            data: {
              ...result,
              // Worker-side observability: which gate is actually installed, and how
              // large the corpus it mined. Without this a misconfiguration is invisible.
              diagnostics: {
                fastGateMode: this.fastGateMode,
                slowGateMode: this.slowGateMode,
                minPatternSupport: this.minPatternSupport,
                workerMacroHistory: this.macroHistory.length,
                workerCorpusSize: this.getMacroSequences().length,
                evaluatedSequenceLength: macroSequence.length
              }
            }
          };
        }

        case 'MINE_PATTERNS': {
          const { sequences, minSupport } = request.payload;
          const mined = await this.minePatterns(sequences, minSupport);

          return {
            id: request.id,
            type: 'MINE_RESULT',
            success: true,
            data: {
              patterns: mined,
              minerAvailable: mined !== null
            }
          };
        }

        case 'RESET': {
          this.sequenceBuilder.clear();
          this.macroHistory = [];
          resetOnnxSlowGateSession();

          return {
            id: request.id,
            type: 'RESET_OK',
            success: true
          };
        }

        case 'PING': {
          return {
            id: request.id,
            type: 'PONG',
            success: true,
            data: {
              timestamp: Date.now()
            }
          };
        }

        default:
          return {
            id: (request as any).id,
            type: 'ERROR',
            success: false,
            error: `Unknown request type: ${(request as any).type}`
          };
      }
    } catch (err) {
      return {
        id: request.id,
        type: 'ERROR',
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  public getSequenceBuilder(): SequenceBuilder {
    return this.sequenceBuilder;
  }

  public getInferenceEngine(): AdaptiveInferenceEngine {
    return this.inferenceEngine;
  }
}
