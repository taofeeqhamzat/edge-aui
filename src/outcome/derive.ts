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
import { canonicalActionFor, isSubmitControl } from './canonical';
import type { SemanticOutcome, SemanticOutcomeDeriver } from './semantic';

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

/**
 * Whether an event commits a form submission.
 *
 * Delegated to the canonical action layer, whose rule is annotation-based: a control is a
 * submit control when its annotation says so, or when the event *is* a submit. The previous
 * substring rule treated every component id containing "btn" as a submit, which labelled an
 * export button `FORM_SUBMIT` (Task 20.4).
 */
function isFormSubmitTarget(event: BehaviourEvent): boolean {
  const action = canonicalActionFor(event);
  return action !== null && isSubmitControl(action);
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

    // A system-initiated act is evidence, never participant ground truth.
    if (ev.systemInitiated) continue;

    if (type === 'click' || type === 'mousedown' || type === 'submit' || type === 'change') {
      const outcome: OutcomeType = isFormSubmitTarget(ev)
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

    // `blur`, `popstate` and `hashchange` are deliberately NOT backtrack candidates.
    // Backtracking is a property of the route sequence, decided once by the route tracker
    // and applied to the settled outcome below (Task 20.4).

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
    if (input.sessionTerminated && inHorizon.length === 0) {
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
  /**
   * Application semantic derivation (Task 20.4). When supplied, every settled outcome also
   * carries the semantic outcome of its source event, so the trace holds both the generic
   * class and what the participant actually did.
   */
  semanticOutcomes?: SemanticOutcomeDeriver;
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
  private readonly semanticOutcomes?: SemanticOutcomeDeriver;

  constructor(options: OutcomeDeriverOptions = {}) {
    this.semanticOutcomes = options.semanticOutcomes;
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
    // Observe in stream order: route history must advance once per event.
    this.semanticOutcomes?.observe(event);
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
    const lookaheadStartMs = windowEndMs + lookaheadMin;
    const lookaheadEndMs = windowEndMs + lookaheadMax;

    // A window's lookahead horizon is only settled once the stream has advanced past it.
    const lookaheadComplete =
      this.streamEnded || this.lastKnownTimestamp >= windowEndMs + lookaheadMax;

    const { outcome: genericOutcome, metadata, sourceEvent } = deriveOutcomeForWindow(
      {
        windowEndMs,
        futureEvents: this.buffer,
        sessionTerminated: Boolean(options.sessionTerminated)
      },
      this.options
    );

    // The semantic outcome decides which participant act this window describes. It is
    // attached to the generic source event when that event has one; otherwise (a route
    // reversal, or a navigation the generic taxonomy does not name) the earliest event with
    // a semantic outcome supplies the reference, so the record still points at a real act.
    const genericSemantic = this.semanticOutcomes?.outcomeFor(sourceEvent);
    const horizonSemantic =
      genericSemantic && genericSemantic.source !== 'none'
        ? undefined
        : this.earliestSemanticEventInHorizon(this.buffer, lookaheadStartMs, lookaheadEndMs);
    const semantic =
      genericSemantic && genericSemantic.source !== 'none'
        ? genericSemantic
        : horizonSemantic?.outcome;
    const semanticSourceEvent = horizonSemantic?.event ?? sourceEvent;

    // One route tracker, two layers: a reversal is BACKTRACK generically and `backtrack`
    // semantically, so the two labels can never disagree about the same event.
    const outcome: OutcomeType =
      semantic?.source === 'backtrack' ? 'BACKTRACK' : genericOutcome;

    const outcomeEvent: OutcomeEvent = {
      timestamp: semanticSourceEvent ? semanticSourceEvent.timestamp : windowEndMs,
      outcome,
      lookaheadComplete,
      sessionId: context.sessionId,
      windowId: window.windowId,
      experimentId: context.experimentId,
      conditionId: context.conditionId,
      sourceEventTimestamp: semanticSourceEvent?.timestamp,
      sourceEventType: semanticSourceEvent?.type,
      componentId: semanticSourceEvent?.componentId,
      taskId: semanticSourceEvent?.taskId,
      taskStepId: semanticSourceEvent?.taskStepId,
      route: semanticSourceEvent?.route,
      derivation: metadata,
      taskOutcome: semantic?.outcomeId,
      taskOutcomeVocabularyVersion: semantic?.vocabularyVersion,
      taskOutcomeSource: semantic?.source,
      taskOutcomeRuleId: semantic?.ruleId
    };

    // Events older than the lookahead horizon can no longer affect any future window.
    this.evictOlderThan(windowEndMs + lookaheadMin);
    return outcomeEvent;
  }

  /**
   * Earliest event in the lookahead horizon whose semantic derivation asserted an outcome.
   *
   * Ordered by timestamp so the choice is deterministic and matches the generic deriver's
   * earliest-event rule.
   */
  private earliestSemanticEventInHorizon(
    events: BehaviourEvent[],
    startMs: number,
    endMs: number
  ): { event: BehaviourEvent; outcome: SemanticOutcome } | undefined {
    if (!this.semanticOutcomes) return undefined;

    let earliest: { event: BehaviourEvent; outcome: SemanticOutcome } | undefined;
    for (const event of events) {
      if (event.timestamp < startMs || event.timestamp > endMs) continue;
      const outcome = this.semanticOutcomes.outcomeFor(event);
      if (outcome.source === 'none') continue;
      if (!earliest || event.timestamp < earliest.event.timestamp) {
        earliest = { event, outcome };
      }
    }
    return earliest;
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
