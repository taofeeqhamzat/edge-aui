/**
 * Adaptive Runtime Composition
 *
 * The assessment (§4.2, §25 P0-1) found that every stage of the research pipeline
 * existed and was unit-tested, but nothing composed or started them: `src/main.tsx`
 * instantiated only the legacy `EdgeAUIFramework`. This module is the missing
 * composition layer.
 *
 * It owns exactly one of each pipeline stage and wires them in the order the
 * architecture requires:
 *
 *   TelemetryObserver ──► RollingWindowBuffer ──► MicroTensorWindow
 *          │                     │                      │
 *          │                     ├──► OutcomeDeriver ──► OutcomeEvent
 *          │                     └──► RuntimeWorkerClient (PUSH_WINDOW)
 *          └──► MacroInteractionStream ──► RuntimeWorkerClient (PUSH_MACRO)
 *                                              │
 *                                              ▼
 *                                   AdaptiveInferenceEngine
 *                                     (Fast Gate → Slow Gate)
 *                                              │
 *                                              ▼
 *                                   InterventionPolicy ──► UIActuator
 *                                              │              │
 *                                              └──► ExperimentRecorder ◄─┘
 *
 * Experimental condition handling (§17): telemetry always runs. In the `baseline`
 * condition the pipeline still observes, windows, mines, derives outcomes, records
 * predictions and *decides* interventions — it simply never applies them to the DOM,
 * which is what makes a like-for-like telemetry comparison possible.
 */

import { TelemetryObserver } from '../telemetry/observer';
import { RollingWindowBuffer } from '../microtensor/window';
import { MacroInteractionStream } from '../macro/sequence';
import { OutcomeDeriver } from '../outcome/derive';
import { RuntimeWorkerClient } from '../runtime/workerClient';
import {
  InstrumentationCollector,
  defaultCollector,
  StageTimingRecord,
  StageTimingStats
} from './instrumentation';
import { InterventionPolicy, PolicyConfig } from '../intervention/policy';
import { UIActuator } from '../intervention/actuator';
import { experimentRecorder } from '../telemetry/recorder';
import { sessionManager } from '../telemetry/session';
import { UiAdapter, DefaultUiAdapter, DEFAULT_TASK_ACTION_BY_EVENT } from '../integration/index';
import { getActiveUIContext } from '../telemetry/contextProvider';
import { getMonotonicTimestamp } from '../telemetry/normalizer';
import { debugBus } from '../debug/debugBus';
import {
  BehaviourEvent,
  MicroTensorWindow,
  ExperimentalCondition,
  InterventionEvent
} from '../telemetry/events';
import { InferenceResult } from '../gates/arbitration';
import { InterventionCommand, InterventionType } from '../intervention/types';
import { UIContext } from '../types/uiContext.js';
import { encodeUIContext } from '../types/contextVector';
import { PREPROCESSING_CONFIG, PIPELINE_CONFIG } from '../config/pipelineConfig';
import {
  RuntimeConfig,
  resolveRuntimeConfig,
  DeepPartial
} from '../config/runtimeConfig';




export interface AdaptiveRuntimeOptions {
  /** Full runtime configuration covering all 9 parameter groups (ADR-012 / Task 4.2). */
  config?: DeepPartial<RuntimeConfig>;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  /**
   * Selector prefix used only for the legacy dwell heuristic. The observer resolves
   * `data-aui-component` annotations independently of this value.
   */
  trackableSelector?: string;
  /** Minimum support for the PrefixSpan miner. Default 2. */
  minPatternSupport?: number;
  /** Declared pattern → intervention map for the Fast Gate. */
  fastGatePatterns?: Record<string, InterventionType | Partial<InterventionCommand>>;
  /** Policy configuration overrides. */
  policyConfig?: Partial<PolicyConfig>;
  /** Provide a slow gate; defaults to the deterministic mock. */
  enableSlowGate?: boolean;
  /**
   * Slow Gate implementation. Defaults to `mock` in non-browser environments (where
   * ONNX Runtime Web cannot initialise) and `onnx` in a browser.
   */
  slowGateMode?: 'mock' | 'onnx';
  /** URL of the foundation ONNX graph. Defaults to the bundled INT8 artifact. */
  modelUrl?: string;
  /** URL of the learned intervention head ONNX graph. Defaults to /models/intervention_head_int8.onnx. */
  interventionModelUrl?: string;
  /** Explicit ablation arm: use deterministic mapping instead of learned head. Default false. */
  useDeterministicMapping?: boolean;
  /** Minimum outcome confidence required to emit an intervention. */
  minOutcomeConfidence?: number;
  /** Skip worker dispatch entirely and evaluate in-process (tests). */
  forceInProcessWorker?: boolean;
  /** Auto-start on construction. Default false; call start(). */
  autoStart?: boolean;
  /** Toggle runtime stage timing instrumentation. Defaults to true. */
  enableInstrumentation?: boolean;
  /** Custom instrumentation collector instance. Defaults to defaultCollector. */
  collector?: InstrumentationCollector;
  /** UI Adapter injecting application-specific task models, context, and actions. */
  adapter?: UiAdapter;
}

