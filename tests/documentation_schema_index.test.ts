/**
 * Documentation Schema Index & Integration Contract Tests
 *
 * Implements verification requirements from Task 4.4 and ADR-012.
 * Asserts that docs/data_schemas.md, docs/integration.md, and docs/project_architecture.md
 * accurately describe the implemented system without drift.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXPERIMENT_TRACE_SCHEMA_VERSION } from '../src/telemetry/traceSchema';
import { TESTBED_UI_VERSION } from '../src/types/uiContext';
import { PREPROCESSING_CONFIG } from '../src/config/pipelineConfig';
import { DEFAULT_RUNTIME_CONFIG } from '../src/config/runtimeConfig';

describe('Documentation Schema Index Contract (Task 4.4)', () => {
  const rootDir = path.resolve(__dirname, '..');
  const dataSchemasPath = path.join(rootDir, 'docs/data_schemas.md');
  const integrationPath = path.join(rootDir, 'docs/integration.md');
  const architecturePath = path.join(rootDir, 'docs/project_architecture.md');

  it('docs/data_schemas.md exists and contains the Versioned Schema Index table', () => {
    expect(fs.existsSync(dataSchemasPath)).toBe(true);
    const content = fs.readFileSync(dataSchemasPath, 'utf8');

    expect(content).toContain('## 1. Versioned Schema Index');
    expect(content).toContain('| Index | Schema / Contract | Version | Declaring File | Primary TypeScript Interface | Purpose |');
  });

  it('all 6 documented schemas match actual codebase versions and files', () => {
    const content = fs.readFileSync(dataSchemasPath, 'utf8');

    // 1. Experiment Trace Schema
    expect(content).toContain(`Experiment Trace Schema** | \`${EXPERIMENT_TRACE_SCHEMA_VERSION}\``);
    expect(content).toContain('src/telemetry/traceSchema.ts');

    // 2. MicroTensor Feature Schema
    expect(content).toContain('MicroTensor Feature Schema** | `1.0.0`');
    expect(content).toContain('src/microtensor/window.ts');
    expect(PREPROCESSING_CONFIG.input_dim).toBe(18);

    // 3. Runtime Configuration Schema
    expect(content).toContain('Runtime Configuration Schema**| `1.0.0`');
    expect(content).toContain('src/config/runtimeConfig.ts');
    expect(DEFAULT_RUNTIME_CONFIG.microtensor.schemaVersion).toBe('1.0.0');

    // 4. Synced Pipeline Configuration Schema
    expect(content).toContain('Synced Pipeline Configuration**| `1.0.0`');
    expect(content).toContain('src/config/pipelineConfig.ts');

    // 5. UI Context Contract
    expect(content).toContain(`UI Context Contract** | \`${TESTBED_UI_VERSION}\``);
    expect(content).toContain('src/types/uiContext.ts');

    // 6. UI Adapter Contract
    expect(content).toContain('UI Adapter Contract** | `1.0.0`');
    expect(content).toContain('src/integration/types.ts');
  });

  it('docs/integration.md exists and covers all 9 runtime configuration parameter groups', () => {
    expect(fs.existsSync(integrationPath)).toBe(true);
    const content = fs.readFileSync(integrationPath, 'utf8');

    const expectedGroups = [
      '1. Telemetry',
      '2. Windowing',
      '3. MicroTensor',
      '4. Macro',
      '5. Fast Gate',
      '6. Slow Gate',
      '7. Policy',
      '8. Actuation',
      '9. Experiment'
    ];

    for (const group of expectedGroups) {
      expect(content).toContain(group);
    }

    expect(content).toContain('UiAdapter');
    expect(content).toContain('data-aui-target');
    expect(content).toContain('Zero External Egress');
  });

  it('docs/project_architecture.md exists and accurately reflects AdaptiveRuntime and RollingWindowBuffer', () => {
    expect(fs.existsSync(architecturePath)).toBe(true);
    const content = fs.readFileSync(architecturePath, 'utf8');

    expect(content).toContain('AdaptiveRuntime');
    expect(content).toContain('RollingWindowBuffer');
    expect(content).toContain('UiAdapter');
    expect(content).toContain('SlidingWindowBuffer');
    expect(content).toMatch(/deprecated|superseded/i);
  });
});
