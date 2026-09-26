import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DefaultUiAdapter,
  DEFAULT_TASK_ACTION_BY_EVENT,
  DEFAULT_TASK_STATE,
  UiAdapter
} from '../src/integration/index';
import { AdaptiveRuntime } from '../src/runtime/adaptiveRuntime';

describe('UI Adapter Integration Contract (Task 3.4 / ADR-011)', () => {
  it('DefaultUiAdapter provides robust fallback defaults', () => {
    const adapter = new DefaultUiAdapter('custom-default', '2.0.0');
    expect(adapter.id).toBe('custom-default');
    expect(adapter.version).toBe('2.0.0');

    // Default task state
    const taskState = adapter.getTaskState();
    expect(taskState).toEqual(DEFAULT_TASK_STATE);
    expect(taskState.status).toBe('Idle');
    expect(taskState.currentTaskId).toBeNull();

    // Default action mappings
    expect(adapter.getTaskActionForEvent('click')).toBe('click');
    expect(adapter.getTaskActionForEvent('submit')).toBe('submit');
    expect(adapter.getTaskActionForEvent('change')).toBe('change');
    expect(adapter.getTaskActionForEvent('input')).toBe('input');
    expect(adapter.getTaskActionForEvent('mousedown')).toBeUndefined();

    // Context resolution
    const context = adapter.getActiveContext();
    expect(context).toBeDefined();
    expect(context.route).toBeDefined();
    expect(Array.isArray(context.availableActions)).toBe(true);
  });

  it('AdaptiveRuntime accepts a minimal UiAdapter implementation without crashing', () => {
    const minimalAdapter: UiAdapter = {
      id: 'minimal-adapter',
      version: '0.0.1'
    };

    const runtime = new AdaptiveRuntime({
      adapter: minimalAdapter,
      autoStart: false,
      enableSlowGate: false
    });

    expect(runtime.getAdapter().id).toBe('minimal-adapter');
    expect(runtime.getAdapter().version).toBe('0.0.1');

    // Context vector generation works with default fallback when adapter omits getActiveContext
    const vector = runtime.getContextVector();
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(6);
  });

  it('enforces architectural isolation: no core pipeline module imports src/testbed', () => {
    const coreDirs = [
      'src/telemetry',
      'src/microtensor',
      'src/macro',
      'src/gates',
      'src/intervention',
      'src/runtime'
    ];

    const violations: Array<{ file: string; line: string }> = [];
    const rootDir = path.resolve(__dirname, '..');

    for (const subDir of coreDirs) {
      const fullDir = path.join(rootDir, subDir);
      if (!fs.existsSync(fullDir)) continue;

      const walk = (dir: string) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const res = path.resolve(dir, file.name);
          if (file.isDirectory()) {
            walk(res);
          } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
            const content = fs.readFileSync(res, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              // Match import or export from ...testbed...
              if (/^\s*(import|export)\s+.*from\s+['"][^'"]*testbed[^'"]*['"]/.test(line)) {
                violations.push({
                  file: path.relative(rootDir, res),
                  line: `L${idx + 1}: ${line.trim()}`
                });
              }
            });
          }
        }
      };

      walk(fullDir);
    }

    expect(violations).toEqual([]);
  });
});
