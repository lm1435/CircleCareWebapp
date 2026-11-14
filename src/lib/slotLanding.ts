// Landing on Today for ONE TIME SLOT (1.4.2 grouped dose alerts).
//
// Contract: `/circles/:id?slot_date=<YYYY-MM-DD>&slot_time=<HH:MM[:SS]>`, built by
// lib/notificationsInbox.ts `slotLandingPath` for `medication_slot_alert` and
// `medication_taken_summary` rows. A slot is one circle, one date and one EXACT
// time in the care recipient's zone (8:00 and 8:05 are two slots).
//
// Today reads it once, finds EVERY dose of the slot that Next up still lists,
// reveals and highlights them all and moves focus to the first one's Taken.
// Each dose keeps its own Taken: there is no "mark all". When none of the
// slot's doses is on Today (all marked already, an older day), Today simply
// stays as it is: no fallback page.

import { isClock, isRealDate } from '@/lib/notificationsInbox';
import type { NextUpItem } from '@/components/overview/nextUpItems';

export interface SlotLanding {
  date: string;
  time: string;
}

export const SLOT_PARAMS = ['slot_date', 'slot_time'] as const;

/** The slot a URL asks for, or null unless BOTH the date and the clock are valid. */
export function parseSlotLanding(search: string): SlotLanding | null {
  const params = new URLSearchParams(search);
  const date = params.get('slot_date');
  const time = params.get('slot_time');
  return isRealDate(date) && isClock(time) ? { date, time } : null;
}

/** True when the URL carries slot params at all (valid or not): they still leave the URL. */
export function hasSlotParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return SLOT_PARAMS.some((key) => params.has(key));
}

/** `search` without the slot params (other params stay), as '?x=y' or ''. */
export function stripSlotParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of SLOT_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

const hhmm = (time: string | null | undefined): string => (time ?? '').slice(0, 5);

/** Every Next up DOSE row of the slot, in list order (same date, same HH:MM). */
export function findSlotItems(items: readonly NextUpItem[], slot: SlotLanding): NextUpItem[] {
  return items.filter(
    (item) =>
      item.type === 'medication' &&
      !!item.med &&
      item.med.scheduled_date === slot.date &&
      hhmm(item.med.scheduled_time) === hhmm(slot.time)
  );
}
