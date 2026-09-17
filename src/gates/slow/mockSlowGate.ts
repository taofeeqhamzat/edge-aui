/**
 * Deterministic Mock Slow Gate
 * Implements Stage 7.2 specifications from clipboard.9.md Section 20 & Section 37.
 * Provides deterministic probabilistic outcome inference and intervention proposal
 * for rapid testbed integration prior to ONNX Runtime Web / WebGPU execution.
 */

import { OutcomeType } from '../../telemetry/events';
import { InterventionCommand, InterventionType, isInterventionType } from '../../intervention/types';
import { SlowGate, SlowGateInput, SlowGateResult } from './types';

export interface MockSlowGateOptions {
  outcome?: OutcomeType;
  intervention?: InterventionType | Partial<InterventionCommand>;
  confidence?: number;
  probabilities?: Float32Array;
  delayMs?: number;
  predicate?: (input: SlowGateInput) => boolean | Promise<boolean>;
  validateShape?: boolean;
}

export class MockSlowGate implements SlowGate {
  private outcome?: OutcomeType;
  private intervention?: InterventionType | Partial<InterventionCommand>;
  private confidence: number;
  private probabilities?: Float32Array;
  private delayMs: number;
  private predicate?: (input: SlowGateInput) => boolean | Promise<boolean>;
  private validateShape: boolean;
  private lastInput: SlowGateInput | null = null;

  constructor(options: MockSlowGateOptions = {}) {
    this.outcome = options.outcome ?? 'HOVER_DWELL';
    this.intervention = options.intervention;
    this.confidence = options.confidence ?? 0.85;
    this.probabilities = options.probabilities;
    this.delayMs = options.delayMs ?? 0;
    this.predicate = options.predicate;
    this.validateShape = options.validateShape ?? true;
  }

  /**
   * Evaluates the tensor sequence and active UI context.
   */
  public async infer(input: SlowGateInput): Promise<SlowGateResult> {
    this.lastInput = input;

    if (this.validateShape) {
      this.assertValidShape(input);
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.predicate) {
      const conditionMet = await this.predicate(input);
      if (!conditionMet) {
        return {
          outcome: 'NO_OUTCOME',
          confidence: 0,
          source: 'slow'
        };
      }
    }

    let candidateIntervention: InterventionCommand | undefined;
    if (this.intervention) {
      candidateIntervention = this.createIntervention(this.intervention, input);
    }

    return {
      outcome: this.outcome,
      confidence: this.confidence,
      probabilities: this.probabilities,
      intervention: candidateIntervention,
      source: 'slow'
    };
  }

  /**
   * Sets mock target outcome.
   */
  public setMockOutcome(outcome?: OutcomeType): void {
    this.outcome = outcome;
  }

  /**
   * Sets mock candidate intervention command or type.
   */
  public setMockIntervention(intervention?: InterventionType | Partial<InterventionCommand>): void {
    this.intervention = intervention;
  }

  /**
   * Sets confidence score.
   */
  public setConfidence(confidence: number): void {
    this.confidence = confidence;
  }

  /**
   * Sets probability distribution vector.
   */
  public setProbabilities(probabilities?: Float32Array): void {
    this.probabilities = probabilities;
  }

  /**
   * Configures artificial delay for latency simulation.
   */
  public setDelayMs(delayMs: number): void {
    this.delayMs = delayMs;
  }

  /**
   * Configures a custom conditional predicate.
   */
  public setPredicate(predicate?: (input: SlowGateInput) => boolean | Promise<boolean>): void {
    this.predicate = predicate;
  }

  /**
   * Inspects the most recent input passed to infer.
   */
  public getLastInput(): SlowGateInput | null {
    return this.lastInput;
  }

  private assertValidShape(input: SlowGateInput): void {
    const [batch, seqLen, featureDim] = input.shape;
    const expectedLength = batch * seqLen * featureDim;

    if (input.sequence.length !== expectedLength) {
      throw new Error(
        `[MockSlowGate] Invalid input tensor length: expected ${expectedLength} (${batch}x${seqLen}x${featureDim}), received ${input.sequence.length}.`
      );
    }
  }

  private createIntervention(
    target: InterventionType | Partial<InterventionCommand>,
    input: SlowGateInput
  ): InterventionCommand {
    const now = Date.now();

    if (typeof target === 'string' && isInterventionType(target)) {
      return {
        type: target,
        source: 'slow',
        confidence: this.confidence,
        issuedAt: now,
        targetComponentId: input.context.activeComponentId,
        reason: `Slow Gate predicted outcome: ${this.outcome ?? 'UNKNOWN'}`
      };
    }

    const cmd = target as Partial<InterventionCommand>;
    return {
      type: cmd.type ?? 'no_op',
      source: 'slow',
      confidence: cmd.confidence ?? this.confidence,
      issuedAt: cmd.issuedAt ?? now,
      targetComponentId: cmd.targetComponentId ?? input.context.activeComponentId,
      ttlMs: cmd.ttlMs,
      reason: cmd.reason ?? `Slow Gate predicted outcome: ${this.outcome ?? 'UNKNOWN'}`
    };
  }
}
