import type { CreateEventRequest } from '@/api/calendarEvents';
import { eventDatesForApi, viewerInstant } from '@/utils/recipientEventDate';
import {
  FIRST_RUN_SCHEDULE_PRESETS,
  buildFirstRunMedication,
  buildSiblingDoseRequests,
  firstRunPresetTimes,
  isFirstRunDosePastDue,
  recurrenceForCreate,
  requiresFullForm,
  viewerToday,
} from '../firstRunMedication';

/**
 * THE PAYLOAD CONTRACT for the first-run wizard.
 *
 * NOT ONE ASSERTION HERE MAY DEPEND ON THE RUNNER'S TIMEZONE, and that is not a
 * style rule — `npm test` pins no TZ while `scripts/run-unit-timezones.sh`
 * re-runs this suite under ten of them, and the dev machine is America/Denver.
 * Mobile's twin of this file carries a comment recording that ONE of its tests
 * was wrong three times in a row, each time in a way that passed on the dev
 * machine and nowhere else:
 *
 *   1. a bare date-shape regex — matched correct and buggy values alike;
 *   2. a pinned literal '2026-09-02' — failed under UTC and Asia/Tokyo;
 *   3. "two far-apart zones must disagree" — false, because from some runner
 *      zones the instant lands where Auckland, Honolulu AND the runner share a
 *      date, so a device-zone implementation satisfied both expectations.
 *
 * So every timezone expectation below is DERIVED for whatever instant this
 * runner produces, never hardcoded — or pinned to a fixed `now` in a fixed
 * recipient zone, where the runner plays no part at all.
 */

const BASE = {
  name: '  Metformin  ',
  dosage: '500mg',
  presetKey: 'twiceDaily' as const,
  customTime: null,
  recurrence: 'daily' as const,
  timezone: 'America/New_York',
  todayStr: '2026-09-01',
};

/** The wire body the API actually receives — `undefined` keys do not survive. */
function onTheWire(payload: CreateEventRequest): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