export interface AdaptiveRuntimeStatus {
  running: boolean;
  sessionId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  windowsEmitted: number;
  macroInteractions: number;
  outcomesDerived: number;
  predictionsRecorded: number;
  interventionsApplied: number;
  lastWindowId?: number;
  slowGateMode: 'mock' | 'onnx';
  /** The execution provider that actually served the model session. */
  executionProvider: string;
  modelLoaded: boolean;
  instrumentationEnabled: boolean;
  timingSummary?: Record<string, StageTimingStats>;
}

export class AdaptiveRuntime {
  private observer: TelemetryObserver;
  private windowBuffer: RollingWindowBuffer;
  private macroStream: MacroInteractionStream;
  private outcomeDeriver: OutcomeDeriver;
  private workerClient: RuntimeWorkerClient;
  private collector: InstrumentationCollector;
  private policy: InterventionPolicy;
  private actuator: UIActuator;
  private adapter: UiAdapter;
  private readonly config: RuntimeConfig;

  private readonly options: AdaptiveRuntimeOptions;
  private readonly conditionId: ExperimentalCondition;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  private latestWindowId: number | undefined;
  private latestWindow: MicroTensorWindow | undefined;
  private running = false;
  private evaluating = false;
  private processedWindowCount = 0;
  private lastEvaluationMs = 0;
  /** Newest observed event timestamp; bounds which outcome horizons are settled. */
  private coveredThroughMs = 0;
  private streamEnded = false;
  /** Windows awaiting a settled outcome label. */
  private pendingOutcomeWindows: MicroTensorWindow[] = [];
  private lastGateDecision: unknown;

  private slowGateMode: 'mock' | 'onnx' | undefined;
  private executionProvider = 'unknown';
  private modelLoaded = false;

  private counters = {
    windowsEmitted: 0,
    macroInteractions: 0,
    outcomesDerived: 0,
    predictionsRecorded: 0,
    interventionsApplied: 0
  };

