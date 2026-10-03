/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */

/**
 * Which medications a printed care summary lists, and in what order.
 *
 * Extracted from mobile's EmergencyInfoScreen so the screen, the mobile PDF
 * and the web PDF all print the SAME three lists from the same events:
 *
 *   - `active`  — one row per recurring medication series that is not stopped
 *                 and has not run past its `recurrence_end_date`;
 *   - `recent`  — one-time medications scheduled within the lookback window
 *                 that were not stopped;
 *   - `stopped` — one row per series stopped within the lookback window (the
 *                 stop instant resolved to a calendar day in the CARE
 *                 RECIPIENT's zone), newest stop first.
 *
 * Every date bound is a naive `YYYY-MM-DD` string stepped as a STRING — never
 * an instant shifted by 24h multiples, which drifts a day across DST.
 */

// Deliberately NOT `./types`' `PdfCalendarEvent`: that is the shape the
// TEMPLATE reads (title, dosage, time). Selection needs the identity fields
// (`id`, `parent_event_id`, `event_type`, `recurrence_end_date`) that the
// template never touches. Both apps' API event types satisfy this without casts.
export interface CareSummaryMedicationEvent {
  id: string;
  parent_event_id?: string | null;
  event_type: string;
  recurrence_rule?: string | null;
  /** Naive `YYYY-MM-DD` in the care recipient's zone. */
  recurrence_end_date?: string | null;
  /** Real UTC instant (ISO string) at which the series was stopped. */
  discontinued_at?: string | null;
  /** Naive `YYYY-MM-DD` in the care recipient's zone. */
  scheduled_date: string;
}

/** How far back the summary looks for one-time and stopped medications. */
export const CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS = 30;

export interface StoppedMedication<E extends CareSummaryMedicationEvent> {
  event: E;
  /** The EARLIEST `discontinued_at` seen on the series — when it actually stopped.
   *  For a series ENDED via "This and future" (no `discontinued_at`) this is
   *  `endedOn` at noon UTC, only so the list stays sortable: read `endedOn` first. */
  stoppedAt: string;
  /**
   * PK26: set only for a series that ended through its `recurrence_end_date`
   * (naive `YYYY-MM-DD`, recipient frame). That date IS the stop date — print it
   * as is, never resolve `stoppedAt` through a zone (a different day in Kiritimati).
   */
  endedOn?: string;
}

export interface SelectCareSummaryMedicationsOptions {
  /** "What day is it for the care recipient", already resolved in their zone. */
  todayStr: string;
  /**
   * Lower bound (inclusive, `YYYY-MM-DD`) for one-time and stopped meds.
   * Defaults to `todayStr` stepped back `CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS`.
   */
  cutoffStr?: string;
  careRecipientTimezone: string;
  /** Resolves an instant to a `YYYY-MM-DD` in the given IANA zone. */
  getDateInTimezone: (timezone: string, date?: Date) => string;
  /** Clock used for the `recurrence_end_date` comparison. Defaults to `new Date()`. */
  now?: Date;
}

export interface CareSummaryMedicationSelection<E extends CareSummaryMedicationEvent> {
  active: E[];
  recent: E[];
  stopped: StoppedMedication<E>[];
  /**
   * The flat list the PDF receives: active, then recent, then stopped — with
   * each stopped event carrying `discontinued_at: stoppedAt` so the template
   * can label it from the event alone.
   */
  forExport: E[];
  /** Stopped SERIES key (`parent_event_id || id`) → earliest stop instant. */
  stoppedSeriesMap: Map<string, string>;
}

/**
 * Add `days` to a `YYYY-MM-DD` string → new `YYYY-MM-DD`.
 *
 * Pure calendar arithmetic through `Date.UTC`, so the host zone and any DST
 * transition inside the span are irrelevant: stepping a naive date is the
 * only safe way to derive "30 days ago" for a recipient in an arbitrary zone.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days, 12));
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Has this series run past its `recurrence_end_date`? THE one definition of an
 * "ended" medication series, shared by the Care Summary (below) and the Meds
 * roster on both apps (mobile MedicationHistoryScreen, web MedicationsPage) so
 * the printout and the roster can never disagree about whether a medication is
 * still current. A series ended with "This and future" gets a
 * `recurrence_end_date` and NO `discontinued_at`, so it is only recognisable
 * through this check.
 *
 * KNOWN CAVEAT, kept on purpose so every surface agrees: this measures a naive
 * recipient-frame `recurrence_end_date` against a real INSTANT, so a series
 * "ends" at noon UTC on that day (8am in New York, a different DAY in
 * Auckland). Changing it changes the PDF's output and needs its own cases.
 */
export function isMedicationSeriesEnded(
  event: { recurrence_end_date?: string | null },
  now: Date = new Date()
): boolean {
  return !!event.recurrence_end_date && new Date(event.recurrence_end_date + 'T12:00:00Z') < now;
}

function seriesKey(e: CareSummaryMedicationEvent): string {
  return e.parent_event_id || e.id;
}

/**
 * Stopped medication SERIES → the instant they were stopped.
 *
 * A stopped medication must never sit in the current-medication list, but it
 * must not vanish either: a drug stopped three days ago is often exactly what
 * a first responder needs (warfarin still drives bleeding risk, a just-ended
 * antibiotic course still drives interactions). It moves to "Recent" instead,
 * labelled with its stop date, so it can never be read as current.
 *
 * Collected per SERIES because a persisted child is filtered server-side by a
 * stop instant it INHERITS from its parent but is returned with its own column
 * untouched — so one occurrence carrying the stamp stops the whole series. The
 * EARLIEST stamp wins: that is when the medication actually stopped.
 */
