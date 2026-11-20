/**
 * UIActuator: Non-Destructive & Accessible UI Adaptation Controller
 * Implements Stage 8.3 specifications from docs/testbed/prd.md Sections 26-28 & docs/plan/tasks/8.3.md.
 * 
 * Guarantees:
 * 1. Non-destructive adaptations via semantic CSS classes:
 *    - edge-aui-highlight
 *    - edge-aui-simplified
 *    - edge-aui-tooltip-expanded
 *    - edge-aui-assistance
 * 2. WCAG AA accessibility, zero focus theft, screen-reader compatibility.
 * 3. 100% deterministic restoration / reversibility on clear() and reset().
 * 4. Structured telemetry emission via InterventionEvent.
 */

import {
  InterventionCommand,
  InterventionType,
  InterventionEvent
} from './types';
import { defaultCollector } from '../runtime/instrumentation';
import { getWallClockTimestamp } from '../telemetry/normalizer';

/**
 * Application port that turns a target reference into a DOM element.
 *
 * The framework must not know an application's markup. A configured resolver is
 * authoritative: when it returns null the adaptation fails, and the failure is recorded, so
 * a misconfigured target never degrades into "adapt something else" (Task 20.5).
 */
export type ActuationTargetResolver = (
  targetId: string,
  context: { root: Document | HTMLElement | null; command: InterventionCommand }
) => Element | null;

export interface UIActuatorOptions {
  root?: Document | HTMLElement;
  defaultAssistanceText?: string;
  /** Resolves a declared target reference to a DOM element. */
  targetResolver?: ActuationTargetResolver;
}

export type InterventionEventListener = (event: InterventionEvent) => void;

interface ReversionRecord {
  command: InterventionCommand;
  cleanup: () => void;
  /** Timer enforcing the command's TTL, when one was provided. */
  ttlTimer?: ReturnType<typeof setTimeout>;
}

/**
 * What an adaptation actually did.
 *
 * `element` names the node that received the adaptation so the correlation attributes can
 * be stamped on it, and a `null` return from an `apply*` method means "nothing was adapted"
 * — which the caller records as actuation failure rather than reporting success.
 */
export interface AdaptationResult {
  cleanup: () => void;
  element: Element | null;
}

/**
 * Escapes a value for safe use inside a CSS attribute selector.
 *
 * `targetComponentId` is interpolated into `[data-aui-component="<id>"]`. Component ids
 * are developer-controlled today, but an id containing a quote or bracket would produce
 * an invalid selector and throw (assessment §13.1). Escaping removes that class of bug.
 */
