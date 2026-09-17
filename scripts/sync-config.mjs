/**
 * sync-config.mjs
 * Synchronizes canonical pipeline parameters from model-preparation/src/config.yaml
 * into edge-aui-framework/src/config/pipelineConfig.json.
 * Enforces config.yaml as the single source of truth for normalization, windowing, and features.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findConfigYaml() {
  const candidates = [
    path.resolve(__dirname, '../../model-preparation/src/config.yaml'),
    path.resolve(process.cwd(), '../model-preparation/src/config.yaml'),
    '/Users/user/Workspace/MivaCS/FYP/model-preparation/src/config.yaml'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find config.yaml in candidates: ${candidates.join(', ')}`);
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
function parseYaml(yamlText) {
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
        let isList = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].split('#')[0].trim();
          if (nextTrimmed) {
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

export function syncConfig() {
  const yamlPath = findConfigYaml();
  console.log(`[sync-config] Reading canonical configuration from: ${yamlPath}`);
  const yamlText = fs.readFileSync(yamlPath, 'utf8');
  const parsed = parseYaml(yamlText);

  const outDir = path.resolve(__dirname, '../src/config');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'pipelineConfig.json');
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[sync-config] Successfully wrote ${outPath}`);
  return parsed;
}

// Execute directly if run via node
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    syncConfig();
  } catch (err) {
    console.error('[sync-config] Error:', err);
    process.exit(1);
  }
}
