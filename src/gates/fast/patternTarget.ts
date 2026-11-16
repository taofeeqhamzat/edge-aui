/**
 * Fast Gate Pattern Target Resolution (Task 20.3)
 *
 * A declared Fast Gate pattern may name either:
 *
 * - a normalized outcome (`{ outcomeId, confidence }`), which is the semantic form: the
 *   application resolver decides the adaptation from the predicted outcome (Task 20.1);
 * - an intervention class or partial `InterventionCommand`, which is the legacy form and
 *   stays supported during the migration.
 *
 * Both gates resolve patterns through this module, so a pattern behaves identically
 * whichever matcher found it, and the outcome is validated against the gate's declared
 * vocabulary in one place.
 */

import {
  InterventionCommand,
  InterventionType,
  isInterventionType
} from '../../intervention/types';
import { getWallClockTimestamp } from '../../telemetry/normalizer';
import type { OutcomeVocabulary } from '../contracts';

/** A pattern that declares a normalized outcome instead of an intervention. */
export interface PatternOutcomeMapping {
  /** Application-supplied outcome identifier; validated against the gate vocabulary. */
  outcomeId: string;
  /** Match strength of the declared pattern. Defaults to the gate default. */
  confidence?: number;
  /** Optional candidate adaptation; the application resolver may also supply it. */
  intervention?: InterventionType | Partial<InterventionCommand>;
  /** Component the adaptation applies to, when the pattern knows it. */
  targetComponentId?: string;
}

/** Everything a declared pattern may map to. */
export type PatternTarget =
  | InterventionType
  | Partial<InterventionCommand>
  | PatternOutcomeMapping;

export function isPatternOutcomeMapping(target: PatternTarget): target is PatternOutcomeMapping {
  return (
    typeof target === 'object' &&
    target !== null &&
    typeof (target as PatternOutcomeMapping).outcomeId === 'string'
  );
}

/**
 * Fails loudly when a declared pattern names an outcome the gate's vocabulary cannot
 * describe. A pattern is configuration, so a mismatch is a configuration error and must not
 * be absorbed into a silently mislabelled prediction.
 */
export function assertOutcomeDeclared(
  vocabulary: OutcomeVocabulary,
  outcomeId: string,
  patternKey: string,
  gateName: string
): void {
  if (vocabulary.outcomes.includes(outcomeId)) return;
  throw new Error(
    `[${gateName}] Pattern '${patternKey}' declares outcome '${outcomeId}', which is not in ` +
      `vocabulary '${vocabulary.id}' (${vocabulary.version}): ${vocabulary.outcomes.join(', ')}`
  );
}

export interface ResolvedPatternTarget {
  outcomeId: string;
  confidence: number;
  intervention?: InterventionCommand;
  targetComponentId?: string;
}

export interface ResolvePatternTargetOptions {
  patternKey: string;
  /** Gate default confidence, used when the pattern does not declare one. */
  defaultConfidence: number;
  /** Free-text attribution recorded on an emitted command. */
  reason: string;
}

/**
 * Resolves a declared pattern target into the normalized fields both gates emit.
 *
 * The legacy forms produce a command whose type doubles as the provisional outcome id: the
 * legacy vocabulary *is* the intervention vocabulary, so the identity mapping is correct
 * until the pattern declares a semantic outcome.
 */
export function resolvePatternTarget(
  target: PatternTarget,
  options: ResolvePatternTargetOptions
): ResolvedPatternTarget {
  if (isPatternOutcomeMapping(target)) {
    const confidence = target.confidence ?? options.defaultConfidence;
    return {
      outcomeId: target.outcomeId,
      confidence,
      targetComponentId: target.targetComponentId,
      intervention: target.intervention
        ? buildInterventionCommand(target.intervention, options, confidence)
        : undefined
    };
  }

  const intervention = buildInterventionCommand(target, options);
  return {
    outcomeId: intervention.type,
    confidence: intervention.confidence ?? options.defaultConfidence,
    intervention
  };
}

function buildInterventionCommand(
  target: InterventionType | Partial<InterventionCommand>,
  options: ResolvePatternTargetOptions,
  confidenceOverride?: number
): InterventionCommand {
  const now = getWallClockTimestamp();

  if (typeof target === 'string' && isInterventionType(target)) {
    return {
      type: target,
      source: 'fast',
      mappingSource: 'fast_gate_pattern',
      confidence: confidenceOverride ?? options.defaultConfidence,
      issuedAt: now,
      reason: options.reason
    };
  }

  const command = target as Partial<InterventionCommand>;
  return {
    type: command.type ?? 'no_op',
    source: 'fast',
    mappingSource: 'fast_gate_pattern',
    confidence: confidenceOverride ?? command.confidence ?? options.defaultConfidence,
    issuedAt: command.issuedAt ?? now,
    targetComponentId: command.targetComponentId,
    ttlMs: command.ttlMs,
    reason: command.reason ?? options.reason
  };
}
