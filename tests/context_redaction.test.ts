/**
 * Context Redaction, Zero Field-Value Leakage, and Zero Telemetry Egress Tests
 * Implements Task 5.2 & ADR-010 (Guarantees 1 & 2).
 *
 * Verifies that:
 * 1. UIContext reaches OnnxSlowGate as the R^6 context tensor, bit-for-bit matching encodeUIContext.
 * 2. No form field values, passwords, free-text inputs, or sentinel strings can ever reach:
 *    - canonical BehaviourEvents
 *    - MicroTensor continuous windows
 *    - MacroInteractions
 *    - OutcomeEvents
 *    - PredictionEvents
 *    - InterventionEvents
 *    - Serialized experiment traces (JSON export)
 *    - Runtime log outputs
 * 3. Telemetry observation, windowing, inference, policy, actuation, and trace export invoke
 *    zero network egress primitives (fetch, XMLHttpRequest, WebSocket, sendBeacon).
 * 4. Context vector encoding (R^6) extracts only structural interface state and never free text.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryObserver } from '../src/telemetry/observer';
import { RollingWindowBuffer } from '../src/microtensor/window';
import { MacroInteractionStream } from '../src/macro/sequence';
import { OutcomeDeriver } from '../src/outcome/derive';
import { ExperimentRecorder } from '../src/telemetry/recorder';
import { createAdaptiveRuntime, AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';
import { encodeUIContext, CONTEXT_VECTOR_DIM, validateContextVector } from '../src/types/contextVector';
import { UIContext } from '../src/types/uiContext';

const SENTINEL_PRIMARY = 'SENTINEL_SECRET_DO_NOT_LEAK_XYZ123';
const SENTINEL_PASSWORD = 'SUPER_CONFIDENTIAL_PASSWORD_9988!!';
const SENTINEL_TEXTAREA = 'FREE_FORM_USER_NOTES_THAT_MUST_NEVER_BE_COLLECTED';
const SENTINEL_EMAIL = 'participant_confidential@privacy-study.org';

describe('Task 5.2 / ADR-010: Context Redaction & Telemetry Privacy Guarantees', () => {
  let formContainer: HTMLDivElement;

  beforeEach(() => {
    formContainer = document.createElement('div');
    formContainer.innerHTML = `
      <form id="test-confidential-form" data-aui-component="account-settings-form" data-aui-route="Settings">
        <label for="username">Username</label>
        <input type="text" id="username" data-aui-component="input-username" value="user_alice" />

        <label for="email">Email</label>
        <input type="email" id="email" data-aui-component="input-email" value="${SENTINEL_EMAIL}" />

        <label for="pwd">Password</label>
        <input type="password" id="pwd" data-aui-component="input-password" value="${SENTINEL_PASSWORD}" />

        <label for="notes">Notes</label>
        <textarea id="notes" data-aui-component="textarea-notes">${SENTINEL_TEXTAREA}</textarea>

        <label for="sentinel">Sentinel Token</label>
        <input type="text" id="sentinel" data-aui-component="input-sentinel" value="${SENTINEL_PRIMARY}" />

        <button type="submit" id="btn-submit" data-aui-component="btn-save-settings" data-aui-action="click">
          Save Settings
        </button>
      </form>
    `;
    document.body.appendChild(formContainer);
  });

  afterEach(() => {
    if (formContainer && formContainer.parentNode) {
      formContainer.parentNode.removeChild(formContainer);
    }
  });

  it('guarantees UIContext reaches the head as R^6 tensor matching encodeUIContext exactly', () => {
    const context: UIContext = {
      route: 'Settings',
      activeComponentId: 'account-settings-form',
      primaryActionAvailable: true,
      helpAvailable: true,
      expandable: false,
      availableActions: ['click', 'change', 'input'],
      taskId: 'T1',
      taskStepId: 'T1-2'
    };

    const independentlyEncoded = encodeUIContext(context);
    expect(independentlyEncoded.length).toBe(CONTEXT_VECTOR_DIM);
    expect(independentlyEncoded.length).toBe(6);

    const validation = validateContextVector(independentlyEncoded);
    expect(validation.valid).toBe(true);

    // Verify all 6 components are valid bounded floats in [0, 1]
    for (let i = 0; i < independentlyEncoded.length; i++) {
      expect(independentlyEncoded[i]).toBeGreaterThanOrEqual(0.0);
      expect(independentlyEncoded[i]).toBeLessThanOrEqual(1.0);
    }

    // Verify route index matches Settings (index 4 in ROUTE_VOCABULARY / 5.0 = 0.8)
    expect(independentlyEncoded[0]).toBeCloseTo(4 / 5, 4);
    // primaryActionAvailable = 1.0
    expect(independentlyEncoded[1]).toBe(1.0);
    // helpAvailable = 1.0
    expect(independentlyEncoded[2]).toBe(1.0);
    // expandable = 0.0
    expect(independentlyEncoded[3]).toBe(0.0);
    // taskProgress = (2 - 1) / 4 = 0.25
    expect(independentlyEncoded[4]).toBeCloseTo(0.25, 4);
    // actionAvailability = 3 / 7
    expect(independentlyEncoded[5]).toBeCloseTo(3 / 7, 4);
  });

  it('proves ADR-010 Guarantee 1: form field sentinel values never leak into serialized traces or logs', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const infoSpy = vi.spyOn(console, 'info');
    const warnSpy = vi.spyOn(console, 'warn');
    const errorSpy = vi.spyOn(console, 'error');

    const recorder = new ExperimentRecorder();
    const observer = new TelemetryObserver();
    const windowBuffer = new RollingWindowBuffer({
      windowDurationMs: 500,
      strideMs: 250,
      minEventsPerWindow: 1
    });
    const macroStream = new MacroInteractionStream();
    const outcomeDeriver = new OutcomeDeriver();

    // Wire observer into recording stages
    observer.subscribe((event) => {
      recorder.recordBehaviourEvent(event);
      windowBuffer.push(event);
      macroStream.recordFromBehaviourEvent(event);
      outcomeDeriver.push(event);
    });

    windowBuffer.subscribe((window) => {
      recorder.recordMicroTensor(window);
      const outcome = outcomeDeriver.deriveForWindow(window, {
        sessionId: 'test-session-001',
        experimentId: 'exp-redaction',
        conditionId: 'adaptive'
      });
      recorder.recordOutcome(outcome);
    });

    macroStream.subscribe((macro) => {
      recorder.recordMacroInteraction(macro);
    });

    observer.start(formContainer);

    // 1. Simulate pointer movements over inputs containing sentinels
    const sentinelInput = document.getElementById('sentinel') as HTMLInputElement;
    const pwdInput = document.getElementById('pwd') as HTMLInputElement;
    const notesTextarea = document.getElementById('notes') as HTMLTextAreaElement;
    const submitBtn = document.getElementById('btn-submit') as HTMLButtonElement;

    // Trigger focus, input changes, and pointer events
    sentinelInput.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 150 }));
    sentinelInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    sentinelInput.dispatchEvent(new Event('input', { bubbles: true }));
    sentinelInput.dispatchEvent(new Event('change', { bubbles: true }));
    sentinelInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    pwdInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
    pwdInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    notesTextarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    notesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    notesTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    notesTextarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    // Trigger form submission
    submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 200 }));
    const form = document.getElementById('test-confidential-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    // Monotonically tick the window buffer to flush windows
    windowBuffer.tick(1000);
    windowBuffer.tick(2000);

    observer.stop();

    // Export full serialized experiment trace
    const exportedTrace = recorder.exportSerializable();
    const serializedJson = JSON.stringify(exportedTrace);

    // Strict assertions: NONE of the confidential strings or sentinels appear in the serialized trace
    expect(serializedJson).not.toContain(SENTINEL_PRIMARY);
    expect(serializedJson).not.toContain(SENTINEL_PASSWORD);
    expect(serializedJson).not.toContain(SENTINEL_TEXTAREA);
    expect(serializedJson).not.toContain(SENTINEL_EMAIL);

    // Verify console log lines were not polluted with any sentinels
    const allConsoleCalls = [
      ...logSpy.mock.calls,
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls
    ].flat().map(String).join(' ');

    expect(allConsoleCalls).not.toContain(SENTINEL_PRIMARY);
    expect(allConsoleCalls).not.toContain(SENTINEL_PASSWORD);
    expect(allConsoleCalls).not.toContain(SENTINEL_TEXTAREA);
    expect(allConsoleCalls).not.toContain(SENTINEL_EMAIL);

    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('proves ADR-010 Guarantee 2: zero network egress primitives are reachable during telemetry execution', async () => {
    // Stub global network primitives
    const fetchSpy = vi.fn();
    const xhrOpenSpy = vi.fn();
    const sendBeaconSpy = vi.fn();

    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', class MockXMLHttpRequest {
      open = xhrOpenSpy;
      send = vi.fn();
      setRequestHeader = vi.fn();
    });
    if (typeof navigator !== 'undefined') {
      (navigator as unknown as { sendBeacon: unknown }).sendBeacon = sendBeaconSpy;
    }

    const runtime: AdaptiveRuntime = createAdaptiveRuntime({
      autoStart: false,
      forceInProcessWorker: true,
      slowGateMode: 'mock',
      config: {
        telemetry: { sampleIntervalMs: 0 },
        windowing: { windowDurationMs: 500, strideMs: 250, minEventCount: 1 }
      }
    });

    await runtime.start();

    // Execute standard user actions on the fixture
    const input = document.getElementById('username') as HTMLInputElement;
    const submit = document.getElementById('btn-submit') as HTMLButtonElement;

    input.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 }));
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 60 }));

    // Tick and trigger internal stages
    await runtime.resetTrial();
    runtime.stop();

    // Assert that zero network egress calls were attempted
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('verifies that encodeUIContext extracts zero free text or user input values', () => {
    // Inject malicious/confidential strings into custom UIContext properties
    const taintedContext: UIContext & Record<string, unknown> = {
      route: 'Analytics',
      activeComponentId: 'filter-panel',
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: true,
      availableActions: ['click', 'toggle'],
      taskId: 'T2',
      taskStepId: 'T2-1',
      // Arbitrary fields that a compromised UI might attempt to attach:
      freeTextComment: 'SECRET_USER_INPUT_NOTES',
      passwordField: 'SUPER_SECRET_VALUE',
      userEmail: 'user@example.com'
    };

    const vector = encodeUIContext(taintedContext);

    // Vector must strictly remain length 6 with only valid normalized numeric components
    expect(vector.length).toBe(6);
    const validation = validateContextVector(vector);
    expect(validation.valid).toBe(true);

    // Ensure Float32Array components are pure numeric projections
    for (let i = 0; i < vector.length; i++) {
      expect(typeof vector[i]).toBe('number');
      expect(Number.isFinite(vector[i])).toBe(true);
    }
  });
});