  constructor(options: AdaptiveRuntimeOptions = {}) {
    this.options = options;
    this.config = resolveRuntimeConfig({
      ...options.config,
      telemetry: {
        ...options.config?.telemetry
      },
      windowing: {
        ...options.config?.windowing
      },
      fastGate: {
        ...(options.minPatternSupport !== undefined ? { minSupport: options.minPatternSupport } : {}),
        ...(options.fastGatePatterns ? { patternInterventionMap: options.fastGatePatterns as any } : {}),
        ...options.config?.fastGate
      },
      policy: {
        ...options.policyConfig,
        ...options.config?.policy
      },
      slowGate: {
        ...(options.modelUrl ? { modelPath: options.modelUrl } : {}),
        ...(options.minOutcomeConfidence !== undefined ? { confidenceThreshold: options.minOutcomeConfidence } : {}),
        ...(options.enableSlowGate !== undefined ? { enabled: options.enableSlowGate } : {}),
        ...options.config?.slowGate
      },
      experiment: {
        ...(options.experimentId ? { experimentId: options.experimentId } : {}),
        ...(options.conditionId ? { conditionId: options.conditionId } : {}),
        ...options.config?.experiment
      }
    });

    this.conditionId = this.config.experiment.conditionId;
    this.adapter = options.adapter ?? new DefaultUiAdapter();
    experimentRecorder.setTaskStateProvider(() => this.adapter.getTaskState?.());
    experimentRecorder.setEffectiveConfig(this.config);

    this.collector = options.collector ?? defaultCollector;
    if (options.enableInstrumentation !== undefined) {
      this.collector.setEnabled(options.enableInstrumentation);
    }

    this.observer = new TelemetryObserver({
      sampleIntervalMs: this.config.telemetry.sampleIntervalMs
    });
    this.windowBuffer = new RollingWindowBuffer({
      windowDurationMs: this.config.windowing.windowDurationMs,
      strideMs: this.config.windowing.strideMs,
      minEventsPerWindow: this.config.windowing.minEventCount,
      settlementDelayMs: this.config.windowing.settlementDelayMs,
      emitInactiveWindows: this.config.windowing.emitInactiveWindows
    });
    this.macroStream = new MacroInteractionStream({
      maxCapacity: this.config.macro.maxHistoryLength
    });
    this.outcomeDeriver = new OutcomeDeriver();

    this.workerClient = new RuntimeWorkerClient({
      useFallback: options.forceInProcessWorker ?? false
    });

    this.policy = new InterventionPolicy({
      confidenceThreshold: this.config.policy.confidenceThreshold,
      requiredConsecutiveWindows: this.config.policy.requiredConsecutiveWindows,
      enforceContextEligibility: this.config.policy.enforceContextEligibility,
      cooldownMs: this.config.policy.cooldownMs,
      dismissalCooldownMs: this.config.policy.dismissalCooldownMs
    });
    this.actuator = new UIActuator({
      defaultAssistanceText: this.config.actuation.defaultAssistanceText
    });

    if (options.autoStart) {
      void this.start();
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.adapter.onInit) {
      this.adapter.onInit(this);
    }

    // 1. Establish session identity before any event is recorded.
    const session =
      sessionManager.getActiveSession() ??
      sessionManager.startSession({
        experimentId: this.options.experimentId,
        conditionId: this.conditionId
      });
    experimentRecorder.bindSession(session);

    // 2. Stamp correlation context onto derived macro interactions.
    this.macroStream.setContext({
      sessionId: session.sessionId,
      experimentId: session.experimentId,
      conditionId: session.conditionId
    });
    this.macroStream.setWindowIdProvider(() => this.latestWindowId);

    // 3. Initialise the worker with the configured gate strategy.
    //
    // The ONNX provider is requested in a browser and falls back to the deterministic
    // mock when the model cannot be executed, so the pipeline always runs while the
    // degradation stays visible in the console and in `workerRuntime` diagnostics.
    try {
      const patternMap = this.options.fastGatePatterns;
      const baseInit = {
        fastGateMode: (patternMap && Object.keys(patternMap).length > 0 ? 'prefixspan' : 'mock') as
          | 'prefixspan'
          | 'mock',
        fastGatePatterns: patternMap,
        minPatternSupport: this.options.minPatternSupport ?? 2,
        enableFastGate: true,
        enableSlowGate: this.options.enableSlowGate !== false
      };

      const desiredSlowGate = this.resolveSlowGateMode();
      this.slowGateMode = desiredSlowGate;

      const initResult = await this.workerClient.init({
        ...baseInit,
        slowGateMode: desiredSlowGate,
        modelUrl: this.options.modelUrl,
        interventionModelUrl: this.options.interventionModelUrl,
        useDeterministicMapping: this.options.useDeterministicMapping,
        minOutcomeConfidence: this.options.minOutcomeConfidence
      });

      this.executionProvider = initResult?.executionProvider ?? 'mock';
      this.modelLoaded = Boolean(initResult?.modelLoaded);
      this.slowGateMode = (initResult?.slowGateMode ?? desiredSlowGate) as 'mock' | 'onnx';

      if (desiredSlowGate === 'onnx' && !this.modelLoaded) {
        console.warn(
          `[AdaptiveRuntime] ONNX model not loaded (provider: ${this.executionProvider}); ` +
            'the pipeline is running on the deterministic Slow Gate mock.'
        );
      }

      debugBus.update({
        workerStatus: 'ready',
        executionProvider: this.executionProvider,
        modelLoaded: this.modelLoaded
      });
    } catch (err) {
      console.error('[AdaptiveRuntime] Worker initialisation failed:', err);
      debugBus.update({ workerStatus: 'error' });
    }

    // 4. Wire telemetry fan-out.
    this.unsubscribers.push(
      this.observer.subscribe((event) => {
        this.handleBehaviourEvent(event);

        // Bridge observed interactions into the UI adapter. Without this no task step
        // could ever be satisfied. It lives here rather than in dev-only diagnostics
        // so task tracking also works in a production build.
        const taskAction = this.adapter.getTaskActionForEvent
          ? this.adapter.getTaskActionForEvent(event.type)
          : DEFAULT_TASK_ACTION_BY_EVENT[event.type];
        if (taskAction && event.componentId && this.adapter.recordInteraction) {
          this.adapter.recordInteraction(event.componentId, taskAction);
        }
        if (event.type === 'navigation' && this.adapter.abandonTask) {
          const currentStatus = this.adapter.getTaskState?.().status;
          if (currentStatus === 'In Progress') {
            this.adapter.abandonTask('navigation');
          }
        }
      })
    );

    this.unsubscribers.push(
      this.windowBuffer.subscribe((window) => this.handleWindow(window))
    );

    this.unsubscribers.push(
      this.macroStream.subscribe((interaction) => {
        this.counters.macroInteractions++;
        // Mirrored into the worker so its PrefixSpan corpus accumulates window-tagged
        // sequences for the mining path.
        void this.workerClient.pushMacro(interaction).catch((err) => {
          console.error('[AdaptiveRuntime] Macro dispatch failed:', err);
        });
        debugBus.update({ latestMacroSequence: this.macroStream.getRecentSymbols(this.config.macro.maxRecentSymbols) });
      })
    );

    // 5. Actuator telemetry → experiment recorder, stamped with episode identity.
    this.unsubscribers.push(
      this.actuator.onInterventionEvent((event) => this.handleInterventionEvent(event))
    );

    // 6. Reset adaptation state whenever the task changes (§25 P1) and record the
    //    task lifecycle into the trace so trials are observable (§6.2).
    if (this.adapter.onTaskStateChange) {
      this.unsubscribers.push(
        this.adapter.onTaskStateChange((state) => {
          this.policy.reset();
          if (state.currentTaskId) {
            sessionManager.setTaskId(state.currentTaskId);
          }
        })
      );
    }

    if (this.adapter.onTaskLifecycle) {
      this.unsubscribers.push(
        this.adapter.onTaskLifecycle((event) => {
          const taskSnapshot = this.adapter.getTaskState?.();
          experimentRecorder.recordTaskEvent({
            timestamp: event.timestamp,
            type: event.type as any,
            taskId: event.taskId,
            taskStepId: event.taskStepId,
            status: (event.status as any) ?? taskSnapshot?.status ?? 'Idle',
            errors: event.errors ?? taskSnapshot?.errors ?? 0,
            durationMs: event.durationMs,
            reason: event.reason as any,
            sessionId: sessionManager.getActiveSession()?.sessionId,
            experimentId: this.options.experimentId,
            conditionId: this.conditionId
          });
        })
      );
    }

    // 7. Start observation and the monotonic window driver.
    this.observer.start();
    this.startTickLoop();
  }

