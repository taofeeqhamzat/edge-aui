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
import { AdaptiveInferenceEngine } from '../gates/arbitration';
import { PrefixSpanFastGate } from '../gates/fast/prefixSpanFastGate';
import { MockSlowGate } from '../gates/slow/mockSlowGate';
import { InterventionPolicy, PolicyConfig } from '../intervention/policy';
import { UIActuator } from '../intervention/actuator';
import { experimentRecorder } from '../telemetry/recorder';
import { sessionManager } from '../telemetry/session';
import { taskManager } from '../testbed/tasks/taskManager';
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
import { PREPROCESSING_CONFIG } from '../config/pipelineConfig';

/**
 * Action semantics recorded against the task model for each observed event type.
 * `mousedown` is deliberately excluded so one click is not counted twice.
 */
const TASK_ACTION_BY_EVENT: Record<string, string> = {
  click: 'click',
  submit: 'submit',
  change: 'change',
  input: 'input'
};

/** Minimum interval between Slow Gate evaluations while the user is idle. */
const IDLE_EVALUATION_INTERVAL_MS = 2000;

/**
 * How long a window may remain pending when the stream goes silent.
 *
 * The outcome lookahead horizon is `[windowEnd + 500ms, windowEnd + 1500ms]`, so a
 * window's label cannot be settled until activity covering that span has been observed.
 * Deriving immediately would classify every window before its horizon and lose the
 * CLICK / FORM_SUBMIT / HOVER_DWELL signal entirely.
 *
 * While the user is active, a window is settled as soon as the next observed event moves
 * past its horizon. When the user stops interacting, this grace period bounds the wait so
 * genuinely idle windows are still labelled (as NO_OUTCOME).
 */
const PENDING_OUTCOME_GRACE_MS = 2000;

/**
 * Width of a PrefixSpan evaluation slot, in milliseconds.
 *
 * Consecutive macro actions are usually hundreds of milliseconds apart but are stamped
 * with different 250 ms window ids, so grouping by window id fragments an interaction
 * episode into single-symbol sequences and no multi-symbol pattern can ever reach
 * support. A wider slot keeps an episode (open filter, change region, apply) in one
 * sequence while still separating distinct episodes.
 */
const MACRO_SEQUENCE_SLOT_MS = 2000;

export interface AdaptiveRuntimeOptions {
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
  /** URL of the ONNX graph. Defaults to the bundled INT8 artifact. */
  modelUrl?: string;
  /** Minimum outcome confidence required to emit an intervention. */
  minOutcomeConfidence?: number;
  /** Skip worker dispatch entirely and evaluate in-process (tests). */
  forceInProcessWorker?: boolean;
  /** Auto-start on construction. Default false; call start(). */
  autoStart?: boolean;
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
}

export class AdaptiveRuntime {
  private observer: TelemetryObserver;
  private windowBuffer: RollingWindowBuffer;
  private macroStream: MacroInteractionStream;
  private outcomeDeriver: OutcomeDeriver;
  private workerClient: RuntimeWorkerClient;
  private inferenceEngine: AdaptiveInferenceEngine;
  private policy: InterventionPolicy;
  private actuator: UIActuator;

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
    this.conditionId = options.conditionId ?? 'adaptive';

    this.observer = new TelemetryObserver();
    this.windowBuffer = new RollingWindowBuffer({
      emitInactiveWindows: true,
      // Delay slot processing by exactly one stride so events arriving within the next
      // stride can still fill the previous window. Processing immediately made a window
      // holding fewer than `min_events_per_window` events permanently un-emittable.
      flushDelayMs: PREPROCESSING_CONFIG.stride_ms
    });
    // A full trial can produce more than the default 100 macro interactions; the
    // evaluation window and the PrefixSpan corpus both read from this history.
    this.macroStream = new MacroInteractionStream({ maxCapacity: 400 });
    this.outcomeDeriver = new OutcomeDeriver();

    this.workerClient = new RuntimeWorkerClient({
      useFallback: options.forceInProcessWorker ?? false
    });

    this.inferenceEngine = new AdaptiveInferenceEngine({
      fastGate: new PrefixSpanFastGate({
        getSequences: () => this.getMacroSequences(),
        minSupport: options.minPatternSupport ?? 2,
        resolveIntervention: options.fastGatePatterns
          ? (patternKey) => options.fastGatePatterns?.[patternKey] ?? null
          : () => null
      }),
      slowGate: options.enableSlowGate === false ? undefined : new MockSlowGate(),
      enableFastGate: true,
      enableSlowGate: options.enableSlowGate !== false
    });

    this.policy = new InterventionPolicy(options.policyConfig);
    this.actuator = new UIActuator();

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

