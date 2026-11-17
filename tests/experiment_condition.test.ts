/**
 * Production Experiment Condition Control
 *
 * The condition is the independent variable of the baseline/adaptive contrast. It must be
 * resolved once, before the participant session starts, from the build default
 * (`VITE_AUI_EXPERIMENT_CONDITION`) with a valid `?auiCondition=` override. Once resolved it
 * must not change within the session, and the exported trace must name the condition the
 * runtime actually ran.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_EXPERIMENT_CONDITION,
  parseExperimentCondition,
  resolveExperimentCondition
} from '../src/config/experimentCondition';
import {
  bootRuntime,
  getCollection,
  getCondition,
  getRuntime,
  stopTestbed,
  switchCondition
} from '../src/runtime/boot';
import { sessionManager } from '../src/telemetry/session';
import { experimentRecorder } from '../src/telemetry/recorder';
import type { SerializableExperimentTrace } from '../src/telemetry/traceSchema';
import { InstrumentationCollector } from '../src/runtime/instrumentation';

function boot(conditionId?: 'baseline' | 'adaptive') {
  return bootRuntime({
    ...(conditionId ? { conditionId } : {}),
    enableSlowGate: false,
    enableInstrumentation: false,
    forceInProcessWorker: true
  });
}

describe('experiment condition configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts only the supported condition values', () => {
    expect(parseExperimentCondition('baseline')).toBe('baseline');
    expect(parseExperimentCondition('adaptive')).toBe('adaptive');
    expect(parseExperimentCondition(' baseline ')).toBe('baseline');
    expect(parseExperimentCondition('BASELINE')).toBeNull();
    expect(parseExperimentCondition('experiment')).toBeNull();
    expect(parseExperimentCondition('')).toBeNull();
    expect(parseExperimentCondition(undefined)).toBeNull();
    expect(parseExperimentCondition(null)).toBeNull();
  });

  it('uses the environment value when no valid query override exists', () => {
    expect(resolveExperimentCondition({ envCondition: 'baseline', search: '' })).toBe('baseline');
    expect(resolveExperimentCondition({ envCondition: 'adaptive', search: '' })).toBe('adaptive');
  });

  it('lets a valid query override the configured default', () => {
    expect(
      resolveExperimentCondition({ envCondition: 'baseline', search: '?auiCondition=adaptive' })
    ).toBe('adaptive');
    expect(
      resolveExperimentCondition({ envCondition: 'adaptive', search: '?auiCondition=baseline' })
    ).toBe('baseline');
    expect(
      resolveExperimentCondition({ envCondition: null, search: '?auiCondition=baseline' })
    ).toBe('baseline');
  });

  it('ignores an invalid query and keeps the valid configured default', () => {
    expect(
      resolveExperimentCondition({ envCondition: 'baseline', search: '?auiCondition=experiment' })
    ).toBe('baseline');
  });

  it('falls back to the safe default for missing or invalid configuration', () => {
    expect(DEFAULT_EXPERIMENT_CONDITION).toBe('adaptive');
    expect(resolveExperimentCondition({ envCondition: null, search: '' })).toBe('adaptive');
    expect(resolveExperimentCondition({ envCondition: 'invalid', search: '' })).toBe('adaptive');
    expect(
      resolveExperimentCondition({ envCondition: 'invalid', search: '?auiCondition=invalid' })
    ).toBe('adaptive');
  });

  it('warns about an unsupported value and then falls back safely', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        resolveExperimentCondition({ envCondition: 'unsupported', search: '' })
      ).toBe(DEFAULT_EXPERIMENT_CONDITION);

      const message = String(warn.mock.calls[0]?.[0] ?? '');
      expect(message).toContain("Ignoring unsupported");
      expect(message).toContain("'unsupported'");
      expect(message).toContain("Supported values are 'adaptive' and 'baseline'");
    } finally {
      warn.mockRestore();
    }
  });

  it('reads the environment and the page query string when no sources are injected', () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    expect(resolveExperimentCondition()).toBe('baseline');

    window.history.replaceState({}, '', '/?auiCondition=adaptive');
    expect(resolveExperimentCondition()).toBe('adaptive');
    window.history.replaceState({}, '', '/');
  });
});

describe('boot-time condition resolution and session immutability', () => {
  beforeEach(() => {
    stopTestbed();
    getCollection()?.stopPeriodicFlush();
    sessionManager.resetSession();
    experimentRecorder.clear();
    window.history.replaceState({}, '', '/');
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', '');
  });

  afterEach(() => {
    stopTestbed();
    getCollection()?.stopPeriodicFlush();
    sessionManager.resetSession();
    experimentRecorder.clear();
    window.history.replaceState({}, '', '/');
    vi.unstubAllEnvs();
  });

  it('boots baseline from the environment and records it in the session and trace', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    const runtime = await boot();

    expect(getCondition()).toBe('baseline');
    expect(runtime.getCondition()).toBe('baseline');
    expect(sessionManager.getActiveSession()?.conditionId).toBe('baseline');
    expect(experimentRecorder.getConditionId()).toBe('baseline');

    const trace = JSON.parse(experimentRecorder.exportJSON()) as SerializableExperimentTrace;
    expect(trace.session.conditionId).toBe('baseline');
    expect(trace.metadata.conditionId).toBe('baseline');
  });

  it('boots adaptive from the environment and records it in the session and trace', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'adaptive');
    const runtime = await boot();

    expect(getCondition()).toBe('adaptive');
    expect(runtime.getCondition()).toBe('adaptive');
    expect(sessionManager.getActiveSession()?.conditionId).toBe('adaptive');
    expect(experimentRecorder.getConditionId()).toBe('adaptive');
  });

  it('lets a valid query override the environment at boot', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    window.history.replaceState({}, '', '/?auiCondition=adaptive');

    const runtime = await boot();

    expect(runtime.getCondition()).toBe('adaptive');
    expect(sessionManager.getActiveSession()?.conditionId).toBe('adaptive');

    // The trace names the condition actually run, not the environment default it overrode.
    const trace = JSON.parse(experimentRecorder.exportJSON()) as SerializableExperimentTrace;
    expect(trace.session.conditionId).toBe('adaptive');
    expect(trace.metadata.conditionId).toBe('adaptive');
  });

  it('ignores an invalid query at boot without failing the session', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    window.history.replaceState({}, '', '/?auiCondition=unsupported');

    const runtime = await boot();

    expect(runtime.getCondition()).toBe('baseline');
    expect(sessionManager.getActiveSession()?.conditionId).toBe('baseline');
  });

  it('reuses the running runtime for the same resolved condition', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    const options = { enableSlowGate: false, forceInProcessWorker: true };
    const first = await bootRuntime(options);
    const second = await bootRuntime(options);

    expect(second).toBe(first);
    expect(second.isRunning()).toBe(true);
    expect(second.getCondition()).toBe('baseline');
  });

  it('restarts a stopped runtime instead of returning it', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    const options = { enableSlowGate: false, forceInProcessWorker: true };
    const first = await bootRuntime(options);
    first.stop();

    const second = await bootRuntime(options);

    expect(second).not.toBe(first);
    expect(second.isRunning()).toBe(true);
    expect(second.getCondition()).toBe('baseline');
  });

  it('honours the instrumentation=off URL override', async () => {
    window.history.replaceState({}, '', '/?instrumentation=off');

    const runtime = await bootRuntime({
      forceInProcessWorker: true,
      collector: new InstrumentationCollector()
    });

    expect(runtime.isInstrumentationEnabled()).toBe(false);
  });

  it('honours disable_instrumentation=true and keeps the Slow Gate enabled by default', async () => {
    window.history.replaceState({}, '', '/?disable_instrumentation=true');

    const runtime = await bootRuntime({
      forceInProcessWorker: true,
      collector: new InstrumentationCollector()
    });

    expect(runtime.isInstrumentationEnabled()).toBe(false);
    expect(runtime.getConfig().slowGate.enabled).toBe(true);
  });

  it('keeps the booted condition immutable for the session', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    const runtime = await boot();
    const sessionId = sessionManager.getActiveSession()!.sessionId;

    // A later boot, a forced runtime rebuild, the legacy condition-switch entry point and a
    // runtime state update must all leave the resolved condition untouched.
    await bootRuntime('adaptive');
    const rebuilt = await bootRuntime({
      conditionId: 'adaptive',
      enableInstrumentation: false,
      config: { experiment: { conditionId: 'adaptive' } }
    });
    await switchCondition('adaptive');
    sessionManager.setCondition('adaptive');

    expect(rebuilt).not.toBe(runtime);
    expect(getCondition()).toBe('baseline');
    expect(rebuilt.getCondition()).toBe('baseline');
    expect(getRuntime()?.getCondition()).toBe('baseline');
    expect(sessionManager.getActiveSession()?.sessionId).toBe(sessionId);
    expect(sessionManager.getActiveSession()?.conditionId).toBe('baseline');
    expect(runtime.getCondition()).toBe('baseline');
  });

  it('resolves the condition again for a new session', async () => {
    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'baseline');
    await boot();
    expect(getCondition()).toBe('baseline');

    stopTestbed();
    sessionManager.resetSession();

    vi.stubEnv('VITE_AUI_EXPERIMENT_CONDITION', 'adaptive');
    await boot();
    expect(getCondition()).toBe('adaptive');
    expect(sessionManager.getActiveSession()?.conditionId).toBe('adaptive');
  });
});
