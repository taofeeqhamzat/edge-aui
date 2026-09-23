import { describe, it, expect, beforeEach } from 'vitest';
import {
  InterventionPolicy,
  createInterventionPolicy
} from '../src/intervention/policy';
import {
  createInterventionCommand,
  createNoOpCommand
} from '../src/intervention/types';
import { UIContext } from '../src/types/uiContext';

function createMockUIContext(overrides: Partial<UIContext> = {}): UIContext {
  return {
    route: 'Analytics',
    activeComponentId: 'filter-drawer',
    componentRole: 'filter',
    availableActions: ['click', 'change'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true,
    taskId: 'T1',
    taskStepId: 'T1-1',
    ...overrides
  };
}

describe('Task 8.2: InterventionPolicy (Confidence & Consecutive Window Gates)', () => {
  let policy: InterventionPolicy;

  beforeEach(() => {
    policy = createInterventionPolicy({
      confidenceThreshold: 0.75,
      requiredConsecutiveWindows: 2,
      enforceContextEligibility: true
    });
  });

  it('rejects transient single-window recommendation and safely defaults to no_op', () => {
    const context = createMockUIContext();
    const cmd = createInterventionCommand({
      type: 'highlight_primary_action',
      targetComponentId: 'btn-apply-filters',
      confidence: 0.85,
      source: 'slow'
    });

    const decision1 = policy.accept(cmd, context);
    expect(decision1.accepted).toBe(false);
    expect(decision1.candidateCount).toBe(1);
    expect(decision1.command.type).toBe('no_op');
    expect(decision1.reason).toContain('Transient recommendation pending persistence');
  });

  it('accepts recommendation once consecutive window persistence requirement is met', () => {
    const context = createMockUIContext();
    const cmd = createInterventionCommand({
      type: 'highlight_primary_action',
      targetComponentId: 'btn-apply-filters',
      confidence: 0.85,
      source: 'slow'
    });

    // Window 1: Pending
    const decision1 = policy.accept(cmd, context);
    expect(decision1.accepted).toBe(false);

    // Window 2: Confirmed
    const decision2 = policy.accept(cmd, context);
    expect(decision2.accepted).toBe(true);
    expect(decision2.candidateCount).toBe(2);
    expect(decision2.command.type).toBe('highlight_primary_action');
    expect(decision2.command.targetComponentId).toBe('btn-apply-filters');
  });

  it('rejects recommendations below confidence threshold and resets candidate count', () => {
    const context = createMockUIContext();
    const validCmd = createInterventionCommand({
      type: 'simplify_options',
      confidence: 0.80,
      source: 'slow'
    });
    const lowConfidenceCmd = createInterventionCommand({
      type: 'simplify_options',
      confidence: 0.60, // Below 0.75
      source: 'slow'
    });

    // Window 1: Valid high confidence
    const decision1 = policy.accept(validCmd, context);
    expect(decision1.candidateCount).toBe(1);

    // Window 2: Low confidence candidate -> Rejects and resets
    const decision2 = policy.accept(lowConfidenceCmd, context);
    expect(decision2.accepted).toBe(false);
    expect(decision2.command.type).toBe('no_op');
    expect(decision2.reason).toContain('below threshold');
    expect(decision2.candidateCount).toBe(0);

    // Window 3: Resumed high confidence -> Needs 2 new windows
    const decision3 = policy.accept(validCmd, context);
    expect(decision3.accepted).toBe(false);
    expect(decision3.candidateCount).toBe(1);
  });

  it('resets candidate tracking when candidate intervention changes', () => {
    const context = createMockUIContext();
    const cmdA = createInterventionCommand({
      type: 'simplify_options',
      confidence: 0.85,
      source: 'slow'
    });
    const cmdB = createInterventionCommand({
      type: 'offer_assistance',
      confidence: 0.90,
      source: 'slow'
    });

    policy.accept(cmdA, context); // Window 1: cmdA (count = 1)

    const decisionB = policy.accept(cmdB, context); // Window 2: cmdB (resets count to 1)
    expect(decisionB.accepted).toBe(false);
    expect(decisionB.candidateCount).toBe(1);

    const decisionB2 = policy.accept(cmdB, context); // Window 3: cmdB (count = 2)
    expect(decisionB2.accepted).toBe(true);
    expect(decisionB2.command.type).toBe('offer_assistance');
  });

  it('enforces UI context eligibility and rejects ineligible interventions', () => {
    // Context where primary action is NOT available
    const contextWithoutPrimaryAction = createMockUIContext({
      primaryActionAvailable: false
    });

    const highlightCmd = createInterventionCommand({
      type: 'highlight_primary_action',
      confidence: 0.95,
      source: 'fast'
    });

    const decision = policy.accept(highlightCmd, contextWithoutPrimaryAction);
    expect(decision.accepted).toBe(false);
    expect(decision.command.type).toBe('no_op');
    expect(decision.reason).toContain('Ineligible: No primary action available');

    // Context where accordions are NOT expandable
    const contextNotExpandable = createMockUIContext({
      expandable: false
    });

    const simplifyCmd = createInterventionCommand({
      type: 'simplify_options',
      confidence: 0.95,
      source: 'slow'
    });

    const simplifyDecision = policy.accept(simplifyCmd, contextNotExpandable);
    expect(simplifyDecision.accepted).toBe(false);
    expect(simplifyDecision.command.type).toBe('no_op');
    expect(simplifyDecision.reason).toContain('Ineligible: No expandable options');
  });

  it('automatically resets candidate streak on task switch', () => {
    const contextTask1 = createMockUIContext({ taskId: 'T1' });
    const contextTask2 = createMockUIContext({ taskId: 'T2' });

    const cmd = createInterventionCommand({
      type: 'offer_assistance',
      confidence: 0.90,
      source: 'slow'
    });

    // Window 1 under Task 1
    policy.accept(cmd, contextTask1);

    // Window 2 under Task 2 -> Reset occurs due to task switch
    const decision = policy.accept(cmd, contextTask2);
    expect(decision.accepted).toBe(false);
    expect(decision.candidateCount).toBe(1); // restarted count under T2
  });

  it('resets candidate streak on explicit user action notification', () => {
    const context = createMockUIContext();
    const cmd = createInterventionCommand({
      type: 'offer_assistance',
      confidence: 0.90,
      source: 'slow'
    });

    policy.accept(cmd, context); // Count = 1

    // User interacts
    policy.notifyUserAction('click');

    // Next window must restart count at 1
    const decision = policy.accept(cmd, context);
    expect(decision.accepted).toBe(false);
    expect(decision.candidateCount).toBe(1);
  });

  it('always accepts no_op as a safe default', () => {
    const context = createMockUIContext();
    const noOp = createNoOpCommand('rule', 'System idle');

    const decision = policy.accept(noOp, context);
    expect(decision.accepted).toBe(true);
    expect(decision.command.type).toBe('no_op');
    expect(decision.candidateCount).toBe(0);
  });
});