        // Bridge observed interactions into the experimental task state machine. Without
        // this no task step could ever be satisfied. It lives here rather than in the
        // dev-only diagnostics module so task tracking also works in a production build.
        const taskAction = TASK_ACTION_BY_EVENT[event.type];
        if (taskAction && event.componentId) {
          taskManager.recordInteraction(event.componentId, taskAction);
        }
        if (event.type === 'navigation' && taskManager.getState().status === 'In Progress') {
          taskManager.abandonTask('navigation');
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
        debugBus.update({ latestMacroSequence: this.macroStream.getRecentSymbols(6) });
      })
    );

    // 5. Actuator telemetry → experiment recorder, stamped with episode identity.
    this.unsubscribers.push(
      this.actuator.onInterventionEvent((event) => this.handleInterventionEvent(event))
    );

    // 6. Reset adaptation state whenever the task changes (§25 P1) and record the
    //    task lifecycle into the trace so trials are observable (§6.2).
    this.unsubscribers.push(
      taskManager.subscribe((state) => {
        this.policy.reset();
        if (state.currentTaskId) {
          sessionManager.setTaskId(state.currentTaskId);
        }
      })
    );

    this.unsubscribers.push(
      taskManager.onLifecycle((event) => {
        experimentRecorder.recordTaskEvent({
          ...event,
          sessionId: sessionManager.getActiveSession()?.sessionId,
          experimentId: this.options.experimentId,
          conditionId: this.conditionId
        });
      })
    );

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
    // The Slow Gate consumes a sequence of T=8 windows; evaluating before the
    // sequence exists would feed it a zero-padded tensor.
    if (this.processedWindowCount < 8) return;

    // Evaluating on a genuinely inactive window produces a prediction for silence,
    // which inflates the trace and wastes edge compute. Evaluate when either the
    // closing window contained activity, or enough time has passed that the state
    // genuinely changed while idle.
    const window = this.latestWindow;
    const hadActivity = Boolean(window && (window.eventCount ?? 0) > 0);
    const sinceLastEvaluation = getMonotonicTimestamp() - this.lastEvaluationMs;
    if (!hadActivity && sinceLastEvaluation < IDLE_EVALUATION_INTERVAL_MS) {
      return;
    }

    void this.evaluateAndAct();
  }

  private async evaluateAndAct(): Promise<void> {
    this.evaluating = true;
    this.lastEvaluationMs = getMonotonicTimestamp();
    const start = this.lastEvaluationMs;

    try {
      const uiContext: UIContext = getActiveUIContext();
      // Pass the fresh macro sequence explicitly. Relying on the worker's own macro
      // history made the Fast Gate evaluate a corpus that lagged the just-closed
      // window, so patterns that had only just become frequent were never matched.
      const macroSequence = this.macroStream.getRecent(40);
      const result: InferenceResult = await this.workerClient.evaluate(uiContext, macroSequence);

      experimentRecorder.recordPrediction({
        timestamp: result.timestamp,
        sessionId: sessionManager.getActiveSession()?.sessionId,
        experimentId: this.options.experimentId,
        conditionId: this.conditionId,
        windowId: this.latestWindowId,
        matchedGate: result.matchedGate,
        outcome: result.slowResult?.outcome,
        interventionType: result.intervention?.type,
        confidence: result.intervention?.confidence ?? result.slowResult?.confidence,
        latencyMs: result.latencyMs,
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

    const lookaheadMax = 1500;
    const now = getMonotonicTimestamp();
    const stillPending: MicroTensorWindow[] = [];

    for (const window of this.pendingOutcomeWindows) {
      const horizonEnd = window.windowEnd + lookaheadMax;
      const horizonCovered = this.coveredThroughMs >= horizonEnd;
      const idleGraceExpired = now - horizonEnd >= PENDING_OUTCOME_GRACE_MS;

      if (!horizonCovered && !idleGraceExpired) {
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
      { sessionTerminated: this.streamEnded }
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
   * MACRO_SEQUENCE_SLOT_MS so an interaction episode (open filter, change region, apply)
   * forms one sequence.
   */
  public getMacroSequences(): string[][] {
    const all = this.macroStream.getRecent(this.macroStream.length);
    const bySlot = new Map<number, string[]>();

    for (const interaction of all) {
      const slot = Math.floor(interaction.timestamp / MACRO_SEQUENCE_SLOT_MS);
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
      modelLoaded: this.modelLoaded
    };
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getCondition(): ExperimentalCondition {
    return this.conditionId;
  }

  /**
   * Returns the already-encoded context vector for the current UI snapshot, which is
   * what a real target head consumes (assessment §15).
   */
  public getContextVector(): Float32Array {
    return encodeUIContext(getActiveUIContext());
  }

  /** Test seam: exposes the composed stages for direct exercise. */
  public getInternals(): {
    observer: TelemetryObserver;
    windowBuffer: RollingWindowBuffer;
    macroStream: MacroInteractionStream;
    outcomeDeriver: OutcomeDeriver;
    inferenceEngine: AdaptiveInferenceEngine;
    policy: InterventionPolicy;
    actuator: UIActuator;
  } {
    return {
      observer: this.observer,
      windowBuffer: this.windowBuffer,
      macroStream: this.macroStream,
      outcomeDeriver: this.outcomeDeriver,
      inferenceEngine: this.inferenceEngine,
      policy: this.policy,
      actuator: this.actuator
    };
  }
}

/**
 * Factory helper.
 */
export function createAdaptiveRuntime(options?: AdaptiveRuntimeOptions): AdaptiveRuntime {
  return new AdaptiveRuntime(options);
}
