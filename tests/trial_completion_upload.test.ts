/**
 * Trial completion → upload wiring (deployment §10, the write path)
 *
 * The collection subsystem (`src/telemetry/collection.ts`) was implemented and unit-tested in
 * isolation, but nothing in the application ever called `completeSession()`. The write path was
 * therefore dead code: the testbed recorded every trace locally and uploaded none of them, which
 * is exactly what the researcher's verification query reported when it returned no rows.
 *
 * These tests assert the wiring, and the two properties that make it safe rather than merely
 * present:
 *
 * 1. completing a task uploads that trial's trace, and the panel reports `uploaded`;
 * 2. the session is rotated afterwards. `research_sessions.session_id` is the primary key and
 *    the client inserts with `resolution=ignore-duplicates` (the anon role holds no `SELECT`, so
 *    an upsert is unavailable), so a second trial under the same id would be silently discarded
 *    as a duplicate while still reporting `uploaded`. Rotation is what makes "one stored row per
 *    trial" true rather than merely reported.
 *
 * The task is completed through `taskManager.recordInteraction`, which is the same call the
 * observer bridge in `App.tsx` makes. The point under test is the collection wiring, not the DOM
 * event plumbing, which `tests/task_wiring.test.tsx` already covers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootTestbed, getCollection, getRuntime, registerDefaultUiAdapter } from '../src/runtime/boot';
import { testbedAdapter } from '../src/testbed/adapter';
import { taskManager } from '../src/testbed/tasks/taskManager';
import { EXPERIMENTAL_TASKS, type TaskId } from '../src/testbed/tasks/taskModel';
import { sessionManager } from '../src/telemetry/session';
import { experimentRecorder } from '../src/telemetry/recorder';

const SUPABASE_URL = 'https://trial-upload-test.supabase.co';

interface UploadCall {
  url: string;
  body: Record<string, unknown>;
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 8_000, label = 'condition' } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

/** Drives a task to `Completed` exactly as the observer bridge does. */
function completeTask(taskId: TaskId): void {
  taskManager.startTask(taskId);
  for (const step of EXPERIMENTAL_TASKS[taskId].steps) {
    taskManager.recordInteraction(step.expectedComponentId!, step.expectedAction!);
  }
  expect(taskManager.getState().status).toBe('Completed');
}

describe('Trial completion uploads the trace', () => {
  let calls: UploadCall[];

  beforeEach(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
    vi.stubEnv('VITE_AUI_COLLECTION_MODE', 'scripted');

    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response('', { status: 201, statusText: 'Created' });
      })
    );

    sessionManager.resetSession();
    experimentRecorder.clear();
    taskManager.resetTask();

    // `main.tsx` registers the real testbed adapter before booting; without it the runtime falls
    // back to `DefaultUiAdapter`, whose `getTaskState()` is a constant, and every trace would
    // report the task status as `Idle`.
    registerDefaultUiAdapter(() => testbedAdapter);

    // The Slow Gate is disabled so this test does not depend on worker/ONNX availability; the
    // upload path is independent of which gate produced the predictions.
    await bootTestbed({
      conditionId: 'adaptive',
      enableSlowGate: false,
      enableInstrumentation: false
    });
  });

  afterEach(() => {
    getRuntime()?.stop();
    taskManager.resetTask();
    sessionManager.resetSession();
    experimentRecorder.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uploads the completed trial, reports uploaded, and rotates the session', async () => {
    const firstSessionId = sessionManager.getActiveSession()!.sessionId;

    completeTask('T1');
    await waitFor(() => calls.length >= 2, { label: 'the T1 upload' });

    const [sessionCall, traceCall] = calls;
    expect(sessionCall.url).toContain('/rest/v1/research_sessions');
    expect(sessionCall.body.session_id).toBe(firstSessionId);
    // Provenance is enriched, never inferred, and the default must remain the safe one.
    expect(sessionCall.body.provenance).toBe('scripted');
    expect(sessionCall.body.status).toBe('Completed');

    expect(traceCall.url).toContain('/rest/v1/research_traces');
    const trace = traceCall.body.trace as {
      schemaVersion: string;
      session: { sessionId: string };
      task: { status: string };
      taskEvents: Array<{ type: string }>;
    };
    // The row and the payload must name the same session, and the trace must contain its own
    // ending: the runtime subscribes to the task lifecycle before collection does.
    expect(trace.session.sessionId).toBe(firstSessionId);
    expect(trace.task.status).toBe('Completed');
    expect(trace.taskEvents.some((event) => event.type === 'task_complete')).toBe(true);

    // The observable the deployment runbook reads off the panel.
    expect(getCollection()!.getStatus().state).toBe('uploaded');

    // A completed trial's session is closed.
    const secondSessionId = sessionManager.getActiveSession()!.sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);

    // Second trial: it must reach the store under its *own* session id. Under the old wiring
    // this insert was a duplicate and was discarded with the panel still reporting `uploaded`.
    completeTask('T2');
    await waitFor(() => calls.length >= 4, { label: 'the T2 upload' });

    const [secondSessionCall, secondTraceCall] = calls.slice(2);
    expect(secondSessionCall.body.session_id).toBe(secondSessionId);
    expect(secondSessionCall.body.session_id).not.toBe(firstSessionId);
    expect((secondTraceCall.body.trace as { session: { sessionId: string } }).session.sessionId).toBe(
      secondSessionId
    );
    expect(secondSessionCall.body.task_id).toBe('T2');
  });

  it('closes an abandoned trial instead of folding it into the next one', async () => {
    const abandonedSessionId = sessionManager.getActiveSession()!.sessionId;

    taskManager.startTask('T3');
    taskManager.recordInteraction('nav-Analytics', 'click');
    taskManager.resetTask();

    await waitFor(() => calls.length >= 2, { label: 'the abandonment upload' });

    expect(calls[0].body.session_id).toBe(abandonedSessionId);
    const trace = calls[1].body.trace as { task: { status: string } };
    // An abandoned trial is a real research outcome (`ABANDON` is in the outcome vocabulary),
    // and it must be recorded under its own id rather than merged into the next trial.
    expect(trace.task.status).toBe('Abandoned');
    expect(sessionManager.getActiveSession()!.sessionId).not.toBe(abandonedSessionId);
  });
});
