/**
 * Deterministic Mock Fast Gate
 * Implements Stage 7.1 specifications from docs/testbed/prd.md Section 18 & Section 37.
 * Provides configurable exact/suffix pattern matching for rapid integration testing
 * before the WASM PrefixSpan miner is compiled.
 */

import { MacroInteraction } from '../../telemetry/events';
import { FastGate, GateDecision } from './types';
import {
  PatternTarget,
  assertOutcomeDeclared,
  isPatternOutcomeMapping,
  resolvePatternTarget
} from './patternTarget';
import { OutcomeVocabulary } from '../contracts';
import { INTERVENTION_VOCABULARY } from '../../config/modelManifest';

/** Provenance identity of this gate implementation, reported on every match. */
const MOCK_GATE_VERSION = 'mock-fast-gate/1.0.0';

export type PatternDefinition = string | readonly string[];
export type PatternIntervention = PatternTarget;

export interface MockFastGateOptions {
  patterns?: Record<string, PatternIntervention>;
  defaultConfidence?: number;
  exactMatchOnly?: boolean; // false: matches suffix of sequence (default); true: exact length match
  /** Version of the declared pattern set, reported on every match. */
  gateVersion?: string;
  /**
   * Vocabulary a declared pattern outcome must belong to.
   * Defaults to the intervention vocabulary, which the legacy pattern form names.
   */
  outcomeVocabulary?: OutcomeVocabulary;
}

export class MockFastGate implements FastGate {
  private patterns: Map<string, PatternIntervention> = new Map();
  private defaultConfidence: number;
  private exactMatchOnly: boolean;
  private readonly gateVersion: string;
  private readonly vocabulary: OutcomeVocabulary;

  constructor(options: MockFastGateOptions = {}) {
    this.defaultConfidence = options.defaultConfidence ?? 1.0;
    this.exactMatchOnly = options.exactMatchOnly ?? false;
    this.gateVersion = options.gateVersion ?? MOCK_GATE_VERSION;
    this.vocabulary = options.outcomeVocabulary ?? INTERVENTION_VOCABULARY;

    if (options.patterns) {
      for (const [pattern, target] of Object.entries(options.patterns)) {
        this.setPattern(pattern, target);
      }
    }
  }

  /**
   * Evaluates the given macro interaction sequence against registered patterns.
   */
  public async evaluate(sequence: MacroInteraction[]): Promise<GateDecision> {
    if (!sequence || sequence.length === 0) {
      return { matched: false, source: 'fast' };
    }

    const currentSymbols = sequence.map((i) => i.symbol);

    for (const [patternKey, target] of this.patterns.entries()) {
      const patternTokens = this.parsePatternKey(patternKey);
      if (patternTokens.length === 0) continue;

      const matches = this.checkMatch(currentSymbols, patternTokens);
      if (matches) {
        const resolved = resolvePatternTarget(target, {
          patternKey,
          defaultConfidence: this.defaultConfidence,
          reason: `Matched fast pattern: ${patternKey}`
        });
        const outcomeIndex = this.vocabulary.outcomes.indexOf(resolved.outcomeId);
        const targetComponentId =
          resolved.targetComponentId ?? resolved.intervention?.targetComponentId;
        return {
          matched: true,
          source: 'fast',
          confidence: resolved.confidence,
          intervention: resolved.intervention,
          prediction: {
            outcomeId: resolved.outcomeId,
            vocabularyId: this.vocabulary.id,
            vocabularyVersion: this.vocabulary.version,
            outcomeIndex: outcomeIndex >= 0 ? outcomeIndex : undefined,
            confidence: resolved.confidence,
            matched: true,
            source: 'fast',
            mappingSource: 'fast_gate_pattern',
            target: targetComponentId ? { componentId: targetComponentId } : undefined
          },
          matchedPattern: patternTokens,
          gateVersion: this.gateVersion
        };
      }
    }

    return {
      matched: false,
      source: 'fast'
    };
  }

  /**
   * Registers or updates a pattern and its corresponding intervention.
   * Example: "SYMBOL_A > SYMBOL_B > SYMBOL_C" -> "highlight_primary_action"
   */
  public setPattern(pattern: PatternDefinition, intervention: PatternIntervention): void {
    const key = this.normalizePatternKey(pattern);
    if (isPatternOutcomeMapping(intervention)) {
      assertOutcomeDeclared(this.vocabulary, intervention.outcomeId, key, 'MockFastGate');
    }
    this.patterns.set(key, intervention);
  }

  /**
   * Removes a registered pattern.
   */
  public removePattern(pattern: PatternDefinition): boolean {
    const key = this.normalizePatternKey(pattern);
    return this.patterns.delete(key);
  }

  /**
   * Clears all registered patterns.
   */
  public clearPatterns(): void {
    this.patterns.clear();
  }

  /**
   * Returns a copy of all registered patterns.
   */
  public getPatterns(): Record<string, PatternIntervention> {
    const out: Record<string, PatternIntervention> = {};
    for (const [k, v] of this.patterns.entries()) {
      out[k] = v;
    }
    return out;
  }

  /**
   * Configures the default confidence score for emitted decisions.
   */
  public setDefaultConfidence(confidence: number): void {
    this.defaultConfidence = confidence;
  }

  private normalizePatternKey(pattern: PatternDefinition): string {
    if (typeof pattern === 'string') {
      return pattern.split(/\s*>\s*/).map((s: string) => s.trim()).join(' > ');
    }
    return pattern.map((s: string) => s.trim()).join(' > ');
  }

  private parsePatternKey(patternKey: string): string[] {
    return patternKey.split(/\s*>\s*/).filter((s) => s.length > 0);
  }

  private checkMatch(sequenceSymbols: string[], patternTokens: string[]): boolean {
    if (this.exactMatchOnly) {
      if (sequenceSymbols.length !== patternTokens.length) return false;
      return patternTokens.every((token, idx) => token === sequenceSymbols[idx]);
    }

    if (sequenceSymbols.length < patternTokens.length) return false;

    // Suffix match: does sequence end with patternTokens?
    const offset = sequenceSymbols.length - patternTokens.length;
    for (let i = 0; i < patternTokens.length; i++) {
      if (sequenceSymbols[offset + i] !== patternTokens[i]) {
        return false;
      }
    }
    return true;
  }
}
