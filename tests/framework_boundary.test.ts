/**
 * Framework Boundary (Task 20.2)
 *
 * The testbed is one integration of the framework, not its definition. This file asserts
 * that in the two ways that can actually regress:
 *
 * 1. A source scan: framework core carries no testbed route, task or component vocabulary
 *    as a value. `src/testbed` (the adapter that supplies it) and `src/app` (the testbed's
 *    React views) are the places it is allowed to live.
 * 2. A second adapter: a UI with a different route/action/task vocabulary produces a valid
 *    context vector and macro stream using only framework contracts.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MacroInteractionStream } from '../src/macro/sequence';
import type { MacroMapper } from '../src/macro/mapper';
import {
  encodeUIContext,
  validateContextVector,
  type ContextEncodingConfig
} from '../src/types/contextVector';
import type { BehaviourEvent } from '../src/telemetry/events';
import { DEFAULT_RUNTIME_CONFIG } from '../src/config/runtimeConfig';

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** Directories that are integrations of the framework, not the framework. */
const INTEGRATION_DIRS = ['testbed', 'app'];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === SRC_ROOT && INTEGRATION_DIRS.includes(entry.name)) continue;
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Quoted route names: an unquoted English word is not a vocabulary leak. */
const ROUTE_TOKENS = /['"`](Analytics|Reports|Customers|Settings|Overview)['"`]/;
/** Quoted task identifiers and step identifiers (`'TD1'`, `'TD1-3'`). */
const TASK_TOKENS = /['"`]TD[1-4](?:-[^'"`]*)?['"`]/;
/** Testbed component identifiers. */
const COMPONENT_TOKENS = /['"`](btn-export|filter-drawer)['"`]/;
/** Testbed macro symbol names. `BACKTRACK`/`RAPID_SCROLL`/`IDLE_DWELL` stay: they are
 * framework-detected behavioural markers, not application vocabulary. */
const SYMBOL_TOKENS =
  /\b(NAV_[A-Z]+|OPEN_FILTERS|CLOSE_FILTERS|APPLY_FILTER|RESET_FILTERS|SELECT_DATE|SELECT_REGION|SELECT_CATEGORY|SELECT_SEGMENT|OPEN_REPORT|EXPORT_REPORT|TABLE_[A-Z_]+|HOVER_KPI|HOVER_HELP|EXPAND_TOOLTIP)\b/;

interface Violation {
  file: string;
  line: number;
  token: string;
  text: string;
}

function scan(pattern: RegExp): Violation[] {
  const violations: Violation[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, index) => {
      const match = pattern.exec(text);
      if (match) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: index + 1,
          token: match[0],
          text: text.trim()
        });
      }
    });
  }
  return violations;
}

describe('framework core carries no application vocabulary', () => {
  it('has no testbed route names in core source', () => {
    expect(scan(ROUTE_TOKENS).map((v) => `${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it('has no testbed task identifiers in core source', () => {
    expect(scan(TASK_TOKENS).map((v) => `${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it('has no testbed component identifiers in core source', () => {
    expect(scan(COMPONENT_TOKENS).map((v) => `${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it('has no testbed macro symbol vocabulary in core source', () => {
    expect(scan(SYMBOL_TOKENS).map((v) => `${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it('declares no application Fast Gate patterns in the framework defaults', () => {
    expect(DEFAULT_RUNTIME_CONFIG.fastGate.patternInterventionMap).toEqual({});
    expect(DEFAULT_RUNTIME_CONFIG.experiment.trialOrder).toEqual([]);
    expect(DEFAULT_RUNTIME_CONFIG.experiment.taskTimeoutsMs).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Second adapter: a checkout flow with its own vocabulary.
//
// It imports framework contracts only. If either contract were still tied to the
// testbed's names this adapter could not be written.
// ---------------------------------------------------------------------------

const CHECKOUT_SYMBOLS = [
  'CART_VIEW',
  'CHANGE_QUANTITY',
  'SUBMIT_ORDER',
  'CONFIRM_PAYMENT'
] as const;

const checkoutMapper: MacroMapper = {
  vocabularyId: 'checkout/1.0.0',
  symbols: CHECKOUT_SYMBOLS,
  isSymbol(value) {
    return (CHECKOUT_SYMBOLS as readonly string[]).includes(value);
  },
  deriveSymbol(event: BehaviourEvent) {
    if (event.type === 'submit') return 'SUBMIT_ORDER';
    if (event.action === 'change' && event.componentId?.startsWith('quantity')) return 'CHANGE_QUANTITY';
    if (event.type === 'click' && event.componentId === 'confirm-payment') return 'CONFIRM_PAYMENT';
    if (event.type === 'navigation') return 'CART_VIEW';
    return null;
  }
};

const CHECKOUT_ENCODING: ContextEncodingConfig = {
  id: 'checkout',
  version: '1.0.0',
  routeVocabulary: ['Cart', 'Checkout', 'Confirmation'],
  actionVocabulary: ['click', 'change', 'submit'],
  taskStepCounts: { CHECKOUT: 3 }
};

function event(overrides: Partial<BehaviourEvent>): BehaviourEvent {
  return { timestamp: 1_700_000_000_000, type: 'click', ...overrides };
}

describe('second adapter uses the framework contracts unchanged', () => {
  it('derives its own macro symbols through the MacroMapper contract', () => {
    const stream = new MacroInteractionStream({ macroMapper: checkoutMapper, autoRecordToTrace: false });

    expect(stream.recordFromBehaviourEvent(event({ type: 'submit' }))?.symbol).toBe('SUBMIT_ORDER');
    expect(
      stream.recordFromBehaviourEvent(
        event({ type: 'change', action: 'change', componentId: 'quantity-input' })
      )?.symbol
    ).toBe('CHANGE_QUANTITY');
    expect(
      stream.recordFromBehaviourEvent(event({ type: 'click', componentId: 'confirm-payment' }))?.symbol
    ).toBe('CONFIRM_PAYMENT');
    // A micro-interaction stays out of the macro stream.
    expect(stream.recordFromBehaviourEvent(event({ type: 'mousemove' }))).toBeNull();

    expect(stream.getRecentSymbols()).toEqual([
      'SUBMIT_ORDER',
      'CHANGE_QUANTITY',
      'CONFIRM_PAYMENT'
    ]);
  });

  it('encodes its own context vocabulary into a valid vector', () => {
    const vector = encodeUIContext(
      {
        route: 'Checkout',
        taskId: 'CHECKOUT',
        taskStepId: 'checkout-2',
        availableActions: ['click', 'submit'],
        primaryActionAvailable: true,
        helpAvailable: false,
        expandable: false
      },
      CHECKOUT_ENCODING
    );

    expect(validateContextVector(vector)).toEqual({ valid: true, errors: [] });
    // Route index 1 of 3.
    expect(vector[0]).toBeCloseTo(1 / 3);
    // Step 2 of 3 -> (2 - 1) / 3.
    expect(vector[4]).toBeCloseTo(1 / 3);
    // Two of three declared actions available.
    expect(vector[5]).toBeCloseTo(2 / 3);
  });

  it('encodes an unknown route as zero instead of guessing an index', () => {
    const vector = encodeUIContext(
      {
        route: 'NotInVocabulary',
        availableActions: ['click'],
        primaryActionAvailable: false,
        helpAvailable: false,
        expandable: false
      },
      CHECKOUT_ENCODING
    );
    expect(vector[0]).toBe(0);
  });
});
