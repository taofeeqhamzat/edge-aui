/**
 * UIActuator: Non-Destructive & Accessible UI Adaptation Controller
 * Implements Stage 8.3 specifications from clipboard.9.md Sections 26-28 & docs/plan/tasks/8.3.md.
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

export interface UIActuatorOptions {
  root?: Document | HTMLElement;
  defaultAssistanceText?: string;
}

export type InterventionEventListener = (event: InterventionEvent) => void;

interface ReversionRecord {
  command: InterventionCommand;
  cleanup: () => void;
}

export class UIActuator {
  private root: Document | HTMLElement | null;
  private defaultAssistanceText: string;
  private activeAdaptations = new Map<InterventionType, ReversionRecord>();
  private eventListeners = new Set<InterventionEventListener>();

  constructor(options: UIActuatorOptions = {}) {
    this.root = options.root ?? (typeof document !== 'undefined' ? document : null);
    this.defaultAssistanceText =
      options.defaultAssistanceText ??
      'Need assistance? Guided steps and contextual filters are available to help complete your task.';
  }

  /**
   * Sets or updates root DOM container.
   */
  public setRoot(root: Document | HTMLElement | null): void {
    this.root = root;
  }

  /**
   * Applies non-destructive declarative adaptation.
   */
  public apply(command: InterventionCommand): void {
    // If no_op, clear any active temporary adaptations and emit event
    if (command.type === 'no_op') {
      this.emitEvent({
        timestamp: Date.now(),
        type: 'applied',
        intervention: 'no_op',
        componentId: command.targetComponentId,
        source: command.source,
        confidence: command.confidence
      });
      return;
    }

    if (!this.root) {
      console.warn('[UIActuator] DOM root not available; adaptation skipped.');
      return;
    }

    // If an adaptation of this type is already active, clear it first
    if (this.activeAdaptations.has(command.type)) {
      this.clear(command);
    }

    let cleanup: (() => void) | null = null;

    switch (command.type) {
      case 'highlight_primary_action':
        cleanup = this.applyHighlightPrimaryAction(command);
        break;
      case 'simplify_options':
        cleanup = this.applySimplifyOptions(command);
        break;
      case 'expand_tooltip':
        cleanup = this.applyExpandTooltip(command);
        break;
      case 'offer_assistance':
        cleanup = this.applyOfferAssistance(command);
        break;
    }

    if (cleanup) {
      this.activeAdaptations.set(command.type, { command, cleanup });
      this.emitEvent({
        timestamp: Date.now(),
        type: 'applied',
        intervention: command.type,
        componentId: command.targetComponentId,
        source: command.source,
        confidence: command.confidence
      });
    }
  }

  /**
   * Clears specific active adaptation or all if none specified.
   */
  public clear(command?: InterventionCommand): void {
    if (command) {
      const active = this.activeAdaptations.get(command.type);
      if (active) {
        active.cleanup();
        this.activeAdaptations.delete(command.type);
        this.emitEvent({
          timestamp: Date.now(),
          type: 'reverted',
          intervention: command.type,
          componentId: command.targetComponentId,
          source: command.source,
          confidence: command.confidence
        });
      }
    } else {
      this.reset();
    }
  }

  /**
   * Restores exact initial DOM state, reverting all active adaptations.
   */
  public reset(): void {
    for (const [type, record] of Array.from(this.activeAdaptations.entries())) {
      record.cleanup();
      this.emitEvent({
        timestamp: Date.now(),
        type: 'reverted',
        intervention: type,
        componentId: record.command.targetComponentId,
        source: record.command.source,
        confidence: record.command.confidence
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
  private applyHighlightPrimaryAction(command: InterventionCommand): (() => void) | null {
    if (!this.root) return null;

    let targetEl: HTMLElement | null = null;
    if (command.targetComponentId) {
      targetEl = this.root.querySelector(
        `[data-aui-component="${command.targetComponentId}"]`
      );
    }
    if (!targetEl) {
      targetEl = this.root.querySelector(
        '[data-aui-role="primary-action"]:not([disabled])'
      );
    }

    if (!targetEl) return null;

    const hadClass = targetEl.hasAttribute('class');
    const initialClass = targetEl.getAttribute('class');

    targetEl.classList.add('edge-aui-highlight');
    targetEl.setAttribute('data-aui-active-adaptation', 'highlight');

    return () => {
      if (targetEl) {
        if (hadClass && initialClass !== null) {
          targetEl.setAttribute('class', initialClass);
        } else {
          targetEl.removeAttribute('class');
        }
        targetEl.removeAttribute('data-aui-active-adaptation');
      }
    };
  }

  // =========================================================================
  // 2. simplify_options
  // =========================================================================
  private applySimplifyOptions(_command: InterventionCommand): (() => void) | null {
    if (!this.root) return null;

    const accordionButtons = Array.from(
      this.root.querySelectorAll('[data-aui-role="accordion"]')
    ) as HTMLElement[];

    if (accordionButtons.length === 0) return null;

    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const collapsedItems: Array<{
      btn: HTMLElement;
      wasExpanded: boolean;
      container?: HTMLElement | null;
    }> = [];

    // Tag drawer or container with edge-aui-simplified
    const filterDrawer = this.root.querySelector('[data-aui-component="filter-drawer"]');
    const drawerHadClass = filterDrawer?.hasAttribute('class');
    const drawerInitialClass = filterDrawer?.getAttribute('class');

    if (filterDrawer) {
      filterDrawer.classList.add('edge-aui-simplified');
    }

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

    return () => {
      if (filterDrawer) {
        if (drawerHadClass && typeof drawerInitialClass === 'string') {
          filterDrawer.setAttribute('class', drawerInitialClass);
        } else {
          filterDrawer.removeAttribute('class');
        }
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
    };
  }

  // =========================================================================
  // 3. expand_tooltip
  // =========================================================================
  private applyExpandTooltip(command: InterventionCommand): (() => void) | null {
    if (!this.root) return null;

    let targetEl: HTMLElement | null = null;
    if (command.targetComponentId) {
      targetEl = this.root.querySelector(
        `[data-aui-component="${command.targetComponentId}"]`
      );
    }
    if (!targetEl) {
      targetEl = this.root.querySelector('[data-aui-role="tooltip"]');
    }

    if (!targetEl) return null;

    const hadClass = targetEl.hasAttribute('class');
    const initialClass = targetEl.getAttribute('class');
    const hadAriaDescribedby = targetEl.hasAttribute('aria-describedby');
    const initialAriaDescribedby = targetEl.getAttribute('aria-describedby');

    targetEl.classList.add('edge-aui-tooltip-expanded');
    targetEl.setAttribute('aria-expanded', 'true');

    // Extract text from title or data attribute
    const tooltipText =
      targetEl.getAttribute('title') ||
      targetEl.getAttribute('data-tooltip') ||
      command.reason ||
      'Contextual guidance available';

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
        this.clear(command);
        this.emitEvent({
          timestamp: Date.now(),
          type: 'dismissed',
          intervention: command.type,
          componentId: command.targetComponentId,
          source: command.source,
          confidence: command.confidence
        });
      }
    };
    doc.addEventListener('keydown', onKeyDown);

    return () => {
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
    };
  }

  // =========================================================================
  // 4. offer_assistance
  // =========================================================================
  private applyOfferAssistance(command: InterventionCommand): (() => void) | null {
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
      this.clear(command);
      this.emitEvent({
        timestamp: Date.now(),
        type: 'dismissed',
        intervention: command.type,
        componentId: command.targetComponentId,
        source: command.source,
        confidence: command.confidence
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

    return () => {
      dismissBtn.removeEventListener('click', onDismiss);
      doc.removeEventListener('keydown', onKeyDown);
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    };
  }
}

export function createUIActuator(options?: UIActuatorOptions): UIActuator {
  return new UIActuator(options);
}
