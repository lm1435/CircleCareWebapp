/**
 * THE DELIBERATE ADJUSTMENT TO THE RECORDED BODIES (owner 2026-11-16): an UNTIMED task / appointment
 * ("Any time") is saved with all five reminder flags CLEARED (`reminderFlagsForSave`: never a reminder without
 * a time). The frozen payload fixtures predate it and carry the form's selection (`reminder_at_due: true`).
 * This sets the five to false on a recorded task / appointment body whose time is absent or null (an edit's
 * absent key falls back to the stored row) and changes nothing else, key order included: a timed body, or a
 * medication, is compared exactly as recorded. Mobile twin: mobile/src/__tests__/helpers/editPatchExpectations.ts.
 */
type Body = Record<string, unknown>;
const FLAGS = ['reminder_at_due', 'reminder_24h', 'reminder_1h', 'reminder_30m', 'reminder_15m'] as const;

function clearBody(data: Body, stored?: Body): Body {
  const type = data.event_type ?? stored?.event_type;
  if (type !== 'task' && type !== 'appointment') return data;
  const time = 'scheduled_time' in data ? data.scheduled_time : stored?.scheduled_time;
  if (time) return data;
  const out: Body = { ...data };
  for (const k of FLAGS) if (k in out) out[k] = false;
  return out;
}

/** A recorded create body, or a recorded `{ eventId, data }` edit call. */
export function untimedRemindersCleared<T>(recorded: T, stored?: object): T {
  if (!recorded || typeof recorded !== 'object') return recorded;
  const r = recorded as Body;
  if (r.data && typeof r.data === 'object') {
    return { ...r, data: clearBody(r.data as Body, stored as Body | undefined) } as T;
  }
  return clearBody(r, stored as Body | undefined) as T;
}
