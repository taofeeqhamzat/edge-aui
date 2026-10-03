/**
 * Intervention Policy Layer
 * Implements Stage 8.2 specifications from docs/testbed/prd.md Sections 23-25 & docs/plan/tasks/8.2.md.
 * 
 * Sits between model inference (Fast/Slow Gates) and UI actuation (UIActuator):
 * 1. Confidence threshold gating (default 0.75 - initial engineering baseline requiring calibration).
 * 2. Consecutive window persistence requirement (default 2 consecutive windows).
 * 3. UI context eligibility gate (checks primaryActionAvailable, expandable, helpAvailable).
 * 4. Automatic reset on task state switch or conflicting user interactions.
 * 5. Safe fallback to no_op when any gate rejects.
 */

import { UIContext } from '../types/uiContext.js';
import {
  InterventionCommand,
  InterventionType,
  createNoOpCommand
} from './types';
import type { PolicyRejectionCategory } from '../telemetry/events';
import { defaultCollector } from '../runtime/instrumentation';

export interface PolicyConfig {
  /**
   * Minimum confidence threshold required to accept a model recommendation.
   * Marked as an initial engineering baseline requiring empirical calibration.
   */
  confidenceThreshold: number;
  /**
   * Number of consecutive windows the identical candidate intervention must be recommended
   * before it is accepted, filtering out transient, noisy single-window inferences.
   */
  requiredConsecutiveWindows: number;
  /**
   * Whether to enforce eligibility against current UI context.
   */
  enforceContextEligibility: boolean;
  /**
   * Refractory period after an intervention has been accepted, during which no new
   * intervention of any type is accepted. Prevents repeated actuation on every
   * subsequent window (assessment §25 P1-4).
   */
  cooldownMs: number;
  /**
   * Refractory period applied specifically after the user dismisses an intervention.
   * Dismissal is treated as negative feedback: re-issuing the same intervention
   * immediately would be counter-productive.
   */
  dismissalCooldownMs: number;
  /**
   * How long an accepted adaptation stays in the interface before it is automatically
   * reverted. Without this the adaptation persisted for the remainder of the session,
   * which biased every later measurement in that session (F-03).
   */
  ttlMs: number;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  confidenceThreshold: 0.75,
  requiredConsecutiveWindows: 2,
  enforceContextEligibility: true,
  cooldownMs: 5000,
  dismissalCooldownMs: 15000,
  ttlMs: 8000
};

/**
 * Grouping key for a refusal. The category vocabulary lives with the trace schema
 * (`telemetry/events.ts`) because it is persisted; the policy only chooses from it, so the
 * runtime, the trace and the analysis all share one definition (F-07).
 */
export type PolicyRefusalCategory = Extract<
  PolicyRejectionCategory,
  'cooldown' | 'dismissed' | 'below_threshold' | 'ineligible_context' | 'pending_persistence' | 'unknown_candidate'
> | 'none';

export interface PolicyDecision {
  accepted: boolean;
  command: InterventionCommand;
  reason: string;
  candidateCount?: number;
  /** Structured refusal cause; `'none'` when the candidate was accepted. */
  rejectionCategory: PolicyRefusalCategory;
  /** Cooldown remaining at decision time, in milliseconds. */
  cooldownRemainingMs: number;
  /** Adaptation lifetime applied when accepted; undefined when rejected. */
  ttlMs?: number;
}

export class InterventionPolicy {
  private config: PolicyConfig;
  private candidateType: InterventionType | null = null;
  private candidateTarget?: string;
  private candidateCount = 0;
  private lastTaskId?: string;

