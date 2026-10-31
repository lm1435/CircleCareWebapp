import {
  findLandingItem,
  landingFallbackPath,
  parseDoseLanding,
  stripLandingParams,
} from '@/lib/doseLanding';
import type { NextUpItem } from '@/components/overview/nextUpItems';

const DOSE = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-10-29';

function row(id: string, over: Partial<NonNullable<NextUpItem['med']>> = {}): NextUpItem {
  return {
    key: `medication:${id}`,
    type: 'medication',
    id,
    title: id,
    detail: null,
    time: '08:00:00',
    date: DATE,
    late: false,
    lateHours: null,
    med: { id, event_type: 'medication', title: id, scheduled_date: DATE, scheduled_time: '08:00:00', ...over } as NextUpItem['med'],
  };
}

describe('parseDoseLanding', () => {
  it('reads dose, date and time', () => {
    expect(parseDoseLanding(`?dose=${DOSE}&date=${DATE}&time=08:00:00`)).toEqual({
      dose: DOSE,
      date: DATE,
      time: '08:00:00',
    });
  });
  it('needs a uuid dose; drops a bad date or time', () => {
    expect(parseDoseLanding('?dose=nope')).toBeNull();
    expect(parseDoseLanding('')).toBeNull();
    expect(parseDoseLanding(`?dose=${DOSE}&date=2026-13-40&time=8am`)).toEqual({
      dose: DOSE,
      date: null,
      time: null,
    });
  });
});

describe('stripLandingParams / landingFallbackPath', () => {
  it('removes only dose/date/time', () => {
    expect(stripLandingParams(`?dose=${DOSE}&date=${DATE}&time=08:00`)).toBe('');
    expect(stripLandingParams(`?x=1&dose=${DOSE}`)).toBe('?x=1');
  });
  it('falls back to the calendar sheet, with or without a date', () => {
    expect(landingFallbackPath('c1', { dose: DOSE, date: DATE, time: null })).toBe(
      `/circles/c1/calendar?date=${DATE}&eventId=${DOSE}`
    );
    expect(landingFallbackPath('c1', { dose: DOSE, date: null, time: null })).toBe(
      `/circles/c1/calendar?eventId=${DOSE}`
    );
  });
});

describe('findLandingItem (tolerant like matchPushEvent)', () => {
  it('matches the row id on the date', () => {
    const items = [row('other'), row(DOSE)];
    expect(findLandingItem(items, { dose: DOSE, date: DATE, time: null })?.id).toBe(DOSE);
  });
  it('does not match the right id on another date', () => {
    expect(findLandingItem([row(DOSE, { scheduled_date: '2026-10-28' })], { dose: DOSE, date: DATE, time: null })).toBeNull();
  });
  it('matches a virtual instance and a child addressed by its series root', () => {
    expect(findLandingItem([row(`${DOSE}_${DATE}`)], { dose: DOSE, date: DATE, time: null })?.id).toBe(`${DOSE}_${DATE}`);
    expect(findLandingItem([row('child', { parent_event_id: DOSE })], { dose: DOSE, date: DATE, time: null })?.id).toBe('child');
  });
  it('several matches: the time breaks the tie (HH:MM)', () => {
    const items = [
      row('a', { parent_event_id: DOSE, scheduled_time: '08:00:00' }),
      row('b', { parent_event_id: DOSE, scheduled_time: '20:00:00' }),
    ];
    expect(findLandingItem(items, { dose: DOSE, date: DATE, time: '20:00' })?.id).toBe('b');
    expect(findLandingItem(items, { dose: DOSE, date: DATE, time: null })?.id).toBe('a');
  });
  it('without a date, the id or the series root is enough', () => {
    expect(findLandingItem([row(DOSE)], { dose: DOSE, date: null, time: null })?.id).toBe(DOSE);
  });
  it('ignores tasks and appointments', () => {
    const task = { ...row(DOSE), type: 'task' as const, med: undefined };
    expect(findLandingItem([task], { dose: DOSE, date: DATE, time: null })).toBeNull();
  });
});