  /** Requested Slow Gate implementation for this environment. */
  private resolveSlowGateMode(): 'mock' | 'onnx' {
    if (this.options.slowGateMode) return this.options.slowGateMode;
    if (this.options.enableSlowGate === false) return 'mock';
    // ONNX Runtime Web requires a browser environment; in jsdom/SSR the mock is used.
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' ? 'onnx' : 'mock';
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.observer.stop();

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    this.actuator.reset();
    this.workerClient.terminate();
    this.windowBuffer.clear();
    this.macroStream.clear();
    this.outcomeDeriver.clear();
    this.latestWindowId = undefined;
    this.latestWindow = undefined;
    this.pendingOutcomeWindows = [];
    this.coveredThroughMs = 0;
    this.streamEnded = false;
    this.processedWindowCount = 0;
    debugBus.update({ workerStatus: 'uninitialized' });

    if (this.adapter.onDestroy) {
      this.adapter.onDestroy();
    }
  }

  /** Resolves the current UIContext using the injected adapter or default DOM queries. */
  private resolveUIContext(): UIContext {
    return this.adapter.getActiveContext ? this.adapter.getActiveContext() : getActiveUIContext();
  }

  /**
   * Resets per-trial state without tearing down the workers. Called between tasks.
   */
  public async resetTrial(): Promise<void> {
    this.actuator.reset();
    this.policy.reset();
    this.windowBuffer.clear();
    this.macroStream.clear();
    this.outcomeDeriver.clear();
    this.latestWindowId = undefined;
    this.latestWindow = undefined;
    this.pendingOutcomeWindows = [];
    this.coveredThroughMs = 0;
    this.streamEnded = false;
    this.outcomeDeriver.clear();
    this.processedWindowCount = 0;
    this.counters = {
      windowsEmitted: 0,
      macroInteractions: 0,
      outcomesDerived: 0,
      predictionsRecorded: 0,
      interventionsApplied: 0
    };
    debugBus.reset();
    try {
      await this.workerClient.reset();
      debugBus.update({ workerStatus: 'ready' });
    } catch (err) {
      console.error('[AdaptiveRuntime] Worker reset failed:', err);
    }
  }

