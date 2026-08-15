import type { CalendarEvent } from '@/api/calendarEvents';

// PORT of mobile/src/utils/medicationGrouping.ts (verbatim semantics). The web
// Medications page and DiscontinueMedDialog group/act on medications with these
// exact keys so mobile and web always agree on what "one medication" is.

/**
 * Composite grouping key for a medication: name + dosage, normalized.
 *
 * Same name + same dosage (at any number of scheduled times / series) is ONE
 * medication. Same name + a DIFFERENT dosage is a separate medication. This is
 * the key the Medications page groups/dedups by, and the key discontinue/
 * reactivate act on so all series of one medication toggle together.
 *
 * Internal whitespace is REMOVED (not just collapsed) before lowercasing so
 * "10mg", "10 mg", and "10  mg" all normalize to the same dose — otherwise one
 * real medication splits into two cards (the "discontinue one, the other stays
 * active" confusion). Removal (vs collapse-to-single-space) is required because
 * "10mg" (no space) and "10 mg" (one space) must match.
 */
const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

export function getMedKey(
  event: Pick<CalendarEvent, 'medication_name' | 'title' | 'medication_dosage'>
): string {
  const name = normalize(event.medication_name || event.title || '');
  const dose = normalize(event.medication_dosage || '');
  return `${name}|${dose}`;
}

/**
 * Series-root id for a single event: the parent series root when the event is a
 * child/virtual instance, otherwise its own id. Discontinue/reactivate target
 * the root (the backend also resolves the root from any child id).
 */
export function getSeriesRoot(event: Pick<CalendarEvent, 'id' | 'parent_event_id'>): string {
  return event.parent_event_id ?? event.id;
}

/**
 * All DISTINCT series roots for every `medication` event in `allEvents` whose
 * med key (name + dosage) matches `medEvent`. Used to discontinue/reactivate
 * every series (e.g. an 08:00 series AND a 20:00 series of the same med at the
 * same dose) in one action.
 *
 * The tapped event's own root is always included, so a single-series or
 * non-recurring med still works even when `allEvents` is missing or partial.
 */
export function getSeriesRootsForMed(
  allEvents: CalendarEvent[] | undefined,
  medEvent: CalendarEvent
): string[] {
  const targetKey = getMedKey(medEvent);
  const roots = new Set<string>();
  roots.add(getSeriesRoot(medEvent));
  (allEvents || []).forEach((e) => {
    if (e.event_type !== 'medication') return;
    if (getMedKey(e) !== targetKey) return;
    roots.add(getSeriesRoot(e));
  });
  return Array.from(roots);
}
