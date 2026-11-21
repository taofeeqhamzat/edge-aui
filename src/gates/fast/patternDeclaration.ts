/**
 * Fast Gate Pattern Declarations (Task 50.2)
 *
 * A Fast Gate pattern used to be a `patternKey -> intervention` entry: enough to name an
 * adaptation, not enough to say what the episode *means*, how strong the evidence was, or
 * whether the pattern can be produced at all. This module defines the declaration format
 * and validates it before a gate is allowed to use it.
 *
 * A declaration carries three things:
 *
 * - the symbol `sequence`;
 * - the `target` the episode resolves to (a semantic outcome, optionally with a legacy
 *   intervention form);
 * - the measured `evidence` behind it, including its provenance.
 *
 * Validation runs once, at composition time. A pattern that names an unknown symbol, an
 * outcome outside the gate's vocabulary, or evidence weaker than the support threshold the
 * gate will apply is a configuration error, not a runtime miss: it can never produce a
 * prediction, so failing loudly is the only way to keep the declared set honest.
 */

import { isInterventionType } from '../../intervention/types';
import type { OutcomeVocabulary } from '../contracts';
import {
  PatternTarget,
  assertOutcomeDeclared,
  isPatternOutcomeMapping
} from './patternTarget';

/** Where the evidence for a declared pattern came from. */
export type PatternProvenance = 'participant' | 'scripted';

/**
 * Measured evidence for one pattern.
 *
 * `supportSessions` is the number of *sessions* containing the pattern, not the number of
 * occurrences: support is a session-level property, so a pattern repeated many times in one
 * session is still supported by one session.
 */
export interface PatternEvidence {
  supportSessions: number;
  occurrences: number;
  /** Task identifiers the pattern was observed in. Never empty. */
  tasks: readonly string[];
  provenance: PatternProvenance;
  /** Where a reader can audit the measurement. */
  source: string;
}

/** One declared pattern: a sequence, its resolved target, and the evidence for it. */
export interface PatternDeclaration {
  sequence: readonly string[];
  target: PatternTarget;
  evidence: PatternEvidence;
}

/** What a declaration is validated against. All values come from the application. */
export interface PatternDeclarationContext {
  /** Vocabulary the declared outcome must belong to. */
  vocabulary: OutcomeVocabulary;
  /** True when the symbol can be produced by the application's macro mapper. */
  isKnownSymbol: (symbol: string) => boolean;
  /** Minimum support the gate applies. Evidence below it can never fire. */
  minSupport: number;
  /** Longest actionable pattern, in symbols. */
  maxPatternLength: number;
  /** Total measured sessions, when known, so support cannot exceed it. */
  totalSessions?: number;
  /** Provenance the experiment requires. Scripted evidence cannot stand in for participants. */
  requiredProvenance?: PatternProvenance;
}

/** Canonical key for a pattern, shared by declarations and the miner. */
export function patternKey(sequence: readonly string[]): string {
  return sequence.join(' > ');
}

/**
 * Validates a declared pattern set and returns the `patternKey -> target` map a gate
 * consumes.
 *
 * Throws on the first invalid declaration. Every message names the pattern, so a broken
 * configuration is identifiable without reading the declaration file.
 */
export function validatePatternDeclarations(
  declarations: readonly PatternDeclaration[],
  context: PatternDeclarationContext
): Map<string, PatternTarget> {
  const targets = new Map<string, PatternTarget>();

  for (const declaration of declarations) {
    const sequence = declaration.sequence;
    const key = patternKey(sequence);

    if (!Array.isArray(sequence) || sequence.length === 0) {
      throw new Error('[PatternDeclaration] A declared pattern must have a non-empty sequence.');
    }
    if (sequence.length > context.maxPatternLength) {
      throw new Error(
        `[PatternDeclaration] Pattern '${key}' has ${sequence.length} symbols, more than the ` +
          `declared maximum ${context.maxPatternLength}.`
      );
    }
    for (const symbol of sequence) {
      if (typeof symbol !== 'string' || symbol.length === 0) {
        throw new Error(`[PatternDeclaration] Pattern '${key}' contains an empty symbol.`);
      }
      if (!context.isKnownSymbol(symbol)) {
        throw new Error(
          `[PatternDeclaration] Pattern '${key}' uses symbol '${symbol}', which the macro ` +
            'vocabulary cannot produce.'
        );
      }
    }
    if (targets.has(key)) {
      throw new Error(`[PatternDeclaration] Pattern '${key}' is declared more than once.`);
    }

    validateTarget(declaration.target, key, context);
    validateEvidence(declaration.evidence, key, context);

    targets.set(key, declaration.target);
  }

  return targets;
}

