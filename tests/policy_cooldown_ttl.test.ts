import { describe, it, expect, beforeEach } from 'vitest';
import { InterventionPolicy } from '../src/intervention/policy';
import { UIActuator } from '../src/intervention/actuator';
import { InterventionCommand } from '../src/intervention/types';
import { UIContext } from '../src/types/uiContext';

const context: UIContext = {
  route: 'Analytics',
  activeComponentId: 'btn-apply-filters',
  availableActions: ['click'],
  primaryActionAvailable: true,
  helpAvailable: true,
  expandable: true
};

const command = (overrides: Partial<InterventionCommand> = {}): InterventionCommand => ({
  type: 'offer_assistance',
  source: 'slow',
  confidence: 0.9,
  issuedAt: Date.now(),
  ...overrides
});

describe('InterventionPolicy cooldown and dismissal feedback (assessment §25 P1-4)', () => {
  let policy: InterventionPolicy;

  beforeEach(() => {
    policy = new InterventionPolicy({
      confidenceThreshold: 0.75,
      requiredConsecutiveWindows: 2,
      enforceContextEligibility: true,
      cooldownMs: 5000,
      dismissalCooldownMs: 15000
    });
  });

  it('enters a cooldown after acceptance so the same adaptation is not re-applied', () => {
    const candidate = command();

    expect(policy.accept(candidate, context).accepted).toBe(false); // persistence 1/2
    expect(policy.accept(candidate, context).accepted).toBe(true); // persistence met

    // Immediately re-offering must be suppressed by the refractory period.
    const suppressed = policy.accept(candidate, context);
    expect(suppressed.accepted).toBe(false);
    expect(suppressed.reason).toContain('Cooldown');
    expect(policy.cooldownRemainingMs()).toBeGreaterThan(0);
  });

  it('does not enter a cooldown when no intervention was accepted', () => {
    policy.accept(command({ confidence: 0.2 }), context);
    expect(policy.cooldownRemainingMs()).toBe(0);
  });

  it('suppresses a specific intervention after the user dismisses it', () => {
    policy.notifyDismissal('offer_assistance');

    // Persistence is satisfied immediately, but dismissal feedback wins.
    const suppressed = policy.accept(command(), context);
    expect(suppressed.accepted).toBe(false);
    expect(suppressed.reason.toLowerCase()).toContain('dismiss');

    // A different intervention is unaffected.
    expect(policy.accept(command({ type: 'expand_tooltip', targetComponentId: 'tooltip-region' }), context).accepted).toBe(
      false
    ); // still needs persistence
    expect(
      policy.accept(command({ type: 'expand_tooltip', targetComponentId: 'tooltip-region' }), context).accepted
    ).toBe(true);
  });

  it('clears cooldown and dismissal state on reset', () => {
    const candidate = command();
    policy.accept(candidate, context);
    policy.accept(candidate, context);
    policy.notifyDismissal('offer_assistance');

    policy.reset();

    expect(policy.cooldownRemainingMs()).toBe(0);
    // After reset the type is no longer suppressed, so persistence starts again.
    expect(policy.accept(candidate, context).accepted).toBe(false);
    expect(policy.accept(candidate, context).accepted).toBe(true);
  });

  it('still accepts no_op unconditionally outside a cooldown', () => {
    const decision = policy.accept(
      { type: 'no_op', source: 'rule', issuedAt: Date.now() },
      context
    );
    expect(decision.accepted).toBe(true);
  });

  it('keeps confidence and eligibility gates independent of the cooldown', () => {
    // Ineligible target: no primary action available.
    const ineligible = policy.accept(
      command({ type: 'highlight_primary_action' }),
      { ...context, primaryActionAvailable: false }
    );
    expect(ineligible.accepted).toBe(false);
    expect(ineligible.reason).toContain('Ineligible');
  });
});

describe('UIActuator TTL and selector safety (assessment §13.1 / §25 P1-5)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reverts an adaptation automatically when its TTL elapses', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<button data-aui-component="btn-apply-filters" data-aui-role="primary-action">Apply</button>`;
    document.body.appendChild(root);

    const actuator = new UIActuator({ root });
    actuator.apply({
      type: 'highlight_primary_action',
      source: 'fast',
      targetComponentId: 'btn-apply-filters',
      issuedAt: Date.now(),
      ttlMs: 40
    });

    const button = root.querySelector('[data-aui-component="btn-apply-filters"]')!;
    expect(button.classList.contains('edge-aui-highlight')).toBe(true);

    await new Promise((r) => setTimeout(r, 120));

    expect(button.classList.contains('edge-aui-highlight')).toBe(false);
    expect(actuator.getActiveInterventions()).toHaveLength(0);
  });

  it('keeps an adaptation when no TTL is declared', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<button data-aui-component="btn-apply-filters" data-aui-role="primary-action">Apply</button>`;
    document.body.appendChild(root);

    const actuator = new UIActuator({ root });
    actuator.apply({
      type: 'highlight_primary_action',
      source: 'fast',
      targetComponentId: 'btn-apply-filters',
      issuedAt: Date.now()
    });

    await new Promise((r) => setTimeout(r, 60));

    expect(actuator.getActiveInterventions()).toHaveLength(1);
  });

  it('does not throw on a component id containing selector metacharacters', () => {
    const root = document.createElement('div');
    root.innerHTML = `<button data-aui-component='odd"id]' data-aui-role="primary-action">Apply</button>`;
    document.body.appendChild(root);

    const actuator = new UIActuator({ root });

    expect(() =>
      actuator.apply({
        type: 'highlight_primary_action',
        source: 'fast',
        targetComponentId: 'odd"id]',
        issuedAt: Date.now()
      })
    ).not.toThrow();

    // The metacharacter id is matched literally rather than producing a broken selector.
    const button = root.querySelector('button')!;
    expect(button.classList.contains('edge-aui-highlight')).toBe(true);

    actuator.reset();
    expect(button.classList.contains('edge-aui-highlight')).toBe(false);
  });
});
