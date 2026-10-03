/**
 * Documentation Consistency (supervisor-ready deployment §21 / assessment F-27)
 *
 * The audit found the documentation set could not be used as the authoritative record of what was
 * built: seven ADR links pointed at files that do not exist, the integration guide documented a
 * `UiAdapter` that never existed, and several documented constants disagreed with the code.
 *
 * Those defects survived because nothing checked them. This test is the machine check. It covers
 * two failure classes:
 *
 * 1. **Local link resolution** — every relative markdown link in the *current* documentation
 *    resolves on disk.
 * 2. **ADR reference resolution** — every `ADR-NNN` reference in the current documentation names a
 *    record that exists.
 *
 * ## Deliberate scope exclusion
 *
 * `docs/assessments/` and the `docs/plan/` task briefs are **historical records**. The audit
 * documents quote the broken link names precisely because they were broken, and the task briefs
 * prescribe work that has since been reframed. Rewriting them to satisfy a linter would destroy the
 * evidence of what was wrong — the opposite of the point. They are therefore excluded, and the
 * exclusion is explicit rather than an oversight.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

/** Directories holding historical records that must not be retro-edited. */
const HISTORICAL_PREFIXES = ['docs/assessments/', 'docs/plan/', 'node_modules/'];

/** Recursively lists markdown files, skipping historical and generated directories. */
function listCurrentDocs(): string[] {
  const results: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(repoRoot, full).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (HISTORICAL_PREFIXES.some((prefix) => `${relative}/`.startsWith(prefix))) continue;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        if (HISTORICAL_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
        results.push(relative);
      }
    }
  };

  walk(path.join(repoRoot, 'docs'));

  // Root-level documents that describe the current system.
  for (const name of ['README.md', 'AGENTS.md']) {
    const full = path.join(repoRoot, name);
    if (fs.existsSync(full)) results.push(name);
  }

  return results.sort();
}

const MARKDOWN_LINK = /\]\(([^)]+)\)/g;
const ADR_REFERENCE = /ADR-(\d{3})/g;

