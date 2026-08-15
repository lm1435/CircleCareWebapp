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
  const allOn: ReminderSelection = {
    reminder_24h: true,
    reminder_1h: true,
    reminder_30m: true,
    reminder_15m: true,
  };
  const allOff: ReminderSelection = {
    reminder_24h: false,
    reminder_1h: false,
    reminder_30m: false,
    reminder_15m: false,
  };

  it('persists the selection when notifications are on and a time exists', () => {
    expect(reminderFlagsForSave(allOn, true, true)).toEqual(allOn);
  });

  it('zeroes everything when notifications are off', () => {
    expect(reminderFlagsForSave(allOn, false, true)).toEqual(allOff);
  });

  it('zeroes everything when there is no time to fire against', () => {
    expect(reminderFlagsForSave(allOn, true, false)).toEqual(allOff);
  });

  it('zeroes the default-on 15-minute reminder specifically', () => {
    const defaults: ReminderSelection = { ...allOff, reminder_15m: true };
    expect(reminderFlagsForSave(defaults, true, false).reminder_15m).toBe(false);
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