  /** Timestamp (ms) until which no intervention may be accepted. */
  private cooldownUntilMs = 0;
  /** Per-intervention-type cooldown expiry, populated on dismissal. */
  private dismissedUntilMs = new Map<InterventionType, number>();

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = {
      ...DEFAULT_POLICY_CONFIG,
      ...config
    };
  }

  /**
   * Evaluates candidate InterventionCommand against confidence, context, and persistence gates.
   */
  public accept(command: InterventionCommand, context: UIContext): PolicyDecision {
    return defaultCollector.timeSync('policy evaluation', 'main', () => {
      // 1. Task change detection: Automatically reset candidate state if task switched
      if (this.lastTaskId !== undefined && context.taskId !== this.lastTaskId) {
        this.reset();
      }
      this.lastTaskId = context.taskId;

      // 2. Safe default no_op: Always accepted, resets active candidate
      if (command.type === 'no_op') {
        this.resetCandidate();
        return {
          accepted: true,
          command,
          reason: 'Safe default no_op maintained',
          candidateCount: 0,
          rejectionCategory: 'none',
          cooldownRemainingMs: this.cooldownRemainingMs()
        };
      }

      // 3. Cooldown Gate: suppress re-actuation during the refractory period
      const now = Date.now();
      if (this.cooldownUntilMs > now) {
        const remaining = this.cooldownUntilMs - now;
        return {
          accepted: false,
          command: createNoOpCommand(command.source, `Cooldown active for ${remaining}ms`),
          reason: `Cooldown active (${remaining}ms remaining)`,
          candidateCount: 0,
          rejectionCategory: 'cooldown',
          cooldownRemainingMs: remaining
        };
      }

      // 4. Per-type dismissal feedback: a dismissed intervention is suppressed for longer
      const dismissedUntil = this.dismissedUntilMs.get(command.type);
      if (dismissedUntil !== undefined && dismissedUntil > now) {
        return {
          accepted: false,
          command: createNoOpCommand(
            command.source,
            `Intervention '${command.type}' was recently dismissed`
          ),
          reason: `Suppressed after dismissal (${dismissedUntil - now}ms remaining)`,
          candidateCount: 0,
          rejectionCategory: 'dismissed',
          cooldownRemainingMs: 0
        };
      }

      // 5. Confidence Threshold Gate
      if (command.confidence !== undefined && command.confidence < this.config.confidenceThreshold) {
        this.resetCandidate();
        return {
          accepted: false,
          command: createNoOpCommand(
            command.source,
            `Confidence (${command.confidence.toFixed(2)}) below threshold (${this.config.confidenceThreshold})`
          ),
          reason: `Confidence ${command.confidence.toFixed(2)} below threshold ${this.config.confidenceThreshold}`,
          candidateCount: 0,
          rejectionCategory: 'below_threshold',
          cooldownRemainingMs: 0
        };
      }

      // 6. UI Context Eligibility Gate
      if (this.config.enforceContextEligibility) {
        const eligibility = this.checkContextEligibility(command, context);
        if (!eligibility.eligible) {
          this.resetCandidate();
          return {
            accepted: false,
            command: createNoOpCommand(command.source, eligibility.reason),
            reason: eligibility.reason,
            candidateCount: 0,
            rejectionCategory: eligibility.category,
            cooldownRemainingMs: 0
          };
        }
      }

      // 7. Consecutive Window Persistence Gate
      const isSameCandidate =
        this.candidateType === command.type &&
        this.candidateTarget === command.targetComponentId;

      if (isSameCandidate) {
        this.candidateCount++;
      } else {
        this.candidateType = command.type;
        this.candidateTarget = command.targetComponentId;
        this.candidateCount = 1;
      }

      if (this.candidateCount >= this.config.requiredConsecutiveWindows) {
        // Enter the cooldown window so the same adaptation is not re-applied on every
        // subsequent window.
        this.cooldownUntilMs = now + this.config.cooldownMs;
        return {
          accepted: true,
          // The adaptation lifetime is attached here, at the one place every accepted
          // command passes through, so no producer can forget it (F-03).
          command: { ...command, ttlMs: command.ttlMs ?? this.config.ttlMs },
          reason: `Candidate met persistence requirement (${this.candidateCount}/${this.config.requiredConsecutiveWindows})`,
          candidateCount: this.candidateCount,
          rejectionCategory: 'none',
          cooldownRemainingMs: this.config.cooldownMs,
          ttlMs: command.ttlMs ?? this.config.ttlMs
        };
      }

      // Not yet persisted through enough consecutive windows
      return {
        accepted: false,
        command: createNoOpCommand(
          command.source,
          `Awaiting consecutive window persistence (${this.candidateCount}/${this.config.requiredConsecutiveWindows})`
        ),
        reason: `Transient recommendation pending persistence (${this.candidateCount}/${this.config.requiredConsecutiveWindows})`,
        candidateCount: this.candidateCount,
        rejectionCategory: 'pending_persistence',
        cooldownRemainingMs: 0
      };
    });
  }

  /**
   * Resets candidate persistence state (e.g. on user conflicting action or task change).
   */
  public reset(): void {
    this.resetCandidate();
    this.lastTaskId = undefined;
    this.cooldownUntilMs = 0;
    this.dismissedUntilMs.clear();
  }

  /**
   * Notifies the policy of an explicit user action (clicks, navigation), resetting the
   * candidate streak.
   */
  public notifyUserAction(_action: string): void {
    this.resetCandidate();
  }

  /**
   * Records that the user dismissed an intervention. Dismissal is negative feedback, so
   * the specific intervention type is suppressed for `dismissalCooldownMs`.
   */
  public notifyDismissal(type: InterventionType): void {
    this.resetCandidate();
    this.dismissedUntilMs.set(type, Date.now() + this.config.dismissalCooldownMs);
  }

  /** Remaining cooldown in milliseconds, or 0 when no cooldown is active. */
  public cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntilMs - Date.now());
  }

  public getConfig(): Readonly<PolicyConfig> {
    return { ...this.config };
  }

  public updateConfig(config: Partial<PolicyConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
  }

  private resetCandidate(): void {
    this.candidateType = null;
    this.candidateTarget = undefined;
    this.candidateCount = 0;
  }

  private checkContextEligibility(
    command: InterventionCommand,
    context: UIContext
  ): { eligible: boolean; reason: string; category: PolicyRefusalCategory } {
    switch (command.type) {
      case 'highlight_primary_action':
        if (!context.primaryActionAvailable) {
          return {
            eligible: false,
            reason: 'Ineligible: No primary action available in current UI context',
            category: 'ineligible_context'
          };
        }
        return { eligible: true, reason: 'Primary action is available', category: 'none' };

      case 'simplify_options':
        if (!context.expandable) {
          return {
            eligible: false,
            reason: 'Ineligible: No expandable options or accordions in current UI context',
            category: 'ineligible_context'
          };
        }
        return { eligible: true, reason: 'Expandable options are present', category: 'none' };

      case 'expand_tooltip':
        if (!context.helpAvailable && !command.targetComponentId) {
          return {
            eligible: false,
            reason: 'Ineligible: No contextual help or tooltip available in current UI context',
            category: 'ineligible_context'
          };
        }
        return {
          eligible: true,
          reason: 'Contextual help or target component is available',
          category: 'none'
        };

      case 'offer_assistance':
        // Assistance banner can be presented in any interactive task view
        return { eligible: true, reason: 'Assistance banner is eligible', category: 'none' };

      case 'no_op':
        return { eligible: true, reason: 'no_op is always eligible', category: 'none' };

      default:
        return {
          eligible: false,
          reason: `Unknown intervention type: ${(command as any).type}`,
          category: 'unknown_candidate'
        };
    }
  }
}

export function createInterventionPolicy(
  config?: Partial<PolicyConfig>
): InterventionPolicy {
  return new InterventionPolicy(config);
}
