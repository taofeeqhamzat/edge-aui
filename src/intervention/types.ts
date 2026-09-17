/**
 * Declarative InterventionCommand Contract & Action Taxonomies
 * Implements specifications from clipboard.9.md Section 22 and docs/plan/tasks/8.1.md.
 * Provides DOM-independent, declarative commands for non-destructive UI actuation.
 */

export const INTERVENTION_TYPES = [
  'no_op',
  'highlight_primary_action',
  'simplify_options',
  'expand_tooltip',
  'offer_assistance'
] as const;

export type InterventionType = typeof INTERVENTION_TYPES[number];

export function isInterventionType(val: unknown): val is InterventionType {
  return typeof val === 'string' && (INTERVENTION_TYPES as readonly string[]).includes(val as string);
}

/**
 * Declarative command representing a desired UI adaptation.
 * Must contain zero direct DOM references or side-effects.
 */
export interface InterventionCommand {
  type: InterventionType;
  targetComponentId?: string;
  confidence?: number;
  source: 'fast' | 'slow' | 'rule';
  issuedAt: number;
  ttlMs?: number;
  reason?: string;
}
