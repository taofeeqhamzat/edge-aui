import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { App } from '../src/app/App';
import {
  getActiveUIContext,
  initUIContextTracker,
  setTrackedUIElement
} from '../src/telemetry/contextProvider';
import { taskManager } from '../src/testbed/tasks/taskManager';

describe('Task 3.2: Active UI Context Provider (getActiveUIContext)', () => {
  beforeEach(() => {
    taskManager.resetTask();
    setTrackedUIElement(null);
  });

  afterEach(() => {
    taskManager.resetTask();
    setTrackedUIElement(null);
  });

  it('returns default context when no element is focused or hovered', () => {
    const { container } = render(<App />);
    const context = getActiveUIContext({ root: container });

    expect(context.route).toBe('Overview');
    expect(context.taskId).toBeUndefined();
    expect(context.taskStepId).toBeUndefined();
    expect(context.availableActions).toContain('click');
    expect(context.primaryActionAvailable).toBe(false);
  });

  it('resolves activeComponentId and role when target element is specified', () => {
    const { container } = render(<App />);
    const navBtn = container.querySelector('[data-aui-component="nav-Analytics"]');
    expect(navBtn).not.toBeNull();

    const context = getActiveUIContext({ targetElement: navBtn, root: container });
    expect(context.activeComponentId).toBe('nav-Analytics');
    expect(context.componentRole).toBe('navigation');
    expect(context.availableActions).toContain('click');
    expect(context.expandable).toBe(false);
  });

  it('traverses ancestor hierarchy when a child of an annotated component is active', () => {
    const { container } = render(
      <div data-aui-route="Analytics">
        <button data-aui-component="btn-apply-filters" data-aui-role="primary-action" data-aui-action="click">
          <span id="nested-span">Click Me</span>
        </button>
      </div>
    );

    const nestedSpan = container.querySelector('#nested-span');
    expect(nestedSpan).not.toBeNull();

    const context = getActiveUIContext({ targetElement: nestedSpan, root: container });
    expect(context.route).toBe('Analytics');
    expect(context.activeComponentId).toBe('btn-apply-filters');
    expect(context.componentRole).toBe('primary-action');
    expect(context.primaryActionAvailable).toBe(true);
  });

  it('detects expandable components for accordions', () => {
    const { container } = render(
      <div>
        <button
          data-aui-component="filter-Region"
          data-aui-role="accordion"
          data-aui-action="click"
          aria-expanded="false"
        >
          Region
        </button>
      </div>
    );

    const accordionBtn = container.querySelector('[data-aui-component="filter-Region"]');
    const context = getActiveUIContext({ targetElement: accordionBtn, root: container });
    expect(context.expandable).toBe(true);
    expect(context.componentRole).toBe('accordion');
  });

  it('detects helpAvailable when tooltip or help components exist', () => {
    const { container } = render(
      <div>
        <span data-aui-component="tooltip-region" data-aui-role="tooltip">
          [?]
        </span>
      </div>
    );

    const context = getActiveUIContext({ root: container });
    expect(context.helpAvailable).toBe(true);
  });

  it('integrates with TaskManager state and step progression', () => {
    const { container } = render(<App />);

    // Start Task T1
    taskManager.startTask('T1');
    let context = getActiveUIContext({ root: container });
    expect(context.taskId).toBe('T1');
    expect(context.taskStepId).toBe('T1-1');

    // Simulate completing step 1 (nav-Analytics click)
    taskManager.recordInteraction('nav-Analytics', 'click');
    context = getActiveUIContext({ root: container });
    expect(context.taskId).toBe('T1');
    expect(context.taskStepId).toBe('T1-2');

    // Simulate completing step 2 (filter-Region click)
    taskManager.recordInteraction('filter-Region', 'click');
    context = getActiveUIContext({ root: container });
    expect(context.taskStepId).toBe('T1-3');
  });

  it('tracks hovered element via setTrackedUIElement and initUIContextTracker', () => {
    const { container } = render(
      <div data-aui-route="Analytics">
        <button id="test-btn" data-aui-component="test-target" data-aui-role="secondary-action" data-aui-action="click">
          Action
        </button>
      </div>
    );

    const cleanup = initUIContextTracker(container);
    const testBtn = container.querySelector('#test-btn');

    // Simulate mouseover event
    testBtn?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    const context = getActiveUIContext({ root: container });
    expect(context.activeComponentId).toBe('test-target');
    expect(context.componentRole).toBe('secondary-action');

    cleanup();
  });
});
