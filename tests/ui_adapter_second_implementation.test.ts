import { describe, it, expect, vi } from 'vitest';
import {
  UiAdapter,
  UiTaskStateSnapshot,
  UiTaskLifecycleEvent
} from '../src/integration/index';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { UIContext } from '../src/types/uiContext';
import { experimentRecorder } from '../src/telemetry/recorder';

/**
 * Deliberately different UI adapter representing an e-commerce checkout wizard.
 * Completely distinct from the research testbed in task taxonomy, step model,
 * component naming, and context extraction.
 */
class CheckoutWizardAdapter implements UiAdapter {
  readonly id = 'checkout-wizard';
  readonly version = '2.1.0';

  public interactionsRecorded: Array<{ componentId: string; action: string }> = [];
  public lifecycleEventsEmitted: UiTaskLifecycleEvent[] = [];
  public initialized = false;
  public destroyed = false;

  private taskState: UiTaskStateSnapshot = {
    currentTaskId: 'CHECKOUT_FLOW',
    status: 'In Progress',
    currentStepIndex: 0,
    completedSteps: [],
    errors: 0
  };

  private stateChangeListeners: Array<(state: UiTaskStateSnapshot) => void> = [];
  private lifecycleListeners: Array<(event: UiTaskLifecycleEvent) => void> = [];

  onInit() {
    this.initialized = true;
  }

  onDestroy() {
    this.destroyed = true;
  }

  getActiveContext(): UIContext {
    return {
      route: 'CheckoutWizard/Shipping',
      activeComponentId: 'input-shipping-zip',
      componentRole: 'form-field',
      taskId: this.taskState.currentTaskId ?? undefined,
      taskStepId: 'step-shipping',
      availableActions: ['change', 'click'],
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: false,
      uiVersion: this.version
    };
  }

  getTaskState(): UiTaskStateSnapshot {
    return { ...this.taskState };
  }

  onTaskStateChange(callback: (state: UiTaskStateSnapshot) => void): () => void {
    this.stateChangeListeners.push(callback);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== callback);
    };
  }

  onTaskLifecycle(callback: (event: UiTaskLifecycleEvent) => void): () => void {
    this.lifecycleListeners.push(callback);
    return () => {
      this.lifecycleListeners = this.lifecycleListeners.filter((l) => l !== callback);
    };
  }

  recordInteraction(componentId: string, action: string): void {
    this.interactionsRecorded.push({ componentId, action });
    if (componentId === 'btn-submit-order' && action === 'submit') {
      this.taskState.status = 'Completed';
      this.taskState.completedSteps.push('step-payment');
      const event: UiTaskLifecycleEvent = {
        type: 'task_complete',
        taskId: 'CHECKOUT_FLOW',
        timestamp: Date.now()
      };
      this.lifecycleEventsEmitted.push(event);
      this.lifecycleListeners.forEach((l) => l(event));
      this.stateChangeListeners.forEach((l) => l({ ...this.taskState }));
    }
  }

  abandonTask(reason: string): void {
    this.taskState.status = 'Abandoned';
    this.taskState.abandonmentReason = reason;
  }

  getTaskActionForEvent(eventType: string): string | undefined {
    const map: Record<string, string> = {
      click: 'click',
      submit: 'submit',
      change: 'change',
      input: 'input'
    };
    return map[eventType];
  }
}

describe('Reference UI Adapter & Second Implementation Proof (Task 4.1 / ADR-011)', () => {
  it('runs full end-to-end pipeline against CheckoutWizardAdapter without touching testbed modules', async () => {
    const adapter = new CheckoutWizardAdapter();

    const runtime = new AdaptiveRuntime({
      adapter,
      experimentId: 'exp-checkout-test',
      conditionId: 'adaptive',
      enableSlowGate: false,
      autoStart: false
    });

    await runtime.start();
    expect(adapter.initialized).toBe(true);

    const internals = runtime.getInternals();

    // 1. Simulate events matching CheckoutWizard
    internals.observer.emit({
      type: 'click',
      x: 350,
      y: 420,
      timestamp: 1000,
      componentId: 'btn-review-cart'
    });

    internals.observer.emit({
      type: 'change',
      x: 360,
      y: 450,
      timestamp: 1100,
      componentId: 'input-shipping-zip'
    });

    internals.observer.emit({
      type: 'submit',
      x: 500,
      y: 600,
      timestamp: 1250,
      componentId: 'btn-submit-order'
    });

    // 2. Assert interactions were bridged to the custom adapter
    expect(adapter.interactionsRecorded).toHaveLength(3);
    expect(adapter.interactionsRecorded[0]).toEqual({
      componentId: 'btn-review-cart',
      action: 'click'
    });
    expect(adapter.interactionsRecorded[1]).toEqual({
      componentId: 'input-shipping-zip',
      action: 'change'
    });
    expect(adapter.interactionsRecorded[2]).toEqual({
      componentId: 'btn-submit-order',
      action: 'submit'
    });

    // 3. Assert lifecycle was routed and recorded in experiment recorder
    expect(adapter.getTaskState().status).toBe('Completed');
    expect(adapter.lifecycleEventsEmitted).toHaveLength(1);
    expect(adapter.lifecycleEventsEmitted[0].type).toBe('task_complete');

    // 4. Assert exported trace reflects the custom adapter's task state
    const trace = experimentRecorder.export();
    expect(trace.task).toBeDefined();
    expect(trace.task?.currentTaskId).toBe('CHECKOUT_FLOW');
    expect(trace.task?.status).toBe('Completed');

    const serializableTrace = experimentRecorder.exportSerializable();
    expect(serializableTrace.task?.currentTaskId).toBe('CHECKOUT_FLOW');
    expect(serializableTrace.metadata.finalTaskStatus).toBe('Completed');

    // 5. Assert context vector is derived from adapter.getActiveContext
    const contextVector = runtime.getContextVector();
    expect(contextVector).toBeInstanceOf(Float32Array);
    expect(contextVector.length).toBe(6);

    runtime.stop();
    expect(adapter.destroyed).toBe(true);
  });
});
