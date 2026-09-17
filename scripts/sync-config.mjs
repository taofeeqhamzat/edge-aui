/**
 * sync-config.mjs
 * Synchronizes canonical pipeline parameters from model-preparation/src/config.yaml
 * into edge-aui-framework/src/config/pipelineConfig.json.
 * Enforces config.yaml as the single source of truth for normalization, windowing, and features.
 *
 * Configurable source path resolution:
 * 1. Explicit options passed to syncConfig({ sourcePath })
 * 2. CLI flag: --config <path>, --source <path>, -c <path>, --config=<path>, or positional *.yaml
 * 3. Environment variable: CONFIG_YAML_PATH or PIPELINE_CONFIG_SOURCE
 * 4. Automatic discovery fallback across standard repository locations
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findConfigYaml(explicitPath) {
  // 1. Explicit argument
  if (explicitPath) {
    const resolved = path.resolve(process.cwd(), explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Explicit config.yaml path not found: ${resolved}`);
    }
    return resolved;
  }

  // 2. CLI flags / arguments (when running from command line)
  if (typeof process !== 'undefined' && Array.isArray(process.argv)) {
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === '--config' || arg === '--source' || arg === '-c') {
        const next = process.argv[i + 1];
        if (!next) {
          throw new Error(`Missing path value after ${arg}`);
        }
        const resolved = path.resolve(process.cwd(), next);
        if (!fs.existsSync(resolved)) {
          throw new Error(`CLI specified config.yaml not found: ${resolved}`);
        }
        return resolved;
      }
      if (arg.startsWith('--config=') || arg.startsWith('--source=')) {
        const val = arg.slice(arg.indexOf('=') + 1);
        const resolved = path.resolve(process.cwd(), val);
        if (!fs.existsSync(resolved)) {
          throw new Error(`CLI specified config.yaml not found: ${resolved}`);
        }
        return resolved;
      }
      if (!arg.startsWith('-') && (arg.endsWith('.yaml') || arg.endsWith('.yml'))) {
        const resolved = path.resolve(process.cwd(), arg);
        if (!fs.existsSync(resolved)) {
          throw new Error(`Positional config.yaml not found: ${resolved}`);
        }
        return resolved;
      }
    }
  }

  // 3. Environment variable override
  const envPath = process.env.CONFIG_YAML_PATH || process.env.PIPELINE_CONFIG_SOURCE;
  if (envPath) {
    const resolved = path.resolve(process.cwd(), envPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Environment-specified config.yaml not found: ${resolved} (via CONFIG_YAML_PATH/PIPELINE_CONFIG_SOURCE)`);
    }
    return resolved;
  }

  // 4. Default candidates
  const candidates = [
    path.resolve(__dirname, '../../model-preparation/src/config.yaml'),
    path.resolve(process.cwd(), '../model-preparation/src/config.yaml'),
    path.resolve(process.cwd(), 'config.yaml'),
    path.resolve(process.cwd(), 'src/config.yaml'),
    '/Users/user/Workspace/MivaCS/FYP/model-preparation/src/config.yaml'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find config.yaml in default candidate locations:\n  ${candidates.join('\n  ')}\n` +
    `Please specify via --config <path>, CONFIG_YAML_PATH environment variable, or syncConfig({ sourcePath }).`
  );
}

function parseYamlValue(str) {
  const val = str.trim();
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;

  // Inline array: [1920, 1080]
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseYamlValue(item.trim()));
  }

  // Number
  if (!Number.isNaN(Number(val)) && !val.includes(':')) {
    return Number(val);
  }

  // Quoted string or raw string
  return val.replace(/^["']|["']$/g, '');
}

/**
 * Lightweight YAML parser handling the structured hierarchy of config.yaml
 */
export function parseYaml(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, node: root }];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Remove comments
    const commentIdx = rawLine.indexOf('#');
    const lineWithoutComment = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const trimmed = lineWithoutComment.trim();

    if (!trimmed) continue;

    const indent = rawLine.search(/\S/);

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const currentParent = stack[stack.length - 1].node;

    // List item
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2).trim();
      const parsedItem = parseYamlValue(itemContent);
      if (Array.isArray(currentParent)) {
        currentParent.push(parsedItem);
      }
      continue;
    }

    // Key-value or section header
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const keyRaw = trimmed.slice(0, colonIdx).trim();
      const valRaw = trimmed.slice(colonIdx + 1).trim();
      const key = keyRaw.replace(/^["']|["']$/g, '');

      if (!valRaw) {
        // Peek next line to see if it's a list or object
        let nextIndent = indent;
        let isList = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].split('#')[0].trim();
          if (nextTrimmed) {
            nextIndent = lines[j].search(/\S/);
            isList = nextTrimmed.startsWith('- ');
            break;
          }
        }

        const newNode = isList ? [] : {};
        currentParent[key] = newNode;
        stack.push({ indent, node: newNode });
      } else {
        currentParent[key] = parseYamlValue(valRaw);
      }
    }
  }

  return root;
}

/**
 * @typedef {Object} SyncConfigOptions
 * @property {string} [sourcePath]
 * @property {string} [outputPath]
 */

export function syncConfig(options = {}) {
  const yamlPath = findConfigYaml(options.sourcePath);
  console.log(`[sync-config] Reading canonical configuration from: ${yamlPath}`);
  const yamlText = fs.readFileSync(yamlPath, 'utf8');
  const parsed = parseYaml(yamlText);

  const outPath = options.outputPath ?? path.resolve(__dirname, '../src/config/pipelineConfig.json');
  const outDir = path.dirname(outPath);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[sync-config] Successfully wrote ${outPath}`);
  return parsed;
}

// Execute directly if run via node
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    syncConfig();
  } catch (err) {
    console.error('[sync-config] Error:', err.message || err);
    process.exit(1);
  }
}
