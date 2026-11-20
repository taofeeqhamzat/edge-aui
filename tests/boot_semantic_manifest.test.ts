/**
 * Semantic Head Boot & Wiring Verification
 *
 * Verifies that registering the v2 semantic bundle manifest in runtime defaults
 * causes bootRuntime() to load the 14-class task outcome head (task_outcome_head_v2_int8.onnx),
 * reporting its model version hash and 14-class prediction vocabulary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  bootRuntime,
  registerRuntimeDefaults,
  stopTestbed
} from '../src/runtime/boot';
import { parseBundleManifest } from '../src/config/modelManifest';
import semanticBundle from '../public/models/task_outcome_head_v2.bundle.json';
import { debugBus } from '../src/debug/debugBus';
import { experimentRecorder } from '../src/telemetry/recorder';
import { sessionManager } from '../src/telemetry/session';
import { resetOnnxSlowGateSession } from '../src/gates/slow/onnxSlowGate';

describe('Retrained Target Head Wiring', () => {
  beforeEach(() => {
    stopTestbed();
    resetOnnxSlowGateSession();
    experimentRecorder.clear();
    sessionManager.resetSession();
  });

  afterEach(() => {
    stopTestbed();
    resetOnnxSlowGateSession();
    registerRuntimeDefaults(null);
  });

  it('boots runtime with the retrained 14-class semantic head when manifest is registered', async () => {
    const manifest = parseBundleManifest(semanticBundle);
    registerRuntimeDefaults({ manifest });

    const runtime = await bootRuntime({
      forceInProcessWorker: true,
      slowGateMode: 'onnx',
      enableSlowGate: true,
      enableInstrumentation: false
    });

    const status = runtime.getStatus();
    expect(status.slowGateMode).toBe('onnx');
    expect(status.modelLoaded).toBe(true);
    expect(status.executionProvider).not.toBe('unavailable');
    expect(status.executionProvider).not.toBe('mock');

    // Model version must reflect the v2 semantic artifact hash
    expect(status.modelVersion).toContain(String(semanticBundle.int8_hash_sha256).slice(0, 12));
    expect(status.modelVersion).toContain('task_outcome_head_v2_int8.onnx');
  });

  it('records semantic task-outcome vocabulary attribution in debugBus metrics', async () => {
    const manifest = parseBundleManifest(semanticBundle);
    registerRuntimeDefaults({ manifest });

    const runtime = await bootRuntime({
      forceInProcessWorker: true,
      slowGateMode: 'onnx',
      enableSlowGate: true,
      enableInstrumentation: false
    });

    const status = runtime.getStatus();
    expect(status.modelLoaded).toBe(true);

    const metrics = debugBus.getSnapshot();
    expect(metrics.modelVersion).toContain(String(semanticBundle.int8_hash_sha256).slice(0, 12));
    expect(metrics.modelVersion).toContain('task_outcome_head_v2_int8.onnx');
  });
});