  // ==========================================================================
  // Pipeline stages
  // ==========================================================================

  /**
   * Drives the window buffer on a monotonic schedule so verified inactivity produces
   * windows rather than silence (assessment §9.2).
   */
  private startTickLoop(): void {
    const intervalMs = Math.max(50, Math.floor(PREPROCESSING_CONFIG.stride_ms / 2));
    this.tickTimer = setInterval(() => {
      this.windowBuffer.tick(getMonotonicTimestamp());
      // Settle any window whose horizon has been covered or whose grace period expired.
      this.flushPendingOutcomes();
    }, intervalMs);
  }

  private handleBehaviourEvent(event: BehaviourEvent): void {
    experimentRecorder.recordBehaviourEvent(event);
    this.windowBuffer.push(event);
    this.outcomeDeriver.push(event);
    this.macroStream.recordFromBehaviourEvent(event);

    // Track how far the observed stream reaches so outcome horizons can be settled.
    if (event.timestamp > this.coveredThroughMs) {
      this.coveredThroughMs = event.timestamp;
    }

    if (event.type === 'pagehide' || event.type === 'beforeunload' || event.type === 'unload') {
      this.streamEnded = true;
    }

    this.flushPendingOutcomes();
  }

  private handleWindow(window: MicroTensorWindow): void {
    this.latestWindowId = window.windowId;
    this.latestWindow = window;
    this.counters.windowsEmitted++;

    debugBus.update({
      latestMicroTensor: Array.from(window.values)
    });

    // 1. Queue the window for outcome derivation once its lookahead horizon is covered.
    this.pendingOutcomeWindows.push(window);
    this.flushPendingOutcomes();

    // 2. Feed the worker off the main thread.
    void this.dispatchWindow(window);

    // 3. Evaluate the dual-gate chain once a full sequence exists.
    this.maybeEvaluate();
  }

  private async dispatchWindow(window: MicroTensorWindow): Promise<void> {
    try {
      // The transferable buffer must be copied because the recorder retains the
      // original Float32Array for the experiment trace.
      const copy = new Float32Array(window.values);
      await this.workerClient.pushWindow({ ...window, values: copy }, true);
      this.processedWindowCount++;
    } catch (err) {
      console.error('[AdaptiveRuntime] Window dispatch failed:', err);
    }
  }

  private maybeEvaluate(): void {
    if (this.evaluating) return;
    // The Slow Gate consumes a sequence of T=sequenceLength windows; evaluating before the
    // sequence exists would feed it a zero-padded tensor.
    if (this.processedWindowCount < this.config.slowGate.sequenceLength) return;

    // Evaluating on a genuinely inactive window produces a prediction for silence,
    // which inflates the trace and wastes edge compute. Evaluate when either the
    // closing window contained activity, or enough time has passed that the state
    // genuinely changed while idle.
    const window = this.latestWindow;
    const hadActivity = Boolean(window && (window.eventCount ?? 0) > 0);
    const sinceLastEvaluation = getMonotonicTimestamp() - this.lastEvaluationMs;
    if (!hadActivity && sinceLastEvaluation < this.config.windowing.inactivityThresholdMs) {
      return;
    }

    void this.evaluateAndAct();
  }