describe('buildFirstRunMedication', () => {
  // ── RULE 3 ────────────────────────────────────────────────────────────────
  it('sets title from the trimmed name, matching AddEventModal trimmedTitle', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect(primary.title).toBe('Metformin');
    expect(primary.medication_name).toBe('Metformin');
  });

  it('sends a non-empty title on the wire, which the backend requires', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect(onTheWire(primary).title).toBe('Metformin');
  });

  // ── RULE 1 ────────────────────────────────────────────────────────────────
  /**
   * THE COLUMN DEFAULT FOR `reminder_15m` IS TRUE. The full form never reaches
   * it because `reminderFlagsForSave` always sends all four. A payload that
   * omitted them would come back with `reminder_15m = true` and fire an extra
   * 15-minutes-early push that an identical form-created medication does not —
   * a silent divergence between the two paths.
   */
  it('sends all four reminder flags explicitly as false', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect(primary.reminder_24h).toBe(false);
    expect(primary.reminder_1h).toBe(false);
    expect(primary.reminder_30m).toBe(false);
    expect(primary.reminder_15m).toBe(false);
  });

  it('keeps all four reminder flags on the wire, not merely on the object', () => {
    const wire = onTheWire(buildFirstRunMedication(BASE).primary);
    expect(wire).toMatchObject({
      reminder_24h: false,
      reminder_1h: false,
      reminder_30m: false,
      reminder_15m: false,
    });
  });

  /**
   * THE FIFTH FLAG, AND THE ONE THAT POINTS THE OTHER WAY.
   *
   * `reminder_at_due` is the alert AT the dose time — the entire point of the
   * wizard's medication — so it is the one reminder that must be ON while the
   * four EARLIER ones are off. The source calls it load-bearing and states it
   * explicitly for exactly the reason the four above are stated: it is a
   * `NOT NULL DEFAULT TRUE` column, so agreeing with the default today is not
   * the same as SAYING so, and this module's contract is to match the form's
   * payload rather than to coincide with a default that can change.
   *
   * Asserted here because nothing else did: flipping the literal in
   * `buildFirstRunMedication` to `false` — silencing every dose the wizard
   * creates — left the whole suite green.
   */
  it('sends reminder_at_due explicitly as true, on the object and on the wire', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect(primary.reminder_at_due).toBe(true);
    expect(onTheWire(primary).reminder_at_due).toBe(true);
  });

  // ── RULE 2 ────────────────────────────────────────────────────────────────
  /**
   * Same trap as `reminder_15m`: `notifications_enabled` is `BOOLEAN NOT NULL
   * DEFAULT TRUE` and happens to agree with the wizard's intent today. The full
   * form sends it explicitly rather than leaning on that default, and this
   * module's job is to match the form's payload, not to coincide with a default
   * that could change out from under it.
   */
  it('sends notifications_enabled explicitly as true', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect(primary.notifications_enabled).toBe(true);
    expect(onTheWire(primary).notifications_enabled).toBe(true);
  });

  /**
   * The ONE field that leans on a column default, called out rather than fixed:
   * sending `false` would claim the user answered a refill question they were
   * never shown. Mobile documents the identical decision.
   */
  it('omits track_refills entirely — the wizard never asks about refills', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect('track_refills' in primary).toBe(false);
  });

  it('omits dosage when blank rather than sending an empty string', () => {
    const { primary } = buildFirstRunMedication({ ...BASE, dosage: '   ' });
    expect(primary.medication_dosage).toBeUndefined();
    expect(onTheWire(primary)).not.toHaveProperty('medication_dosage');
  });

  it('trims the dosage it does send', () => {
    const { primary } = buildFirstRunMedication({ ...BASE, dosage: '  500mg  ' });
    expect(primary.medication_dosage).toBe('500mg');
  });

  it('omits rxcui entirely when no drug was picked', () => {
    const { primary } = buildFirstRunMedication(BASE);
    expect('rxcui' in primary).toBe(false);
  });

  it('writes rxcui when one is supplied', () => {
    const { primary } = buildFirstRunMedication({ ...BASE, rxcui: '860975' });
    expect(primary.rxcui).toBe('860975');
  });

  it('always creates a medication, never another event type', () => {
    expect(buildFirstRunMedication(BASE).primary.event_type).toBe('medication');
  });

  // ── RULE 5 ────────────────────────────────────────────────────────────────
  /**
   * ABSENT AND NULL ARE DIFFERENT INSTRUCTIONS to the backend's
   * `eventSchema.partial()`: absent means "leave unchanged", null means "remove
   * it". Hand-building `recurrence_rule: null` on a create would diverge from
   * the form, which leaves a `let recurrence_rule: string | undefined`
   * undefined for "Does not repeat".
   */
  it('leaves recurrence_rule undefined for "none", never sending daily or null', () => {
    const { primary } = buildFirstRunMedication({
      ...BASE,
      presetKey: 'everyMorning',
      recurrence: 'none',
    });
    expect(primary.recurrence_rule).toBeUndefined();
    expect(primary.recurrence_rule).not.toBeNull();
    // The key is PRESENT with an undefined value (that is what the helper
    // returns), so absence is asserted where it is observable: the wire.
    expect(onTheWire(primary)).not.toHaveProperty('recurrence_rule');
  });

  it('uses the step-4 recurrence, never the preset helper hardcoded daily', () => {
    const { primary } = buildFirstRunMedication({
      ...BASE,
      presetKey: 'everyMorning',
      recurrence: 'weekly',
    });
    expect(primary.recurrence_rule).toBe('weekly');
  });

  it.each(['daily', 'every_other_day', 'weekly'] as const)(
    'passes the %s rule through untouched',
    (recurrence) => {
      const { primary } = buildFirstRunMedication({
        ...BASE,
        presetKey: 'everyMorning',
        recurrence,
      });
      expect(primary.recurrence_rule).toBe(recurrence);
    }
  );

  it('never sends a recurrence_end_date — the wizard asks for no end', () => {
    const { primary } = buildFirstRunMedication({ ...BASE, recurrence: 'weekly' });
    expect(onTheWire(primary)).not.toHaveProperty('recurrence_end_date');
  });

  // ── RULE 6 (the dose times half) ─────────────────────────────────────────
  it.each([
    ['everyMorning', 0],
    ['everyEvening', 0],
    ['twiceDaily', 1],
    ['threeTimesDaily', 2],
  ] as const)('reports %s as %i additional dose time(s)', (presetKey, expected) => {
    const { additionalTimes } = buildFirstRunMedication({ ...BASE, presetKey });
    expect(additionalTimes).toHaveLength(expected);
  });

  it('uses the custom time as the primary with no siblings', () => {
    const { primary, additionalTimes } = buildFirstRunMedication({
      ...BASE,
      presetKey: 'custom',
      customTime: '14:30',
    });
    // DERIVED through the same conversion, never hardcoded: '14:30' is a VIEWER
    // wall clock, and what it becomes in the recipient's zone depends on the
    // runner. Asserting a bare '14:30' passes only where the two zones happen to
    // agree.
    expect(primary.scheduled_time).toBe(
      eventDatesForApi({
        dateStr: BASE.todayStr,
        timeStr: '14:30',
        recurrenceEndDateStr: null,
        timezone: BASE.timezone,
      }).scheduledTime
    );
    expect(additionalTimes).toHaveLength(0);
  });

  it('keeps the wall clock when the recipient shares the viewer zone', () => {
    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { primary } = buildFirstRunMedication({
      ...BASE,
      presetKey: 'custom',
      customTime: '14:30',
      timezone: viewerZone,
    });
    expect(primary.scheduled_time).toBe('14:30');
  });

  it('throws rather than inventing a time when custom has no time', () => {
    expect(() =>
      buildFirstRunMedication({ ...BASE, presetKey: 'custom', customTime: null })
    ).toThrow();
  });

  // ── RULE 4 (the payload half — the modal owns the precedence chain) ───────
  /**
   * `scheduled_date` must be the day the dose falls on in the RECIPIENT's zone,
   * not the viewer's.
   *
   * The pair of zones is DERIVED, for the reason recorded at the top of this
   * file: "two far-apart zones must disagree" is simply false from some runner
   * zones. Two zones whose dates genuinely differ for THIS instant cannot both
   * be satisfied by a single viewer-zone value, in any runner zone.
   */
  it('resolves scheduled_date in the recipient timezone, not the viewer’s', () => {
    const primaryInstant = viewerInstant(BASE.todayStr, '08:00');

    const dateIn = (timeZone: string): string =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(primaryInstant);

    const CANDIDATES = [
      'Pacific/Kiritimati',
      'Pacific/Auckland',
      'Asia/Tokyo',
      'Europe/Berlin',
      'UTC',
      'America/Denver',
      'Pacific/Honolulu',
      'Pacific/Midway',
    ];
    const pair = CANDIDATES.flatMap((a) => CANDIDATES.map((b) => [a, b] as const)).find(
      ([a, b]) => dateIn(a) !== dateIn(b)
    );

    // Across a 26-hour span of offsets two zones always disagree about the date;
    // if this ever fails the harness is broken, not the code.
    expect(pair).toBeDefined();

    for (const zone of pair as readonly [string, string]) {
      const { primary } = buildFirstRunMedication({
        ...BASE,
        presetKey: 'everyMorning',
        timezone: zone,
      });
      expect(primary.scheduled_date).toBe(dateIn(zone));
    }
  });
});

