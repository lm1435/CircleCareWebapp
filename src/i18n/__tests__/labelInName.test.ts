/**
 * WCAG 2.5.3 Label in Name (a11y pass 2026-10-08): when a control's visible text
 * is `key` and its aria-label is `keyA11y` / `keyLabel` / `keyAria` in the same
 * object, the aria-label must contain the visible words, in order, so a speech
 * user who says what they see ("click Dosis gegeben") hits the control. Caught
 * two German labels that split the visible phrase around the interpolation.
 *
 * Interpolations are compared as a placeholder on both sides. Keys whose label
 * deliberately names a different action are listed in ALLOW with the reason.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_REGISTRY } from '../locales';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** ns:path keys exempt from the check. */
const ALLOW = new Set<string>([
  // Not a visible/label pair: `row.undoLabel` is unused (TaskRow hands `row.undo`
  // to its Undo badge, which builds its own label).
  'tasks:row.undoLabel',
]);

const norm = (s: string): string =>
  s
    .replace(/\{\{[^}]+\}\}/g, '\u0000')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

type Json = { [k: string]: unknown };

function mismatches(obj: Json, path: string, ns: string, out: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') {
      mismatches(value as Json, path ? `${path}.${key}` : key, ns, out);
      continue;
    }
    const m = key.match(/^(.+?)(A11y|Aria|AriaLabel|Label)$/);
    if (!m || typeof value !== 'string') continue;
    const visible = obj[m[1]];
    if (typeof visible !== 'string') continue;
    const id = `${ns}:${path ? `${path}.` : ''}${key}`;
    if (ALLOW.has(id)) continue;
    if (!norm(value).includes(norm(visible))) {
      out.push(`${id}: visible "${visible}" is not in "${value}"`);
    }
  }
}

describe('label in name (WCAG 2.5.3)', () => {
  for (const { code } of LOCALE_REGISTRY) {
    it(`${code}: every aria-label contains its control's visible text`, () => {
      const dir = join(I18N_DIR, code);
      const out: string[] = [];
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const json = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Json;
        mismatches(json, '', file.replace(/\.json$/, ''), out);
      }
      expect(out).toEqual([]);
    });
  }
});
