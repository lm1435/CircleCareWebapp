import {
  DEFAULT_DURATION_MINUTES,
  DURATION_PRESETS,
  addMinutesToTimeStr,
  assignedToForSave,
  matchingDurationIndex,
  minutesBetween,
  reminderFlagsForSave,
  remindersApply,
  supportsAssignee,
  type ReminderSelection,
} from '../eventForm';

const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('supportsAssignee', () => {
  it.each(['task', 'appointment'] as const)('%s carries an assignee', (type) => {
    expect(supportsAssignee(type)).toBe(true);
  });

  it('medications do not', () => {
    expect(supportsAssignee('medication')).toBe(false);
  });
});

describe('assignedToForSave', () => {
  it.each(['task', 'appointment'] as const)('sends the assignee for a %s', (type) => {
    expect(assignedToForSave(type, USER)).toBe(USER);
  });

  it.each(['task', 'appointment'] as const)(
    'sends an explicit null when a %s is set back to Anyone',
    (type) => {
      // The regression: this used to be omitted, and updates are partial
      // patches, so the previous assignee survived the save.
      expect(assignedToForSave(type, null)).toBeNull();
    }
  );

  it('distinguishes "unassigned" from "not applicable"', () => {
    expect(assignedToForSave('task', null)).not.toBeUndefined();
    expect(assignedToForSave('medication', null)).toBeUndefined();
  });

  it('omits the key entirely for medications', () => {
    expect(assignedToForSave('medication', USER)).toBeUndefined();
  });

  it('treats an empty string as unassigned rather than sending it', () => {
    // An empty id would fail the backend's uuid() check with a 400.
    expect(assignedToForSave('task', '')).toBeNull();
    expect(assignedToForSave('task', '   ')).toBeNull();
  });
});

describe('remindersApply', () => {
  it('always applies to medications — the form requires a time', () => {
    expect(remindersApply('medication', '')).toBe(true);
    expect(remindersApply('medication', '08:00')).toBe(true);
  });

  it.each(['appointment', 'task'] as const)('applies to a %s once a time is set', (type) => {
    expect(remindersApply(type, '14:00')).toBe(true);
  });

  it.each(['appointment', 'task'] as const)('does not apply to a timeless %s', (type) => {
    expect(remindersApply(type, '')).toBe(false);
    expect(remindersApply(type, '   ')).toBe(false);
  });
});

describe('reminderFlagsForSave', () => {
  /** Everything on — the anchor alert AND all four earlier reminders. */
  const allOn: ReminderSelection = {
    reminder_at_due: true,
    reminder_24h: true,
    reminder_1h: true,
    reminder_30m: true,
    reminder_15m: true,
  };
  /**
   * Everything off, `reminder_at_due` included — the ONLY genuinely silent
   * state, and what the helper must produce for "notifications off" / "no time".
   */
  const allOff: ReminderSelection = {
    reminder_at_due: false,
    reminder_24h: false,
    reminder_1h: false,
    reminder_30m: false,
    reminder_15m: false,
  };
  /**
   * The anchor alone. This is NOT silence: the alert still fires at the
   * scheduled time. Before `reminder_at_due` existed, "all four earlier flags
   * off" WAS the silent state, and this shape is what that assertion has to
   * become.
   */
  const anchorOnly: ReminderSelection = { ...allOff, reminder_at_due: true };

  it('persists the selection when notifications are on and a time exists', () => {
    expect(reminderFlagsForSave(allOn, true, true)).toEqual(allOn);
  });

  it('keeps the at-due anchor when every earlier reminder is off — not a silent event', () => {
    // The four `reminder_*` flags are opt-IN extras now. Zeroing the anchor
    // because none of them are checked would delete the primary alert on the
    // most common save there is: a plain event nobody asked for extras on.
    expect(reminderFlagsForSave(anchorOnly, true, true)).toEqual(anchorOnly);
    expect(reminderFlagsForSave(anchorOnly, true, true).reminder_at_due).toBe(true);
  });

  it('persists an explicit at-due opt-out — the one state that really is silent', () => {
    // Companion to the case above: the user deliberately turned the anchor off
    // with notifications still on and a time set. Re-arming it "helpfully"
    // would overrule the only way to make an event silent.
    expect(reminderFlagsForSave(allOff, true, true)).toEqual(allOff);
    expect(reminderFlagsForSave(allOff, true, true).reminder_at_due).toBe(false);
  });

  // ── The master toggle mutes; it does not erase ────────────────────────────
  //
  // It used to erase, and that was defensible exactly as long as
  // process_task_reminders() honoured no mute at all — blanking the columns was
  // then the only thing that could silence a task. Migration 20260823120000
  // added `notifications_enabled = true` to its four pre-reminder blocks and
  // 20260901120000 added the fifth (at-due) block carrying the same guard, so
  // every selector on the platform now skips a muted row: both process_*
  // functions, tiers 1/2/3, and the manual POST /task-reminders sweep.

  it('does NOT zero anything when notifications are off', () => {
    expect(reminderFlagsForSave(allOn, false, true)).toEqual(allOn);
  });

  it('keeps the at-due anchor across a master off → on cycle', () => {
    // The whole point of the contract. `reminder_at_due` is NOT NULL DEFAULT
    // TRUE, so the old zeroing stored a plain `false` indistinguishable from a
    // deliberate opt-out — the anchor could never be restored, and a muted-then-
    // unmuted medication only ever spoke through the missed-dose escalation.
    const savedWhileMuted = reminderFlagsForSave(anchorOnly, false, true);
    expect(savedWhileMuted.reminder_at_due).toBe(true);
    // Hydration reads those columns back verbatim; unmuting saves them again.
    expect(reminderFlagsForSave(savedWhileMuted, true, true)).toEqual(anchorOnly);
  });

  it('does NOT zero anything when there is no time to fire against', () => {
    // Every reminder function filters `scheduled_time IS NOT NULL`, so the flags
    // are INERT without a time. Zeroing them wrote the anchor off, and adding a
    // time later then produced a silent event with nothing on screen to explain
    // it — the same defect one step removed.
    expect(reminderFlagsForSave(allOn, true, false)).toEqual(allOn);
  });

  it('keeps both column-default-TRUE flags on a timeless entry', () => {
    // `reminder_15m` and `reminder_at_due` are the two whose DB default is TRUE,
    // so they are the two the old zeroing actually changed for a fresh task.
    const defaults: ReminderSelection = { ...allOff, reminder_at_due: true, reminder_15m: true };
    const saved = reminderFlagsForSave(defaults, true, false);
    expect(saved.reminder_15m).toBe(true);
    expect(saved.reminder_at_due).toBe(true);
  });

  it('leaves the selection alone when notifications are off AND there is no time', () => {
    expect(reminderFlagsForSave(allOn, false, false)).toEqual(allOn);
  });

  it('sends all five flags, never a subset', () => {
    // A dropped key is a partial patch server-side: the stored value survives.
    const keys = Object.keys(reminderFlagsForSave(allOn, false, false)).sort();
    expect(keys).toEqual([
      'reminder_15m',
      'reminder_1h',
      'reminder_24h',
      'reminder_30m',
      'reminder_at_due',
    ]);
  });

  it('does not mutate the caller selection', () => {
    const selection = { ...allOn };
    reminderFlagsForSave(selection, false, false);
    expect(selection).toEqual(allOn);
  });
});

