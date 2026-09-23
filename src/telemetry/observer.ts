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
  normalizeCoordinates,
  normalizeScroll,
  getViewportDimensions,
  getDocumentScrollBounds,
  getGeometrySnapshot
} from './normalizer';
import { getActiveUIContext } from './contextProvider';

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
      el.addEventListener(type, fn, opts);
      this.unbindHandlers.push(() => {
        el.removeEventListener(type, fn, opts);
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

  private extractElementMetadata(target: EventTarget | null): {
    componentId?: string;
    componentRole?: string;
    action?: string;
    targetTag?: string;
  } {
    if (!target || !(target instanceof Element)) {
      return {};
    }

    const targetTag = target.tagName.toLowerCase();
    const annotatedEl = target.closest ? target.closest('[data-aui-component]') : null;

    if (annotatedEl) {
      return {
        componentId: annotatedEl.getAttribute('data-aui-component') || undefined,
        componentRole: annotatedEl.getAttribute('data-aui-role') || undefined,
        action: annotatedEl.getAttribute('data-aui-action') || undefined,
        targetTag
      };
    }

    // Check direct attributes if closest didn't match
    return {
      componentId: target.getAttribute?.('data-aui-component') || undefined,
      componentRole: target.getAttribute?.('data-aui-role') || undefined,
      action: target.getAttribute?.('data-aui-action') || undefined,
      targetTag
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
    const coords = normalizeCoordinates(
      e.clientX,
      e.clientY,
      this.cachedViewport.width,
      this.cachedViewport.height
    );

    const elemMeta = this.extractElementMetadata(e.target);
    const uiContext = getActiveUIContext({ targetElement: e.target as Element });
    const geometry = this.captureGeometry();

    const event: BehaviourEvent = {
      timestamp: getMonotonicTimestamp(),
      type,
      x: coords.x,
      y: coords.y,
      componentId: elemMeta.componentId ?? uiContext.activeComponentId,
      componentRole: elemMeta.componentRole ?? uiContext.componentRole,
      action: elemMeta.action ?? (type === 'click' ? 'click' : type === 'mouseover' ? 'hover' : undefined),
      route: uiContext.route,
      taskId: uiContext.taskId,
      taskStepId: uiContext.taskStepId,
      targetTag: elemMeta.targetTag,
      viewport: geometry.viewport,
      document: geometry.document
    };

    this.emit(event);
  }

  private recordScrollEvent(sourceType: 'scroll' | 'wheel' = 'scroll'): void {
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
      timestamp: getMonotonicTimestamp(),
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
  }

  private recordFormEvent(type: 'input' | 'change' | 'submit', e: Event): void {
    const elemMeta = this.extractElementMetadata(e.target);
    const uiContext = getActiveUIContext({ targetElement: e.target as Element });
    const geometry = this.captureGeometry();

    const event: BehaviourEvent = {
      timestamp: getMonotonicTimestamp(),
      type,
      componentId: elemMeta.componentId ?? uiContext.activeComponentId,
      componentRole: elemMeta.componentRole ?? uiContext.componentRole,
      action: elemMeta.action ?? type,
      route: uiContext.route,
      taskId: uiContext.taskId,
      taskStepId: uiContext.taskStepId,
      targetTag: elemMeta.targetTag,
      viewport: geometry.viewport,
      document: geometry.document
    };

    this.emit(event);
  }

  private recordLifecycleEvent(type: 'focus' | 'blur', e: Event): void {
    const elemMeta = this.extractElementMetadata(e.target);
    const uiContext = getActiveUIContext({ targetElement: e.target as Element });

    const event: BehaviourEvent = {
      timestamp: getMonotonicTimestamp(),
      type,
      componentId: elemMeta.componentId ?? uiContext.activeComponentId,
      componentRole: elemMeta.componentRole ?? uiContext.componentRole,
      action: type,
      route: uiContext.route,
      taskId: uiContext.taskId,
      taskStepId: uiContext.taskStepId,
      targetTag: elemMeta.targetTag
    };

    this.emit(event);
  }

  private recordNavigationEvent(sourceType: string, customRoute?: string): void {
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
      timestamp: getMonotonicTimestamp(),
      type: resolvedType,
      route: customRoute ?? uiContext.route,
      taskId: uiContext.taskId,
      taskStepId: uiContext.taskStepId,
      action: sourceType
    };

    this.emit(event);
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
