import { MERIDIEM } from '../timezone';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

/**
 * MERIDIEM is a code constant (not an i18n key) typed `Record<SupportedLanguage, ...>`.
 * A locale added to the registry without its row would render "AM/PM" (or throw)
 * silently, so the table must cover the registry exactly. Mobile and backend carry
 * the other two copies; the mobile suite owns the three-way value parity test.
 */
describe('MERIDIEM follows the locale registry', () => {
  it('has a row for every registry locale and no row for an unregistered one', () => {
    expect(Object.keys(MERIDIEM).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('every row has non-empty am and pm', () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(MERIDIEM[code].am.length).toBeGreaterThan(0);
      expect(MERIDIEM[code].pm.length).toBeGreaterThan(0);
    }
  });

  it('keeps the shipped values byte-identical (RAE form for es)', () => {
    expect(MERIDIEM.en).toEqual({ am: 'AM', pm: 'PM' });
    expect(MERIDIEM.es).toEqual({ am: 'a. m.', pm: 'p. m.' });
  });
});
