/**
 * How an entry was added (release 1.2.3): backend `calendar_events.entry_source`.
 *
 *   'voice'  dictated with voice add        (mobile only)
 *   'scan'   filled from a photo of a label (mobile only)
 *   'form'   typed into the add form
 *
 * Sent ONCE, on create; the backend ignores it on an edit. An entry saved
 * before this was recorded has none (null / absent = unknown).
 *
 * WHY IT IS RECORDED: so the care circle can see it. The detail view of a
 * medication, appointment or task says "Added by voice" when the entry was
 * dictated (`isAddedByVoice`, `EntrySourceNote`), on web and on mobile alike.
 * 'scan' and 'form' are stored and shown nowhere.
 *
 * Mirror of mobile/src/utils/entrySource.ts.
 */

export const ENTRY_SOURCES = ['form', 'scan', 'voice'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** What every create from the web app sends: the web has no voice add and no label scan. */
export const WEB_ENTRY_SOURCE: EntrySource = 'form';

/** True only for an entry saved by voice; unknown, 'form' and 'scan' show nothing. */
export function isAddedByVoice(
  event: { entry_source?: string | null } | null | undefined,
): boolean {
  return event?.entry_source === 'voice';
}
