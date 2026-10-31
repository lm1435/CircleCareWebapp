/**
 * An edit whose stored time lands on the SECOND reading of a wall clock the viewer's browser repeats
 * (fall-back) must save back unchanged. The Date constructor names the first reading, so without the
 * held instant an untouched save moved the dose an hour early (Pago Pago 21:00 on 2026-10-31 from Denver).
 * The browser zone is the process zone (TZ); the fall-back is discovered at runtime.
 */
import { describe, expect, it } from 'vitest';
import { eventDatesForApi, eventDatesFromApi, viewerInstant } from '@/utils/recipientEventDate';

function viewerFallBack(): { second: Date; first: Date } | null {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60000) {
    const before = new Date(t).getTimezoneOffset();
    const after = new Date(t + 15 * 60000).getTimezoneOffset();
    if (after > before) {
      let at = t + 15 * 60000;
      while (new Date(at - 60000).getTimezoneOffset() === after) at -= 60000;
      return { second: new Date(at), first: new Date(at - (after - before) * 60000) };
    }
  }
  return null;
}
const FALL = viewerFallBack();
const ZONES = ['Etc/GMT-14', 'Etc/GMT-8', 'Etc/GMT', 'Etc/GMT+11', 'Asia/Kolkata', 'Pacific/Pago_Pago', 'Europe/London'];
const wire = (instant: Date, zone: string) => {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', ...o }).format(instant);
  return { date: f({ year: 'numeric', month: '2-digit', day: '2-digit' }), time: f({ hour: '2-digit', minute: '2-digit' }) };
};

describe('the viewer\'s repeated hour', () => {
  it('an untouched edit on the second reading saves the stored pair back (and did not without the held instant)', () => {
    if (!FALL) return; // no fall-back in this browser zone: no repeated hour
    let lostCount = 0;
    for (const zone of ZONES) {
      const stored = wire(FALL.second, zone);
      const h = eventDatesFromApi({ scheduledDate: stored.date, scheduledTime: stored.time, timezone: zone });
      expect(h.instant?.getTime()).toBe(FALL.second.getTime());
      const back = eventDatesForApi({ dateStr: h.dateStr, timeStr: h.timeStr, recurrenceEndDateStr: null, timezone: zone, heldInstant: h.instant });
      expect({ date: back.scheduledDate, time: back.scheduledTime }).toEqual(stored);
      // FALSIFIER: the same fields without the held instant land on the first reading. (A recipient that
      // falls back at the same instant - London for a London browser - reads both the same, so count.)
      const lost = eventDatesForApi({ dateStr: h.dateStr, timeStr: h.timeStr, recurrenceEndDateStr: null, timezone: zone });
      if (lost.scheduledTime !== stored.time) lostCount++;
    }
    expect(lostCount).toBeGreaterThan(0);
  });

  it('a held instant changes nothing once a field moves, and nothing outside a repeated hour (3 days, every 5 min)', () => {
    const centre = FALL ? FALL.second.getTime() : Date.UTC(2026, 10, 1, 8);
    const pad = (n: number) => String(n).padStart(2, '0');
    let checked = 0;
    for (let t = centre - 36 * 3600000; t <= centre + 36 * 3600000; t += 5 * 60000) {
      const held = new Date(t);
      const dateStr = `${held.getFullYear()}-${pad(held.getMonth() + 1)}-${pad(held.getDate())}`;
      const timeStr = `${pad(held.getHours())}:${pad(held.getMinutes())}`;
      const built = viewerInstant(dateStr, timeStr);
      const inRepeat = !!FALL && t >= FALL.second.getTime() && t < 2 * FALL.second.getTime() - FALL.first.getTime();
      if (!inRepeat) {
        expect(viewerInstant(dateStr, timeStr, held).getTime()).toBe(built.getTime());
        checked++;
      }
      const other = timeStr === '10:00' ? '11:00' : '10:00';
      expect(viewerInstant(dateStr, other, held).getTime()).toBe(viewerInstant(dateStr, other).getTime());
    }
    expect(checked).toBeGreaterThan(800);
  });
});