  private async evaluateAndAct(): Promise<void> {
    this.evaluating = true;
    this.lastEvaluationMs = getMonotonicTimestamp();
    const start = this.lastEvaluationMs;

    try {
      const uiContext: UIContext = this.resolveUIContext();
      // Pass the fresh macro sequence explicitly. Relying on the worker's own macro
      // history made the Fast Gate evaluate a corpus that lagged the just-closed
      // window, so patterns that had only just become frequent were never matched.
      const macroSequence = this.macroStream.getRecent(this.config.macro.recentSequenceLookback);
      const result: InferenceResult = await this.workerClient.evaluate(uiContext, macroSequence);

      const resolvedMappingSource =
        result.intervention?.mappingSource ??
        (result.matchedGate === 'fast'
          ? 'fast_gate_pattern'
          : result.matchedGate === 'slow'
            ? (result.slowResult?.mappingSource ?? (this.options.useDeterministicMapping ? 'deterministic_mapping' : 'learned_head'))
            : undefined);

      const modelVersion =
        this.options.interventionModelUrl ??
        (this.modelLoaded ? 'TargetInterventionHead-v1.0.0-int8' : undefined);

      experimentRecorder.recordPrediction({
        timestamp: result.timestamp,
        sessionId: sessionManager.getActiveSession()?.sessionId,
        experimentId: this.options.experimentId,
        conditionId: this.conditionId,
        windowId: this.latestWindowId,
        matchedGate: result.matchedGate,
        outcome: result.slowResult?.outcome,
        interventionType: result.intervention?.type,
        mappingSource: resolvedMappingSource,
        confidence: result.intervention?.confidence ?? result.slowResult?.confidence,
        latencyMs: result.latencyMs,
        fastGateLatencyMs: result.fastGateLatencyMs,
        slowGateLatencyMs: result.slowGateLatencyMs,
        modelVersion,
        contextEncodingVersion: 'R6-v1.0.0',
        bothGatesEvaluated: result.matchedGate === 'none'
      });
      this.counters.predictionsRecorded++;

      // Surface the Fast Gate corpus size so a silent mining path is visible.
      const macroCorpus = this.getMacroSequences();
      const workerDiagnostics = (result as InferenceResult & {
        diagnostics?: unknown;
      }).diagnostics;

      this.lastGateDecision = {
        matchedGate: result.matchedGate,
        workerDiagnostics,
        fastMatched: result.fastDecision.matched,
        fastPattern: result.fastDecision.matchedPattern,
        intervention: result.intervention?.type,
        corpusSize: this.getMacroSequences().length,
        slowOutcome: result.slowResult?.outcome,
        slowConfidence: result.slowResult?.confidence
      };

      debugBus.update({
        fastGateStatus: {
          matched: result.fastDecision.matched,
          pattern: result.fastDecision.matchedPattern?.join(' > '),
          confidence: result.fastDecision.confidence
        },
        fastGateCorpusSize: macroCorpus.length,
        slowGateStatus: {
          called: result.matchedGate !== 'fast',
          outcome: result.slowResult?.outcome,
          confidence: result.slowResult?.confidence
        },
        inferenceLatencyMs: result.latencyMs
      });

      if (!result.intervention) {
        debugBus.update({
          interventionStatus: { type: 'no_op', source: 'rule', state: 'no decision' }
        });
        return;
      }

      const decision = this.policy.accept(result.intervention, uiContext);
      experimentRecorder.recordIntervention({
        timestamp: Date.now(),
        type: decision.accepted ? 'accepted' : 'issued',
        intervention: decision.command.type,
        componentId: decision.command.targetComponentId,
        source: decision.command.source,
        mappingSource: decision.command.mappingSource ?? resolvedMappingSource,
        confidence: decision.command.confidence,
        interventionEpisodeId: this.currentEpisode,
        sessionId: sessionManager.getActiveSession()?.sessionId,
        experimentId: this.options.experimentId,
        conditionId: this.conditionId,
        windowId: this.latestWindowId
      });

      if (!decision.accepted) {
        debugBus.update({
          interventionStatus: {
            type: 'no_op',
            source: decision.command.source,
            state: decision.reason
          }
        });
        return;
      }

      // Baseline condition: decide, log, but never mutate the DOM (§17).
      if (this.conditionId !== 'adaptive') {
        debugBus.update({
          interventionStatus: {
            type: decision.command.type,
            source: decision.command.source,
            confidence: decision.command.confidence,
            state: 'decision only (baseline condition)'
          }
        });
        return;
      }

      this.beginEpisode();
      this.actuator.apply(decision.command);
      this.counters.interventionsApplied++;
      debugBus.update({
        interventionStatus: {
          type: decision.command.type,
          source: decision.command.source,
          confidence: decision.command.confidence,
          state: decision.reason
        }
      });
    } catch (err) {
      console.error('[AdaptiveRuntime] Evaluation failed:', err);
    } finally {
      debugBus.update({ featureLatencyMs: getMonotonicTimestamp() - start });
      this.evaluating = false;
    }
  }

