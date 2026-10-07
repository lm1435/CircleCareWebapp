/**
 * MERIDIEM lockstep: webapp `src/i18n/format/<code>.ts` vs backend
 * `backend/src/i18n/tables/<code>/format.ts` (canonical), for every code present on either
 * side. A variant file may omit `meridiem` (sparse = inherits its base) on either side.
 * Skipped when the sibling backend checkout is absent (CI of webapp alone).
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_FORMATS } from '../format';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_TABLES = join(HERE, '../../../../backend/src/i18n/tables');
const RE = /meridiem:\s*\{\s*am:\s*'([^']*)',\s*pm:\s*'([^']*)'\s*\}/;

function backendMeridiems(): Record<string, { am: string; pm: string } | null> {
  const out: Record<string, { am: string; pm: string } | null> = {};
  for (const code of readdirSync(BACKEND_TABLES)) {
    const f = join(BACKEND_TABLES, code, 'format.ts');
    if (!existsSync(f)) continue;
    const m = RE.exec(readFileSync(f, 'utf8'));
    out[code] = m ? { am: m[1] as string, pm: m[2] as string } : null;
  }
  return out;
}

describe.skipIf(!existsSync(BACKEND_TABLES))('MERIDIEM parity with backend tables', () => {
  it('has the same set of locale codes and identical markers', () => {
    const backend = backendMeridiems();
    expect(Object.keys(backend).sort()).toEqual(Object.keys(LOCALE_FORMATS).sort());
    for (const [code, fmt] of Object.entries(LOCALE_FORMATS)) {
      expect(backend[code] ?? null, code).toEqual(fmt.meridiem ?? null);
    }
  });
});
