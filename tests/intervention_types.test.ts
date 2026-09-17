import { describe, it, expect } from 'vitest';
import {
  INTERVENTION_SCHEMA_VERSION,
  INTERVENTION_TYPES,
  isInterventionType,
  createInterventionCommand,
  createNoOpCommand,
  validateInterventionCommand
} from '../src/intervention/types';

describe('Task 8.1: InterventionCommand Contract & Action Taxonomies', () => {
  it('defines 5 standard action taxonomies and schema version 1.0', () => {
    expect(INTERVENTION_SCHEMA_VERSION).toBe('1.0');
    expect(INTERVENTION_TYPES).toEqual([
      'no_op',
      'highlight_primary_action',
      'simplify_options',
      'expand_tooltip',
      'offer_assistance'
    ]);
  });

  it('correctly validates intervention types with isInterventionType', () => {
    for (const t of INTERVENTION_TYPES) {
      expect(isInterventionType(t)).toBe(true);
    }
    expect(isInterventionType('invalid_action')).toBe(false);
    expect(isInterventionType(123)).toBe(false);
    expect(isInterventionType(null)).toBe(false);
  });

  it('creates valid InterventionCommand via createInterventionCommand', () => {
    const cmd = createInterventionCommand({
      type: 'highlight_primary_action',
      targetComponentId: 'btn-apply-filters',
      confidence: 0.85,
      source: 'slow',
      ttlMs: 5000,
      reason: 'User hesitating near submit'
    });

    expect(cmd.type).toBe('highlight_primary_action');
    expect(cmd.targetComponentId).toBe('btn-apply-filters');
    expect(cmd.confidence).toBe(0.85);
    expect(cmd.source).toBe('slow');
    expect(cmd.ttlMs).toBe(5000);
    expect(cmd.reason).toBe('User hesitating near submit');
    expect(cmd.issuedAt).toBeTypeOf('number');

    const validation = validateInterventionCommand(cmd);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('creates safe default no_op command', () => {
    const noOp = createNoOpCommand('fast', 'PrefixSpan cache miss');
    expect(noOp.type).toBe('no_op');
    expect(noOp.source).toBe('fast');
    expect(noOp.reason).toBe('PrefixSpan cache miss');
    expect(noOp.issuedAt).toBeTypeOf('number');

    const validation = validateInterventionCommand(noOp);
    expect(validation.valid).toBe(true);
  });

  it('catches validation errors for malformed commands', () => {
    // Missing type, invalid source, negative confidence
    const invalidCmd: any = {
      type: 'unknown_type',
      source: 'invalid_source',
      confidence: -0.5,
      issuedAt: 'not-a-number'
    };

    const validation = validateInterventionCommand(invalidCmd);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(3);

    expect(validateInterventionCommand(null).valid).toBe(false);
    expect(validateInterventionCommand('not-an-object').valid).toBe(false);
  });
});