  private handleInterventionEvent(event: InterventionEvent): void {
    // Dismissal is negative feedback: suppress re-issuing that intervention.
    if (event.type === 'dismissed') {
      this.policy.notifyDismissal(event.intervention as InterventionType);
    }

    experimentRecorder.recordIntervention({
      ...event,
      interventionEpisodeId: event.interventionEpisodeId ?? this.currentEpisode,
      sessionId: sessionManager.getActiveSession()?.sessionId,
      experimentId: this.options.experimentId,
      conditionId: this.conditionId,
      windowId: this.latestWindowId
    });
  }

  /**
   * Starts a new intervention episode. An episode groups the
   * issued → accepted → applied → dismissed/reverted lifecycle of one adaptation.
   */
  private beginEpisode(): string {
    this.episodeCounter++;
    this.currentEpisode = `ep_${this.episodeCounter}`;
    return this.currentEpisode;
  }

  private episodeCounter = 0;
  private currentEpisode = 'ep_0';

  /**
   * Settles outcome labels whose lookahead span is now covered by observed activity.
   *
   * Windows are queued on emission and resolved later: `coveredThroughMs` is the newest
   * event timestamp seen, so a window is only settled once the stream has advanced past
   * `windowEnd + 1500ms`, or once the idle grace period expires.
   */
  private flushPendingOutcomes(): void {
    if (this.pendingOutcomeWindows.length === 0) return;

    const lookaheadMax = PIPELINE_CONFIG.target_generation.lookahead_horizon_ms[1];
    const now = getMonotonicTimestamp();
    const stillPending: MicroTensorWindow[] = [];

    for (const window of this.pendingOutcomeWindows) {
      const horizonEnd = window.windowEnd + lookaheadMax;
      const horizonCovered = this.coveredThroughMs >= horizonEnd;
      const idleGraceExpired = now - horizonEnd >= this.config.windowing.pendingOutcomeGraceMs;

      if (!this.streamEnded && !horizonCovered && !idleGraceExpired) {
        stillPending.push(window);
        continue;
      }

      // A window whose horizon has not been observed is labelled from the events that
      // are known, and marked provisional so downstream analysis can filter it out.
      this.settleOutcome(window, horizonCovered);
    }

    this.pendingOutcomeWindows = stillPending;
  }

  private settleOutcome(window: MicroTensorWindow, lookaheadComplete: boolean): void {
    const outcome = this.outcomeDeriver.deriveForWindow(
      window,
      {
        sessionId: sessionManager.getActiveSession()?.sessionId,
        experimentId: this.options.experimentId,
        conditionId: this.conditionId
      },
      { sessionTerminated: this.streamEnded && !lookaheadComplete }
    );

    experimentRecorder.recordOutcome({ ...outcome, lookaheadComplete });
    this.counters.outcomesDerived++;
  }

  /** The most recent dual-gate decision, exposed for live diagnostics and tests. */
  public getLastGateDecision(): unknown {
    return this.lastGateDecision;
  }

