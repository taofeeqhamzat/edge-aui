/**
 * Passive Behavioural Telemetry Observer
 * Implements Stage 4.1 specifications from docs/testbed/prd.md & docs/plan/tasks/4.1.md.
 * Captures pointer, scroll, form, and navigation interactions with zero layout thrashing.
 */

import {
  BehaviourEvent,
  BehaviourEventType
} from './events';
import {
  getMonotonicTimestamp,
  getWallClockTimestamp,
  normalizeCoordinates,
  normalizeScroll,
  getViewportDimensions,
  getDocumentScrollBounds,
  getGeometrySnapshot
} from './normalizer';
import { getActiveUIContext } from './contextProvider';
import { defaultCollector } from '../runtime/instrumentation';

/**
 * The disclosure state after the action, given the state observed at capture time.
 *
 * The observer listens in the capture phase, so it always reads the pre-action value. A
 * control that declares the `accordion` role toggles its disclosed section on click, so the
 * post-action value is the negation of the observed one. Leaving it unflipped labelled every
 * opening click as a closing one, which is a semantic-outcome defect rather than a cosmetic
 * one: the trace then says the participant collapsed the filter they had just opened.
 */
function toDisclosureStateAfter(
  observed: boolean | undefined,
  componentRole: string | undefined,
  eventType: BehaviourEventType | undefined
): boolean | undefined {
  if (observed === undefined) return undefined;
  if (eventType !== 'click') return observed;
  if (componentRole !== 'accordion') return observed;
  return !observed;
}

export type TelemetryEventListener = (event: BehaviourEvent) => void;

export interface TelemetryObserverOptions {
  /**
   * Root DOM node to bind events. Defaults to window in browser.
   */
  root?: Window | Document | HTMLElement;

  /**
   * Minimum millisecond interval between high-frequency pointer movement events.
   * Default is 0 (unthrottled / natural browser event frequency).
   */
  sampleIntervalMs?: number;

  /**
   * Initial event listener callback.
   */
  onEvent?: TelemetryEventListener;
}

export class TelemetryObserver {
  private root: Window | Document | HTMLElement | null = null;
  private listeners: Set<TelemetryEventListener> = new Set();
  private isRunning = false;
  private sampleIntervalMs: number;

  // Viewport bounds cache to avoid layout thrashing
  private cachedViewport = { width: 1920, height: 1080 };
  private lastMouseMoveTime = 0;
  private lastScrollTime = 0;

  // Track unbind handlers
  private unbindHandlers: (() => void)[] = [];

  constructor(options: TelemetryObserverOptions = {}) {
    this.sampleIntervalMs = options.sampleIntervalMs ?? 0;
    if (options.onEvent) {
      this.listeners.add(options.onEvent);
    }
  }