function validateTarget(
  target: PatternTarget,
  key: string,
  context: PatternDeclarationContext
): void {
  if (isPatternOutcomeMapping(target)) {
    if (typeof target.outcomeId !== 'string' || target.outcomeId.length === 0) {
      throw new Error(`[PatternDeclaration] Pattern '${key}' declares an empty outcome id.`);
    }
    assertOutcomeDeclared(context.vocabulary, target.outcomeId, key, 'PatternDeclaration');
    if (target.confidence !== undefined) {
      assertConfidence(target.confidence, key);
    }
    if (target.intervention !== undefined) {
      const type = typeof target.intervention === 'string' ? target.intervention : target.intervention.type;
      if (type !== undefined && !isInterventionType(type)) {
        throw new Error(
          `[PatternDeclaration] Pattern '${key}' declares unknown intervention '${type}'.`
        );
      }
    }
    return;
  }

  if (typeof target === 'string') {
    if (!isInterventionType(target)) {
      throw new Error(
        `[PatternDeclaration] Pattern '${key}' declares unknown intervention '${target}'.`
      );
    }
    // The legacy form's intervention class doubles as its provisional outcome id, so it
    // must still belong to the gate's vocabulary.
    assertOutcomeDeclared(context.vocabulary, target, key, 'PatternDeclaration');
    return;
  }

  if (target.type !== undefined && !isInterventionType(target.type)) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' declares unknown intervention '${target.type}'.`
    );
  }
  if (target.confidence !== undefined) {
    assertConfidence(target.confidence, key);
  }
}

function validateEvidence(
  evidence: PatternEvidence,
  key: string,
  context: PatternDeclarationContext
): void {
  if (!evidence) {
    throw new Error(`[PatternDeclaration] Pattern '${key}' has no evidence.`);
  }
  if (!Number.isInteger(evidence.supportSessions) || evidence.supportSessions < 1) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' must declare a positive whole-number support.`
    );
  }
  if (evidence.supportSessions < context.minSupport) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' is supported by ${evidence.supportSessions} ` +
        `sessions, below the gate's minimum support of ${context.minSupport}; it can never fire.`
    );
  }
  if (context.totalSessions !== undefined && evidence.supportSessions > context.totalSessions) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' claims ${evidence.supportSessions} sessions, more ` +
        `than the ${context.totalSessions} measured.`
    );
  }
  if (!Number.isInteger(evidence.occurrences) || evidence.occurrences < evidence.supportSessions) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' must have at least one occurrence per supporting session.`
    );
  }
  if (!Array.isArray(evidence.tasks) || evidence.tasks.length === 0) {
    throw new Error(`[PatternDeclaration] Pattern '${key}' must name the tasks it was observed in.`);
  }
  if (typeof evidence.source !== 'string' || evidence.source.length === 0) {
    throw new Error(`[PatternDeclaration] Pattern '${key}' must record where its evidence lives.`);
  }
  if (context.requiredProvenance && evidence.provenance !== context.requiredProvenance) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' has '${evidence.provenance}' evidence, but the ` +
        `declared set requires '${context.requiredProvenance}' evidence.`
    );
  }
}

function assertConfidence(confidence: number, key: string): void {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(
      `[PatternDeclaration] Pattern '${key}' declares confidence ${confidence}, outside [0, 1].`
    );
  }
}