describe('firstRunPresetTimes', () => {
  it('matches mobile’s MED_SCHEDULE_PRESETS clock times exactly', () => {
    // The literal times are the CONTRACT with mobile — both platforms must put
    // a "twice daily" medication at the same two clocks or the same answer
    // produces two different medications.
    expect(FIRST_RUN_SCHEDULE_PRESETS.map((p) => [p.key, p.times])).toEqual([
      ['everyMorning', ['08:00']],
      ['everyEvening', ['20:00']],
      ['twiceDaily', ['08:00', '20:00']],
      ['threeTimesDaily', ['08:00', '14:00', '20:00']],
    ]);
  });

  it('splits a preset into its primary and the rest', () => {
    expect(firstRunPresetTimes('threeTimesDaily', null)).toEqual({
      primaryTime: '08:00',
      additionalTimes: ['14:00', '20:00'],
    });
  });
});

describe('recurrenceForCreate', () => {
  it('omits both keys on the wire for "none"', () => {
    const wire = JSON.parse(JSON.stringify(recurrenceForCreate('none')));
    expect(wire).toEqual({});
  });

  it('never emits an explicit null, which would mean "remove it"', () => {
    for (const r of ['daily', 'every_other_day', 'weekly', 'none'] as const) {
      const result = recurrenceForCreate(r);
      expect(result.recurrence_rule).not.toBeNull();
      expect(result.recurrence_end_date).not.toBeNull();
    }
  });

  it('carries the rule and no end date for a real repeat', () => {
    expect(recurrenceForCreate('weekly')).toEqual({
      recurrence_rule: 'weekly',
      recurrence_end_date: undefined,
    });
  });
});

