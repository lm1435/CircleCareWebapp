import { describe, expect, it } from 'vitest';
import { CIRCLE_A, EVENT_ID, MED_ID, local, makeItem } from '@/test/fixtures/inbox';
import {
  groupInbox,
  inboxTypeEnum,
  inboxFlagValue,
  resolveInboxDestination,
  rowCopy,
  rowMeta,
  unreadBucket,
} from '@/lib/notificationsInbox';
import i18n from '@/i18n';

const NOW = new Date(2026, 9, 29, 15, 0, 0); // Thu Oct 29 2026, 15:00 local
const t = (key: string, options?: Record<string, unknown>): string =>
  i18n.t(key, { ns: 'common', lng: 'en', ...options }) as string;

describe('inboxFlagValue', () => {
  it('honours an explicit on/off', () => {
    expect(inboxFlagValue('on', true)).toBe(true);
    expect(inboxFlagValue('off', false)).toBe(false);
  });
  it('unset: ON outside production, OFF in production', () => {
    expect(inboxFlagValue(undefined, false)).toBe(true);
    expect(inboxFlagValue(undefined, true)).toBe(false);
    expect(inboxFlagValue('', true)).toBe(false);
  });
});

describe('unreadBucket / inboxTypeEnum', () => {
  it('buckets the unread count', () => {
    expect([0, 1, 3, 4, 9, 10, 250].map(unreadBucket)).toEqual([
      '0', '1_3', '1_3', '4_9', '4_9', '10_plus', '10_plus',
    ]);
  });
  it('maps unknown types to other', () => {
    expect(inboxTypeEnum('care_note_added')).toBe('care_note_added');
    expect(inboxTypeEnum('brand_new_type')).toBe('other');
    expect(inboxTypeEnum(undefined)).toBe('other');
  });
});

