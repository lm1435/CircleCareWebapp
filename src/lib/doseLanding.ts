// Landing on Today for ONE dose (inbox rows for a dose that is not marked yet).
//
// Contract: `/circles/:id?dose=<eventId>&date=<YYYY-MM-DD>&time=<HH:MM[:SS]>`
// (lib/notificationsInbox.ts resolveInboxDestination builds it). Today reads it
// once, finds the dose in Next up, scrolls to it, highlights it and moves focus
// to its Taken button; when the dose is not on Today it falls back to the
// calendar's event sheet (`/calendar?date=&eventId=`), which offers Taken / Skip.
//
// Pure helpers, so the parsing and the tolerant match are testable without a render.

import { isClock, isRealDate, isUuid } from '@/lib/notificationsInbox';
import type { NextUpItem } from '@/components/overview/nextUpItems';

export interface DoseLanding {
  /** The dose's calendar event id (a row id, a virtual-instance root or a series root). */
  dose: string;
  /** YYYY-MM-DD in the care recipient's zone, when the link carried one. */
  date: string | null;
  /** HH:MM[:SS], when the link carried one. */
  time: string | null;
}

export const LANDING_PARAMS = ['dose', 'date', 'time'] as const;

/** The landing a URL asks for, or null when there is no (valid) dose. Bad date/time are dropped. */
export function parseDoseLanding(search: string): DoseLanding | null {
  const params = new URLSearchParams(search);
  const dose = params.get('dose');
  if (!isUuid(dose)) return null;
  const date = params.get('date');
  const time = params.get('time');
  return {
    dose,
    date: isRealDate(date) ? date : null,
    time: isClock(time) ? time : null,
  };
}

/** `search` without dose/date/time (other params stay), as a '?x=y' string or ''. */
export function stripLandingParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of LANDING_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** The calendar's event sheet for this dose: the fallback when Today does not list it. */
export function landingFallbackPath(circleId: string, landing: DoseLanding): string {
  const params = new URLSearchParams();
  if (landing.date) params.set('date', landing.date);
  params.set('eventId', landing.dose);
  return `/circles/${circleId}/calendar?${params.toString()}`;
}

const hhmm = (time: string | null | undefined): string => (time ?? '').slice(0, 5);

/**
 * The Next up dose row a landing meant. Tolerant like mobile's `matchPushEvent`:
 * the row's own id, a virtual instance (`<root>_<date>`), or a physical child
 * addressed by its series root. With several matches, the one at `time` wins.
 */
export function findLandingItem(
  items: readonly NextUpItem[],
  landing: DoseLanding
): NextUpItem | null {
  const { dose, date, time } = landing;
  const matches = items.filter((item) => {
    const med = item.med;
    if (item.type !== 'medication' || !med) return false;
    if (!date) return med.id === dose || med.parent_event_id === dose;
    return (
      (med.id === dose && med.scheduled_date === date) ||
      med.id === `${dose}_${date}` ||
      (med.parent_event_id === dose && med.scheduled_date === date)
    );
  });
  if (matches.length === 0) return null;
  if (time && matches.length > 1) {
    const exact = matches.find((item) => hhmm(item.med?.scheduled_time) === hhmm(time));
    if (exact) return exact;
  }
  return matches[0];
}
