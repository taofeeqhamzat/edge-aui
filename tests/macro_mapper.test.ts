/**
 * MacroMapper Contract and Generic Annotation Mapper (Task 20.2)
 *
 * The framework ships a mapper for an unconfigured DOM application: symbols are derived
 * mechanically from the semantic annotation contract plus the behavioural markers the
 * framework detects itself. It is deliberately *not* a curated vocabulary — an application
 * that wants meaningful symbols supplies its own mapper, as the testbed does.
 */

import { describe, it, expect } from 'vitest';
import {
  createAnnotationMacroMapper,
  BEHAVIOURAL_MARKER_SYMBOLS,
  DEFAULT_MACRO_VOCABULARY_ID
} from '../src/macro/mapper';
import type { BehaviourEvent } from '../src/telemetry/events';

function event(overrides: Partial<BehaviourEvent>): BehaviourEvent {
  return { timestamp: 1_700_000_000_000, type: 'click', ...overrides };
}

describe('generic annotation macro mapper', () => {
  const mapper = createAnnotationMacroMapper();

  it('identifies its vocabulary', () => {
    expect(mapper.vocabularyId).toBe(DEFAULT_MACRO_VOCABULARY_ID);
  });

  it('derives a navigation symbol from a deliberate navigation act', () => {
    expect(
      mapper.deriveSymbol(
        event({ type: 'click', componentRole: 'navigation', componentId: 'nav-cart' })
      )
    ).toBe('NAV_CART');
  });

  it('does not derive a navigation symbol from incidental pointer traffic', () => {
    expect(
      mapper.deriveSymbol(
        event({ type: 'mouseover', componentRole: 'navigation', componentId: 'nav-cart' })
      )
    ).toBeNull();
    expect(mapper.deriveSymbol(event({ type: 'mousemove', componentId: 'nav-cart' }))).toBeNull();
  });

  it('derives a selection symbol from a change event', () => {
    expect(
      mapper.deriveSymbol(event({ type: 'change', componentId: 'quantity-input' }))
    ).toBe('SELECT_QUANTITY_INPUT');
  });

  it('derives disclosure symbols from the observed expanded state', () => {
    expect(
      mapper.deriveSymbol(event({ type: 'click', componentId: 'panel', ariaExpanded: true }))
    ).toBe('EXPAND_PANEL');
    expect(
      mapper.deriveSymbol(event({ type: 'click', componentId: 'panel', ariaExpanded: false }))
    ).toBe('COLLAPSE_PANEL');
    // Without an observed state the act is a plain click, not a guessed disclosure.
    expect(mapper.deriveSymbol(event({ type: 'click', componentId: 'panel' }))).toBe('CLICK_PANEL');
  });

  it('maps framework-detected behavioural markers', () => {
    expect(mapper.deriveSymbol(event({ type: 'click', action: 'backtrack' }))).toBe(
      BEHAVIOURAL_MARKER_SYMBOLS.backtrack
    );
    expect(mapper.deriveSymbol(event({ type: 'scroll', action: 'rapid_scroll' }))).toBe(
      BEHAVIOURAL_MARKER_SYMBOLS.rapidScroll
    );
    expect(mapper.deriveSymbol(event({ type: 'click', action: 'idle_dwell' }))).toBe(
      BEHAVIOURAL_MARKER_SYMBOLS.idleDwell
    );
  });

  it('returns null when no annotation identifies a deliberate act', () => {
    expect(mapper.deriveSymbol(event({ type: 'click' }))).toBeNull();
  });

  it('is deterministic for the same event', () => {
    const sample = event({ type: 'change', componentId: 'Quantity Input' });
    expect(mapper.deriveSymbol(sample)).toBe(mapper.deriveSymbol(sample));
    expect(mapper.deriveSymbol(sample)).toBe('SELECT_QUANTITY_INPUT');
  });
});