// ── RULE 9 ──────────────────────────────────────────────────────────────────
/**
 * "Twice daily, every other day" is expressible but means SIBLING DOSES ON A
 * NON-DAILY RULE — the corner the sibling/timezone helpers are least exercised
 * on. The wizard offers the full form there rather than guessing. Single-time
 * presets combine with every repeat option freely.
 */
describe('requiresFullForm', () => {
  it.each(['twiceDaily', 'threeTimesDaily'] as const)(
    'is true for multi-dose preset %s on a non-daily repeat',
    (presetKey) => {
      expect(requiresFullForm(presetKey, 'weekly')).toBe(true);
      expect(requiresFullForm(presetKey, 'every_other_day')).toBe(true);
      expect(requiresFullForm(presetKey, 'none')).toBe(true);
    }
  );

  it.each(['twiceDaily', 'threeTimesDaily'] as const)(
    'is false for multi-dose preset %s on daily',
    (presetKey) => {
      expect(requiresFullForm(presetKey, 'daily')).toBe(false);
    }
  );

  it.each(['everyMorning', 'everyEvening', 'custom'] as const)(
    'is false for single-time preset %s on every repeat',
    (presetKey) => {
      for (const r of ['daily', 'every_other_day', 'weekly', 'none'] as const) {
        expect(requiresFullForm(presetKey, r)).toBe(false);
      }
    }
  );
});

// ── RULE 6 ──────────────────────────────────────────────────────────────────
/**
 * SIBLING DOSES ACROSS A DAY BOUNDARY — the case the per-dose derivation exists
 * for, and the one no rendered-modal test can reach.
 *
 * A rendered test drives a viewer and a recipient a couple of hours apart, so
 * its evening dose never leaves the day and the whole hazard is invisible.
 * Here the recipient is far enough away that two doses on the same VIEWER day
 * fall on DIFFERENT recipient days — so a sibling that borrowed the primary's
 * `scheduled_date` stores the dose a full day out and its reminder fires 24
 * hours late.
 *
 * THE STRADDLING HOURS ARE DERIVED, NOT HARDCODED. Which viewer hours cross the
 * recipient's midnight depends entirely on the offset between the runner's zone
 * and the recipient's. A fixed 08:00/20:00 pair silently stops straddling under
 * some runner zones — passing the `toBe` and failing only the `not.toBe` that
 * made it meaningful.
 */
