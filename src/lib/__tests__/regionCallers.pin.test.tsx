/**
 * 1.4.3 item 3 — PIN: every web caller that derives a REGION, driven only through the browser
 * (navigator.languages + the Intl zone), never through a module mock of the resolver, so the
 * single-resolver refactor (lib/regionResolver) cannot change what any caller answers. Written and
 * run green against the pre-refactor code; must pass unchanged after it.
 *
 * Callers pinned: browserDefaultUnits (lib/vitals), browserDefaultPhoneCountry incl. its locale
 * fallback (lib/phone), formatWeekdayList (calendar/recurrenceLabel), DaysOfWeekPicker (week
 * start), RegionUnitsAutoSet (region handed to the auto-set).
 */
import { render, screen, within } from '@testing-library/react';
import '@/i18n';

const h = vi.hoisted(() => ({ run: vi.fn((_deps: { userId: string; region: string | null }) => Promise.resolve('skipped')) }));
vi.mock('@/lib/regionUnitsAutoSet', async (orig) => ({
  ...(await orig<typeof import('@/lib/regionUnitsAutoSet')>()),
  runRegionUnitsAutoSet: (deps: { userId: string; region: string | null }) => h.run(deps),
}));

import { browserDefaultUnits } from '@/lib/vitals';
import { browserDefaultPhoneCountry } from '@/lib/phone';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { DaysOfWeekPicker } from '@/components/calendar/DaysOfWeekPicker';
import { RegionUnitsAutoSet } from '@/components/RegionUnitsAutoSet';
import { useAuthStore } from '@/store/authStore';

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
function browser(languages: string[], timeZone: string) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '');
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat
  ) {
    return { ...realResolvedOptions.call(this), timeZone };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  h.run.mockClear();
});

describe('PIN browserDefaultUnits: the resolved region', () => {
  it('P: bare "en" in Europe/London -> GB units (zone step)', () => {
    browser(['en'], 'Europe/London');
    expect(browserDefaultUnits()).toEqual({ weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' });
  });
  it('N: en-US in America/Denver stays US', () => {
    browser(['en-US'], 'America/Denver');
    expect(browserDefaultUnits()).toEqual({ weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' });
  });
});

describe('PIN browserDefaultPhoneCountry (resolver, then the locale fallback)', () => {
  it('P: en-US in Europe/Berlin -> DE (resolver zone step)', () => {
    browser(['en-US'], 'Europe/Berlin');
    expect(browserDefaultPhoneCountry()).toBe('DE');
  });
  it('P: de-JP (JP not offered) -> fallback by language -> DE', () => {
    browser(['de-JP'], 'Asia/Tokyo');
    expect(browserDefaultPhoneCountry()).toBe('DE');
  });
  it('N: ja-JP -> US, never a guess', () => {
    browser(['ja-JP'], 'Asia/Tokyo');
    expect(browserDefaultPhoneCountry()).toBe('US');
  });
  it('N: only navigator.languages[0] counts (second language ignored)', () => {
    browser(['en', 'de-DE'], 'America/Denver');
    expect(browserDefaultPhoneCountry()).toBe('US');
  });
});

describe('PIN week start callers (formatWeekdayList, DaysOfWeekPicker)', () => {
  const chips = () =>
    within(screen.getByRole('group', { name: 'Repeat on' }))
      .getAllByRole('checkbox')
      .map((c) => c.getAttribute('data-day'));
  const picker = () =>
    render(<DaysOfWeekPicker id="days" label="Repeat on" selected={[]} language="en" onChange={() => {}} />);

  it('P: bare "en" in Europe/London -> Monday-first', () => {
    browser(['en'], 'Europe/London');
    expect(formatWeekdayList([0, 3], 'en')).toBe('Wed, Sun');
    picker();
    expect(chips()).toEqual(['1', '2', '3', '4', '5', '6', '0']);
  });
  it('N: en-US in a US zone stays Sunday-first', () => {
    browser(['en-US'], 'America/New_York');
    expect(formatWeekdayList([0, 3], 'en')).toBe('Sun, Wed');
    picker();
    expect(chips()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });
});

describe('PIN RegionUnitsAutoSet: hands the resolved region to the auto-set', () => {
  const signIn = () => useAuthStore.setState({ isAuthenticated: true, user: { id: 'u1' } } as never);
  afterEach(() => useAuthStore.setState({ isAuthenticated: false, user: null } as never));

  it('P: bare "de" in UTC -> DE (language country)', () => {
    browser(['de'], 'UTC');
    signIn();
    render(<RegionUnitsAutoSet />);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][0]).toEqual({ userId: 'u1', region: 'DE' });
  });
  it('N: bare "en" in a US zone -> null (no guess)', () => {
    browser(['en'], 'America/Denver');
    signIn();
    render(<RegionUnitsAutoSet />);
    expect(h.run.mock.calls[0][0].region).toBeNull();
  });
});
