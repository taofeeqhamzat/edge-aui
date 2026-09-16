import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryObserver, createTelemetryObserver } from '../src/telemetry/observer';
import { BehaviourEvent } from '../src/telemetry/events';

describe('telemetry/observer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('initializes in non-observing state and transitions on start() / stop()', () => {
    const observer = new TelemetryObserver();
    expect(observer.isObserving()).toBe(false);

    observer.start(container);
    expect(observer.isObserving()).toBe(true);

    observer.stop();
    expect(observer.isObserving()).toBe(false);
  });

  it('captures pointer events and normalizes coordinates strictly to [0, 1]', () => {
    const observer = createTelemetryObserver();
    const captured: BehaviourEvent[] = [];
    observer.subscribe((evt) => captured.push(evt));

    observer.start(container);

    const mouseMove = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 400,
      clientY: 300
    });
    container.dispatchEvent(mouseMove);

    expect(captured.length).toBe(1);
    const event = captured[0];
    expect(event.type).toBe('mousemove');
    expect(event.x).toBeGreaterThanOrEqual(0);
    expect(event.x).toBeLessThanOrEqual(1);
    expect(event.y).toBeGreaterThanOrEqual(0);
    expect(event.y).toBeLessThanOrEqual(1);
    expect(event.timestamp).toBeGreaterThanOrEqual(0);

    observer.stop();
  });

  it('automatically extracts data-aui-* semantic attributes from target and ancestors', () => {
    const observer = createTelemetryObserver();
    const captured: BehaviourEvent[] = [];
    observer.subscribe((evt) => captured.push(evt));

    container.innerHTML = `
      <div data-aui-component="filter-drawer" data-aui-role="filter" data-aui-action="toggle">
        <button id="test-btn" data-aui-component="apply-filter" data-aui-role="primary-action" data-aui-action="click">
          <span id="test-span">Apply</span>
        </button>
      </div>
    `;

    observer.start(container);

    const span = document.getElementById('test-span')!;
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      clientX: 100,
      clientY: 100
    });
    span.dispatchEvent(clickEvent);

    expect(captured.length).toBe(1);
    const event = captured[0];
    expect(event.type).toBe('click');
    expect(event.componentId).toBe('apply-filter');
    expect(event.componentRole).toBe('primary-action');
    expect(event.action).toBe('click');
    expect(event.targetTag).toBe('span');

    observer.stop();
  });

  it('captures scroll events and emits normalized scroll depth', () => {
    const observer = createTelemetryObserver();
    const captured: BehaviourEvent[] = [];
    observer.subscribe((evt) => captured.push(evt));

    observer.start(container);

    const scrollEvent = new Event('scroll', { bubbles: true });
    container.dispatchEvent(scrollEvent);

    expect(captured.length).toBe(1);
    expect(captured[0].type).toBe('scroll');
    expect(captured[0].scrollX).toBeDefined();
    expect(captured[0].scrollY).toBeDefined();

    observer.stop();
  });

  it('captures form input, change, and submit events', () => {
    const observer = createTelemetryObserver();
    const captured: BehaviourEvent[] = [];
    observer.subscribe((evt) => captured.push(evt));

    container.innerHTML = `
      <form id="search-form" data-aui-component="search-form" data-aui-role="form-field">
        <input id="search-input" data-aui-component="query-input" data-aui-role="form-field" data-aui-action="input" type="text" />
      </form>
    `;

    observer.start(container);

    const inputEl = document.getElementById('search-input')!;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    const formEl = document.getElementById('search-form')!;
    formEl.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(captured.length).toBe(3);
    expect(captured[0].type).toBe('input');
    expect(captured[0].componentId).toBe('query-input');
    expect(captured[1].type).toBe('change');
    expect(captured[2].type).toBe('submit');
    expect(captured[2].componentId).toBe('search-form');

    observer.stop();
  });

  it('unsubscribes listeners cleanly without side effects', () => {
    const observer = createTelemetryObserver();
    const captured: BehaviourEvent[] = [];
    const unsubscribe = observer.subscribe((evt) => captured.push(evt));

    observer.start(container);

    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(captured.length).toBe(1);

    unsubscribe();

    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(captured.length).toBe(1);

    observer.stop();
  });

  it('stops listening and detaches all event handlers when stop() is called', () => {
    const observer = createTelemetryObserver();
    const captured: BehaviourEvent[] = [];
    observer.subscribe((evt) => captured.push(evt));

    observer.start(container);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(captured.length).toBe(1);

    observer.stop();
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(captured.length).toBe(1);
  });

  it('respects sampleIntervalMs throttling for high-frequency pointer movements', () => {
    const observer = createTelemetryObserver({ sampleIntervalMs: 100 });
    const captured: BehaviourEvent[] = [];
    observer.subscribe((evt) => captured.push(evt));

    observer.start(container);

    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }));
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 30 }));

    // Only the first event should fire within the 100ms throttle interval
    expect(captured.length).toBe(1);

    observer.stop();
  });
});