export function escapeCssAttributeValue(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

/** Builds a safe attribute selector for a component id. */
function componentSelector(componentId: string): string {
  return `[data-aui-component="${escapeCssAttributeValue(componentId)}"]`;
}

/**
 * DOM token for the current adaptation.
 *
 * These short names are the pre-existing contract asserted by `tests/actuator.test.ts`
 * (`highlight` for `highlight_primary_action`). They are preserved rather than replaced,
 * because the attribute's *presence* is what was missing for three of the four adaptation
 * types (F-05) — not its spelling.
 */
const ADAPTATION_DOM_TOKENS: Record<InterventionType, string> = {
  no_op: 'none',
  highlight_primary_action: 'highlight',
  simplify_options: 'simplified',
  expand_tooltip: 'tooltip-expanded',
  offer_assistance: 'assistance'
};

/**
 * DOM attribute naming the adaptation currently applied to an element.
 *
 * Every adaptation type sets this. Previously only `highlight_primary_action` did, so a
 * verifier could not prove from the DOM that the adaptation in the trace was the one
 * visible, and an applied `simplify_options` left no correlatable footprint (F-05).
 */
export const ADAPTATION_ATTRIBUTE = 'data-aui-active-adaptation';

/**
 * DOM attribute carrying the intervention episode id.
 *
 * This is the join key between the exported trace and the live interface: it lets an
 * automated check assert that episode `ep_N` in the record is episode `ep_N` on screen.
 */
export const ADAPTATION_EPISODE_ATTRIBUTE = 'data-aui-adaptation-episode';

/**
 * Stamps the correlation attributes onto an adapted element.
 *
 * Returns a restore function so the attributes are removed with the same care as the
 * adaptation itself — a leaked attribute would make a reverted adaptation look active.
 */
export function markAdaptation(
  element: Element,
  adaptation: string,
  episodeId?: string
): () => void {
  const previousAdaptation = element.getAttribute(ADAPTATION_ATTRIBUTE);
  const previousEpisode = element.getAttribute(ADAPTATION_EPISODE_ATTRIBUTE);

  element.setAttribute(ADAPTATION_ATTRIBUTE, adaptation);
  if (episodeId) {
    element.setAttribute(ADAPTATION_EPISODE_ATTRIBUTE, episodeId);
  }

  return () => {
    if (previousAdaptation === null) {
      element.removeAttribute(ADAPTATION_ATTRIBUTE);
    } else {
      element.setAttribute(ADAPTATION_ATTRIBUTE, previousAdaptation);
    }

    if (previousEpisode === null) {
      element.removeAttribute(ADAPTATION_EPISODE_ATTRIBUTE);
    } else {
      element.setAttribute(ADAPTATION_EPISODE_ATTRIBUTE, previousEpisode);
    }
  };
}

export class UIActuator {
  private root: Document | HTMLElement | null;
  private defaultAssistanceText: string;
  private readonly targetResolver?: ActuationTargetResolver;
  private activeAdaptations = new Map<InterventionType, ReversionRecord>();
  private eventListeners = new Set<InterventionEventListener>();

  constructor(options: UIActuatorOptions = {}) {
    this.root = options.root ?? (typeof document !== 'undefined' ? document : null);
    this.defaultAssistanceText =
      options.defaultAssistanceText ??
      'Need assistance? Guided steps and contextual filters are available to help complete the task.';
    this.targetResolver = options.targetResolver;
  }

  /**
   * Resolves a command's declared target.
   *
   * With a configured resolver the answer is final — including "no element". Without one,
   * the framework falls back to the annotation contract (`data-aui-component`), which is the
   * documented default for a DOM application that has not supplied a resolver.
   */
  private resolveDeclaredTarget(command: InterventionCommand): Element | null {
    const targetId = command.targetComponentId;
    if (!targetId) return null;
    if (this.targetResolver) {
      return this.targetResolver(targetId, { root: this.root, command });
    }
    return this.root?.querySelector(componentSelector(targetId)) ?? null;
  }

  /**
   * Sets or updates root DOM container.
   */
  public setRoot(root: Document | HTMLElement | null): void {
    this.root = root;
  }

  /**
   * Applies a non-destructive declarative adaptation.
   *
   * Returns `true` only when an element was actually adapted. The return value exists so the
   * caller can record actuation failure in the trace; previously a failed adaptation was a
   * `console.warn` and nothing else (F-07).
   */
  public apply(command: InterventionCommand): boolean {
    return defaultCollector.timeSync('actuation', 'main', () => {
      // If no_op, clear any active temporary adaptations and emit event
      if (command.type === 'no_op') {
        this.emitEvent({
          timestamp: getWallClockTimestamp(),
          type: 'applied',
          intervention: 'no_op',
          componentId: command.targetComponentId,
          source: command.source,
          mappingSource: command.mappingSource,
          confidence: command.confidence,
          interventionEpisodeId: command.episodeId
        });
        return true;
      }

      if (!this.root) {
        console.warn('[UIActuator] DOM root not available; adaptation skipped.');
        return false;
      }

      // Every element-changing adaptation must declare what it acts on. Without a target
      // there is no honest element, and the old framework guessed one (the first primary
      // action, tooltip or accordion). Guessing is how a filter prediction ended up
      // highlighting Export (assessment §5.3), so a missing declaration is a failure.
      if (command.type !== 'offer_assistance' && !command.targetComponentId) {
        console.warn(
          `[UIActuator] '${command.type}' declared no target; no adaptation was applied.`
        );
        return false;
      }

      // If an adaptation of this type is already active, clear it first
      if (this.activeAdaptations.has(command.type)) {
        this.clear(command);
      }

      let result: AdaptationResult | null = null;

      switch (command.type) {
        case 'highlight_primary_action':
          result = this.applyHighlightPrimaryAction(command);
          break;
        case 'simplify_options':
          result = this.applySimplifyOptions(command);
          break;
        case 'expand_tooltip':
          result = this.applyExpandTooltip(command);
          break;
        case 'offer_assistance':
          result = this.applyOfferAssistance(command);
          break;
      }

      if (!result) {
        return false;
      }

      const { cleanup, element } = result;

      // Stamp the correlation attributes so the adaptation is provable from the DOM.
      const unmark = element
        ? markAdaptation(element, ADAPTATION_DOM_TOKENS[command.type] ?? command.type, command.episodeId)
        : () => {};

      // Enforce ttlMs: an adaptation with a declared lifetime reverts on its own.
      let ttlTimer: ReturnType<typeof setTimeout> | undefined;
      if (command.ttlMs !== undefined && command.ttlMs > 0) {
        ttlTimer = setTimeout(() => {
          this.clear(command, 'ttl');
        }, command.ttlMs);
      }

      this.activeAdaptations.set(command.type, {
        command,
        cleanup: () => {
          cleanup();
          unmark();
        },
        ttlTimer
      });
      this.emitEvent({
        timestamp: getWallClockTimestamp(),
        type: 'applied',
        intervention: command.type,
        componentId: command.targetComponentId,
        source: command.source,
        mappingSource: command.mappingSource,
        confidence: command.confidence,
        interventionEpisodeId: command.episodeId
      });
      return true;
    });
  }

  /**
   * Clears a specific active adaptation, or all of them when none is named.
   *
   * `reason` is recorded on the terminal event so an expiry is distinguishable from a user
   * dismissal in the trace (F-03).
   */
  public clear(command?: InterventionCommand, reason: InterventionEvent["reason"] = 'reset'): void {
    defaultCollector.timeSync('actuation', 'main', () => {
      if (command) {
        const active = this.activeAdaptations.get(command.type);
        if (active) {
          if (active.ttlTimer !== undefined) {
            clearTimeout(active.ttlTimer);
          }
          active.cleanup();
          this.activeAdaptations.delete(command.type);
          this.emitEvent({
            timestamp: getWallClockTimestamp(),
            type: 'reverted',
            intervention: command.type,
            componentId: command.targetComponentId,
            source: command.source,
            mappingSource: command.mappingSource,
            confidence: command.confidence,
            interventionEpisodeId: active.command.episodeId ?? command.episodeId,
            reason
          });
        }
      } else {
        this.reset(reason);
      }
    });
  }

  /**
   * Restores exact initial DOM state, reverting all active adaptations.
   *
   * `reason` is recorded on each terminal event: a reversion at a trial boundary is not the
   * same research fact as an expiry or a dismissal, and the trace must say which happened.
   */
  public reset(reason: InterventionEvent["reason"] = 'reset'): void {
    for (const [type, record] of Array.from(this.activeAdaptations.entries())) {
      if (record.ttlTimer !== undefined) {
        clearTimeout(record.ttlTimer);
      }
      record.cleanup();
      this.emitEvent({
        timestamp: getWallClockTimestamp(),
        type: 'reverted',
        intervention: type,
        componentId: record.command.targetComponentId,
        source: record.command.source,
        mappingSource: record.command.mappingSource,
        confidence: record.command.confidence,
        interventionEpisodeId: record.command.episodeId,
        reason
      });
    }
    this.activeAdaptations.clear();
  }

  /**
   * Returns list of currently active intervention commands.
   */
  public getActiveInterventions(): InterventionCommand[] {
    return Array.from(this.activeAdaptations.values()).map((r) => r.command);
  }

  /**
   * Registers structured telemetry event listener.
   */
  public onInterventionEvent(listener: InterventionEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitEvent(event: InterventionEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[UIActuator] Event listener error:', err);
      }
    }
  }

  // =========================================================================
  // 1. highlight_primary_action
  // =========================================================================
  private applyHighlightPrimaryAction(command: InterventionCommand): AdaptationResult | null {
    if (!this.root) return null;

    // The declared target is the whole instruction. No role-based fallback: an application
    // that means a specific control names it, and one that does not gets no adaptation.
    const targetEl = this.resolveDeclaredTarget(command) as HTMLElement | null;
    if (!targetEl) return null;

    const hadClass = targetEl.hasAttribute('class');
    const initialClass = targetEl.getAttribute('class');

    targetEl.classList.add('edge-aui-highlight');

    return {
      element: targetEl,
      cleanup: () => {
        if (targetEl) {
          if (hadClass && initialClass !== null) {
            targetEl.setAttribute('class', initialClass);
          } else {
            targetEl.removeAttribute('class');
          }
        }
      }
    };
  }

  // =========================================================================
  // 2. simplify_options
  // =========================================================================
  private applySimplifyOptions(command: InterventionCommand): AdaptationResult | null {
    if (!this.root) return null;

    // A declared surface bounds the mutation: only the options inside it are simplified.
    // Collapsing every accordion in the document was how an unrelated panel was altered.
    const declaredSurface = this.resolveDeclaredTarget(command) as HTMLElement | null;
    if (!declaredSurface) return null;

    const accordionButtons = Array.from(
      declaredSurface.querySelectorAll('[data-aui-role="accordion"]')
    ) as HTMLElement[];

    if (accordionButtons.length === 0) return null;

    const simplifiedSurface = declaredSurface;

    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const collapsedItems: Array<{
      btn: HTMLElement;
      wasExpanded: boolean;
      container?: HTMLElement | null;
    }> = [];

    // Tag the surface that contains the options being simplified.
    const surfaceHadClass = simplifiedSurface.hasAttribute('class');
    const surfaceInitialClass = simplifiedSurface.getAttribute('class');

    simplifiedSurface.classList.add('edge-aui-simplified');

    for (const btn of accordionButtons) {
      const parentSection = btn.parentElement;
      // Do not collapse section containing currently active/focused element (PRD §28.3)
      if (activeEl && parentSection && parentSection.contains(activeEl)) {
        continue;
      }

      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        collapsedItems.push({
          btn,
          wasExpanded: true,
          container: parentSection
        });

        // Trigger button click to let component's state collapse cleanly and retain consistency
        btn.click();
      }
    }

    // Ensure focus was not hijacked by programmatic clicks (PRD §28.3, §45)
    if (activeEl && document.activeElement !== activeEl && typeof activeEl.focus === 'function') {
      activeEl.focus();
    }

    return {
      // The first accordion button is the element the adaptation is observable on, so the
      // correlation attributes go there rather than on a wrapper the user cannot see.
      element: accordionButtons[0],
      cleanup: () => {
        if (surfaceHadClass && typeof surfaceInitialClass === 'string') {
          simplifiedSurface.setAttribute('class', surfaceInitialClass);
        } else {
          simplifiedSurface.removeAttribute('class');
        }
        // Restore previously open accordions
        for (const item of collapsedItems) {
          if (item.btn.getAttribute('aria-expanded') !== 'true') {
            item.btn.click();
          }
        }
        // Guarantee focus integrity is maintained upon restoration
        if (activeEl && document.activeElement !== activeEl && typeof activeEl.focus === 'function') {
          activeEl.focus();
        }
      }
    };
  }

  // =========================================================================
  // 3. expand_tooltip
  // =========================================================================
  private applyExpandTooltip(command: InterventionCommand): AdaptationResult | null {
    if (!this.root) return null;

    // The declared target identifies the one element whose help text is expanded. A
    // missing declaration fails instead of expanding the first tooltip on the page, which
    // could be about a different column (assessment §5.3).
    const targetEl = this.resolveDeclaredTarget(command) as HTMLElement | null;
    if (!targetEl) return null;

    // The bubble shows the element's own help text. Falling back to a generic sentence or
    // to `command.reason` would put words in the interface the interface never said.
    const tooltipText = (
      targetEl.getAttribute('title') ?? targetEl.getAttribute('data-tooltip') ?? ''
    ).trim();
    if (!tooltipText) return null;

    const hadClass = targetEl.hasAttribute('class');
    const initialClass = targetEl.getAttribute('class');
    const hadAriaDescribedby = targetEl.hasAttribute('aria-describedby');
    const initialAriaDescribedby = targetEl.getAttribute('aria-describedby');

    targetEl.classList.add('edge-aui-tooltip-expanded');
    targetEl.setAttribute('aria-expanded', 'true');

    // Store original title so browser tooltip doesn't clash
    const originalTitle = targetEl.getAttribute('title');
    if (originalTitle) {
      targetEl.removeAttribute('title');
      targetEl.setAttribute('data-original-title', originalTitle);
    }

    // Stable unique ID for ARIA association (PRD §45)
    const tooltipId = `edge-aui-tip-${Math.random().toString(36).substring(2, 9)}`;

    // Create non-modal accessible tooltip bubble (PRD §28.4)
    const doc = targetEl.ownerDocument || document;
    const bubble = doc.createElement('div');
    bubble.id = tooltipId;
    bubble.className = 'edge-aui-tooltip-bubble';
    bubble.setAttribute('role', 'tooltip');
    bubble.textContent = tooltipText;

    // Associate target element with tooltip for assistive technologies (PRD §45)
    targetEl.setAttribute(
      'aria-describedby',
      initialAriaDescribedby ? `${initialAriaDescribedby} ${tooltipId}` : tooltipId
    );

    // Attach bubble next to target (non-destructive sibling insertion)
    if (targetEl.parentNode) {
      targetEl.parentNode.insertBefore(bubble, targetEl.nextSibling);
    }

    // Keyboard dismissibility without stealing focus (PRD §28.4, §45)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.clear(command, 'user_dismissal');
        this.emitEvent({
          timestamp: getWallClockTimestamp(),
          type: 'dismissed',
          intervention: command.type,
          componentId: command.targetComponentId,
          source: command.source,
          mappingSource: command.mappingSource,
          confidence: command.confidence,
          interventionEpisodeId: command.episodeId,
          reason: 'user_dismissal'
        });
      }
    };
    doc.addEventListener('keydown', onKeyDown);

    return {
      element: targetEl,
      cleanup: () => {
        doc.removeEventListener('keydown', onKeyDown);
        if (targetEl) {
          if (hadClass && initialClass !== null) {
            targetEl.setAttribute('class', initialClass);
          } else {
            targetEl.removeAttribute('class');
          }
          targetEl.removeAttribute('aria-expanded');
          if (hadAriaDescribedby && initialAriaDescribedby !== null) {
            targetEl.setAttribute('aria-describedby', initialAriaDescribedby);
          } else {
            targetEl.removeAttribute('aria-describedby');
          }
          const savedTitle = targetEl.getAttribute('data-original-title');
          if (savedTitle) {
            targetEl.setAttribute('title', savedTitle);
            targetEl.removeAttribute('data-original-title');
          }
        }
        if (bubble.parentNode) {
          bubble.parentNode.removeChild(bubble);
        }
      }
    };
  }

  // =========================================================================
  // 4. offer_assistance
  // =========================================================================
  private applyOfferAssistance(command: InterventionCommand): AdaptationResult | null {
    if (!this.root) return null;

    const doc = this.root instanceof Document ? this.root : this.root.ownerDocument || document;
    const existing = doc.querySelector('.edge-aui-assistance-banner');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const banner = doc.createElement('aside');
    banner.className = 'edge-aui-assistance-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    const content = doc.createElement('div');
    content.className = 'edge-aui-assistance-content';

    const title = doc.createElement('div');
    title.className = 'edge-aui-assistance-title';
    title.textContent = 'Guidance Tip';

    const text = doc.createElement('div');
    text.textContent = command.reason || this.defaultAssistanceText;

    content.appendChild(title);
    content.appendChild(text);

    const dismissBtn = doc.createElement('button');
    dismissBtn.className = 'edge-aui-assistance-dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss guidance tip');
    dismissBtn.setAttribute('type', 'button');
    dismissBtn.innerHTML = '&times;';

    banner.appendChild(content);
    banner.appendChild(dismissBtn);

    const container = doc.body || doc.documentElement;
    container.appendChild(banner);

    const onDismiss = () => {
      this.clear(command, 'user_dismissal');
      this.emitEvent({
        timestamp: getWallClockTimestamp(),
        type: 'dismissed',
        intervention: command.type,
        componentId: command.targetComponentId,
        source: command.source,
        mappingSource: command.mappingSource,
        confidence: command.confidence,
        interventionEpisodeId: command.episodeId,
        reason: 'user_dismissal'
      });
    };

    // Keyboard dismissibility (Escape key) per PRD §28.5 & §45
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };

    dismissBtn.addEventListener('click', onDismiss);
    doc.addEventListener('keydown', onKeyDown);

    return {
      // The banner itself is the element the adaptation is observable on.
      element: banner,
      cleanup: () => {
        dismissBtn.removeEventListener('click', onDismiss);
        doc.removeEventListener('keydown', onKeyDown);
        if (banner.parentNode) {
          banner.parentNode.removeChild(banner);
        }
      }
    };
  }
}

export function createUIActuator(options?: UIActuatorOptions): UIActuator {
  return new UIActuator(options);
}
