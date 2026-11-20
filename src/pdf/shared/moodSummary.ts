/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */
import type { PdfCareNoteMood, PdfMoodBucket, PdfMoodNote, PdfMoodSummary } from './types';

/** Display order: best → hardest. */
export const PDF_CARE_NOTE_MOODS: readonly PdfCareNoteMood[] = ['great', 'good', 'okay', 'tough'];

/** `GET /circles/:id/care-notes` rejects a window longer than this (inclusive days). */
export const MOOD_NOTES_MAX_WINDOW_DAYS = 92;

/** Periods up to this long are bucketed by week; longer ones by 30-day blocks. */
const WEEKLY_BUCKET_MAX_PERIOD_DAYS = 92;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → UTC ms, or null for a malformed / calendar-invalid date. Pure
 *  UTC math on the string: never the device's or the server's local time. */
function parseDay(day: string): number | null {
  if (typeof day !== 'string' || !DATE_RE.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function emptyCounts(): Record<PdfCareNoteMood, number> {
  return { great: 0, good: 0, okay: 0, tough: 0 };
}

function isKnownMood(mood: unknown): mood is PdfCareNoteMood {
  return typeof mood === 'string' && (PDF_CARE_NOTE_MOODS as readonly string[]).includes(mood);
}

/**
 * Split an inclusive start..end period into consecutive, NON-overlapping
 * windows of at most `maxDays` days each, oldest first, so a long report
 * ("All time") can read its care notes without tripping the endpoint's window
 * cap. Returns [] for a malformed or inverted range.
 */
export function moodNoteWindows(
  startDate: string,
  endDate: string,
  maxDays: number = MOOD_NOTES_MAX_WINDOW_DAYS
): Array<{ from: string; to: string }> {
  const startMs = parseDay(startDate);
  const endMs = parseDay(endDate);
  const span = Math.floor(maxDays);
  if (startMs === null || endMs === null || startMs > endMs || !(span >= 1)) return [];
  const windows: Array<{ from: string; to: string }> = [];
  for (let from = startMs; from <= endMs; from += span * DAY_MS) {
    const to = Math.min(from + (span - 1) * DAY_MS, endMs);
    windows.push({ from: formatDay(from), to: formatDay(to) });
  }
  return windows;
}

/**
 * Collapse a period's Daily Care Notes into the adherence report's "Day
 * ratings" section: how many notes were rated great / good / okay / tough, in
 * total and per block of days, and which days had a tough note.
 *
 * COUNTS ARE PER NOTE, not per day: two caregivers who each rate the same day
 * are two ratings, exactly as the Notes tab shows them.
 *
 * Returns `undefined` — the section does not print at all — when the range is
 * malformed or no note in it carries a known mood. A note outside
 * start..end (inclusive), with no mood, with a mood this build does not know,
 * or already seen under the same `id`, is ignored.
 */
export function computeMoodSummary(
  notes: PdfMoodNote[],
  startDate: string,
  endDate: string
): PdfMoodSummary | undefined {
  const startMs = parseDay(startDate);
  const endMs = parseDay(endDate);
  if (startMs === null || endMs === null || startMs > endMs || !Array.isArray(notes)) return undefined;

  const periodDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  const bucketDays = periodDays <= WEEKLY_BUCKET_MAX_PERIOD_DAYS ? 7 : 30;

  // ANCHORED AT THE END DATE. Blocks are counted back from the last day of the
  // period, so the most recent block — the one a clinician reads first — is
  // always a full one, and any short remainder is the OLDEST block. Anchored at
  // the start, a 30-day report ended on a 2-day block that read as a drop.
  const buckets: PdfMoodBucket[] = [];
  for (let to = endMs; to >= startMs; to -= bucketDays * DAY_MS) {
    const from = Math.max(to - (bucketDays - 1) * DAY_MS, startMs);
    buckets.unshift({ start: formatDay(from), end: formatDay(to), counts: emptyCounts() });
  }

  const counts = emptyCounts();
  const seenIds = new Set<string>();
  const ratedDays = new Set<string>();
  const toughDays = new Set<string>();
  let ratedNotes = 0;

  for (const note of notes) {
    if (!note || !isKnownMood(note.mood)) continue;
    const dayMs = parseDay(note.note_date);
    if (dayMs === null || dayMs < startMs || dayMs > endMs) continue;
    if (note.id != null) {
      if (seenIds.has(note.id)) continue;
      seenIds.add(note.id);
    }
    counts[note.mood] += 1;
    ratedNotes += 1;
    ratedDays.add(note.note_date);
    if (note.mood === 'tough') toughDays.add(note.note_date);
    const blocksFromEnd = Math.floor((endMs - dayMs) / (bucketDays * DAY_MS));
    buckets[buckets.length - 1 - blocksFromEnd].counts[note.mood] += 1;
  }

  if (ratedNotes === 0) return undefined;

  return {
    counts,
    ratedNotes,
    ratedDays: ratedDays.size,
    periodDays,
    buckets,
    toughDays: Array.from(toughDays).sort(),
  };
}

/** Beyond this many windows (about two years) the section is skipped rather
 *  than reading years of notes to print one table. */
export const MOOD_NOTES_MAX_WINDOWS = 8;

/**
 * Read a period's care notes through the caller's `fetchWindow` and summarise
 * their moods. Both apps' export hooks call this, so the rules are one place:
 *
 * - ONE REQUEST AT A TIME, oldest window first. An "All time" report on a long
 *   lived circle would otherwise fire a dozen parallel reads of full notes.
 * - ALL WINDOWS OR NOTHING. A window that throws, or answers with anything but
 *   an array, drops the whole section: a partial read would undercount.
 * - NEVER THROWS. The report must export without the section.
 * - ONLY id / note_date / mood are kept. A note's body goes no further.
 */
export async function loadMoodSummary(
  fetchWindow: (from: string, to: string) => Promise<readonly PdfMoodNote[] | null | undefined>,
  startDate: string,
  endDate: string
): Promise<PdfMoodSummary | undefined> {
  try {
    const windows = moodNoteWindows(startDate, endDate);
    if (windows.length === 0 || windows.length > MOOD_NOTES_MAX_WINDOWS) return undefined;
    const moodNotes: PdfMoodNote[] = [];
    for (const w of windows) {
      const notes = await fetchWindow(w.from, w.to);
      if (!Array.isArray(notes)) return undefined;
      for (const n of notes) {
        if (n) moodNotes.push({ id: n.id, note_date: n.note_date, mood: n.mood });
      }
    }
    return computeMoodSummary(moodNotes, startDate, endDate);
  } catch {
    return undefined;
  }
}