describe('groupInbox (viewer-local days)', () => {
  it('buckets Today / Yesterday / 2 days ago and drops older rows', () => {
    const today = makeItem({ updated_at: local(2026, 10, 29, 0, 5) });
    const yesterdayLate = makeItem({ updated_at: local(2026, 10, 28, 23, 55) });
    const two = makeItem({ updated_at: local(2026, 10, 27, 0, 1) });
    const old = makeItem({ updated_at: local(2026, 10, 26, 23, 59) });
    const sections = groupInbox([old, two, yesterdayLate, today], NOW);
    expect(sections.map((s) => s.key)).toEqual(['today', 'yesterday', 'twoDaysAgo']);
    expect(sections[0].items).toEqual([today]);
    expect(sections[1].items).toEqual([yesterdayLate]);
    expect(sections[2].items).toEqual([two]);
  });
  it('omits empty sections and orders newest first', () => {
    const a = makeItem({ updated_at: local(2026, 10, 29, 8) });
    const b = makeItem({ updated_at: local(2026, 10, 29, 14) });
    const sections = groupInbox([a, b], NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

describe('rowCopy (dose rows render from state)', () => {
  const state = (status: string, extra: Record<string, unknown> = {}) =>
    makeItem({
      type: 'medication_confirmation',
      title: 'STORED TITLE',
      body: 'Stored body',
      updated_at: local(2026, 10, 29, 8, 12),
      state: {
        status: status as never,
        medication_name: 'Lisinopril',
        scheduled_time: '08:00:00',
        scheduled_date: '2026-10-29',
        ...extra,
      },
    });
  it('taken with and without a name', () => {
    expect(rowCopy(state('taken', { actor_first_name: 'Ana' }), t, '12h')).toEqual({
      title: 'Lisinopril 8:00 AM · Taken by Ana',
      body: 'Marked at 8:12 AM',
    });
    expect(rowCopy(state('taken'), t, '12h').title).toBe('Lisinopril 8:00 AM · Taken');
  });
  it('skipped with and without a name', () => {
    expect(rowCopy(state('skipped', { actor_first_name: 'Sam' }), t, '12h').title).toBe(
      'Lisinopril 8:00 AM · Skipped by Sam'
    );
    expect(rowCopy(state('skipped'), t, '12h').title).toBe('Lisinopril 8:00 AM · Skipped');
  });
  it('due, late and not_marked', () => {
    expect(rowCopy(state('due'), t, '12h').title).toBe('Time for Lisinopril 8:00 AM');
    expect(rowCopy(state('late'), t, '12h').title).toBe("Lisinopril 8:00 AM isn't marked as taken yet");
    expect(rowCopy(state('not_marked'), t, '12h').title).toBe(
      "Lisinopril 8:00 AM isn't marked as taken yet"
    );
    expect(rowCopy(state('late'), t, '12h').body).toBe('Stored body');
  });
  it('honours a 24h clock', () => {
    expect(rowCopy(state('taken', { scheduled_time: '18:30:00' }), t, '24h').title).toBe(
      'Lisinopril 18:30 · Taken'
    );
  });
  it('non-dose rows keep the stored title and body', () => {
    const row = makeItem({ title: 'Ana added a note', body: 'Slept well' });
    expect(rowCopy(row, t, '12h')).toEqual({ title: 'Ana added a note', body: 'Slept well' });
  });
});

describe('rowMeta', () => {
  const opts = { now: NOW, cycle: '12h' as const, language: 'en', t };
  it('circle name only when showCircle; clock time on the same day', () => {
    const row = makeItem({ circle_name: 'Mom', updated_at: local(2026, 10, 29, 14, 10) });
    expect(rowMeta(row, { ...opts, showCircle: true })).toBe('Mom · 2:10 PM');
    expect(rowMeta(row, { ...opts, showCircle: false })).toBe('2:10 PM');
  });
  it('weekday short on an earlier day', () => {
    const row = makeItem({ circle_name: 'Mom', updated_at: local(2026, 10, 28, 17, 40) });
    expect(rowMeta(row, { ...opts, showCircle: true })).toBe('Mom · Wed');
  });
});

describe('resolveInboxDestination (same place a push tap goes)', () => {
  const base = `/circles/${CIRCLE_A}`;
  const dest = (over: Parameters<typeof makeItem>[0]) => resolveInboxDestination(makeItem(over));

  it('event types -> calendar with date and eventId', () => {
    for (const type of ['medication_reminder', 'task_assigned', 'appointment_created', 'note_added']) {
      expect(dest({ type, data: { eventId: EVENT_ID, scheduledDate: '2026-10-29' } })).toEqual({
        kind: 'route',
        to: `${base}/calendar?date=2026-10-29&eventId=${EVENT_ID}`,
      });
    }
  });
  it('a dose row without data.scheduledDate falls back to state.scheduled_date', () => {
    expect(
      dest({
        type: 'medication_confirmation',
        data: { eventId: EVENT_ID },
        state: { status: 'taken', medication_name: 'X', scheduled_time: '08:00:00', scheduled_date: '2026-10-28' },
      })
    ).toEqual({ kind: 'route', to: `${base}/calendar?date=2026-10-28&eventId=${EVENT_ID}` });
  });
  it('an event type without an event id still opens the calendar', () => {
    expect(dest({ type: 'task_reminder', data: {} })).toEqual({ kind: 'route', to: `${base}/calendar` });
  });
  it('refill / as-needed -> meds?medication=', () => {
    expect(dest({ type: 'as_needed_dose_given', data: { medicationId: MED_ID } })).toEqual({
      kind: 'route',
      to: `${base}/meds?medication=${MED_ID}`,
    });
    // pre-1.3.1 refill pushes carried the series id as eventId
    expect(dest({ type: 'refill_urgent', data: { eventId: EVENT_ID } })).toEqual({
      kind: 'route',
      to: `${base}/meds?medication=${EVENT_ID}`,
    });
    expect(dest({ type: 'refill_reminder', data: {} })).toEqual({ kind: 'route', to: `${base}/meds` });
  });
  it('care_note_added -> notes?date=', () => {
    expect(dest({ type: 'care_note_added', data: { noteDate: '2026-10-27' } })).toEqual({
      kind: 'route',
      to: `${base}/notes?date=2026-10-27`,
    });
    expect(dest({ type: 'care_note_added', data: { noteDate: '../x' } })).toEqual({
      kind: 'route',
      to: `${base}/notes`,
    });
  });
  it('daily_update -> dated view, or the circle when the date is unusable', () => {
    expect(dest({ type: 'daily_update', data: { date: '2026-10-28' } })).toEqual({
      kind: 'route',
      to: `${base}/daily-update/2026-10-28`,
    });
    expect(dest({ type: 'daily_update', data: { date: 'nope' } })).toEqual({ kind: 'route', to: base });
  });
  it('shift -> calendar shifts view', () => {
    expect(dest({ type: 'shift', data: { eventId: EVENT_ID } })).toEqual({
      kind: 'route',
      to: `${base}/calendar?mode=shifts`,
    });
    expect(dest({ type: 'shifts_reopened' })).toEqual({ kind: 'route', to: `${base}/calendar?mode=shifts` });
  });
  it('member_joined / invite_nudge -> members; other circle-level types and unknown types -> the circle', () => {
    expect(dest({ type: 'member_joined' })).toEqual({ kind: 'route', to: `${base}/members` });
    expect(dest({ type: 'invite_nudge' })).toEqual({ kind: 'route', to: `${base}/members` });
    for (const type of ['recognition', 'tier_downgrade_view_only', 'member_role_changed', 'future_type']) {
      expect(dest({ type })).toEqual({ kind: 'route', to: base });
    }
  });
  it('gone targets open the removed state with the reason', () => {
    expect(dest({ type: 'medication_reminder', target_status: 'removed' })).toEqual({ kind: 'gone', reason: 'removed' });
    expect(dest({ type: 'medication_reminder', target_status: 'ended' })).toEqual({ kind: 'gone', reason: 'ended' });
    expect(dest({ type: 'shift', target_status: 'no_access' })).toEqual({ kind: 'gone', reason: 'no_access' });
    expect(dest({ type: 'member_removed' })).toEqual({ kind: 'gone', reason: 'no_access' });
    expect(dest({ type: 'circle_archived' })).toEqual({ kind: 'gone', reason: 'no_access' });
  });
  it('never builds a path from an untrusted circle id', () => {
    expect(dest({ type: 'note_added', circle_id: '../../users/me', data: {} })).toEqual({ kind: 'none' });
    expect(dest({ type: 'test' })).toEqual({ kind: 'none' });
  });
});
