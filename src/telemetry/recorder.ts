/**
 * In-Memory Experiment Trace Recorder
 * Implements Stage 4.3 & Stage 10.1 specifications from docs/testbed/prd.md Sections 33-34 & docs/plan/tasks/10.1.md.
 * Manages chronological event logs and JSON export without remote telemetry transmission.
 */

import {
  BehaviourEvent,
  MicroTensorWindow,
  MacroInteraction,
  OutcomeEvent,
  PredictionEvent,
  PolicyDecisionEvent,
  InterventionEvent,
  TaskEvent,
  ExperimentalCondition
} from './events';
import { SessionContext, SessionProvenance, sessionManager } from './session';
import { TESTBED_UI_VERSION } from '../types/uiContext.js';
import { UiTaskStateSnapshot, DEFAULT_TASK_STATE } from '../integration/index';
import { PREPROCESSING_CONFIG, PIPELINE_CONFIG } from '../config/pipelineConfig';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '../config/runtimeConfig';
import { defaultCollector } from '../runtime/instrumentation';
import { getWallClockTimestamp } from './normalizer';
import { APPLICATION_VERSION, POLICY_VERSION } from './version';
import {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  TRACE_CLOCK_MODE,
  validateExperimentTrace,
  reconstructReplayStream,
  type SerializableMicroTensorWindow,
  type SerializableExperimentTrace,
  type TraceReplayMetadata,
  type TraceValidationResult,
  type ReplayStreamItem,
  findOrphanedWindows,
  type MiningCounters,
  type EvictionCounters
} from './traceSchema';

export {
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  TRACE_CLOCK_MODE,
  validateExperimentTrace,
  reconstructReplayStream,
  findOrphanedWindows
};

export type {
  SerializableMicroTensorWindow,
  SerializableExperimentTrace,
  TraceReplayMetadata,
  TraceValidationResult,
  ReplayStreamItem,
  MiningCounters,
  EvictionCounters
};

export interface ExperimentTrace {
  schemaVersion: string;
  session: SessionContext;
  task?: UiTaskStateSnapshot;
  effectiveConfig?: RuntimeConfig;
  behaviourEvents: BehaviourEvent[];
  microTensors: MicroTensorWindow[];
  macroInteractions: MacroInteraction[];
  outcomes: OutcomeEvent[];
  predictions: PredictionEvent[];
  policyDecisions: PolicyDecisionEvent[];
  interventions: InterventionEvent[];
  taskEvents: TaskEvent[];
}

/** Buffer names used for eviction accounting, so a truncation names the buffer it hit. */
export const TRACE_BUFFER_NAMES = [
  'behaviourEvents',
  'microTensors',
  'macroInteractions',
  'outcomes',
  'predictions',
  'policyDecisions',
  'interventions',
  'taskEvents'
] as const;

export type TraceBufferName = (typeof TRACE_BUFFER_NAMES)[number];

export interface ExperimentRecorderOptions {
  maxBufferSize?: number;
}

export class ExperimentRecorder {
  private behaviourEvents: BehaviourEvent[] = [];
  private microTensors: MicroTensorWindow[] = [];
  private macroInteractions: MacroInteraction[] = [];
  private outcomes: OutcomeEvent[] = [];
  private predictions: PredictionEvent[] = [];
  private policyDecisions: PolicyDecisionEvent[] = [];
  private interventions: InterventionEvent[] = [];
  private taskEvents: TaskEvent[] = [];

  private maxBufferSize: number;

  /**
   * Per-buffer eviction counts. `shift()` on overflow used to be silent, so a long session
   * lost its beginning with no evidence in the record (F-16). Counting makes truncation
   * visible and prevents an incomplete trace from being analysed as if whole.
   */
  private evictions: Record<string, number> = {
    behaviourEvents: 0,
    microTensors: 0,
    macroInteractions: 0,
    outcomes: 0,
    predictions: 0,
    policyDecisions: 0,
    interventions: 0,
    taskEvents: 0
  };

  /**
   * Session snapshot captured when recording begins. Retaining the session at start
   * (rather than reading the live singleton at export time) means an exported trace
   * can never be attributed to a different session than the one that produced it.
   */
  private sessionSnapshot: SessionContext | null = null;
  private taskStateProvider: (() => UiTaskStateSnapshot | undefined) | null = null;
  private effectiveConfig: RuntimeConfig | null = null;
  /** Model provenance as actually reported by the runtime, not as requested (F-10, F-19). */
  private modelVersion: string | null = null;
  private executionProvider: string | null = null;
  private miningCounters: MiningCounters | null = null;

  constructor(options: ExperimentRecorderOptions = {}) {
    // Default 10,000 events preserves memory strictly under the 20MB budget
    this.maxBufferSize = options.maxBufferSize ?? 10000;
  }

