import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMERGENCY_REGION_CODES,
  emergencyNumberForRegion,
  getEmergencyNumber,
} from '@/lib/emergencyNumber';

// 1.4.3: the SOS card's number is mobile's, per country (mobile/src/utils/locale.ts).
const MOBILE_LOCALE = join(__dirname, '..', '..', '..', '..', 'mobile', 'src', 'utils', 'locale.ts');

/** Every `XX: 'NNN'` pair inside mobile's EMERGENCY_NUMBERS literal. */
function mobileTable(): Record<string, string> {
  const src = readFileSync(MOBILE_LOCALE, 'utf8');
  const body = src.slice(src.indexOf('const EMERGENCY_NUMBERS'));
  const literal = body.slice(0, body.indexOf('};'));
  const out: Record<string, string> = {};
  for (const line of literal.split('\n')) {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(/\b([A-Z]{2}):\s*'(\d+)'/g)) out[m[1]] = m[2];
  }
  return out;
}

function setLanguages(langs: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(langs);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(langs[0] ?? '');
}

describe('emergency number (web twin of mobile getEmergencyNumber)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSITIVE: the table is mobile\'s, country for country', () => {
    const mobile = mobileTable();
    expect(Object.keys(mobile).length).toBeGreaterThan(40);
    expect(Object.fromEntries(EMERGENCY_REGION_CODES.map((c) => [c, emergencyNumberForRegion(c)]))).toEqual(
      mobile
    );
  });

  it.each([
    ['en-US', '911'],
    ['en-GB', '999'],
    ['es-MX', '911'],
    ['es-CO', '123'],
    ['de-DE', '112'],
    ['en-AU', '000'],
    ['pt-PT', '112'],
  ])('POSITIVE: %s dials %s', (tag, number) => {
    setLanguages([tag]);
    expect(getEmergencyNumber()).toBe(number);
  });

  it.each([['en'], ['es-419'], ['ja-JP'], ['pt']])(
    'NEGATIVE: %s (no explicit, verified region) never guesses a number',
    (tag) => {
      setLanguages([tag]);
      expect(getEmergencyNumber()).toBeNull();
    }
  );
});
