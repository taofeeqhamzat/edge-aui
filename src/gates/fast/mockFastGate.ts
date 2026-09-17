/**
 * Deterministic Mock Fast Gate
 * Implements Stage 7.1 specifications from clipboard.9.md Section 18 & Section 37.
 * Provides configurable exact/suffix pattern matching for rapid integration testing
 * before the WASM PrefixSpan miner is compiled.
 */

import { MacroInteraction } from '../../telemetry/events';
import { InterventionCommand, InterventionType, isInterventionType } from '../../intervention/types';
import { FastGate, GateDecision } from './types';

export type PatternDefinition = string | readonly string[];
export type PatternIntervention = InterventionType | Partial<InterventionCommand>;

export interface MockFastGateOptions {
  patterns?: Record<string, PatternIntervention>;
  defaultConfidence?: number;
  exactMatchOnly?: boolean; // false: matches suffix of sequence (default); true: exact length match
}

export class MockFastGate implements FastGate {
  private patterns: Map<string, PatternIntervention> = new Map();
  private defaultConfidence: number;
  private exactMatchOnly: boolean;

  constructor(options: MockFastGateOptions = {}) {
    this.defaultConfidence = options.defaultConfidence ?? 1.0;
    this.exactMatchOnly = options.exactMatchOnly ?? false;

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
        const intervention = this.createIntervention(target, patternKey);
        return {
          matched: true,
          source: 'fast',
          confidence: intervention.confidence ?? this.defaultConfidence,
          intervention,
          matchedPattern: patternTokens
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
   * Example: "NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION" -> "highlight_primary_action"
   */
  public setPattern(pattern: PatternDefinition, intervention: PatternIntervention): void {
    const key = this.normalizePatternKey(pattern);
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

  private createIntervention(target: PatternIntervention, patternKey: string): InterventionCommand {
    const now = Date.now();

    if (typeof target === 'string' && isInterventionType(target)) {
      return {
        type: target,
        source: 'fast',
        confidence: this.defaultConfidence,
        issuedAt: now,
        reason: `Matched fast pattern: ${patternKey}`
      };
    }

    const command = target as Partial<InterventionCommand>;
    return {
      type: command.type ?? 'no_op',
      source: 'fast',
      confidence: command.confidence ?? this.defaultConfidence,
      issuedAt: command.issuedAt ?? now,
      targetComponentId: command.targetComponentId,
      ttlMs: command.ttlMs,
      reason: command.reason ?? `Matched fast pattern: ${patternKey}`
    };
  }
}
