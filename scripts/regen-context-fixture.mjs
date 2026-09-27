#!/usr/bin/env node
/**
 * Cross-Repository UIContext Encoding Fixture Generator
 *
 * Implements Phase B Task 10.2 specification:
 * Produces ground-truth encoded vectors from the runtime's encoding logic
 * (src/types/contextVector.ts) to verify parity with the Python encoder
 * (model-preparation/src/context_encoding.py) within 1e-6 tolerance.
 *
 * Usage:
 *   node scripts/regen-context-fixture.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frameworkRoot = path.resolve(__dirname, '..');
const modelPrepRoot = path.resolve(frameworkRoot, '..', 'model-preparation');
const fixtureDir = path.resolve(modelPrepRoot, 'tests', 'fixtures');
const fixturePath = path.resolve(fixtureDir, 'context_encoding_fixtures.json');

export const CONTEXT_VECTOR_DIM = 6;
export const ROUTE_VOCABULARY = [
  'Overview',
  'Analytics',
  'Reports',
  'Customers',
  'Settings'
];
export const ACTION_VOCABULARY = [
  'click',
  'change',
  'toggle',
  'hover',
  'select',
  'input',
  'focus'
];
export const TASK_STEP_COUNTS = {
  T1: 4,
  T2: 2,
  T3: 4
};

export function encodeUIContext(context) {
  const vector = new Float32Array(CONTEXT_VECTOR_DIM);

  const routeIndex = ROUTE_VOCABULARY.indexOf(context.route);
  vector[0] = routeIndex >= 0 ? routeIndex / ROUTE_VOCABULARY.length : 0.0;

  vector[1] = context.primaryActionAvailable ? 1.0 : 0.0;
  vector[2] = context.helpAvailable ? 1.0 : 0.0;
  vector[3] = context.expandable ? 1.0 : 0.0;

  if (context.taskId && context.taskStepId) {
    const stepCount = TASK_STEP_COUNTS[context.taskId];
    if (stepCount && stepCount > 0) {
      const stepNumber = Number.parseInt(context.taskStepId.split('-').pop() ?? '', 10);
      if (Number.isFinite(stepNumber) && stepNumber > 0) {
        vector[4] = Math.min(1.0, (stepNumber - 1) / stepCount);
      }
    }
  }

  const actionCount = new Set(context.availableActions ?? []).size;
  vector[5] = Math.min(1.0, actionCount / ACTION_VOCABULARY.length);

  return vector;
}

const testCases = [
  {
    name: 'standard_analytics_t1_step2',
    context: {
      route: 'Analytics',
      activeComponentId: 'filter-Region',
      componentRole: 'accordion',
      taskId: 'T1',
      taskStepId: 'T1-2',
      availableActions: ['click', 'change'],
      primaryActionAvailable: true,
      helpAvailable: true,
      expandable: true
    }
  },
  {
    name: 'overview_idle_no_task',
    context: {
      route: 'Overview',
      activeComponentId: 'nav-Overview',
      componentRole: 'navigation',
      availableActions: ['click', 'hover'],
      primaryActionAvailable: false,
      helpAvailable: false,
      expandable: false
    }
  },
  {
    name: 'reports_t2_completed_step',
    context: {
      route: 'Reports',
      activeComponentId: 'btn-export',
      componentRole: 'primary-action',
      taskId: 'T2',
      taskStepId: 'T2-2',
      availableActions: ['click'],
      primaryActionAvailable: true,
      helpAvailable: false,
      expandable: false
    }
  },
  {
    name: 'settings_t3_step4_full_actions',
    context: {
      route: 'Settings',
      activeComponentId: 'btn-apply-filters',
      componentRole: 'submit-action',
      taskId: 'T3',
      taskStepId: 'T3-4',
      availableActions: ['click', 'change', 'toggle', 'hover', 'select', 'input', 'focus'],
      primaryActionAvailable: true,
      helpAvailable: true,
      expandable: true
    }
  },
  {
    name: 'unknown_route_with_duplicates',
    context: {
      route: 'CustomDashboard',
      activeComponentId: 'custom-widget',
      componentRole: 'widget',
      taskId: 'T1',
      taskStepId: 'T1-1',
      availableActions: ['click', 'click', 'hover'],
      primaryActionAvailable: false,
      helpAvailable: true,
      expandable: false
    }
  },
  {
    name: 'empty_actions_and_malformed_step',
    context: {
      route: 'Customers',
      availableActions: [],
      taskId: 'T1',
      taskStepId: 'invalid-step-format',
      primaryActionAvailable: false,
      helpAvailable: false,
      expandable: true
    }
  },
  {
    name: 'step_index_exceeding_max',
    context: {
      route: 'Analytics',
      taskId: 'T2',
      taskStepId: 'T2-99',
      availableActions: ['click', 'hover', 'focus'],
      primaryActionAvailable: true,
      helpAvailable: true,
      expandable: false
    }
  }
];

const fixtureData = {
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  dimension: CONTEXT_VECTOR_DIM,
  routeVocabulary: ROUTE_VOCABULARY,
  actionVocabulary: ACTION_VOCABULARY,
  cases: testCases.map((tc) => {
    const vector = encodeUIContext(tc.context);
    return {
      name: tc.name,
      context: tc.context,
      expectedVector: Array.from(vector)
    };
  })
};

fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(fixturePath, JSON.stringify(fixtureData, null, 2), 'utf8');

console.log(`Generated ${fixtureData.cases.length} context encoding test fixtures at:`);
console.log(fixturePath);
