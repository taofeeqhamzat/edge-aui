/**
 * Runtime Outcome Derivation
 *
 * Ports the deterministic lookahead-outcome policy from
 * `model-preparation/src/target_generation.py` (`extract_lookahead_outcome`,
 * `extract_outcome_for_window`) into the browser so the target environment can emit
 * observable ground truth independently of any model prediction.
 *
 * Methodological guardrails preserved from the Python reference:
 * - The lookahead horizon is `[window_end + 500ms, window_end + 1500ms]`.
 * - The earliest qualifying event wins; the priority hierarchy is applied ONLY to
 *   break ties between candidates sharing the earliest timestamp (1 ms tolerance).
 * - `ABANDON` requires an observable DOM lifecycle event (pagehide, beforeunload,
 *   unload) or an explicitly terminated stream.
 * - `NO_OUTCOME` is a legitimate class representing inactivity or ordinary reading
 *   pauses without a qualifying macro-action.
 */

import {
  BehaviourEvent,
  OutcomeEvent,
  OutcomeType,
  OutcomeDerivationMetadata,
  ExperimentalCondition
} from '../telemetry/events';

/** Priority hierarchy (highest first), from model-preparation/src/config.yaml. */
export const PRIORITY_HIERARCHY: OutcomeType[] = [
  'FORM_SUBMIT',
  'CLICK',
  'BACKTRACK',
  'RAPID_SCROLL',
  'HOVER_DWELL',
  'ABANDON',
  'NO_OUTCOME'
];

/** Higher rank wins. Derived so the ranks always follow PRIORITY_HIERARCHY. */
export const PRIORITY_RANK: Record<OutcomeType, number> = PRIORITY_HIERARCHY.reduce(
  (acc, name, idx) => {
    acc[name] = PRIORITY_HIERARCHY.length - idx;
    return acc;
  },
  {} as Record<OutcomeType, number>
);

/** Outcome id mapping, aligned with model-preparation/src/config.yaml outcome_taxonomy. */
export const OUTCOME_NAME_TO_ID: Record<OutcomeType, number> = {
  NO_OUTCOME: 0,
  CLICK: 1,
  FORM_SUBMIT: 2,
  BACKTRACK: 3,
  RAPID_SCROLL: 4,
  HOVER_DWELL: 5,
  ABANDON: 6
};

export const DEFAULT_LOOKAHEAD_MIN_MS = 500;
export const DEFAULT_LOOKAHEAD_MAX_MS = 1500;
export const DEFAULT_RAPID_SCROLL_MIN_EVENTS = 4;
export const DEFAULT_HOVER_DWELL_MIN_EVENTS = 2;
const LIFECYCLE_EVENT_TYPES = new Set(['beforeunload', 'pagehide', 'unload']);
const TIE_TOLERANCE_MS = 1.0;

export interface DeriveOutcomeOptions {
  lookaheadMinMs?: number;
  lookaheadMaxMs?: number;
  rapidScrollMinEvents?: number;
  hoverDwellMinEvents?: number;
}

export interface DeriveOutcomeInput {
  /** End of the MicroTensor window the outcome is being attached to. */
  windowEndMs: number;
  /**
   * Events whose timestamps fall inside the lookahead horizon. Callers may pass a
   * superset; the deriver filters strictly.
   */
  futureEvents: BehaviourEvent[];
  /**
   * True when the recorded session is known to have terminated at or before the
   * lookahead horizon (stream exhaustion). Mirrors `session_terminated`.
   *
   * This must be supplied by the caller when the stream genuinely ends (page
   * unload, explicit end of trial). It must NOT be inferred from "no event has
   * arrived yet": during a live session the horizon is always ahead of the newest
   * event, which would label every window ABANDON.
   */
  sessionTerminated?: boolean;
}

interface Candidate {
  outcome: OutcomeType;
  timestamp: number;
  rank: number;
  source: OutcomeDerivationMetadata['source'];
  event: BehaviourEvent;
}

function isFormSubmitTarget(componentId: string | undefined, componentRole: string | undefined): boolean {
  const haystack = `${componentId ?? ''} ${componentRole ?? ''}`.toLowerCase();
  return ['submit', 'btn', 'button', 'input', 'form', 'primary-action'].some((term) =>
    haystack.includes(term)
  );
}

/**
 * Derives the outcome label for one window. Pure and deterministic: identical inputs
 * always produce an identical label.
 */