  /** Sets the task state provider callback to query the active task state without coupling to testbed. */
  public setTaskStateProvider(provider: (() => UiTaskStateSnapshot | undefined) | null): void {
    this.taskStateProvider = provider;
  }

  /** Sets the effective runtime configuration snapshot for reproducible trace export. */
  public setEffectiveConfig(config: RuntimeConfig | null): void {
    this.effectiveConfig = config;
  }

  /**
   * Records the model provenance the runtime actually observed, so the trace identifies the
   * deployed model instead of a hardcoded literal (F-19) and the provider that actually
   * served inference rather than the one requested (F-10).
   */
  public setModelProvenance(modelVersion: string | null, executionProvider: string | null): void {
    if (modelVersion !== null) this.modelVersion = modelVersion;
    if (executionProvider !== null) this.executionProvider = executionProvider;
  }

  /** Records bounded Fast Gate execution counters for the exported trace (F-02). */
  public setMiningCounters(counters: MiningCounters | null): void {
    this.miningCounters = counters ? { ...counters } : null;
  }

  /** Binds the trace to a session, called when a session starts. */
  public bindSession(session: SessionContext): void {
    this.sessionSnapshot = { ...session };
  }

  public getSessionId(): string | undefined {
    return this.sessionSnapshot?.sessionId;
  }

  public getExperimentId(): string | undefined {
    return this.sessionSnapshot?.experimentId;
  }

  public getConditionId(): ExperimentalCondition | undefined {
    return this.sessionSnapshot?.conditionId;
  }

  public getProvenance(): SessionProvenance {
    return this.sessionSnapshot?.provenance ?? 'scripted';
  }

  /**
   * Appends to a buffer, counting any eviction. Every buffer uses this so truncation is
   * always accounted for — a silent `shift()` is indistinguishable from data that never
   * existed (F-16).
   */
  private append<T>(buffer: TraceBufferName, target: T[], item: T): void {
    if (target.length >= this.maxBufferSize) {
      target.shift();
      this.evictions[buffer] += 1;
    }
    target.push(item);
  }

