/**
 * Insurance "plan type" placeholder (1.4.2 i18n audit B): market-neutral and the
 * same words as mobile (`mobile/src/i18n/locales/*.json` edit.insurance.labelPlaceholder)
 * in every locale. A regional variant resolves through its base, as at runtime.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_REGISTRY } from '../locales';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_DIR = join(I18N_DIR, '../../../mobile/src/i18n/locales');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

function resolved(code: string): { web?: string; mobile?: string } {
  const entry = LOCALE_REGISTRY.find((e) => e.code === code) as { base?: string } | undefined;
  const chain = entry?.base ? [entry.base, code] : [code];
  let web: string | undefined;
  let mobile: string | undefined;
  for (const c of chain) {
    web = read(join(I18N_DIR, c, 'emergency.json')).edit?.insurance?.labelPlaceholder ?? web;
    mobile = read(join(MOBILE_DIR, `${c}.json`)).edit?.insurance?.labelPlaceholder ?? mobile;
  }
  return { web, mobile };
}

const MARKET_SPECIFIC = /Medicare|Medicaid|Medi-Cal|NHS|Obamacare|SUS\b|IMSS|ISAPRE|FONASA|gesetzlich|mutuelle|Medis/i;
const CODES = LOCALE_REGISTRY.map((e) => e.code);

describe('insurance plan-type placeholder', () => {
  it.each(CODES)('%s: web and mobile show the same words', (code) => {
    const { web, mobile } = resolved(code);
    expect(web).toBeTruthy();
    expect(web).toBe(mobile);
  });

  it('en reads "e.g., health, dental" (positive)', () => {
    expect(resolved('en').web).toBe('e.g., health, dental');
    expect(resolved('es').web).toBe('ej., salud, dental');
  });

  it.each(CODES)('%s: names no country-specific program like Medicare (negative)', (code) => {
    expect(resolved(code).web).not.toMatch(MARKET_SPECIFIC);
  });
});
