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
import { sessionManager, type SessionContext } from '../telemetry/session';
import { UiAdapter, DefaultUiAdapter, DEFAULT_TASK_ACTION_BY_EVENT } from '../integration/index';
import { getActiveUIContext } from '../telemetry/contextProvider';
import { getMonotonicTimestamp, getWallClockTimestamp } from '../telemetry/normalizer';
import { debugBus } from '../debug/debugBus';
import {
  BehaviourEvent,
  MicroTensorWindow,
  ExperimentalCondition,
  InterventionEvent,
  PolicyDecisionEvent,
  PolicyRejectionCategory
} from '../telemetry/events';
import type { MiningCounters } from '../telemetry/traceSchema';
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

  /**
   * Window ids pushed into the worker's sequence, oldest first.
   *
   * The prediction's windowId used to be read from `latestWindowId`, a mutable field that
   * every emitted window overwrites, so consecutive predictions could name the same window
   * while evaluating different sequences (F-18). Recording the sequence explicitly is what
   * makes "which window produced this decision" answerable.
   */
  private evaluatedWindowIds: number[] = [];
  private predictionCounter = 0;

  /**
   * Bounded Fast Gate execution counters (F-02). Surfaced in the trace so a dropped or
   * superseded evaluation is visible rather than silently missing.
   */
  private miningCounters: MiningCounters = {
    executed: 0,
    skipped: 0,
    superseded: 0,
    timedOut: 0,
    droppedWindows: 0
  };

  private slowGateMode: 'mock' | 'onnx' | undefined;
  private executionProvider = 'unknown';
  private modelLoaded = false;
  /** Model provenance reported by the worker, used for the trace's modelVersion (F-19). */
  private reportedModelVersion: string | null = null;

  private counters = {
    windowsEmitted: 0,
    macroInteractions: 0,
    outcomesDerived: 0,
    predictionsRecorded: 0,
    policyDecisionsRecorded: 0,
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
      useFallback: options.forceInProcessWorker ?? false,
      // The transport budget must accommodate the bounded mining deadline, otherwise the
      // RPC gives up before the Fast Gate can report why it stopped (F-02).
      requestTimeoutMs: this.config.fastGate.rpcTimeoutMs
    });

    this.policy = new InterventionPolicy({
      confidenceThreshold: this.config.policy.confidenceThreshold,
      requiredConsecutiveWindows: this.config.policy.requiredConsecutiveWindows,
      enforceContextEligibility: this.config.policy.enforceContextEligibility,
      cooldownMs: this.config.policy.cooldownMs,
      dismissalCooldownMs: this.config.policy.dismissalCooldownMs,
      // The adaptation lifetime is a research-methodology parameter; it is now wired rather
      // than merely declared, so an accepted adaptation actually expires (F-03).
      ttlMs: this.config.actuation.defaultTtlMs
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
        minOutcomeConfidence: this.options.minOutcomeConfidence,
        // Send the resolved execution bounds so the miner's protection is configurable
        // rather than hardcoded in the worker (ADR-012 / F-02).
        fastGateBounds: {
          maxPatterns: this.config.fastGate.maxPatterns,
          maxPatternLength: this.config.fastGate.maxPatternLength,
          maxCorpusSequences: this.config.fastGate.maxCorpusSequences,
          miningTimeoutMs: this.config.fastGate.miningTimeoutMs
        }
      });

      this.executionProvider = initResult?.executionProvider ?? 'mock';
      this.modelLoaded = Boolean(initResult?.modelLoaded);
      this.slowGateMode = (initResult?.slowGateMode ?? desiredSlowGate) as 'mock' | 'onnx';

      // Record the model identity the worker actually loaded. Without this the trace
      // reported a hardcoded literal regardless of which graph ran (F-19).
      this.reportedModelVersion = initResult?.modelVersion ?? null;
      experimentRecorder.setModelProvenance(this.reportedModelVersion, this.executionProvider);
      experimentRecorder.setMiningCounters(this.miningCounters);

      if (desiredSlowGate === 'onnx' && !this.modelLoaded) {
        console.warn(
          `[AdaptiveRuntime] ONNX model not loaded (provider: ${this.executionProvider}); ` +
            'the pipeline is running on the deterministic Slow Gate mock.'
        );
      }

      debugBus.update({
        workerStatus: 'ready',
        executionProvider: this.executionProvider,
        modelLoaded: this.modelLoaded,
        slowGateMode: this.slowGateMode,
        modelVersion: this.reportedModelVersion ?? undefined
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

  /**
   * Re-points session correlation after the session has been rotated at a trial boundary.
   *
   * Predictions, policy decisions and interventions read the *live* session when they are
   * recorded, so they follow a rotation automatically. The macro-interaction context is a
   * snapshot taken at start, so without this the next trial's macro symbols would still carry
   * the previous trial's session id — a trace whose row says one session and whose contents
   * say another. The recorder's bound snapshot is updated for the same reason.
   */
  public rebindSession(session: SessionContext): void {
    experimentRecorder.bindSession(session);
    this.macroStream.setContext({
      sessionId: session.sessionId,
      experimentId: session.experimentId,
      conditionId: session.conditionId
    });
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

    // Close any live adaptation *before* unsubscribing, so its terminal event still reaches
    // the recorder. Previously the reset ran after the subscriptions were torn down, which
    // meant an adaptation still visible at teardown was never recorded as reverted (F-03).
    this.actuator.reset('session_end');
    this.windowBuffer.clear();

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    // Settle the outcome windows the observed activity already supports, so a stopped trial
    // does not lose labels it could have derived.
    this.streamEnded = true;
    this.flushPendingOutcomes();
    experimentRecorder.setMiningCounters(this.miningCounters);

    this.workerClient.terminate();
    this.macroStream.clear();
    this.outcomeDeriver.clear();
    this.latestWindowId = undefined;
    this.latestWindow = undefined;
    this.pendingOutcomeWindows = [];
    this.coveredThroughMs = 0;
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
    this.evaluatedWindowIds = [];
    this.currentPredictionId = undefined;
    this.miningCounters = {
      executed: 0,
      skipped: 0,
      superseded: 0,
      timedOut: 0,
      droppedWindows: 0
    };
    this.counters = {
      windowsEmitted: 0,
      macroInteractions: 0,
      outcomesDerived: 0,
      predictionsRecorded: 0,
      policyDecisionsRecorded: 0,
      interventionsApplied: 0
    };
    // Close any episode still visible before the trial boundary, so a reset cannot leave an
    // adaptation applied with no terminal event in the record (F-03).
    this.actuator.clear(undefined, 'session_end');
    experimentRecorder.setMiningCounters(this.miningCounters);
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
      // The window grid is expressed on the canonical trace clock, so a window's
      // windowStart/windowEnd are epoch milliseconds and comparable with every other
      // trace record (schema 1.3.0 / F-01).
      this.windowBuffer.tick(getWallClockTimestamp());
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

    // Track the sequence the worker is building, capped at the Slow Gate's tensor length.
    // This is the record of what was actually evaluated, not what happened to be newest.
    this.evaluatedWindowIds.push(window.windowId);
    const sequenceLength = Math.max(1, this.config.slowGate.sequenceLength);
    if (this.evaluatedWindowIds.length > sequenceLength) {
      this.evaluatedWindowIds.splice(0, this.evaluatedWindowIds.length - sequenceLength);
    }

    debugBus.update({
      latestMicroTensor: Array.from(window.values),
      latestWindowId: window.windowId,
      latestWindowInactive: Boolean(window.inactive),
      latestWindowEventCount: window.eventCount ?? 0
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
      // A window that never reached the worker is a hole in the evaluated sequence, so it
      // is counted rather than only logged. Silent loss was F-02's worst symptom.
      this.miningCounters.droppedWindows++;
      console.error('[AdaptiveRuntime] Window dispatch failed:', err);
    }
  }

  private maybeEvaluate(): void {
    if (this.evaluating) {
      // A newer window arrived while an evaluation was in flight. The in-flight evaluation
      // is still recorded, but this window's evaluation is deliberately skipped and the
      // decision is counted, so backpressure is observable instead of invisible (F-02).
      this.miningCounters.superseded++;
      return;
    }
    // The Slow Gate consumes a sequence of T=sequenceLength windows; evaluating before the
    // sequence exists would feed it a zero-padded tensor.
    if (this.processedWindowCount < this.config.slowGate.sequenceLength) {
      this.miningCounters.skipped++;
      return;
    }

    // Evaluating on a genuinely inactive window produces a prediction for silence,
    // which inflates the trace and wastes edge compute. Evaluate when either the
    // closing window contained activity, or enough time has passed that the state
    // genuinely changed while idle.
    const window = this.latestWindow;
    const hadActivity = Boolean(window && (window.eventCount ?? 0) > 0);
    const sinceLastEvaluation = getMonotonicTimestamp() - this.lastEvaluationMs;
    if (!hadActivity && sinceLastEvaluation < this.config.windowing.inactivityThresholdMs) {
      this.miningCounters.skipped++;
      return;
    }

    void this.evaluateAndAct();
  }

  /**
   * Records one policy verdict. Called on every evaluation path — accepted, rejected,
   * baseline decision-only, actuation failure and no-prediction — because a trace that only
   * shows successful interventions cannot answer "why did it not intervene?" (F-07).
   */
  private recordPolicyDecision(
    event: Omit<PolicyDecisionEvent, 'timestamp' | 'sessionId' | 'experimentId' | 'conditionId'>
  ): void {
    experimentRecorder.recordPolicyDecision({
      timestamp: getWallClockTimestamp(),
      sessionId: sessionManager.getActiveSession()?.sessionId,
      experimentId: this.options.experimentId,
      conditionId: this.conditionId,
      ...event
    });
    this.counters.policyDecisionsRecorded++;
  }

  /**
   * Folds the worker's cumulative Fast Gate outcome counters into the trace counters.
   *
   * These are monotonic counts for the worker's lifetime, so they are merged by taking the
   * maximum rather than summed: the same totals are re-reported on every evaluation, and
   * summing them would multiply the counts by the number of evaluations (F-02).
   */
  private mergeWorkerMiningOutcomes(diagnostics: unknown): void {
    const outcomes = (diagnostics as { miningOutcomes?: Record<string, number> } | undefined)
      ?.miningOutcomes;
    if (!outcomes) return;

    const take = (key: string, target: keyof MiningCounters): void => {
      const value = outcomes[key];
      if (typeof value !== 'number') return;
      const current = (this.miningCounters[target] as number | undefined) ?? 0;
      if (value > current) {
        (this.miningCounters[target] as number) = value;
      }
    };

    take('executed', 'executed');
    take('timed_out', 'timedOut');
  }

  private async evaluateAndAct(): Promise<void> {
    this.evaluating = true;
    this.lastEvaluationMs = getMonotonicTimestamp();
    const start = this.lastEvaluationMs;

    try {
      const uiContext: UIContext = this.resolveUIContext();
      // Snapshot the evaluated window set *before* awaiting, and pass it through the whole
      // decision chain. Reading a mutable "latest" value after the await is what let
      // predictions name a window they never evaluated (F-18).
      const evaluatedWindowIds = [...this.evaluatedWindowIds];
      const evaluatedWindowId = evaluatedWindowIds[evaluatedWindowIds.length - 1] ?? this.latestWindowId;
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

      // Model provenance is taken from what the worker reported it loaded, falling back to
      // a hardcoded literal only when nothing was reported. The literal alone could not
      // distinguish two different exported graphs (F-19).
      const modelVersion =
        this.reportedModelVersion ??
        this.options.interventionModelUrl ??
        (this.modelLoaded ? 'TargetInterventionHead-v1.0.0-int8' : undefined);

      this.predictionCounter++;
      const predictionId = `pred_${this.predictionCounter}`;

      // Fold the worker's bounded-execution counters in before the prediction is recorded.
      const workerDiagnostics = (result as InferenceResult & {
        diagnostics?: unknown;
      }).diagnostics;
      this.mergeWorkerMiningOutcomes(workerDiagnostics);

      experimentRecorder.recordPrediction({
        timestamp: result.timestamp,
        predictionId,
        sessionId: sessionManager.getActiveSession()?.sessionId,
        experimentId: this.options.experimentId,
        conditionId: this.conditionId,
        windowId: evaluatedWindowId,
        evaluatedWindowIds,
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
        inferenceLatencyMs: result.latencyMs,
        latestPredictionId: predictionId,
        matchedGate: result.matchedGate,
        mappingSource: resolvedMappingSource,
        modelVersion,
        executionProvider: this.executionProvider,
        modelLoaded: this.modelLoaded,
        slowGateMode: this.slowGateMode
      });

      // ---------------------------------------------------------------------
      // No candidate at all: record the absence explicitly so "no prediction" is
      // distinguishable from "prediction rejected" in the exported trace (F-07).
      // ---------------------------------------------------------------------
      if (!result.intervention) {
        this.recordPolicyDecision({
          windowId: evaluatedWindowId,
          predictionId,
          accepted: false,
          policyDecision: 'no_prediction',
          policyReason:
            result.matchedGate === 'none'
              ? 'No intervention: both gates evaluated and returned no candidate'
              : `No intervention: ${result.matchedGate} gate produced no candidate`,
          candidateCount: 0,
          cooldownRemainingMs: this.policy.cooldownRemainingMs(),
          phase: 'no_prediction'
        });
        debugBus.update({
          interventionStatus: { type: 'no_op', source: 'rule', state: 'no decision' },
          policyState: 'NO PREDICTION',
          policyReason: 'No candidate produced by either gate'
        });
        return;
      }

      const decision = this.policy.accept(result.intervention, uiContext);

      // ---------------------------------------------------------------------
      // Rejected: the reason is a research result and is persisted, not just logged.
      // ---------------------------------------------------------------------
      if (!decision.accepted) {
        this.recordPolicyDecision({
          windowId: evaluatedWindowId,
          predictionId,
          candidate: decision.command.type,
          confidence: result.intervention.confidence ?? result.slowResult?.confidence,
          accepted: false,
          policyDecision: 'rejected',
          policyReason: decision.reason,
          rejectionCategory: decision.rejectionCategory as PolicyRejectionCategory,
          candidateCount: decision.candidateCount,
          cooldownRemainingMs: decision.cooldownRemainingMs,
          phase: 'policy'
        });
        debugBus.update({
          interventionStatus: {
            type: 'no_op',
            source: decision.command.source,
            state: decision.reason
          },
          policyState: 'POLICY REJECTED',
          policyReason: decision.reason,
          policyCooldownRemainingMs: decision.cooldownRemainingMs,
          candidateCount: decision.candidateCount
        });
        return;
      }

      // ---------------------------------------------------------------------
      // Baseline: permitted, recorded, but never applied. The verdict is persisted so a
      // baseline session evidences "decided but not applied" from the trace alone (§17).
      // ---------------------------------------------------------------------
      if (this.conditionId !== 'adaptive') {
        this.recordPolicyDecision({
          windowId: evaluatedWindowId,
          predictionId,
          candidate: decision.command.type,
          confidence: decision.command.confidence,
          accepted: true,
          policyDecision: 'decision_only',
          policyReason: `${decision.reason} — not applied: baseline condition`,
          rejectionCategory: 'baseline_condition',
          candidateCount: decision.candidateCount,
          cooldownRemainingMs: decision.cooldownRemainingMs,
          phase: 'policy'
        });
        debugBus.update({
          interventionStatus: {
            type: decision.command.type,
            source: decision.command.source,
            confidence: decision.command.confidence,
            state: 'decision only (baseline condition)'
          },
          policyState: 'POLICY ACCEPTED (BASELINE — NOT APPLIED)',
          policyReason: decision.reason,
          candidateCount: decision.candidateCount
        });
        return;
      }

      // ---------------------------------------------------------------------
      // Adaptive: open the episode, then apply. The episode id is created *before* any
      // record is written so the issued and applied events share one id (F-05).
      // ---------------------------------------------------------------------
      const episodeId = this.beginEpisode(predictionId);

      experimentRecorder.recordIntervention({
        timestamp: getWallClockTimestamp(),
        type: 'accepted',
        intervention: decision.command.type,
        componentId: decision.command.targetComponentId,
        source: decision.command.source,
        mappingSource: decision.command.mappingSource ?? resolvedMappingSource,
        confidence: decision.command.confidence,
        interventionEpisodeId: episodeId,
        predictionId,
        sessionId: sessionManager.getActiveSession()?.sessionId,
        experimentId: this.options.experimentId,
        conditionId: this.conditionId,
        windowId: evaluatedWindowId
      });

      this.recordPolicyDecision({
        windowId: evaluatedWindowId,
        predictionId,
        candidate: decision.command.type,
        confidence: decision.command.confidence,
        accepted: true,
        policyDecision: 'accepted',
        policyReason: decision.reason,
        candidateCount: decision.candidateCount,
        cooldownRemainingMs: decision.cooldownRemainingMs,
        ttlMs: decision.ttlMs,
        phase: 'policy'
      });

      // The episode id reaches the DOM through the command, so the trace's episode and the
      // visible adaptation can be correlated by an automated check (F-05).
      const applied = this.actuator.apply({ ...decision.command, episodeId } as InterventionCommand);

      if (!applied) {
        this.recordPolicyDecision({
          windowId: evaluatedWindowId,
          predictionId,
          candidate: decision.command.type,
          accepted: false,
          policyDecision: 'rejected',
          policyReason: `Actuation failed: the actuator could not resolve a target element for '${decision.command.type}'`,
          rejectionCategory: 'actuation_failed',
          candidateCount: decision.candidateCount,
          cooldownRemainingMs: decision.cooldownRemainingMs,
          ttlMs: decision.ttlMs,
          phase: 'actuation_failed'
        });
        debugBus.update({
          interventionStatus: {
            type: decision.command.type,
            source: decision.command.source,
            confidence: decision.command.confidence,
            state: 'ACTUATION FAILED'
          },
          policyState: 'ACTUATION FAILED',
          policyReason: 'Actuator could not resolve a target element'
        });
        return;
      }

      this.counters.interventionsApplied++;
      debugBus.update({
        interventionStatus: {
          type: decision.command.type,
          source: decision.command.source,
          confidence: decision.command.confidence,
          state: decision.reason
        },
        policyState: 'ACTUATED',
        policyReason: decision.reason,
        candidateCount: decision.candidateCount,
        activeEpisodeId: episodeId,
        activeIntervention: decision.command.type,
        activeInterventionTtlMs: decision.ttlMs,
        activeInterventionExpiresInMs: decision.ttlMs
      });
    } catch (err) {
      console.error('[AdaptiveRuntime] Evaluation failed:', err);
    } finally {
      // This is the duration of the whole evalu-and-act cycle, not feature-extraction
      // latency. The label now matches what is measured (F-08).
      debugBus.update({ evaluationCycleLatencyMs: getMonotonicTimestamp() - start });
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
      predictionId: event.predictionId ?? this.currentPredictionId,
      sessionId: sessionManager.getActiveSession()?.sessionId,
      experimentId: this.options.experimentId,
      conditionId: this.conditionId,
      windowId: event.windowId ?? this.latestWindowId
    });

    // Reflect the terminal state in the live panel so an expired episode is visible without
    // reading the trace (F-03 / F-08).
    if (event.type === 'reverted' || event.type === 'dismissed') {
      debugBus.update({
        policyState: event.type === 'dismissed' ? 'DISMISSED' : 'EXPIRED',
        activeEpisodeId: undefined,
        activeIntervention: undefined,
        activeInterventionExpiresInMs: undefined,
        policyReason:
          event.reason === 'ttl'
            ? 'Adaptation expired after its TTL'
            : event.type === 'dismissed'
              ? 'Adaptation dismissed by the user'
              : 'Adaptation reverted'
      });
    }
  }

  /**
   * Starts a new intervention episode. An episode groups the
   * issued → accepted → applied → dismissed/reverted lifecycle of one adaptation.
   */
  private beginEpisode(predictionId?: string): string {
    this.episodeCounter++;
    this.currentEpisode = `ep_${this.episodeCounter}`;
    this.currentPredictionId = predictionId ?? this.currentPredictionId;
    return this.currentEpisode;
  }

  private episodeCounter = 0;
  private currentEpisode = 'ep_0';
  private currentPredictionId: string | undefined;

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
    // Epoch clock: `window.windowEnd` and `coveredThroughMs` are trace timestamps.
    const now = getWallClockTimestamp();
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

  /**
   * Bounded Fast Gate execution counters.
   *
   * Exposed so a researcher can tell a quiet session (nothing to mine) from a broken one
   * (evaluations being superseded or timing out). Silence was previously indistinguishable
   * from lost work (F-02).
   */
  public getMiningCounters(): MiningCounters {
    return { ...this.miningCounters };
  }

  /** Records the current mining counters into the trace before it is exported. */
  public syncMiningCountersToRecorder(): void {
    experimentRecorder.setMiningCounters(this.miningCounters);
    experimentRecorder.setModelProvenance(this.reportedModelVersion, this.executionProvider);
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
