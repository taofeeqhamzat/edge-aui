/**
 * Edge-AUI Dedicated Web Worker
 * Implements Stage 9.1 specifications from clipboard.9.md Sections 39, 40 & docs/plan/tasks/9.1.md.
 * 
 * Thread Isolation & Invariants:
 * - Operates in dedicated background worker thread with ZERO DOM access.
 * - Encapsulates MicroTensor window ingestion, SequenceBuilder (T=8), Fast Gate, and Slow Gate.
 * - Eliminates main-thread blocking by processing transferable Float32Array buffers.
 * - Emits declarative InterventionCommands back to the main thread for UIActuator application.
 */

import { SequenceBuilder } from '../microtensor/sequence';
import { MicroTensorWindow, MacroInteraction } from '../telemetry/events';
import {
  AdaptiveInferenceEngine,
  createAdaptiveInferenceEngine,
  InferenceResult
} from '../gates/arbitration';
import { MockFastGate } from '../gates/fast/mockFastGate';
import { MockSlowGate } from '../gates/slow/mockSlowGate';
import {
  RuntimeWorkerRequest,
  RuntimeWorkerResponse,
  RUNTIME_WORKER_VERSION
} from './messages';

export class RuntimeWorkerCore {
  private sequenceBuilder: SequenceBuilder;
  private inferenceEngine: AdaptiveInferenceEngine;
  private macroHistory: MacroInteraction[] = [];

  constructor() {
    this.sequenceBuilder = new SequenceBuilder();
    this.inferenceEngine = createAdaptiveInferenceEngine({
      fastGate: new MockFastGate(),
      slowGate: new MockSlowGate()
    });
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

          const fastGate = request.payload?.fastGatePatterns
            ? new MockFastGate({ patterns: request.payload.fastGatePatterns })
            : new MockFastGate();

          const slowGate = new MockSlowGate();

          this.inferenceEngine = createAdaptiveInferenceEngine({
            fastGate,
            slowGate,
            enableFastGate: request.payload?.enableFastGate ?? true,
            enableSlowGate: request.payload?.enableSlowGate ?? true
          });

          return {
            id: request.id,
            type: 'INIT_OK',
            success: true,
            data: {
              version: RUNTIME_WORKER_VERSION
            }
          };
        }

        case 'PUSH_WINDOW': {
          const { windowStart, windowEnd, values } = request.payload;
          const window: MicroTensorWindow = {
            windowStart,
            windowEnd,
            values
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
            data: result
          };
        }

        case 'RESET': {
          this.sequenceBuilder.clear();
          this.macroHistory = [];

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

// Instantiate worker instance in Web Worker global scope
const core = new RuntimeWorkerCore();

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.addEventListener('message', async (event: MessageEvent<RuntimeWorkerRequest>) => {
    const response = await core.handleRequest(event.data);
    self.postMessage(response);
  });
}
