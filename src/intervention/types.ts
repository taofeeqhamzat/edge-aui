/**
 * Declarative InterventionCommand Contract & Action Taxonomies
 * Implements specifications from clipboard.9.md Sections 22, 25 & docs/plan/tasks/8.1.md.
 * 
 * Provides DOM-independent, declarative commands for non-destructive UI actuation:
 * - no_op: Maintain current state (safe default).
 * - highlight_primary_action: Subtle visual emphasis on primary action button.
 * - simplify_options: Collapse non-essential filter accordions.
 * - expand_tooltip: Display contextual help for ambiguous field.
 * - offer_assistance: Display non-modal assistance banner.
 */

export const INTERVENTION_SCHEMA_VERSION = '1.0';

export const INTERVENTION_TYPES = [
  'no_op',
  'highlight_primary_action',
  'simplify_options',
  'expand_tooltip',
  'offer_assistance'
] as const;

export type InterventionType = (typeof INTERVENTION_TYPES)[number];

export type InterventionSource = 'fast' | 'slow' | 'rule';

/**
 * Type guard checking if a given string is a valid InterventionType.
 */
export function isInterventionType(val: unknown): val is InterventionType {
  return (
    typeof val === 'string' &&
    (INTERVENTION_TYPES as readonly string[]).includes(val as string)
  );
}

/**
 * Declarative command representing a desired UI adaptation.
 * Must contain zero direct DOM references or side-effects.
 */
export interface InterventionCommand {
  type: InterventionType;
  targetComponentId?: string;
  confidence?: number;
  source: InterventionSource;
  issuedAt: number;
  ttlMs?: number;
  reason?: string;
}

export interface CreateInterventionOptions {
  type: InterventionType;
  targetComponentId?: string;
  confidence?: number;
  source?: InterventionSource;
  issuedAt?: number;
  ttlMs?: number;
  reason?: string;
}

/**
 * Factory helper for creating validated InterventionCommand instances.
 */
export function createInterventionCommand(
  options: CreateInterventionOptions
): InterventionCommand {
  if (!isInterventionType(options.type)) {
    throw new Error(`Invalid intervention type: ${options.type}`);
  }

  return {
    type: options.type,
    targetComponentId: options.targetComponentId,
    confidence: options.confidence,
    source: options.source ?? 'rule',
    issuedAt: options.issuedAt ?? Date.now(),
    ttlMs: options.ttlMs,
    reason: options.reason
  };
}

/**
 * Factory helper for creating the safe default no_op command.
 */
export function createNoOpCommand(
  source: InterventionSource = 'rule',
  reason = 'Safe default no_op'
): InterventionCommand {
  return {
    type: 'no_op',
    source,
    issuedAt: Date.now(),
    reason
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates whether an unknown object conforms to the InterventionCommand schema.
 */
export function validateInterventionCommand(cmd: unknown): ValidationResult {
  const errors: string[] = [];

  if (!cmd || typeof cmd !== 'object') {
    return { valid: false, errors: ['Command must be a non-null object'] };
  }

  const c = cmd as Record<string, unknown>;

  if (!isInterventionType(c.type)) {
    errors.push(
      `Invalid or missing type '${String(c.type)}'. Must be one of: ${INTERVENTION_TYPES.join(', ')}`
    );
  }

  if (
    c.source !== 'fast' &&
    c.source !== 'slow' &&
    c.source !== 'rule'
  ) {
    errors.push(
      `Invalid or missing source '${String(c.source)}'. Must be 'fast', 'slow', or 'rule'`
    );
  }

  if (typeof c.issuedAt !== 'number' || !Number.isFinite(c.issuedAt)) {
    errors.push('issuedAt must be a finite number timestamp');
  }

  if (c.confidence !== undefined) {
    if (
      typeof c.confidence !== 'number' ||
      !Number.isFinite(c.confidence) ||
      c.confidence < 0 ||
      c.confidence > 1
    ) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }

  if (c.targetComponentId !== undefined && typeof c.targetComponentId !== 'string') {
    errors.push('targetComponentId must be a string if provided');
  }

  if (c.ttlMs !== undefined && (typeof c.ttlMs !== 'number' || c.ttlMs <= 0)) {
    errors.push('ttlMs must be a positive number if provided');
  }

  if (c.reason !== undefined && typeof c.reason !== 'string') {
    errors.push('reason must be a string if provided');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export type {
  InterventionEvent,
  InterventionEventType
} from '../telemetry/events';
