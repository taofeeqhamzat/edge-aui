/**
 * Semantic Outcome Derivation (Task 20.4)
 *
 * The framework predicts *observable interaction outcomes*. The generic seven-class taxonomy
 * (`CLICK`, `FORM_SUBMIT`, …) is the model's foundation vocabulary; the semantic vocabulary
 * is the application's, and describes what the participant actually did.
 *
 * This module supplies the contract and the derivation mechanics:
 *
 * - the vocabulary, its identity and its version are application-supplied;
 * - the rules are application-supplied, ordered, and receive a classified action;
 * - route-level backtracking is framework-owned, because it is a property of the navigation
 *   sequence rather than of any one application's pages;
 * - a system-initiated act is never a participant outcome.
 *
 * Nothing here names an application outcome; core requires no particular one.
 */

import type { BehaviourEvent } from '../telemetry/events';
import { CanonicalAction, canonicalActionFor } from './canonical';
import { RouteBacktrackingTracker } from './backtracking';

/** Application-supplied semantic outcome vocabulary. */
export interface SemanticOutcomeVocabulary {
  /** Identity of the vocabulary, e.g. `testbed-semantic`. */
  id: string;
  /** Version, recorded with every derived outcome. */
  version: string;
  /** Declared outcome identifiers. */
  outcomes: readonly string[];
  /** Outcome ID for a route-level reversal. Application vocabulary, not a framework name. */
  backtrackOutcomeId: string;
  /** Outcome ID when no rule matches. */
  noOutcomeId: string;
}

/** What a matched rule returns. */
export interface SemanticOutcomeMatch {
  outcomeId: string;
  /** Confidence of the rule match in [0, 1]. Defaults to 1. */
  confidence?: number;
}

/** One application rule. Rules are evaluated in declaration order. */
export interface SemanticOutcomeRule {
  /** Stable rule identity, recorded so an outcome can be attributed to the rule that made it. */
  id: string;
  match(action: CanonicalAction): SemanticOutcomeMatch | null;
}

export type SemanticOutcomeSource = 'backtrack' | 'application_rule' | 'none';

export interface SemanticOutcome {
  outcomeId: string;
  vocabularyId: string;
  vocabularyVersion: string;
  source: SemanticOutcomeSource;
  /** Rule that produced the outcome, when a rule did. */
  ruleId?: string;
  confidence: number;
}

export interface SemanticOutcomeDeriverOptions {
  vocabulary: SemanticOutcomeVocabulary;
  rules: SemanticOutcomeRule[];
  /** Page the session starts on; seeds route-level backtracking. */
  startingRoute?: string;
}

/**
 * Stateful deriver: it sees each canonical event once, in order, so route history is
 * coherent, and answers again for the same event when a window closes.
 *
 * The per-event cache is keyed by event identity, so deriving the same window twice cannot
 * advance the route history twice.
 */
export class SemanticOutcomeDeriver {
  private readonly vocab: SemanticOutcomeVocabulary;
  private readonly rules: SemanticOutcomeRule[];
  private readonly backtracking: RouteBacktrackingTracker;
  private readonly cache = new WeakMap<BehaviourEvent, SemanticOutcome>();

  constructor(options: SemanticOutcomeDeriverOptions) {
    this.vocab = options.vocabulary;
    this.rules = options.rules;
    this.backtracking = new RouteBacktrackingTracker(options.startingRoute);
  }

  public get vocabulary(): SemanticOutcomeVocabulary {
    return this.vocab;
  }

  public getVisitedPages(): readonly string[] {
    return this.backtracking.getVisitedPages();
  }

  /** Re-seeds route history for a new session or trial. */
  public reset(startingRoute?: string): void {
    this.backtracking.reset(startingRoute);
  }

  /**
   * Classifies and derives the outcome for one event, in stream order.
   *
   * Returns the cached outcome when the event was already observed, which is what makes
   * per-window derivation idempotent.
   */
  public observe(event: BehaviourEvent): SemanticOutcome {
    const cached = this.cache.get(event);
    if (cached) return cached;

    const outcome = this.derive(event);
    this.cache.set(event, outcome);
    return outcome;
  }

  /** Cached outcome for an already observed event; `no outcome` when it was not observed. */
  public outcomeFor(event: BehaviourEvent | undefined): SemanticOutcome {
    if (!event) return this.none();
    return this.cache.get(event) ?? this.none();
  }

  private derive(event: BehaviourEvent): SemanticOutcome {
    const action = canonicalActionFor(event);
    if (!action || action.systemInitiated) {
      return this.none();
    }

    // Route-level reversal is framework-owned and takes precedence: a participant who moved
    // back to a page they had already visited reversed course, whatever that page is.
    const observation = this.backtracking.observe(action);
    if (observation.backtrack) {
      return this.emit(this.vocab.backtrackOutcomeId, 'backtrack', 1);
    }

    for (const rule of this.rules) {
      const match = rule.match(action);
      if (match) {
        return this.emit(match.outcomeId, 'application_rule', match.confidence ?? 1, rule.id);
      }
    }

    return this.none();
  }

  private emit(
    outcomeId: string,
    source: SemanticOutcomeSource,
    confidence: number,
    ruleId?: string
  ): SemanticOutcome {
    return {
      outcomeId,
      vocabularyId: this.vocab.id,
      vocabularyVersion: this.vocab.version,
      source,
      ruleId,
      confidence
    };
  }

  private none(): SemanticOutcome {
    return this.emit(this.vocab.noOutcomeId, 'none', 0);
  }
}
