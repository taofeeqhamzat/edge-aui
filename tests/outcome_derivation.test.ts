import { describe, it, expect } from 'vitest';
import { deriveOutcomeForWindow } from '../src/outcome/derive';
import { BehaviourEvent } from '../src/telemetry/events';

const ev = (timestamp: number, type: BehaviourEvent['type'], extra: Partial<BehaviourEvent> = {}): BehaviourEvent =>
  ({ timestamp, type, ...extra });

describe('Outcome derivation (model-preparation parity)', () => {
  /**
   * The lookahead policy is ported from model-preparation/src/target_generation.py.
   * These cases mirror the Python reference semantics: earliest qualifying event wins,
   * and the priority hierarchy is applied strictly as a tie-breaker.
   */
  it('earliest qualifying event wins over a higher-priority later event', () => {
    const r = deriveOutcomeForWindow({
      windowEndMs: 0,
      futureEvents: [
        ev(1900, 'click', { componentId: 'btn-apply-filters', componentRole: 'submit-action' }),  // FORM_SUBMIT, later
        ev(700, 'mouseover'), ev(750, 'mouseover')                 // HOVER_DWELL, earlier
      ]
    });
    expect(r.outcome).toBe('HOVER_DWELL');
  });

  it('resolves ties via the priority hierarchy', () => {
    const r = deriveOutcomeForWindow({
      windowEndMs: 0,
      futureEvents: [
        ev(700, 'click', { componentId: 'filter-Region' }),
        ev(700, 'click', { componentId: 'btn-apply-filters', componentRole: 'submit-action' })
      ]
    });
    expect(r.outcome).toBe('FORM_SUBMIT');
    expect(r.metadata.tieBroken).toBe(true);
  });

  it('returns NO_OUTCOME for inactivity without termination', () => {
    const r = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [] });
    expect(r.outcome).toBe('NO_OUTCOME');
  });

  it('returns ABANDON on stream exhaustion', () => {
    const r = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [], sessionTerminated: true });
    expect(r.outcome).toBe('ABANDON');
  });

  it('returns ABANDON on a lifecycle event', () => {
    const r = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [ev(800, 'pagehide')] });
    expect(r.outcome).toBe('ABANDON');
    expect(r.metadata.observableTermination).toBe(true);
  });

  it('requires 4 scroll events for RAPID_SCROLL', () => {
    const three = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [ev(600,'scroll'),ev(650,'scroll'),ev(700,'scroll')] });
    const four = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [ev(600,'scroll'),ev(650,'scroll'),ev(700,'scroll'),ev(750,'scroll')] });
    expect(three.outcome).toBe('NO_OUTCOME');
    expect(four.outcome).toBe('RAPID_SCROLL');
  });

  /**
   * Changed by Task 20.4 (was: blur and popstate map to BACKTRACK).
   *
   * Backtracking is a property of the route sequence, not of an event type. `blur` is a
   * focus change and `popstate` is the browser reporting a route the participant may have
   * been sent to; neither is a reversal on its own. The route tracker in
   * `outcome/backtracking.ts` decides, and `OutcomeDeriver` promotes a settled outcome to
   * BACKTRACK when it does. `tests/semantic_outcomes.test.ts` covers that path.
   */
  it('does not infer BACKTRACK from blur, popstate or hashchange', () => {
    for (const type of ['blur', 'popstate', 'hashchange'] as const) {
      const result = deriveOutcomeForWindow({ windowEndMs: 0, futureEvents: [ev(600, type)] });
      expect(result.outcome, type).not.toBe('BACKTRACK');
    }
  });
});
