/**
 * Owner screenshot (2026-11-02): the Spanish week grid's hour labels read "12 PM" (mobile hand-built
 * them). Both platforms now label the axis through ONE rule, utils/timezone `formatHourOfDay`: the
 * viewer's 12/24-hour clock and the app's period marker table (MERIDIEM: Spanish RAE "p. m.").
 * The web axis used raw `Intl` on `i18n.language`, which disagreed with every other time on the
 * page wherever the browser's tag is regional or CLDR differs from the app's table: `es-MX`
 * printed "12 p.m." and Canadian French "12 h p.m." beside "12:30 p. m." / "12:30 p.m." chips.
 */
import { render } from '@testing-library/react';
import i18n from '@/i18n';
import { WeekView } from '../WeekView';
import { formatHourOfDay } from '@/utils/timezone';

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => mockUseHourCycle() }));

const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];

function axisLabels(): string[] {
  const { container, unmount } = render(
    <WeekView
      days={DAYS}
      eventsByDay={new Map()}
      careRecipientTimezone="America/Mexico_City"
      todayStr="2026-11-02"
      onEventClick={vi.fn()}
    />
  );
  // The axis is the aria-hidden column of absolutely placed mono spans (one per hour, 0 blank).
  const spans = Array.from(container.querySelectorAll('[aria-hidden="true"] > span'))
    .map((s) => s.textContent ?? '')
    .filter(Boolean);
  unmount();
  return spans;
}

describe('WeekView hour axis', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['es', '12 p. m.', '9 a. m.'],
    ['es-MX', '12 p. m.', '9 a. m.'],
    ['fr-CA', '12 p.m.', '9 a.m.'],
    ['en', '12 PM', '9 AM'],
  ])('%s, 12-hour: noon reads "%s", 9:00 reads "%s"', async (lng, noon, nine) => {
    mockUseHourCycle.mockReturnValue('12h');
    await i18n.changeLanguage(lng);
    const labels = axisLabels();
    expect(labels).toContain(noon);
    expect(labels).toContain(nine);
  });

  it('24-hour: "14", the same hour-only form as mobile', async () => {
    mockUseHourCycle.mockReturnValue('24h');
    await i18n.changeLanguage('de');
    const labels = axisLabels();
    expect(labels).toContain('14');
    expect(labels).toContain('09');
    expect(labels.filter((l) => /Uhr|PM|AM/.test(l))).toEqual([]);
  });

  it('formatHourOfDay matches mobile for midnight-as-24 and both cycles', () => {
    expect(formatHourOfDay(12, '12h', 'es')).toBe('12 p. m.');
    expect(formatHourOfDay(24, '12h', 'en')).toBe('12 AM');
    expect(formatHourOfDay(14, '24h', 'es')).toBe('14');
  });
});
