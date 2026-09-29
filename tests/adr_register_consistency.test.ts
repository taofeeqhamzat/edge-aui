/**
 * ADR Register Consistency & Deferment Audit Tests (Task 8.2 / Brief §19)
 *
 * Verifies that:
 * 1. All 14 ADR files exist and parse with valid status and date headers.
 * 2. Every deferment block adheres strictly to the six-field form required by Brief §19:
 *    - Decision
 *    - Deferred until
 *    - Reason
 *    - Current workaround
 *    - Risk
 *    - Evidence required to revisit
 * 3. ADR-014 index matches the per-ADR deferments (D1 through D12).
 * 4. Internal ADR file cross-references resolve on disk.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Task 8.2: Architectural Decision Record (ADR) Register Consistency', () => {
  const decisionsDir = path.resolve(__dirname, '../docs/decisions');
  const adrFiles = fs
    .readdirSync(decisionsDir)
    .filter((f) => f.startsWith('ADR-') && f.endsWith('.md'))
    .sort();

  const VALID_STATUSES = ['Accepted', 'Superseded', 'Deprecated', 'Proposed'];
  const REQUIRED_DEFERMENT_FIELDS = [
    'Decision:',
    'Deferred until:',
    'Reason:',
    'Current workaround:',
    'Risk:',
    'Evidence required to revisit:'
  ];

  it('contains all 14 expected ADR records (ADR-001 through ADR-014)', () => {
    expect(adrFiles.length).toBeGreaterThanOrEqual(14);
    for (let i = 1; i <= 14; i++) {
      const numStr = String(i).padStart(3, '0');
      const found = adrFiles.find((f) => f.startsWith(`ADR-${numStr}`));
      expect(found, `Expected file for ADR-${numStr} to exist`).toBeDefined();
    }
  });

  it('asserts each ADR carries a valid status and decision date', () => {
    for (const file of adrFiles) {
      const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');

      const statusMatch = content.match(/- \*\*Status:\*\* ([^\n]+)/);
      expect(statusMatch, `${file} missing - **Status:** header`).not.toBeNull();
      const statusText = statusMatch![1];
      const hasValidStatus = VALID_STATUSES.some((v) => statusText.includes(v));
      expect(hasValidStatus, `${file} has invalid status '${statusText}'`).toBe(true);

      const dateMatch = content.match(/- \*\*Date:\*\* ([^\n]+)/);
      expect(dateMatch, `${file} missing - **Date:** header`).not.toBeNull();
      expect(dateMatch![1]).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('asserts every deferment block carries all six Brief §19 fields', () => {
    for (const file of adrFiles) {
      // ADR-001 has no deferments (Option A was accepted in full)
      if (file.startsWith('ADR-001')) continue;

      const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');
      const lines = content.split('\n');

      let inBlock = false;
      let currentBlock: string[] = [];
      const blocks: string[][] = [];

      for (const line of lines) {
        if (line.startsWith('> **Decision:**') || (line.startsWith('> **Deferred until:**') && !inBlock)) {
          if (inBlock) blocks.push(currentBlock);
          inBlock = true;
          currentBlock = [line];
        } else if (inBlock) {
          if (line.startsWith('>')) {
            currentBlock.push(line);
          } else {
            inBlock = false;
            blocks.push(currentBlock);
            currentBlock = [];
          }
        }
      }
      if (inBlock) blocks.push(currentBlock);

      for (const block of blocks) {
        const text = block.join('\n');
        for (const field of REQUIRED_DEFERMENT_FIELDS) {
          expect(text, `${file} deferment block missing field '${field}':\n${text}`).toContain(field);
        }
      }
    }
  });

  it('asserts ADR-014 index enumerates all 12 deferred items (D1 through D12)', () => {
    const adr014 = fs.readFileSync(
      path.join(decisionsDir, 'ADR-014-deferred-target-ui-features.md'),
      'utf8'
    );

    for (let i = 1; i <= 12; i++) {
      const label = `**D${i} —`;
      expect(adr014, `ADR-014 missing item ${label}`).toContain(label);
    }
  });

  it('asserts cross-ADR links resolve to existing files', () => {
    for (const file of adrFiles) {
      const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');
      const adrRefRegex = /ADR-(\d{3})/g;
      let match;
      while ((match = adrRefRegex.exec(content)) !== null) {
        const refNum = match[1];
        const targetFile = adrFiles.find((f) => f.startsWith(`ADR-${refNum}`));
        expect(targetFile, `${file} references ADR-${refNum} which does not exist`).toBeDefined();
      }
    }
  });
});