describe('Documentation consistency', () => {
  const docs = listCurrentDocs();

  it('finds the current documentation to check', () => {
    // A sanity guard: if the walker silently returns nothing, the link checks below would pass
    // vacuously, which is the exact failure mode this test exists to prevent.
    expect(docs.length).toBeGreaterThan(10);
    expect(docs).toContain('README.md');
    expect(docs).toContain('docs/integration.md');
    expect(docs).toContain('docs/architecture.md');
    // Historical documents are deliberately not checked.
    expect(docs.some((d) => d.startsWith('docs/assessments/'))).toBe(false);
  });

  it('every relative markdown link in current documentation resolves on disk', () => {
    const broken: string[] = [];

    for (const doc of docs) {
      const content = fs.readFileSync(path.join(repoRoot, doc), 'utf8');
      const baseDir = path.dirname(path.join(repoRoot, doc));

      for (const match of content.matchAll(MARKDOWN_LINK)) {
        const target = match[1].trim();

        // External, anchor-only and mailto links are out of scope.
        if (/^(https?:|mailto:|#)/.test(target)) continue;

        const withoutAnchor = target.split('#')[0];
        if (withoutAnchor === '') continue;

        const resolved = path.resolve(baseDir, withoutAnchor);
        if (!fs.existsSync(resolved)) {
          broken.push(`${doc} → ${target}`);
        }
      }
    }

    expect(
      broken,
      `Broken relative links in current documentation:\n  ${broken.join('\n  ')}\n\n` +
        'Fix the link, or move the file to docs/assessments/ if it is a historical record.'
    ).toEqual([]);
  });

  it('every ADR reference in current documentation names an ADR that exists', () => {
    const decisionsDir = path.join(repoRoot, 'docs', 'decisions');
    const adrNumbers = new Set(
      fs
        .readdirSync(decisionsDir)
        .filter((f) => f.startsWith('ADR-') && f.endsWith('.md'))
        .map((f) => f.slice(4, 7))
    );

    const dangling: string[] = [];

    for (const doc of docs) {
      const content = fs.readFileSync(path.join(repoRoot, doc), 'utf8');
      for (const match of content.matchAll(ADR_REFERENCE)) {
        if (!adrNumbers.has(match[1])) {
          dangling.push(`${doc} → ADR-${match[1]}`);
        }
      }
    }

    expect(
      dangling,
      `References to ADRs that do not exist:\n  ${dangling.join('\n  ')}\n\n` +
        'The audit found seven such references (F-27); they were invisible because nothing checked.'
    ).toEqual([]);
  });

  it('every ADR file follows the ADR-NNN-kebab-title naming convention', () => {
    const decisionsDir = path.join(repoRoot, 'docs', 'decisions');
    const malformed = fs
      .readdirSync(decisionsDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => !/^ADR-\d{3}-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(f));

    expect(malformed, `ADR files that do not match ADR-NNN-kebab-title.md: ${malformed.join(', ')}`).toEqual(
      []
    );
  });

  it('the integration guide documents the real UiAdapter and UIContext field names', () => {
    // The audit found the guide documenting `getTasks`, `resolveUiContext`, `expectedSteps`,
    // `activePage` and `currentViewport` — none of which exist (F-25). The portability claim in
    // ADR-011 was therefore unproven outside the two in-repo adapters. The documented example must
    // name the real members.
    const integration = fs.readFileSync(path.join(repoRoot, 'docs', 'integration.md'), 'utf8');
    const adapterSource = fs.readFileSync(path.join(repoRoot, 'src', 'integration', 'types.ts'), 'utf8');
    const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'types', 'uiContext.ts'), 'utf8');

    for (const member of ['getActiveContext', 'getTaskState', 'onTaskStateChange', 'onTaskLifecycle', 'recordInteraction', 'getTaskActionForEvent', 'abandonTask']) {
      expect(adapterSource, `UiAdapter should declare ${member}`).toContain(member);
      expect(integration, `docs/integration.md should document ${member}`).toContain(member);
    }

    // Real UIContext fields, and none of the fabricated ones.
    for (const field of ['route', 'activeComponentId', 'componentRole', 'primaryActionAvailable', 'helpAvailable', 'expandable']) {
      expect(contextSource).toContain(field);
      expect(integration).toContain(field);
    }
    for (const fabricated of ['resolveUiContext', 'expectedSteps', 'activePage', 'currentViewport']) {
      expect(
        integration,
        `docs/integration.md still documents '${fabricated}', which does not exist in the implementation`
      ).not.toContain(fabricated);
    }
  });

  it('documents the real CSS class names the actuator applies', () => {
    const integration = fs.readFileSync(path.join(repoRoot, 'docs', 'integration.md'), 'utf8');
    const actuator = fs.readFileSync(path.join(repoRoot, 'src', 'intervention', 'actuator.ts'), 'utf8');

    for (const className of [
      'edge-aui-highlight',
      'edge-aui-simplified',
      'edge-aui-tooltip-expanded',
      'edge-aui-assistance-banner'
    ]) {
      expect(actuator, `actuator should apply ${className}`).toContain(className);
      expect(integration, `docs/integration.md should document ${className}`).toContain(className);
    }

    // The previously documented names, which the actuator never shipped. The lookbehind is
    // required so the correct names (`edge-aui-highlight`) are not matched as substrings of the
    // stale ones (`aui-highlight`).
    for (const stale of ['aui-highlight', 'aui-simplified', 'aui-tooltip-expanded', 'aui-assistance-active']) {
      expect(
        integration,
        `docs/integration.md still documents the non-existent class '${stale}'`
      ).not.toMatch(new RegExp(`(?<!edge-)${stale}`));
    }
  });

  it('documents the current trace schema version, not a superseded one', async () => {
    const { EXPERIMENT_TRACE_SCHEMA_VERSION, TRACE_CLOCK_MODE } = await import('../src/telemetry/traceSchema');

    for (const doc of ['docs/integration.md', 'docs/data_schemas.md', 'docs/architecture.md']) {
      const content = fs.readFileSync(path.join(repoRoot, doc), 'utf8');
      const claimsOldVersion =
        content.includes("traceSchemaVersion` | `'1.1.0'") ||
        content.includes('Experiment Trace Schema** | `1.2.0`');
      expect(claimsOldVersion, `${doc} still claims a superseded trace schema version`).toBe(false);
    }

    const dataSchemas = fs.readFileSync(path.join(repoRoot, 'docs', 'data_schemas.md'), 'utf8');
    expect(dataSchemas).toContain(EXPERIMENT_TRACE_SCHEMA_VERSION);
    expect(dataSchemas).toContain(TRACE_CLOCK_MODE);
  });
});