export function deriveOutcomeForWindow(
  input: DeriveOutcomeInput,
  options: DeriveOutcomeOptions = {}
): { outcome: OutcomeType; metadata: OutcomeDerivationMetadata; sourceEvent?: BehaviourEvent } {
  const lookaheadMinMs = options.lookaheadMinMs ?? DEFAULT_LOOKAHEAD_MIN_MS;
  const lookaheadMaxMs = options.lookaheadMaxMs ?? DEFAULT_LOOKAHEAD_MAX_MS;
  const rapidScrollMinEvents = options.rapidScrollMinEvents ?? DEFAULT_RAPID_SCROLL_MIN_EVENTS;
  const hoverDwellMinEvents = options.hoverDwellMinEvents ?? DEFAULT_HOVER_DWELL_MIN_EVENTS;

  const lookaheadStartMs = input.windowEndMs + lookaheadMinMs;
  const lookaheadEndMs = input.windowEndMs + lookaheadMaxMs;

  const metadata: OutcomeDerivationMetadata = {
    lookaheadStartMs,
    lookaheadEndMs,
    candidateCount: 0,
    earliestTimestampMs: null,
    tieBroken: false,
    source: 'none',
    observableTermination: false
  };

  // Strict horizon filter, mirroring extract_outcome_for_window.
  const inHorizon = input.futureEvents
    .filter((ev) => ev.timestamp >= lookaheadStartMs && ev.timestamp <= lookaheadEndMs)
    .sort((a, b) => a.timestamp - b.timestamp);

  const candidates: Candidate[] = [];
  let scrollEventsSeen = 0;
  let hoverEventsSeen = 0;

  for (const ev of inHorizon) {
    const type = ev.type;

    if (type === 'click' || type === 'mousedown') {
      const outcome: OutcomeType = isFormSubmitTarget(ev.componentId, ev.componentRole)
        ? 'FORM_SUBMIT'
        : 'CLICK';
      candidates.push({
        outcome,
        timestamp: ev.timestamp,
        rank: PRIORITY_RANK[outcome],
        source: 'dom_action',
        event: ev
      });
      continue;
    }

    if (LIFECYCLE_EVENT_TYPES.has(type)) {
      candidates.push({
        outcome: 'ABANDON',
        timestamp: ev.timestamp,
        rank: PRIORITY_RANK.ABANDON,
        source: 'lifecycle_event',
        event: ev
      });
      continue;
    }

    if (type === 'blur' || type === 'popstate' || type === 'hashchange') {
      candidates.push({
        outcome: 'BACKTRACK',
        timestamp: ev.timestamp,
        rank: PRIORITY_RANK.BACKTRACK,
        source: 'navigation_shift',
        event: ev
      });
      continue;
    }

    if (type === 'scroll' || type === 'wheel') {
      scrollEventsSeen += 1;
      if (scrollEventsSeen === rapidScrollMinEvents) {
        candidates.push({
          outcome: 'RAPID_SCROLL',
          timestamp: ev.timestamp,
          rank: PRIORITY_RANK.RAPID_SCROLL,
          source: 'motor_stream',
          event: ev
        });
      }
      continue;
    }

    if (type === 'mouseover') {
      hoverEventsSeen += 1;
      if (hoverEventsSeen === hoverDwellMinEvents) {
        candidates.push({
          outcome: 'HOVER_DWELL',
          timestamp: ev.timestamp,
          rank: PRIORITY_RANK.HOVER_DWELL,
          source: 'motor_stream',
          event: ev
        });
      }
    }
  }

  metadata.candidateCount = candidates.length;

  if (candidates.length === 0) {
    if (input.sessionTerminated) {
      metadata.source = 'stream_exhaustion';
      metadata.observableTermination = false;
      return { outcome: 'ABANDON', metadata };
    }
    return { outcome: 'NO_OUTCOME', metadata };
  }

  // Earliest-event temporal selection, then hierarchy strictly as a tie-breaker.
  const earliestTs = Math.min(...candidates.map((c) => c.timestamp));
  metadata.earliestTimestampMs = earliestTs;

  const tied = candidates.filter((c) => Math.abs(c.timestamp - earliestTs) <= TIE_TOLERANCE_MS);
  if (tied.length > 1) {
    metadata.tieBroken = true;
  }
  tied.sort((a, b) => b.rank - a.rank);

  const winner = tied[0];
  metadata.source = winner.source;
  if (winner.outcome === 'ABANDON') {
    metadata.observableTermination = winner.source === 'lifecycle_event';
  }

  return { outcome: winner.outcome, metadata, sourceEvent: winner.event };
}