  /**
   * Sequences of macro symbols for PrefixSpan mining.
   *
   * Interactions are grouped into coarse evaluation slots rather than individual
   * 250 ms windows. Consecutive macro actions almost always fall in different windows
   * at that granularity, which would produce a corpus of single-symbol sequences and
   * make every multi-symbol pattern impossible to mine. A slot spans
   * config.macro.groupingIntervalMs so an interaction episode (open filter, change region, apply)
   * forms one sequence.
   */
  public getMacroSequences(): string[][] {
    const all = this.macroStream.getRecent(this.macroStream.length);
    const bySlot = new Map<number, string[]>();
    const slotDuration = this.config.macro.groupingIntervalMs;

    for (const interaction of all) {
      const slot = Math.floor(interaction.timestamp / slotDuration);
      const bucket = bySlot.get(slot) ?? [];
      bucket.push(interaction.symbol);
      bySlot.set(slot, bucket);
    }

    return Array.from(bySlot.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, symbols]) => symbols);
  }

  // ==========================================================================
  // Introspection
  // ==========================================================================

  /** Returns the effective resolved runtime configuration (ADR-012 / Task 4.2). */
  public getConfig(): RuntimeConfig {
    return this.config;
  }

  public getStatus(): AdaptiveRuntimeStatus {
    const session = sessionManager.getActiveSession();
    return {
      running: this.running,
      sessionId: session?.sessionId,
      experimentId: session?.experimentId,
      conditionId: session?.conditionId,
      windowsEmitted: this.counters.windowsEmitted,
      macroInteractions: this.counters.macroInteractions,
      outcomesDerived: this.counters.outcomesDerived,
      predictionsRecorded: this.counters.predictionsRecorded,
      interventionsApplied: this.counters.interventionsApplied,
      lastWindowId: this.latestWindowId,
      slowGateMode: this.slowGateMode ?? this.resolveSlowGateMode(),
      executionProvider: this.executionProvider,
      modelLoaded: this.modelLoaded,
      instrumentationEnabled: this.collector.isEnabled(),
      timingSummary: this.collector.getSummary()
    };
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getCondition(): ExperimentalCondition {
    return this.conditionId;
  }

  public getTimingRecords(): StageTimingRecord[] {
    return this.collector.getRecords();
  }

  public getTimingSummary(): Record<string, StageTimingStats> {
    return this.collector.getSummary();
  }

  /** Clears stored timing records and statistics in the collector. */
  public clearTimings(): void {
    this.collector.clear();
  }

  /** Dynamically toggles stage instrumentation collection. */
  public setInstrumentationEnabled(enabled: boolean): void {
    this.collector.setEnabled(enabled);
  }

  /** Returns whether stage instrumentation collection is currently active. */
  public isInstrumentationEnabled(): boolean {
    return this.collector.isEnabled();
  }

  /**
   * Returns the already-encoded context vector for the current UI snapshot, which is
   * what a real target head consumes (assessment §15).
   */
  public getContextVector(): Float32Array {
    return encodeUIContext(this.resolveUIContext());
  }

  /** Returns the active UI adapter. */
  public getAdapter(): UiAdapter {
    return this.adapter;
  }

  /** Test seam: exposes the composed stages for direct exercise. */
  public getInternals(): {
    observer: TelemetryObserver;
    windowBuffer: RollingWindowBuffer;
    macroStream: MacroInteractionStream;
    outcomeDeriver: OutcomeDeriver;
    workerClient: RuntimeWorkerClient;
    policy: InterventionPolicy;
    actuator: UIActuator;
    collector: InstrumentationCollector;
  } {
    return {
      observer: this.observer,
      windowBuffer: this.windowBuffer,
      macroStream: this.macroStream,
      outcomeDeriver: this.outcomeDeriver,
      workerClient: this.workerClient,
      policy: this.policy,
      actuator: this.actuator,
      collector: this.collector
    };
  }
}

/**
 * Factory helper.
 */
export function createAdaptiveRuntime(options?: AdaptiveRuntimeOptions): AdaptiveRuntime {
  return new AdaptiveRuntime(options);
}