  /**
   * Subscribe a new event listener. Returns an unsubscribe function.
   */
  public subscribe(listener: TelemetryEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Returns whether telemetry observation is currently active.
   */
  public isObserving(): boolean {
    return this.isRunning;
  }

  /**
   * Starts telemetry observation on the target root.
   */
  public start(root?: Window | Document | HTMLElement): void {
    if (this.isRunning) {
      return;
    }

    const targetRoot = root || (typeof window !== 'undefined' ? window : null);
    if (!targetRoot) {
      return;
    }

    this.root = targetRoot;
    this.cachedViewport = getViewportDimensions();
    this.attachListeners(this.root);
    this.isRunning = true;
  }

  /**
   * Stops observation and removes all event listeners.
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    for (const unbind of this.unbindHandlers) {
      unbind();
    }
    this.unbindHandlers = [];
    this.root = null;
    this.isRunning = false;
  }

  /**
   * Dispatches a BehaviourEvent to all registered listeners.
   */
  public emit(event: BehaviourEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[TelemetryObserver] Listener threw error:', err);
      }
    }
  }

  private attachListeners(target: Window | Document | HTMLElement): void {
    const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };

    // Viewport resize observer to keep cached viewport fresh without querying DOM in hot loop
    const onResize = () => {
      this.cachedViewport = getViewportDimensions();
    };

    // Pointer event handlers
    const onPointerMove = (e: Event) => {
      const mouseEvent = e as MouseEvent;
      const now = getMonotonicTimestamp();
      if (this.sampleIntervalMs > 0 && now - this.lastMouseMoveTime < this.sampleIntervalMs) {
        return;
      }
      this.lastMouseMoveTime = now;
      this.recordPointerEvent('mousemove', mouseEvent);
    };

    const onPointerOver = (e: Event) => this.recordPointerEvent('mouseover', e as MouseEvent);
    const onPointerOut = (e: Event) => this.recordPointerEvent('mouseout', e as MouseEvent);
    const onMouseDown = (e: Event) => this.recordPointerEvent('mousedown', e as MouseEvent);
    const onMouseUp = (e: Event) => this.recordPointerEvent('mouseup', e as MouseEvent);
    const onClick = (e: Event) => this.recordPointerEvent('click', e as MouseEvent);

    // Viewport scroll handler (scroll + wheel both count as scroll modality input)
    const onScroll = () => {
      const now = getMonotonicTimestamp();
      if (this.sampleIntervalMs > 0 && now - this.lastScrollTime < this.sampleIntervalMs) {
        return;
      }
      this.lastScrollTime = now;
      this.recordScrollEvent('scroll');
    };

    const onWheel = () => {
      const now = getMonotonicTimestamp();
      if (this.sampleIntervalMs > 0 && now - this.lastScrollTime < this.sampleIntervalMs) {
        return;
      }
      this.lastScrollTime = now;
      this.recordScrollEvent('wheel');
    };

    // Form input handlers
    const onInput = (e: Event) => this.recordFormEvent('input', e);
    const onChange = (e: Event) => this.recordFormEvent('change', e);
    const onSubmit = (e: Event) => this.recordFormEvent('submit', e);

    // Focus lifecycle handlers — required by the BACKTRACK outcome contract
    const onFocusIn = (e: Event) => this.recordLifecycleEvent('focus', e);
    const onFocusOut = (e: Event) => this.recordLifecycleEvent('blur', e);

    // Lifecycle & Navigation handlers
    const onPopState = () => this.recordNavigationEvent('popstate');
    const onHashChange = () => this.recordNavigationEvent('hashchange');
    const onPageHide = () => this.recordNavigationEvent('pagehide');
    const onBeforeUnload = () => this.recordNavigationEvent('beforeunload');
    const onUnload = () => this.recordNavigationEvent('unload');
    const onCustomNav = (e: Event) => {
      const customDetail = (e as CustomEvent)?.detail;
      this.recordNavigationEvent('navigation', customDetail?.route);
    };

    // Bind event helper
    const add = (
      el: EventTarget,
      type: string,
      fn: EventListenerOrEventListenerObject,
      opts: AddEventListenerOptions | boolean
    ) => {
      const wrappedFn = (e: Event) => {
        defaultCollector.timeSync('event capture', 'main', () => {
          if (typeof fn === 'function') {
            fn(e);
          } else {
            fn.handleEvent(e);
          }
        });
      };
      el.addEventListener(type, wrappedFn, opts);
      this.unbindHandlers.push(() => {
        el.removeEventListener(type, wrappedFn, opts);
      });
    };

    add(target, 'mousemove', onPointerMove, passiveOpts);
    add(target, 'mouseover', onPointerOver, passiveOpts);
    add(target, 'mouseout', onPointerOut, passiveOpts);
    add(target, 'mousedown', onMouseDown, passiveOpts);
    add(target, 'mouseup', onMouseUp, passiveOpts);
    add(target, 'click', onClick, passiveOpts);
    add(target, 'scroll', onScroll, passiveOpts);
    add(target, 'wheel', onWheel, passiveOpts);
    add(target, 'input', onInput, passiveOpts);
    add(target, 'change', onChange, passiveOpts);
    add(target, 'submit', onSubmit, passiveOpts);
    add(target, 'focusin', onFocusIn, passiveOpts);
    add(target, 'focusout', onFocusOut, passiveOpts);

    if (typeof window !== 'undefined') {
      add(window, 'resize', onResize, { passive: true });
      add(window, 'popstate', onPopState, { passive: true });
      add(window, 'hashchange', onHashChange, { passive: true });
      add(window, 'pagehide', onPageHide, { passive: true });
      add(window, 'beforeunload', onBeforeUnload, { passive: true });
      add(window, 'unload', onUnload, { passive: true });
      add(window, 'navigation', onCustomNav, { passive: true });
    }
  }

  private extractElementMetadata(
    target: EventTarget | null,
    eventType?: BehaviourEventType
  ): {
    componentId?: string;
    componentRole?: string;
    action?: string;
    targetTag?: string;
    ariaExpanded?: boolean;
  } {
    if (!target || !(target instanceof Element)) {
      return {};
    }

    const targetTag = target.tagName.toLowerCase();
    const annotatedEl = target.closest ? target.closest('[data-aui-component]') : null;

    /**
     * Reads the disclosure state as it stands when the event is observed.
     *
     * The observer listens in the capture phase, so this is always the state *before* the
     * action: neither React's handler nor a plain listener on the target has run yet. A
     * disclosure control toggles on click, so `toDisclosureStateAfter` negates it for the
     * accordion role rather than recording an opening click as a close.
     */
    const readAriaExpanded = (el: Element | null): boolean | undefined => {
      const raw = el?.getAttribute('aria-expanded');
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      // An accordion's triggering control may not carry the attribute itself; look at the
      // nearest control inside the same section before giving up.
      const nested = el?.querySelector?.('[aria-expanded]');
      const nestedRaw = nested?.getAttribute('aria-expanded');
      if (nestedRaw === 'true') return true;
      if (nestedRaw === 'false') return false;
      return undefined;
    };

    if (annotatedEl) {
      const componentRole = annotatedEl.getAttribute('data-aui-role') || undefined;
      const observedDisclosure = readAriaExpanded(target) ?? readAriaExpanded(annotatedEl);
      return {
        componentId: annotatedEl.getAttribute('data-aui-component') || undefined,
        componentRole,
        action: annotatedEl.getAttribute('data-aui-action') || undefined,
        targetTag,
        ariaExpanded: toDisclosureStateAfter(observedDisclosure, componentRole, eventType)
      };
    }

    // Check direct attributes if closest didn't match
    const componentRole = target.getAttribute?.('data-aui-role') || undefined;
    return {
      componentId: target.getAttribute?.('data-aui-component') || undefined,
      componentRole,
      action: target.getAttribute?.('data-aui-action') || undefined,
      targetTag,
      ariaExpanded: toDisclosureStateAfter(readAriaExpanded(target), componentRole, eventType)
    };
  }

  /**
   * Captures the observed geometry so MicroTensor extraction never falls back to a
   * constant document size (assessment §8 D1 / §25 P0-2).
   */
  private captureGeometry(): {
    viewport: { width: number; height: number };
    document: { width: number; height: number; scrollableWidth: number; scrollableHeight: number };
  } {
    const snapshot = getGeometrySnapshot();
    return { viewport: snapshot.viewport, document: snapshot.document };
  }

  private recordPointerEvent(type: BehaviourEventType, e: MouseEvent): void {
    defaultCollector.timeSync('event normalisation', 'main', () => {
      const coords = normalizeCoordinates(
        e.clientX,
        e.clientY,
        this.cachedViewport.width,
        this.cachedViewport.height
      );

      const elemMeta = this.extractElementMetadata(e.target, type);
      const uiContext = getActiveUIContext({ targetElement: e.target as Element });
      const geometry = this.captureGeometry();

      const event: BehaviourEvent = {
        timestamp: getWallClockTimestamp(),
        type,
        x: coords.x,
        y: coords.y,
        componentId: elemMeta.componentId ?? uiContext.activeComponentId,
        componentRole: elemMeta.componentRole ?? uiContext.componentRole,
        action: elemMeta.action ?? (type === 'click' ? 'click' : type === 'mouseover' ? 'hover' : undefined),
        ariaExpanded: elemMeta.ariaExpanded,
        route: uiContext.route,
        taskId: uiContext.taskId,
        taskStepId: uiContext.taskStepId,
        targetTag: elemMeta.targetTag,
        viewport: geometry.viewport,
        document: geometry.document
      };

      this.emit(event);
    });
  }

  private recordScrollEvent(sourceType: 'scroll' | 'wheel' = 'scroll'): void {
    defaultCollector.timeSync('event normalisation', 'main', () => {
      const bounds = getDocumentScrollBounds();
      const normScroll = normalizeScroll(
        bounds.scrollX,
        bounds.scrollY,
        bounds.scrollableWidth,
        bounds.scrollableHeight
      );

      const uiContext = getActiveUIContext();
      const geometry = this.captureGeometry();

      const event: BehaviourEvent = {
        timestamp: getWallClockTimestamp(),
        type: sourceType,
        scrollX: normScroll.scrollX,
        scrollY: normScroll.scrollY,
        scrollTopPx: bounds.scrollY,
        action: sourceType,
        route: uiContext.route,
        taskId: uiContext.taskId,
        taskStepId: uiContext.taskStepId,
        viewport: geometry.viewport,
        document: geometry.document
      };

      this.emit(event);
    });
  }

  private recordFormEvent(type: 'input' | 'change' | 'submit', e: Event): void {
    defaultCollector.timeSync('event normalisation', 'main', () => {
      const elemMeta = this.extractElementMetadata(e.target, type);
      const uiContext = getActiveUIContext({ targetElement: e.target as Element });
      const geometry = this.captureGeometry();

      const event: BehaviourEvent = {
        timestamp: getWallClockTimestamp(),
        type,
        componentId: elemMeta.componentId ?? uiContext.activeComponentId,
        componentRole: elemMeta.componentRole ?? uiContext.componentRole,
        action: elemMeta.action ?? type,
        ariaExpanded: elemMeta.ariaExpanded,
        route: uiContext.route,
        taskId: uiContext.taskId,
        taskStepId: uiContext.taskStepId,
        targetTag: elemMeta.targetTag,
        viewport: geometry.viewport,
        document: geometry.document
      };

      this.emit(event);
    });
  }

  private recordLifecycleEvent(type: 'focus' | 'blur', e: Event): void {
    defaultCollector.timeSync('event normalisation', 'main', () => {
      const elemMeta = this.extractElementMetadata(e.target, type);
      const uiContext = getActiveUIContext({ targetElement: e.target as Element });

      const event: BehaviourEvent = {
        timestamp: getWallClockTimestamp(),
        type,
        componentId: elemMeta.componentId ?? uiContext.activeComponentId,
        componentRole: elemMeta.componentRole ?? uiContext.componentRole,
        action: type,
        ariaExpanded: elemMeta.ariaExpanded,
        route: uiContext.route,
        taskId: uiContext.taskId,
        taskStepId: uiContext.taskStepId,
        targetTag: elemMeta.targetTag
      };

      this.emit(event);
    });
  }

  private recordNavigationEvent(sourceType: string, customRoute?: string): void {
    defaultCollector.timeSync('event normalisation', 'main', () => {
      const uiContext = getActiveUIContext();

      // Preserve the concrete source type for popstate/hashchange/pagehide/beforeunload/unload
      // so the outcome deriver can distinguish BACKTRACK from ABANDON (assessment §25 P1-3).
      const resolvedType: BehaviourEventType =
        sourceType === 'popstate' ||
        sourceType === 'hashchange' ||
        sourceType === 'pagehide' ||
        sourceType === 'beforeunload' ||
        sourceType === 'unload'
          ? sourceType
          : 'navigation';

      const event: BehaviourEvent = {
        timestamp: getWallClockTimestamp(),
        type: resolvedType,
        route: customRoute ?? uiContext.route,
        taskId: uiContext.taskId,
        taskStepId: uiContext.taskStepId,
        action: sourceType
      };

      this.emit(event);
    });
  }
}

/**
 * Singleton shared observer instance.
 */
export const defaultTelemetryObserver = new TelemetryObserver();

/**
 * Factory helper.
 */
export function createTelemetryObserver(options?: TelemetryObserverOptions): TelemetryObserver {
  return new TelemetryObserver(options);
}