export interface OutcomeDeriverOptions extends DeriveOutcomeOptions {
  /** How long lookahead events are retained for outcome derivation. Default 10s. */
  retentionMs?: number;
  maxBufferedEvents?: number;
}

export interface OutcomeDeriverContext {
  sessionId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
}

/**
 * Live outcome deriver. Buffers recent canonical events so a window's lookahead
 * horizon can be resolved as soon as it closes, without waiting for the session to end.
 */
export class OutcomeDeriver {
  private buffer: BehaviourEvent[] = [];
  private readonly retentionMs: number;
  private readonly maxBufferedEvents: number;
  private readonly options: DeriveOutcomeOptions;
  private lastKnownTimestamp = 0;
  /** True once the stream is known to have ended; see endSession(). */
  private streamEnded = false;

  constructor(options: OutcomeDeriverOptions = {}) {
    this.retentionMs = options.retentionMs ?? 10_000;
    this.maxBufferedEvents = options.maxBufferedEvents ?? 5_000;
    this.options = {
      lookaheadMinMs: options.lookaheadMinMs,
      lookaheadMaxMs: options.lookaheadMaxMs,
      rapidScrollMinEvents: options.rapidScrollMinEvents,
      hoverDwellMinEvents: options.hoverDwellMinEvents
    };
  }

  public push(event: BehaviourEvent): void {
    this.buffer.push(event);
    if (event.timestamp > this.lastKnownTimestamp) {
      this.lastKnownTimestamp = event.timestamp;
    }
    if (this.buffer.length > this.maxBufferedEvents) {
      this.buffer.shift();
    }
  }

  /**
   * Derives the outcome for a closed window and clears events that can no longer
   * contribute to a future horizon.
   *
   * `sessionTerminated` reflects an explicit end-of-stream signal only. In a live
   * session the lookahead horizon is by construction ahead of the newest event, so
   * treating that as termination would classify every window as ABANDON.
   */
  public deriveForWindow(
    window: { windowId: number; windowEnd: number },
    context: OutcomeDeriverContext,
    options: { sessionTerminated?: boolean } = {}
  ): OutcomeEvent {
    const lookaheadMin = this.options.lookaheadMinMs ?? DEFAULT_LOOKAHEAD_MIN_MS;
    const lookaheadMax = this.options.lookaheadMaxMs ?? DEFAULT_LOOKAHEAD_MAX_MS;
    const windowEndMs = window.windowEnd;

    // A window's lookahead horizon is only settled once the stream has advanced past it.
    const lookaheadComplete =
      this.streamEnded || this.lastKnownTimestamp >= windowEndMs + lookaheadMax;

    const { outcome, metadata, sourceEvent } = deriveOutcomeForWindow(
      {
        windowEndMs,
        futureEvents: this.buffer,
        sessionTerminated: Boolean(options.sessionTerminated)
      },
      this.options
    );

    const outcomeEvent: OutcomeEvent = {
      timestamp: sourceEvent ? sourceEvent.timestamp : windowEndMs,
      outcome,
      lookaheadComplete,
      sessionId: context.sessionId,
      windowId: window.windowId,
      experimentId: context.experimentId,
      conditionId: context.conditionId,
      sourceEventTimestamp: sourceEvent?.timestamp,
      sourceEventType: sourceEvent?.type,
      componentId: sourceEvent?.componentId,
      taskId: sourceEvent?.taskId,
      taskStepId: sourceEvent?.taskStepId,
      route: sourceEvent?.route,
      derivation: metadata
    };

    // Events older than the lookahead horizon can no longer affect any future window.
    this.evictOlderThan(windowEndMs + lookaheadMin);
    return outcomeEvent;
  }

  /**
   * Marks the stream as ended so windows whose horizon falls past the final event are
   * labelled ABANDON rather than NO_OUTCOME. Call on page unload or trial teardown.
   */
  public endSession(): void {
    this.streamEnded = true;
  }

  public isStreamEnded(): boolean {
    return this.streamEnded;
  }

  private evictOlderThan(windowEndMs: number): void {
    const cutoff = windowEndMs - this.retentionMs;
    let removeCount = 0;
    while (removeCount < this.buffer.length && this.buffer[removeCount].timestamp < cutoff) {
      removeCount++;
    }
    if (removeCount > 0) {
      this.buffer.splice(0, removeCount);
    }
  }

  public get bufferedCount(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
    this.lastKnownTimestamp = 0;
    this.streamEnded = false;
  }
}
