import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RuntimeWorkerCore
} from '../src/runtime/worker/core';
import {
  RuntimeWorkerClient,
  createRuntimeWorkerClient
} from '../src/runtime/workerClient';
import {
  getTransferablesForRequest,
  RuntimeWorkerRequest
} from '../src/runtime/messages';
import { MicroTensorWindow, MacroInteraction } from '../src/telemetry/events';
import { UIContext } from '../src/types/uiContext';

function createMockWindow(index: number): MicroTensorWindow {
  const values = new Float32Array(18);
  for (let i = 0; i < 18; i++) {
    values[i] = ((index * 18 + i) % 100) / 100.0;
  }
  return {
    windowStart: index * 250,
    windowEnd: index * 250 + 500,
    values
  };
}

function createMockUIContext(): UIContext {
  return {
    route: 'Analytics',
    activeComponentId: 'filter-drawer',
    componentRole: 'accordion',
    availableActions: ['click'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: true
  };
}

describe('Task 9.1: Worker Thread Isolation & Transferable Buffer Messaging', () => {
  describe('Transferable Buffer Utilities', () => {
    it('extracts ArrayBuffer from PUSH_WINDOW request', () => {
      const window = createMockWindow(0);
      const req: RuntimeWorkerRequest = {
        id: 'test_1',
        type: 'PUSH_WINDOW',
        payload: {
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          values: window.values
        }
      };

      const transferables = getTransferablesForRequest(req);
      expect(transferables).toHaveLength(1);
      expect(transferables[0]).toBe(window.values.buffer);
    });

    it('returns empty array for requests without transferables', () => {
      const req: RuntimeWorkerRequest = {
        id: 'test_2',
        type: 'PING'
      };
      expect(getTransferablesForRequest(req)).toEqual([]);
    });
  });

  describe('RuntimeWorkerCore (Isolated Compute Engine)', () => {
    let core: RuntimeWorkerCore;

    beforeEach(async () => {
      core = new RuntimeWorkerCore();
      await core.handleRequest({
        id: 'init_1',
        type: 'INIT',
        payload: {
          fastGatePatterns: {
            'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
          }
        }
      });
    });

    it('processes PUSH_WINDOW requests and aggregates into SequenceBuilder (T=8)', async () => {
      for (let i = 0; i < 8; i++) {
        const win = createMockWindow(i);
        const res = await core.handleRequest({
          id: `win_${i}`,
          type: 'PUSH_WINDOW',
          payload: {
            windowStart: win.windowStart,
            windowEnd: win.windowEnd,
            values: win.values
          }
        });

        expect(res.success).toBe(true);
        if (res.type === 'WINDOW_PROCESSED') {
          expect(res.data.windowCount).toBe(i + 1);
          expect(res.data.isFull).toBe(i === 7);
        }
      }

      expect(core.getSequenceBuilder().isFull()).toBe(true);
    });

    it('ADR-002: Fast Gate match short-circuits during EVALUATE', async () => {
      // Ingest macro events that match Fast Gate pattern
      const macros: MacroInteraction[] = [
        { timestamp: 1000, symbol: 'NAV_ANALYTICS' },
        { timestamp: 1200, symbol: 'OPEN_FILTERS' }
      ];

      for (const m of macros) {
        await core.handleRequest({
          id: `m_${m.symbol}`,
          type: 'PUSH_MACRO',
          payload: { macro: m }
        });
      }

      const evalRes = await core.handleRequest({
        id: 'eval_1',
        type: 'EVALUATE',
        payload: {
          uiContext: createMockUIContext()
        }
      });

      expect(evalRes.success).toBe(true);
      if (evalRes.type === 'EVALUATION_RESULT') {
        expect(evalRes.data.matchedGate).toBe('fast');
        expect(evalRes.data.intervention?.type).toBe('highlight_primary_action');
        expect(evalRes.data.intervention?.source).toBe('fast');
      }
    });

    it('clears sequence and macro history on RESET request', async () => {
      await core.handleRequest({
        id: 'win_0',
        type: 'PUSH_WINDOW',
        payload: createMockWindow(0)
      });
      expect(core.getSequenceBuilder().length).toBe(1);

      const resetRes = await core.handleRequest({
        id: 'reset_1',
        type: 'RESET'
      });
      expect(resetRes.type).toBe('RESET_OK');
      expect(core.getSequenceBuilder().length).toBe(0);
    });
  });

  describe('RuntimeWorkerClient (Main-Thread RPC Wrapper)', () => {
    let client: RuntimeWorkerClient;

    beforeEach(async () => {
      client = createRuntimeWorkerClient({ useFallback: true });
      await client.init({
        fastGatePatterns: {
          'NAV_ANALYTICS > OPEN_FILTERS': 'highlight_primary_action'
        }
      });
    });

    afterEach(() => {
      client.terminate();
    });

    it('initializes and responds to ping', async () => {
      expect(client.isReady()).toBe(true);
      const timestamp = await client.ping();
      expect(timestamp).toBeTypeOf('number');
      expect(timestamp).toBeGreaterThan(0);
    });

    it('streams 8 windows and evaluates dual-engine inference under 50ms latency budget', async () => {
      for (let i = 0; i < 8; i++) {
        const res = await client.pushWindow(createMockWindow(i));
        expect(res.windowCount).toBe(i + 1);
        expect(res.isFull).toBe(i === 7);
      }

      const start = performance.now();
      const result = await client.evaluate(createMockUIContext(), [
        { timestamp: 1000, symbol: 'NAV_ANALYTICS' },
        { timestamp: 1200, symbol: 'OPEN_FILTERS' }
      ]);
      const duration = performance.now() - start;

      // Assert <50ms latency budget constraint
      expect(duration).toBeLessThan(50);
      expect(result.matchedGate).toBe('fast');
      expect(result.intervention?.type).toBe('highlight_primary_action');
    });

    it('handles reset cleanly across the boundary', async () => {
      await client.pushWindow(createMockWindow(0));
      await client.reset();

      const res = await client.pushWindow(createMockWindow(0));
      expect(res.windowCount).toBe(1);
    });
  });
});