  public recordBehaviourEvent(event: BehaviourEvent): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('behaviourEvents', this.behaviourEvents, event);
    });
  }

  public recordMicroTensor(window: MicroTensorWindow): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('microTensors', this.microTensors, window);
    }, { windowId: window.windowId });
  }

  public recordMacroInteraction(event: MacroInteraction): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('macroInteractions', this.macroInteractions, event);
    }, { windowId: event.windowId });
  }

  public recordOutcome(event: OutcomeEvent): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('outcomes', this.outcomes, event);
    }, { windowId: event.windowId });
  }

  public recordPrediction(event: PredictionEvent): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('predictions', this.predictions, event);
    }, { windowId: event.windowId });
  }

  public recordPolicyDecision(event: PolicyDecisionEvent): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('policyDecisions', this.policyDecisions, event);
    }, { windowId: event.windowId });
  }

  public recordIntervention(event: InterventionEvent): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('interventions', this.interventions, event);
    });
  }

  public recordTaskEvent(event: TaskEvent): void {
    defaultCollector.timeSync('trace recording', 'main', () => {
      this.append('taskEvents', this.taskEvents, event);
    });
  }

  /**
   * Resolves the session to attribute this trace to: the bound snapshot if one exists,
   * otherwise the live active session, otherwise an explicit anonymous fallback.
   */
  private resolveSession(): SessionContext {
    const resolved =
      this.sessionSnapshot ??
      sessionManager.getActiveSession() ?? {
        sessionId: 'anonymous-unassigned',
        startedAt: 0,
        startedAtEpochMs: 0
      };

    // Always surface an explicit condition so a trace can never be ambiguous about
    // whether adaptation was permitted (assessment §17).
    return {
      ...resolved,
      conditionId: resolved.conditionId ?? 'baseline'
    };
  }

  /**
   * Returns a snapshot of the full chronological experiment trace with in-memory Float32Array microtensors.
   */
  public export(): ExperimentTrace {
    const task = this.taskStateProvider ? this.taskStateProvider() : undefined;
    return {
      schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      session: this.resolveSession(),
      task,
      effectiveConfig: this.effectiveConfig ?? undefined,
      behaviourEvents: [...this.behaviourEvents],
      microTensors: [...this.microTensors],
      macroInteractions: [...this.macroInteractions],
      outcomes: [...this.outcomes],
      predictions: [...this.predictions],
      policyDecisions: [...this.policyDecisions],
      interventions: [...this.interventions],
      taskEvents: [...this.taskEvents]
    };
  }

  /**
   * Detects the integrity problems a researcher must not have to discover by accident.
   * Returns an empty array for a clean capture.
   */
  private collectIntegrityWarnings(session: SessionContext): string[] {
    const warnings: string[] = [];

    const evictions = this.getEvictionCounters();
    if (evictions.truncated) {
      const detail = Object.entries(evictions.byBuffer)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${name}=${count}`)
        .join(', ');
      warnings.push(
        `Trace is truncated: ${evictions.total} record(s) were evicted by the buffer cap (${detail}). ` +
          'The beginning of the session is missing and this trace must not be analysed as whole.'
      );
    }

    const appliedEpisodes = new Map<string, number>();
    const terminalEpisodes = new Set<string>();
    for (const event of this.interventions) {
      if (!event.interventionEpisodeId) continue;
      if (event.type === 'applied') {
        appliedEpisodes.set(event.interventionEpisodeId, (appliedEpisodes.get(event.interventionEpisodeId) ?? 0) + 1);
      } else if (event.type === 'reverted' || event.type === 'dismissed') {
        terminalEpisodes.add(event.interventionEpisodeId);
      }
    }
    const unterminated = [...appliedEpisodes.keys()].filter((id) => !terminalEpisodes.has(id));
    if (unterminated.length > 0) {
      warnings.push(
        `Intervention episode(s) applied with no terminal event: ${unterminated.join(', ')}. ` +
          'An adaptation with no recorded expiry or dismissal leaves the rest of the session contaminated.'
      );
    }

    const windowsWithOutcome = new Set(
      this.outcomes.map((o) => o.windowId).filter((id): id is number => typeof id === 'number')
    );

    // Only a *stale* window is orphaned; windows still inside their settlement allowance are
    // in flight, not missing. The definition is shared with the trace verifier so a live capture
    // and the verifier cannot disagree about what "orphaned" means (F-13).
    const lookaheadMaxMs = PIPELINE_CONFIG.target_generation.lookahead_horizon_ms[1];
    const pendingOutcomeGraceMs =
      this.effectiveConfig?.windowing?.pendingOutcomeGraceMs ??
      DEFAULT_RUNTIME_CONFIG.windowing.pendingOutcomeGraceMs;
    const orphanedWindows = findOrphanedWindows(
      this.microTensors,
      windowsWithOutcome,
      lookaheadMaxMs,
      pendingOutcomeGraceMs
    );

    if (orphanedWindows.length > 0) {
      warnings.push(
        `${orphanedWindows.length} MicroTensor window(s) passed their settlement allowance with no outcome record ` +
          `(first: ${orphanedWindows.slice(0, 5).join(', ')}).`
      );
    }

    // Provenance must never be absent: an unlabelled trace could be mistaken for
    // participant data (ADR-018).
    if (session.provenance !== 'scripted' && session.provenance !== 'participant') {
      warnings.push("Session provenance is missing; the trace cannot be classified as scripted or participant.");
    }

    return warnings;
  }

  /**
   * Produces a fully serializable, schema-compliant experiment trace object.
   */
  public exportSerializable(): SerializableExperimentTrace {
    const activeSession = this.resolveSession();
    const taskState = this.taskStateProvider ? (this.taskStateProvider() ?? DEFAULT_TASK_STATE) : DEFAULT_TASK_STATE;
    // durationMs is measured on the canonical clock. Subtracting the monotonic
    // `startedAt` from `Date.now()` produced a meaningless value (assessment §16.4).
    const now = getWallClockTimestamp();
    const startedAtEpochMs = activeSession.startedAtEpochMs ?? 0;
    const durationMs = startedAtEpochMs > 0 ? Math.max(0, now - startedAtEpochMs) : 0;

    const totalEvents =
      this.behaviourEvents.length +
      this.microTensors.length +
      this.macroInteractions.length +
      this.outcomes.length +
      this.predictions.length +
      this.policyDecisions.length +
      this.interventions.length +
      this.taskEvents.length;

    const integrityWarnings = this.collectIntegrityWarnings(activeSession);

    const metadata: TraceReplayMetadata = {
      durationMs,
      totalEvents,
      behaviourCount: this.behaviourEvents.length,
      microTensorCount: this.microTensors.length,
      macroCount: this.macroInteractions.length,
      outcomeCount: this.outcomes.length,
      predictionCount: this.predictions.length,
      interventionCount: this.interventions.length,
      policyDecisionCount: this.policyDecisions.length,
      taskEventCount: this.taskEvents.length,
      finalTaskStatus: taskState.status,
      experimentId: activeSession.experimentId,
      conditionId: activeSession.conditionId,
      uiVersion: TESTBED_UI_VERSION,
      settlementDelayMs: PREPROCESSING_CONFIG.settlement_delay_ms ?? PREPROCESSING_CONFIG.stride_ms,
      effectiveConfig: this.effectiveConfig ?? undefined,
      clock: TRACE_CLOCK_MODE,
      provenance: activeSession.provenance ?? 'scripted',
      applicationVersion: APPLICATION_VERSION,
      modelVersion: this.modelVersion ?? undefined,
      executionProvider: this.executionProvider ?? undefined,
      policyVersion: POLICY_VERSION,
      mining: this.miningCounters ?? undefined,
      evictions: this.getEvictionCounters(),
      integrityWarnings
    };

    return {
      schemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      session: activeSession,
      task: taskState,
      metadata,
      effectiveConfig: this.effectiveConfig ?? undefined,
      behaviourEvents: [...this.behaviourEvents],
      // Window bounds are already on the canonical clock: the window grid is anchored to the
      // first observed event timestamp and advanced by `getWallClockTimestamp()`, and observed
      // event timestamps are epoch milliseconds. They are therefore written through unchanged.
      // An earlier revision of this export applied a session epoch offset here as well, which
      // double-counted it and produced window bounds ~2x the event timeline.
      microTensors: this.microTensors.map((m) => ({
        windowId: m.windowId,
        windowStart: m.windowStart,
        windowEnd: m.windowEnd,
        values: Array.from(m.values),
        eventCount: m.eventCount,
        inactive: m.inactive
      })),
      macroInteractions: [...this.macroInteractions],
      outcomes: [...this.outcomes],
      predictions: [...this.predictions],
      policyDecisions: [...this.policyDecisions],
      interventions: [...this.interventions],
      taskEvents: [...this.taskEvents]
    };
  }

  /**
   * Produces a JSON string of the trace adhering strictly to SerializableExperimentTrace.
   */
  public exportJSON(pretty = false): string {
    const serializable = this.exportSerializable();
    return pretty ? JSON.stringify(serializable, null, 2) : JSON.stringify(serializable);
  }

  /**
   * Triggers an in-browser direct file download of the recorded trace as JSON.
   * Runs entirely client-side without any server or external telemetry dependency.
   */
  public downloadTraceAsJSON(filename?: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      console.warn('[ExperimentRecorder] downloadTraceAsJSON is only available in browser environments.');
      return;
    }

    const json = this.exportJSON(true);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const activeSession = sessionManager.getActiveSession();
    const sessionId = activeSession?.sessionId ?? 'unknown-session';
    const resolvedFilename = filename ?? `experiment-trace-${sessionId}-${Date.now()}.json`;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = resolvedFilename;
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Reconstructs an ordered replay stream from the current recorder buffer.
   */
  public getReplayStream(): ReplayStreamItem[] {
    return reconstructReplayStream(this.exportSerializable());
  }

  /**
   * Clears all recorded buffers. The session binding is retained so a cleared trace
   * is still attributable to the session it belongs to.
   */
  public clear(): void {
    this.behaviourEvents = [];
    this.microTensors = [];
    this.macroInteractions = [];
    this.outcomes = [];
    this.predictions = [];
    this.policyDecisions = [];
    this.interventions = [];
    this.taskEvents = [];
    for (const name of TRACE_BUFFER_NAMES) {
      this.evictions[name] = 0;
    }
    this.miningCounters = null;
  }

  /**
   * Returns the proof that telemetry was not silently truncated. `truncated` is true when
   * any buffer evicted a record, which means the trace is missing its earliest data.
   */
  public getEvictionCounters(): EvictionCounters {
    const byBuffer: Record<string, number> = {};
    let total = 0;
    for (const name of TRACE_BUFFER_NAMES) {
      const count = this.evictions[name] ?? 0;
      byBuffer[name] = count;
      total += count;
    }
    return { total, byBuffer, truncated: total > 0 };
  }

  /**
   * Returns counts of events currently buffered in memory.
   */
  public getEventCounts(): {
    behaviourEvents: number;
    microTensors: number;
    macroInteractions: number;
    outcomes: number;
    predictions: number;
    policyDecisions: number;
    interventions: number;
    taskEvents: number;
    total: number;
  } {
    const counts = {
      behaviourEvents: this.behaviourEvents.length,
      microTensors: this.microTensors.length,
      macroInteractions: this.macroInteractions.length,
      outcomes: this.outcomes.length,
      predictions: this.predictions.length,
      policyDecisions: this.policyDecisions.length,
      interventions: this.interventions.length,
      taskEvents: this.taskEvents.length
    };
    return {
      ...counts,
      total:
        counts.behaviourEvents +
        counts.microTensors +
        counts.macroInteractions +
        counts.outcomes +
        counts.predictions +
        counts.policyDecisions +
        counts.interventions +
        counts.taskEvents
    };
  }
}

/**
 * Singleton shared experiment trace recorder.
 */
export const experimentRecorder = new ExperimentRecorder();