describe('buildSiblingDoseRequests across a day boundary', () => {
  const todayStr = '2026-09-01';
  const at = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

  const dayIn = (timezone: string, hour: number): string =>
    eventDatesForApi({
      dateStr: todayStr,
      timeStr: at(hour),
      recurrenceEndDateStr: null,
      timezone,
    }).scheduledDate;

  /**
   * A recipient zone and two viewer-local hours that land on different days
   * there. Every candidate is far from every plausible runner zone, so one of
   * them straddles wherever this runs.
   */
  const straddle = (() => {
    for (const timezone of ['Pacific/Auckland', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      const base = dayIn(timezone, 0);
      for (let hour = 1; hour < 24; hour++) {
        if (dayIn(timezone, hour) !== base) return { timezone, early: 0, late: hour };
      }
    }
    throw new Error('no straddling zone found — candidate list needs widening');
  })();

  const { timezone, early, late } = straddle;

  const primary = buildFirstRunMedication({
    ...BASE,
    presetKey: 'custom',
    customTime: at(early),
    timezone,
    todayStr,
  }).primary;

  it('gives each dose its own recipient-frame time', () => {
    const [sibling] = buildSiblingDoseRequests({
      primary,
      additionalTimes: [at(late)],
      timezone,
      todayStr,
    });

    expect(sibling.scheduled_time).toBe(
      eventDatesForApi({
        dateStr: todayStr,
        timeStr: at(late),
        recurrenceEndDateStr: null,
        timezone,
      }).scheduledTime
    );
    expect(sibling.scheduled_time).not.toBe(primary.scheduled_time);
  });

  /**
   * THE ASSERTION THE EXTRACTION EXISTS FOR. A sibling copying the primary's
   * date is not merely imprecise here — it stores the dose on the wrong calendar
   * day.
   */
  it('advances the sibling date when the dose crosses midnight there', () => {
    const [sibling] = buildSiblingDoseRequests({
      primary,
      additionalTimes: [at(late)],
      timezone,
      todayStr,
    });

    expect(sibling.scheduled_date).toBe(dayIn(timezone, late));
    expect(sibling.scheduled_date).not.toBe(primary.scheduled_date);
  });

  it('points every sibling at the primary bottle', () => {
    const siblings = buildSiblingDoseRequests({
      primary,
      additionalTimes: [at(early), at(late)],
      timezone,
      todayStr,
      refillGroupId: 'evt-1',
    });

    expect(siblings).toHaveLength(2);
    expect(siblings.map((s) => s.refill_group_id)).toEqual(['evt-1', 'evt-1']);
  });

  /**
   * THE PRIMARY MUST ACTUALLY CARRY A BOTTLE, or this asserts nothing.
   *
   * `siblingDosePayload` spreads `...primary` and then clears four refill
   * fields. Run against a wizard-built primary — which never sets any of them —
   * the `not.toHaveProperty` checks pass whether the clears exist or not:
   * deleting all four from the source left this test green. So the fixture is a
   * primary that DOES track a bottle, which is the realistic input (mobile's
   * form fills these, and this function is a port of mobile's) and the only one
   * under which the clears are observable.
   *
   * Why the clears matter: one bottle, several dose times. A sibling that
   * inherited `quantity_remaining` would be a SECOND counter draining at half
   * the real rate, so both rows would report ~30 days of supply on the day the
   * bottle actually ran out and the refill alert would fire late.
   */
  it('leaves the bottle with the owner — no sibling carries refill state', () => {
    const trackedPrimary: CreateEventRequest = {
      ...primary,
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 42,
      pills_per_day: 2,
      alert_days_before: 7,
    };
    const [sibling] = buildSiblingDoseRequests({
      primary: trackedPrimary,
      additionalTimes: [at(late)],
      timezone,
      todayStr,
      refillGroupId: 'evt-1',
    });
    expect(sibling.track_refills).toBe(false);
    const wire = onTheWire(sibling);
    expect(wire).not.toHaveProperty('quantity_in_bottle');
    expect(wire).not.toHaveProperty('quantity_remaining');
    expect(wire).not.toHaveProperty('pills_per_day');
    expect(wire).not.toHaveProperty('alert_days_before');
    // The OWNER keeps every one of them — the clears are the sibling's, not a
    // mutation of the row that owns the bottle.
    expect(onTheWire(trackedPrimary)).toMatchObject({
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 42,
      pills_per_day: 2,
      alert_days_before: 7,
    });
  });

  /**
   * Absent, NOT null. The backend reads an absent key as "leave alone" while an
   * explicit null would detach a row that never had a bottle.
   */
  it('omits refill_group_id when the primary create returned no id', () => {
    const [sibling] = buildSiblingDoseRequests({
      primary,
      additionalTimes: [at(late)],
      timezone,
      todayStr,
    });
    expect('refill_group_id' in sibling).toBe(false);
  });

  it('carries the primary’s identity and reminder flags onto every sibling', () => {
    const [sibling] = buildSiblingDoseRequests({
      primary,
      additionalTimes: [at(late)],
      timezone,
      todayStr,
      refillGroupId: 'evt-1',
    });
    expect(sibling.title).toBe(primary.title);
    expect(sibling.medication_name).toBe(primary.medication_name);
    expect(sibling.recurrence_rule).toBe(primary.recurrence_rule);

    /**
     * ALL SIX, not the two that happened to get written down.
     *
     * This asserted `notifications_enabled` and `reminder_15m` only, while
     * calling itself a reminder-flag test — so the flag that actually MAKES a
     * dose speak was checked on the primary and on nothing else. Adding
     * `reminder_at_due: false` to `siblingDosePayload`'s overrides silences the
     * 20:00 half of a twice-daily medication outright: the 08:00 dose still
     * announces itself, the evening one never does, and the family learns about
     * it from the missed-dose escalation. That mutation left this suite green.
     *
     * Spelled out flag by flag rather than as a subset compare, so a NEW
     * reminder column added to the primary and forgotten here is a failure
     * rather than a silent omission.
     */
    expect(sibling.notifications_enabled).toBe(true);
    expect(sibling.reminder_at_due).toBe(true);
    expect(sibling.reminder_24h).toBe(false);
    expect(sibling.reminder_1h).toBe(false);
    expect(sibling.reminder_30m).toBe(false);
    expect(sibling.reminder_15m).toBe(false);
    // And they are the PRIMARY's values, not coincidences: the two rows are one
    // medication, so the six must agree by construction.
    for (const flag of [
      'notifications_enabled',
      'reminder_at_due',
      'reminder_24h',
      'reminder_1h',
      'reminder_30m',
      'reminder_15m',
    ] as const) {
      expect(sibling[flag], `sibling ${flag} diverged from the primary`).toBe(primary[flag]);
    }
  });
});

// ── RULE 7 ──────────────────────────────────────────────────────────────────
/**
 * Pinned to a FIXED `now` in a FIXED recipient zone, so the runner plays no
 * part: every value below is computed inside `timezone`, from an instant this
 * test states outright.
 */
describe('isFirstRunDosePastDue', () => {
  const timezone = 'UTC';
  /** 20:00 UTC — an evening signup, which is exactly when this bites. */
  const now = new Date('2026-09-01T20:00:00Z');

  const dose = (scheduled_date: string, scheduled_time: string): CreateEventRequest => ({
    event_type: 'medication',
    title: 'Metformin',
    scheduled_date,
    scheduled_time,
  });

  it('is true for the 08:00 default saved in the evening', () => {
    expect(isFirstRunDosePastDue(dose('2026-09-01', '08:00'), timezone, now)).toBe(true);
  });

  it('is false for a dose still ahead today', () => {
    expect(isFirstRunDosePastDue(dose('2026-09-01', '23:00'), timezone, now)).toBe(false);
  });

  /**
   * A dose whose recipient-frame date has already rolled to TOMORROW is not
   * past due — it is simply scheduled, and warning about it would be wrong.
   */
  it('is false for tomorrow, even at an hour that has passed today', () => {
    expect(isFirstRunDosePastDue(dose('2026-09-02', '08:00'), timezone, now)).toBe(false);
  });

  it('is false for a payload with no time at all', () => {
    const noTime = { ...dose('2026-09-01', '08:00'), scheduled_time: undefined };
    expect(isFirstRunDosePastDue(noTime, timezone, now)).toBe(false);
  });
});

describe('viewerToday', () => {
  it('reports the viewer’s own calendar day, zero-padded', () => {
    const now = new Date(2026, 8, 3, 4, 5);
    expect(viewerToday(now)).toBe('2026-09-03');
  });
});
