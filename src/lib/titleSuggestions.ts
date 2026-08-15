// History-based title suggestions (docs/plans/condition-tags.md QP5).
// Pure function — nowMs is ALWAYS a parameter, never Date.now() inside, so
// results are deterministic and tests never depend on the clock. Mirrors
// mobile/src/utils/titleSuggestions.ts (same contract on both platforms).
//
// A title qualifies only when it has been used at least twice. Repetition is
// the whole signal: an earlier `count >= 2 OR used in the last 60 days` rule
// admitted any one-off, which made the strip a recent-items list rather than
// things the circle repeats — and because the source is circle-wide, it
// promoted one member's one-off private shorthand into a chip every other
// member saw on the Add Task form.

export interface TitleSuggestionEvent {
  title: string;
  event_type: string;
  scheduled_date: string; // YYYY-MM-DD (naive, care-recipient local)
}

const MAX_SUGGESTIONS = 6;
/** A title must have been used this many times before it is offered back. */
const MIN_USES_TO_SUGGEST = 2;

/**
 * Parse a naive YYYY-MM-DD as a UTC-midnight epoch. Deterministic regardless
 * of device timezone (never `new Date('YYYY-MM-DD…')` local parsing) — used to
 * rank qualifying titles by recency.
 */
function toEpochMs(scheduledDate: string): number {
  const [y, m, d] = scheduledDate.split('-').map(Number);
  if (!y || !m || !d) return Number.NEGATIVE_INFINITY;
  return Date.UTC(y, m - 1, d);
}

interface TitleGroup {
  /** Original casing of the most recent occurrence. */
  display: string;
  count: number;
  /** Epoch ms of the most recent occurrence. */
  latest: number;
}

/**
 * Derive up to 6 title suggestions for an event type from the circle's own
 * event history:
 * - only events of `eventType` with a non-empty title count;
 * - case-insensitive dedupe (original casing of the most recent use wins);
 * - a title qualifies only when used >= 2 times;
 * - ranked by frequency desc, then recency desc;
 * - padded with `generics` (skipping case-insensitive duplicates) up to 6.
 */
export function deriveTitleSuggestions(
  events: Array<{ title: string; event_type: string; scheduled_date: string }>,
  eventType: string,
  /** Retained for signature parity with mobile and for callers already passing
   *  it. Recency now only ranks qualifying titles, so this no longer affects
   *  which titles are admitted. */
  _nowMs: number,
  generics: string[]
): string[] {
  const groups = new Map<string, TitleGroup>();

  for (const event of events) {
    if (event.event_type !== eventType) continue;
    const title = (event.title ?? '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    const occurredAt = toEpochMs(event.scheduled_date);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (occurredAt >= group.latest) {
        group.latest = occurredAt;
        group.display = title;
      }
    } else {
      groups.set(key, { display: title, count: 1, latest: occurredAt });
    }
  }

  const qualified = [...groups.values()].filter(
    (group) => group.count >= MIN_USES_TO_SUGGEST
  );
  qualified.sort((a, b) => b.count - a.count || b.latest - a.latest);

  const result = qualified.slice(0, MAX_SUGGESTIONS).map((group) => group.display);
  const used = new Set(result.map((title) => title.toLowerCase()));

  for (const generic of generics) {
    if (result.length >= MAX_SUGGESTIONS) break;
    const trimmed = generic.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || used.has(key)) continue;
    used.add(key);
    result.push(trimmed);
  }

  return result;
}
