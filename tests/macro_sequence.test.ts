import { describe, it, expect, beforeEach } from 'vitest';
import { MacroInteractionStream } from '../src/macro/sequence';
import { BehaviourEvent, MacroInteraction } from '../src/telemetry/events';
import { experimentRecorder } from '../src/telemetry/recorder';
import { TESTBED_MACRO_MAPPER } from '../src/testbed/config/macroVocabulary';

/** These cases assert the testbed's macro vocabulary, so they map with it. */
const testbedStream = (options: ConstructorParameters<typeof MacroInteractionStream>[0] = {}) =>
  new MacroInteractionStream({ ...options, macroMapper: TESTBED_MACRO_MAPPER });

describe('MacroInteractionStream (Task 6.2 & Fast Gate History)', () => {
  beforeEach(() => {
    experimentRecorder.clear();
  });

  it('records direct macro interactions and logs to experiment trace', () => {
    const stream = testbedStream({ maxCapacity: 10 });
    const interaction: MacroInteraction = {
      timestamp: 100,
      symbol: 'NAV_ANALYTICS',
      componentId: 'nav-Analytics'
    };

    stream.record(interaction);

    expect(stream.length).toBe(1);
    expect(stream.getRecent()).toEqual([interaction]);
    expect(experimentRecorder.getEventCounts().macroInteractions).toBe(1);
  });

  it('records from canonical BehaviourEvent when semantic symbol is present', () => {
    const stream = testbedStream();

    const semanticEv: BehaviourEvent = {
      timestamp: 200,
      type: 'click',
      componentId: 'btn-apply-filters',
      action: 'click'
    };

    const result = stream.recordFromBehaviourEvent(semanticEv);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('APPLY_FILTER');
    expect(result!.timestamp).toBe(200);
    expect(stream.length).toBe(1);

    // Non-semantic event (e.g. raw mouse movement) returns null and is not recorded
    const rawMove: BehaviourEvent = {
      timestamp: 250,
      type: 'mousemove',
      x: 0.1,
      y: 0.2
    };
    const moveResult = stream.recordFromBehaviourEvent(rawMove);
    expect(moveResult).toBeNull();
    expect(stream.length).toBe(1);
  });

  it('enforces bounded capacity and evicts oldest entries', () => {
    const stream = testbedStream({ maxCapacity: 3 });

    stream.record({ timestamp: 1, symbol: 'NAV_OVERVIEW' });
    stream.record({ timestamp: 2, symbol: 'NAV_ANALYTICS' });
    stream.record({ timestamp: 3, symbol: 'OPEN_FILTERS' });
    expect(stream.length).toBe(3);

    // Pushing 4th item evicts the 1st
    stream.record({ timestamp: 4, symbol: 'SELECT_REGION' });
    expect(stream.length).toBe(3);

    const symbols = stream.getRecentSymbols();
    expect(symbols).toEqual(['NAV_ANALYTICS', 'OPEN_FILTERS', 'SELECT_REGION']);
  });

  it('generates pattern strings formatted for Fast Gate PrefixSpan pattern matching', () => {
    const stream = testbedStream();

    stream.record({ timestamp: 10, symbol: 'NAV_ANALYTICS' });
    stream.record({ timestamp: 20, symbol: 'OPEN_FILTERS' });
    stream.record({ timestamp: 30, symbol: 'SELECT_REGION' });
    stream.record({ timestamp: 40, symbol: 'APPLY_FILTER' });

    // Full pattern
    expect(stream.toPatternString()).toBe(
      'NAV_ANALYTICS > OPEN_FILTERS > SELECT_REGION > APPLY_FILTER'
    );

    // Last 3 symbols
    expect(stream.toPatternString(3)).toBe(
      'OPEN_FILTERS > SELECT_REGION > APPLY_FILTER'
    );

    // Custom separator
    expect(stream.toPatternString(2, ' -> ')).toBe(
      'SELECT_REGION -> APPLY_FILTER'
    );
  });

  it('notifies subscribers on new macro interactions', () => {
    const stream = testbedStream();
    const emitted: string[] = [];

    const unsubscribe = stream.subscribe((interaction) => {
      emitted.push(interaction.symbol);
    });

    stream.record({ timestamp: 100, symbol: 'OPEN_REPORT' });
    stream.record({ timestamp: 200, symbol: 'EXPORT_REPORT' });

    expect(emitted).toEqual(['OPEN_REPORT', 'EXPORT_REPORT']);

    unsubscribe();
    stream.record({ timestamp: 300, symbol: 'BACKTRACK' });

    expect(emitted).toEqual(['OPEN_REPORT', 'EXPORT_REPORT']);
  });

  it('clears bounded stream buffer cleanly', () => {
    const stream = testbedStream();
    stream.record({ timestamp: 10, symbol: 'NAV_SETTINGS' });
    expect(stream.length).toBe(1);

    stream.clear();
    expect(stream.length).toBe(0);
    expect(stream.getRecent()).toEqual([]);
  });
});