export function collectStoppedSeries<E extends CareSummaryMedicationEvent>(
  events: readonly E[]
): Map<string, string> {
  const stopped = new Map<string, string>();
  for (const e of events) {
    if (e.event_type === 'medication' && e.discontinued_at) {
      const key = seriesKey(e);
      const prev = stopped.get(key);
      if (!prev || e.discontinued_at < prev) stopped.set(key, e.discontinued_at);
    }
  }
  return stopped;
}

export function selectCareSummaryMedications<E extends CareSummaryMedicationEvent>(
  events: readonly E[] | null | undefined,
  options: SelectCareSummaryMedicationsOptions
): CareSummaryMedicationSelection<E> {
  const list: readonly E[] = events ?? [];
  const cutoff =
    options.cutoffStr ?? addDaysToDateString(options.todayStr, -CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS);
  const now = options.now ?? new Date();
  const { careRecipientTimezone, getDateInTimezone } = options;

  const stoppedSeriesMap = collectStoppedSeries(list);

  // Active medications: recurring meds, deduped by series.
  // The parent row is only returned when its scheduled_date is within the query
  // window, so we can't rely on !parent_event_id. Instead, deduplicate by
  // parent_event_id || id so each medication series appears exactly once.
  const seen = new Set<string>();
  const active = list.filter((e) => {
    if (e.event_type !== 'medication' || !e.recurrence_rule) return false;
    // LEFT ALONE DELIBERATELY, and reported rather than smuggled in: this
    // measures a naive recipient-frame `recurrence_end_date` against a real
    // INSTANT (so a series "ends" at noon UTC, which is 8am in New York and a
    // different DAY in Auckland). Fixing it changes behaviour and needs its own
    // cases; both surfaces must keep printing the same list until then.
    if (isMedicationSeriesEnded(e, now)) return false;
    const key = seriesKey(e);
    if (stoppedSeriesMap.has(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Recent one-time medications (within the lookback window).
  const recent = list.filter(
    (e) =>
      e.event_type === 'medication' &&
      !e.recurrence_rule &&
      !e.parent_event_id &&
      // Stopped one-time meds are not dropped — they move to the stopped list
      // below so they carry a stop date instead of reading as simply "taken".
      !e.discontinued_at &&
      e.scheduled_date >= cutoff
  );

  // Recently STOPPED medications, one row per series, newest stop first.
  // Bounded by the same cutoff so a medication stopped long ago does not crowd
  // the page a paramedic is scanning. `discontinued_at` is a real UTC instant,
  // so it is resolved to a calendar day in the CARE RECIPIENT's zone before it
  // is compared — otherwise a late-evening stop reads as the next day.
  const byKey = new Map<string, E>();
  for (const e of list) {
    if (e.event_type !== 'medication') continue;
    const key = seriesKey(e);
    if (!stoppedSeriesMap.has(key) || byKey.has(key)) continue;
    byKey.set(key, e);
  }
  const discontinuedStopped: StoppedMedication<E>[] = Array.from(byKey.entries())
    .map(([key, event]) => ({ event, stoppedAt: stoppedSeriesMap.get(key)! }))
    .filter(({ stoppedAt }) => getDateInTimezone(careRecipientTimezone, new Date(stoppedAt)) >= cutoff);

  // PK26: a course ended with "This and future" has a `recurrence_end_date` and NO
  // `discontinued_at`, so the walk above never saw it — it was in neither list. It is
  // exactly the just-ended antibiotic course the stopped list exists for, so it joins
  // "Recently stopped" with its end date as the stop date. Same "ended" definition as the
  // roster (`isMedicationSeriesEnded`); a series that is ALSO discontinued stays with the
  // discontinued walk. One row per series; bounded by the same cutoff.
  const endedSeen = new Set<string>();
  const endedStopped: StoppedMedication<E>[] = [];
  for (const e of list) {
    if (e.event_type !== 'medication' || !e.recurrence_rule || !e.recurrence_end_date) continue;
    if (!isMedicationSeriesEnded(e, now)) continue;
    const key = seriesKey(e);
    if (stoppedSeriesMap.has(key) || endedSeen.has(key)) continue;
    if (e.recurrence_end_date < cutoff) continue;
    endedSeen.add(key);
    endedStopped.push({
      event: e,
      stoppedAt: `${e.recurrence_end_date}T12:00:00Z`,
      endedOn: e.recurrence_end_date,
    });
  }

  // Newest stop first, by the stop DAY in the recipient's frame (ties: the instant).
  const stopDay = (m: StoppedMedication<E>): string =>
    m.endedOn ?? getDateInTimezone(careRecipientTimezone, new Date(m.stoppedAt));
  const stopped = [...discontinuedStopped, ...endedStopped].sort(
    (a, b) => stopDay(b).localeCompare(stopDay(a)) || b.stoppedAt.localeCompare(a.stoppedAt)
  );

  // Carried into the PDF too — a paramedic reading the printout needs the
  // same stopped-medication history the screen shows. `discontinued_at`
  // rides along on the event, and the PDF labels it from that.
  const forExport: E[] = [
    ...active,
    ...recent,
    // An ended course keeps NO `discontinued_at` (it was never discontinued): the
    // template recognises it by its `recurrence_end_date` and prints that date.
    ...stopped.map(({ event, stoppedAt, endedOn }) =>
      endedOn ? event : { ...event, discontinued_at: stoppedAt }
    ),
  ];

  return { active, recent, stopped, forExport, stoppedSeriesMap };
}