describe('duration presets', () => {
  it('offers 30 min, 1 hr and 2 hrs, defaulting to the shortest', () => {
    expect(DURATION_PRESETS).toEqual([30, 60, 120]);
    expect(DEFAULT_DURATION_MINUTES).toBe(30);
  });
});

describe('addMinutesToTimeStr', () => {
  it.each([
    ['14:00', 30, '14:30'],
    ['14:00', 60, '15:00'],
    ['14:00', 120, '16:00'],
    ['09:45', 30, '10:15'],
    ['00:00', 30, '00:30'],
  ])('%s + %i min = %s', (start, mins, expected) => {
    expect(addMinutesToTimeStr(start, mins)).toBe(expected);
  });

  it('clamps at end of day rather than rolling into the next', () => {
    // The event carries a single scheduled_date, so a rolled-over end time
    // would silently describe a span the calendar cannot render.
    expect(addMinutesToTimeStr('23:50', 120)).toBe('23:59');
  });

  it('returns empty for a malformed time', () => {
    expect(addMinutesToTimeStr('', 30)).toBe('');
    expect(addMinutesToTimeStr('not-a-time', 30)).toBe('');
  });
});

describe('minutesBetween', () => {
  it('measures the span', () => {
    expect(minutesBetween('14:00', '14:30')).toBe(30);
    expect(minutesBetween('14:00', '16:00')).toBe(120);
  });

  it('returns null when either end is missing or malformed', () => {
    expect(minutesBetween('', '14:30')).toBeNull();
    expect(minutesBetween('14:00', '')).toBeNull();
    expect(minutesBetween('bad', '14:30')).toBeNull();
  });
});

describe('matchingDurationIndex', () => {
  it.each([
    ['14:30', 0],
    ['15:00', 1],
    ['16:00', 2],
  ])('selects the chip matching an end of %s', (end, expectedIndex) => {
    expect(matchingDurationIndex('14:00', end)).toBe(expectedIndex);
  });

  it('leaves every chip unselected for a custom span', () => {
    // 45 minutes came from the end-time field, not a chip — rounding it to the
    // nearest preset would silently change the event.
    expect(matchingDurationIndex('14:00', '14:45')).toBe(-1);
  });

  it('leaves every chip unselected when there is no time yet', () => {
    expect(matchingDurationIndex('', '')).toBe(-1);
    expect(matchingDurationIndex('14:00', '')).toBe(-1);
  });

  it('does not select a chip for a negative span', () => {
    expect(matchingDurationIndex('14:00', '13:00')).toBe(-1);
  });

  it('round-trips with addMinutesToTimeStr', () => {
    DURATION_PRESETS.forEach((preset, index) => {
      expect(matchingDurationIndex('10:00', addMinutesToTimeStr('10:00', preset))).toBe(index);
    });
  });
});
