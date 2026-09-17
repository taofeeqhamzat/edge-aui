import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { findConfigYaml, parseYaml, syncConfig } from '../scripts/sync-config.mjs';

describe('sync-config (Configurable Source Path & Canonical Parser)', () => {
  it('resolves explicit sourcePath when valid', () => {
    const relativePath = '../model-preparation/src/config.yaml';
    const resolved = findConfigYaml(relativePath);
    expect(resolved).toContain('model-preparation/src/config.yaml');
  });

  it('fails visibly when explicit sourcePath does not exist', () => {
    expect(() => {
      findConfigYaml('non_existent_path.yaml');
    }).toThrow(/Explicit config\.yaml path not found/);
  });

  it('parses nested YAML structures correctly', () => {
    const yamlSample = `
preprocessing:
  window_size_ms: 500
  stride_ms: 250
  reference_viewport: [1920, 1080]
  core_features:
    - meanVelocity
    - maxVelocity
  normalization:
    mean_velocity_scale: 10.0
    hesitation_scale: 25.0
`;
    const parsed = parseYaml(yamlSample);
    expect(parsed.preprocessing.window_size_ms).toBe(500);
    expect(parsed.preprocessing.stride_ms).toBe(250);
    expect(parsed.preprocessing.reference_viewport).toEqual([1920, 1080]);
    expect(parsed.preprocessing.core_features).toEqual(['meanVelocity', 'maxVelocity']);
    expect(parsed.preprocessing.normalization.mean_velocity_scale).toBe(10.0);
    expect(parsed.preprocessing.normalization.hesitation_scale).toBe(25.0);
  });

  it('runs syncConfig and produces valid configuration object', () => {
    const config = syncConfig();
    expect(config.preprocessing).toBeDefined();
    expect(config.preprocessing.num_features).toBe(9);
    expect(config.preprocessing.input_dim).toBe(18);
    expect(config.preprocessing.normalization.mean_velocity_scale).toBe(10);
  });
});
