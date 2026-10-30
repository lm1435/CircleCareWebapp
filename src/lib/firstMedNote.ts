import { scopedKey } from '@/lib/storageScope';

/**
 * The local "first med" note behind Today's "Tomorrow" row with the "Already given today?
 * Mark it" line (onboarding 1.3.1, spec section 1). Written when a user's FIRST medication
 * was saved from the add menu and its start rolled to the next dose; read by Today.
 *
 * localStorage, namespaced per signed-in user (scopedKey), keyed per circle, carrying the
 * event id. EXPIRES AT THE END OF THE RECIPIENT'S DAY: it stores the recipient-zone date it
 * was written on, and a read on any other recipient-zone date drops it. Non-sensitive UI
 * state: the medication NAME is kept so the row can render before the events load, and
 * never leaves the browser (no analytics).
 */
export interface FirstMedNote {
  eventId: string;
  name: string;
  dosage: string;
  /** Primary dose time, recipient frame, HH:MM:SS (the confirm body's scheduled_time). */
  time: string;
  /** Recipient-zone date the note was written on (its day of validity). */
  day: string;
  /** The server start date of the medication (> day while the start is rolled). */
  startDate: string;
  /** Set once "Mark it" succeeded: Today then shows the Taken state. */
  marked: boolean;
}

const BASE = 'cc:firstMedNote';

const key = (circleId: string): string => scopedKey(`${BASE}:${circleId}`);

export function writeFirstMedNote(circleId: string, note: FirstMedNote): void {
  try {
    window.localStorage.setItem(key(circleId), JSON.stringify(note));
  } catch {
    // Storage unavailable: the Today row simply does not appear.
  }
}

function isNote(v: unknown): v is FirstMedNote {
  if (!v || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.eventId === 'string' &&
    typeof n.name === 'string' &&
    typeof n.dosage === 'string' &&
    typeof n.time === 'string' &&
    typeof n.day === 'string' &&
    typeof n.startDate === 'string' &&
    typeof n.marked === 'boolean'
  );
}

/** The live note for `circleId`, or null (absent, corrupt, or from another recipient day). */
export function readFirstMedNote(circleId: string, recipientToday: string): FirstMedNote | null {
  try {
    const raw = window.localStorage.getItem(key(circleId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isNote(parsed)) return null;
    if (parsed.day !== recipientToday) {
      window.localStorage.removeItem(key(circleId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function markFirstMedNoteMarked(circleId: string, recipientToday: string): void {
  const note = readFirstMedNote(circleId, recipientToday);
  if (note) writeFirstMedNote(circleId, { ...note, marked: true });
}

export function clearFirstMedNote(circleId: string): void {
  try {
    window.localStorage.removeItem(key(circleId));
  } catch {
    // nothing to do
  }
}
