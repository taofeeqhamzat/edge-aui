import { UIContext, AuiComponentRole, AuiAction } from '../types/telemetry';
import { taskManager } from '../testbed/tasks/taskManager';
import { EXPERIMENTAL_TASKS } from '../testbed/tasks/taskModel';

export interface UIContextOptions {
  targetElement?: Element | null;
  route?: string;
  root?: Document | HTMLElement;
}

let lastTrackedElement: Element | null = null;
let trackerCleanup: (() => void) | null = null;

/**
 * Initializes passive hover and focus tracking on the root container.
 * Returns an unbind cleanup function.
 */
export function initUIContextTracker(root: Document | HTMLElement = typeof document !== 'undefined' ? document : null as unknown as Document): () => void {
  if (!root || typeof root.addEventListener !== 'function') {
    return () => {};
  }

  const onMouseOver = (event: Event) => {
    const target = event.target as Element | null;
    if (target && target.nodeType === Node.ELEMENT_NODE) {
      lastTrackedElement = target;
    }
  };

  const onFocusIn = (event: Event) => {
    const target = event.target as Element | null;
    if (target && target.nodeType === Node.ELEMENT_NODE) {
      lastTrackedElement = target;
    }
  };

  root.addEventListener('mouseover', onMouseOver, true);
  root.addEventListener('focusin', onFocusIn, true);

  const cleanup = () => {
    root.removeEventListener('mouseover', onMouseOver, true);
    root.removeEventListener('focusin', onFocusIn, true);
    if (trackerCleanup === cleanup) {
      trackerCleanup = null;
    }
  };

  trackerCleanup = cleanup;
  return cleanup;
}

/**
 * Set or reset tracked element directly (useful for tests and synthetic interactions)
 */
export function setTrackedUIElement(element: Element | null) {
  lastTrackedElement = element;
}

/**
 * Returns the current interaction context snapshot for edge-aui inference.
 */
export function getActiveUIContext(options?: UIContextOptions): UIContext {
  const doc = typeof document !== 'undefined' ? document : null;
  const root = options?.root || doc;

  // 1. Resolve active route
  let route = options?.route;
  if (!route && root) {
    const routeEl = root.querySelector('[data-aui-route]');
    if (routeEl) {
      route = routeEl.getAttribute('data-aui-route') || undefined;
    }
  }
  if (!route && typeof window !== 'undefined' && window.location?.pathname) {
    const cleanPath = window.location.pathname.replace(/^\//, '');
    if (cleanPath) {
      route = cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1);
    }
  }
  if (!route) {
    route = 'Overview';
  }

  // 2. Resolve target element
  let target = options?.targetElement;
  if (!target) {
    if (lastTrackedElement && lastTrackedElement.isConnected) {
      target = lastTrackedElement;
    } else if (doc && doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement) {
      target = doc.activeElement;
    } else if (root) {
      try {
        target = root.querySelector(':hover');
      } catch {
        // :hover might not be supported in some synthetic environments
        target = null;
      }
    }
  }

  // 3. Resolve annotated component metadata
  let activeComponentId: string | undefined;
  let componentRole: AuiComponentRole | string | undefined;
  let activeAction: AuiAction | string | undefined;
  let expandable = false;

  if (target) {
    const annotatedEl = target.closest ? target.closest('[data-aui-component]') : null;
    if (annotatedEl) {
      activeComponentId = annotatedEl.getAttribute('data-aui-component') || undefined;
      componentRole = (annotatedEl.getAttribute('data-aui-role') as AuiComponentRole) || undefined;
      activeAction = (annotatedEl.getAttribute('data-aui-action') as AuiAction) || undefined;

      if (
        componentRole === 'accordion' ||
        annotatedEl.hasAttribute('aria-expanded') ||
        annotatedEl.getAttribute('data-aui-component')?.includes('accordion')
      ) {
        expandable = true;
      }
    }
  }

  // 4. Resolve task state
  let taskId: string | undefined;
  let taskStepId: string | undefined;
  const taskState = taskManager.getState();
  if (taskState && taskState.currentTaskId) {
    taskId = taskState.currentTaskId;
    const task = EXPERIMENTAL_TASKS[taskState.currentTaskId];
    if (task && task.steps && task.steps[taskState.currentStepIndex]) {
      taskStepId = task.steps[taskState.currentStepIndex].stepId;
    }
  }

  // 5. Compute available actions
  const availableActionsSet = new Set<string>();
  if (activeAction) {
    availableActionsSet.add(activeAction);
  }
  if (root) {
    const actionElements = root.querySelectorAll('[data-aui-action]');
    actionElements.forEach((el) => {
      const act = el.getAttribute('data-aui-action');
      if (act) {
        availableActionsSet.add(act);
      }
    });
  }
  if (availableActionsSet.size === 0) {
    availableActionsSet.add('click');
  }

  // 6. Compute primaryActionAvailable
  let primaryActionAvailable = false;
  if (root) {
    const primaryAction = root.querySelector('[data-aui-role="primary-action"]:not([disabled])');
    primaryActionAvailable = primaryAction !== null;
  }

  // 7. Compute helpAvailable
  let helpAvailable = false;
  if (root) {
    const helpOrTooltip = root.querySelector(
      '[data-aui-role="help"], [data-aui-role="tooltip"], [data-aui-component*="help"], [data-aui-component*="tooltip"]'
    );
    helpAvailable = helpOrTooltip !== null;
  }

  return {
    route,
    activeComponentId,
    componentRole,
    taskId,
    taskStepId,
    availableActions: Array.from(availableActionsSet),
    primaryActionAvailable,
    helpAvailable,
    expandable
  };
}
