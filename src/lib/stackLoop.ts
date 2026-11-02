import type { MouseEvent } from 'react';

/**
 * Appointment -> doctor's Visits & notes -> that visit -> doctor's Visits & notes ... would push a
 * browser-history entry per tap and Back would walk the whole loop. Each side records where it came
 * FROM in the link's `state`; when the target is that very place the link goes back one entry
 * (`navigate(-1)`) instead of pushing a copy. Modified / non-primary clicks keep native link behavior.
 */

/** Location state the calendar's doctor link leaves on the visits page: the appointment it came from. */
export interface FromEventState {
  id: string;
  date: string;
}

export function readFromEvent(state: unknown): FromEventState | null {
  const v = (state as { fromEvent?: unknown } | null)?.fromEvent as Partial<FromEventState> | undefined;
  return v && typeof v.id === 'string' && typeof v.date === 'string' ? { id: v.id, date: v.date } : null;
}

/** Location state the visits page leaves on the calendar: the doctor whose visits it came from. */
export function readFromProviderId(state: unknown): string | null {
  const v = (state as { fromProviderId?: unknown } | null)?.fromProviderId;
  return typeof v === 'string' ? v : null;
}

export function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
