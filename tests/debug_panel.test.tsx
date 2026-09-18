/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DebugPanel } from '../src/debug/DebugPanel';
import { debugBus } from '../src/debug/debugBus';
import { sessionManager } from '../src/telemetry/session';
import { taskManager } from '../src/testbed/tasks/taskManager';
import { experimentRecorder } from '../src/telemetry/recorder';

describe('DebugPanel (Task 10.2)', () => {
  beforeEach(() => {
    taskManager.resetTask();
    sessionManager.resetSession();
    experimentRecorder.clear();
    debugBus.reset();
  });

  afterEach(() => {
    taskManager.resetTask();
    sessionManager.resetSession();
    experimentRecorder.clear();
    debugBus.reset();
  });

  it('renders collapsed toggle button with task status initially', () => {
    act(() => {
      render(<DebugPanel forceShow={true} />);
    });

    const toggleBtn = screen.getByRole('button', { name: /Open Edge-AUI Development Debug Panel/i });
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.textContent).toContain('⚡ AUI Debug');
    expect(toggleBtn.textContent).toContain('[Idle]');
  });

  it('expands panel and displays prioritized session, task, and gate metrics', () => {
    sessionManager.startSession('T1');
    taskManager.startTask('T1');

    debugBus.update({
      latestMicroTensor: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      latestMacroSequence: ['NAV_ANALYTICS', 'OPEN_FILTER', 'APPLY_FILTER'],
      fastGateStatus: { matched: true, pattern: 'SEQ_FILTER', confidence: 1.0 },
      slowGateStatus: { called: false },
      interventionStatus: { type: 'highlight_primary_action', source: 'fast', confidence: 1.0, state: 'applied' },
      inferenceLatencyMs: 2.34,
      featureLatencyMs: 0.85,
      workerStatus: 'ready'
    });

    act(() => {
      render(<DebugPanel forceShow={true} />);
    });

    // Click toggle to open panel
    const toggleBtn = screen.getByRole('button', { name: /Open Edge-AUI Development Debug Panel/i });
    act(() => {
      fireEvent.click(toggleBtn);
    });

    // Verify Title
    expect(screen.getByText('Edge-AUI Pipeline Inspector')).not.toBeNull();

    // Verify Session & Task info
    expect(screen.getByText(/T1 \(Filter Analytics\)/)).not.toBeNull();
    expect(screen.getByText(/T1-1: Navigate to Analytics/)).not.toBeNull();

    // Verify Dual-Gate Decisions
    expect(screen.getByText(/MATCH \(SEQ_FILTER\)/)).not.toBeNull();
    expect(screen.getByText('skipped')).not.toBeNull();
    expect(screen.getByText(/highlight_primary_action \[fast\]/)).not.toBeNull();

    // Verify Latencies
    expect(screen.getByText('2.34 ms')).not.toBeNull();
    expect(screen.getByText('0.85 ms')).not.toBeNull();
    expect(screen.getByText('ready')).not.toBeNull();

    // Verify Macro Sequence
    expect(screen.getByText('NAV_ANALYTICS')).not.toBeNull();
    expect(screen.getByText('OPEN_FILTER')).not.toBeNull();
    expect(screen.getByText('APPLY_FILTER')).not.toBeNull();

    // Verify MicroTensor values
    expect(screen.getByText('0.100')).not.toBeNull();
    expect(screen.getByText('[111111111]')).not.toBeNull();
  });

  it('triggers local trace export and recorder clear without server calls', () => {
    let downloadCalled = false;
    const origDownload = experimentRecorder.downloadTraceAsJSON.bind(experimentRecorder);
    experimentRecorder.downloadTraceAsJSON = () => {
      downloadCalled = true;
    };

    try {
      act(() => {
        render(<DebugPanel forceShow={true} />);
      });

      const toggleBtn = screen.getByRole('button', { name: /Open Edge-AUI Development Debug Panel/i });
      act(() => {
        fireEvent.click(toggleBtn);
      });

      const exportBtn = screen.getByRole('button', { name: /Export Experiment Trace JSON/i });
      act(() => {
        fireEvent.click(exportBtn);
      });
      expect(downloadCalled).toBe(true);

      const clearBtn = screen.getByRole('button', { name: /Clear Recorded Trace/i });
      experimentRecorder.recordBehaviourEvent({ timestamp: 10, type: 'click' });
      expect(experimentRecorder.getEventCounts().total).toBe(1);

      act(() => {
        fireEvent.click(clearBtn);
      });
      expect(experimentRecorder.getEventCounts().total).toBe(0);
    } finally {
      experimentRecorder.downloadTraceAsJSON = origDownload;
    }
  });

  it('collapses when close button is clicked', () => {
    act(() => {
      render(<DebugPanel forceShow={true} />);
    });

    const toggleBtn = screen.getByRole('button', { name: /Open Edge-AUI Development Debug Panel/i });
    act(() => {
      fireEvent.click(toggleBtn);
    });
    expect(screen.getByText('Edge-AUI Pipeline Inspector')).not.toBeNull();

    const closeBtn = screen.getByRole('button', { name: /Collapse Debug Panel/i });
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(screen.queryByText('Edge-AUI Pipeline Inspector')).toBeNull();
    expect(screen.getByRole('button', { name: /Open Edge-AUI Development Debug Panel/i })).not.toBeNull();
  });
});
