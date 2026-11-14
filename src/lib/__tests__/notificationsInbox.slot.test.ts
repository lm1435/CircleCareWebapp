// 1.4.2 notification wave, web inbox: grouped dose rows (medication_slot_alert /
// medication_taken_summary) and the quiet-circle routine check-in.
// Contracts: docs/plans/notification-grouping-1-4-2-backend-contract.md,
// docs/plans/quiet-circle-backoff-1-4-2-backend-contract.md.
import { describe, expect, it } from 'vitest';
import { CIRCLE_A, EVENT_ID, makeItem } from '@/test/fixtures/inbox';
import {
  inboxTypeEnum,
  resolveInboxDestination,
  rowCopy,
  slotFallbackCopy,
  wireCount,
} from '@/lib/notificationsInbox';
import i18n from '@/i18n';

const t = (key: string, options?: Record<string, unknown>): string =>
  i18n.t(key, { ns: 'common', lng: 'en', ...options }) as string;

const SLOT_DATA = {
  type: 'medication_slot_alert',
  slotTier: 'tier2',
  tier: 2,
  circleId: CIRCLE_A,
  circle_id: CIRCLE_A,
  scheduledDate: '2026-11-20',
  scheduled_date: '2026-11-20',
  scheduledTime: '08:00:00',
  scheduled_time: '08:00:00',
  slotKey: `${CIRCLE_A}:2026-11-20:08:00:00`,
  doseCount: 3,
  unmarkedCount: 2,
};
const SUMMARY_DATA = {
  type: 'medication_taken_summary',
  circleId: CIRCLE_A,
  circle_id: CIRCLE_A,
  scheduledDate: '2026-11-20',
  scheduled_date: '2026-11-20',
  scheduledTime: '08:00:00',
  scheduled_time: '08:00:00',
  slotKey: `${CIRCLE_A}:2026-11-20:08:00:00`,
  summaryId: '55555555-5555-4555-8555-555555555555',
  doseCount: 3,
  takenCount: 2,
  skippedCount: 1,
  markersCount: 2,
};

describe('push type enum (inbox_row_opened.type)', () => {
  it('P the three 1.4.2 types are known types, not "other"', () => {
    expect(inboxTypeEnum('medication_slot_alert')).toBe('medication_slot_alert');
    expect(inboxTypeEnum('medication_taken_summary')).toBe('medication_taken_summary');
    expect(inboxTypeEnum('routine_checkin')).toBe('routine_checkin');
  });
});

describe('grouped dose rows: destination', () => {
  it('P grouped alert row opens Today focused on its slot (date + exact time)', () => {
    const item = makeItem({ type: 'medication_slot_alert', data: SLOT_DATA });
    expect(resolveInboxDestination(item)).toEqual({
      kind: 'route',
      to: `/circles/${CIRCLE_A}?slot_date=2026-11-20&slot_time=08:00:00`,
    });
  });

  it('P summary row opens Today focused on its slot', () => {
    const item = makeItem({ type: 'medication_taken_summary', data: SUMMARY_DATA });
    expect(resolveInboxDestination(item)).toEqual({
      kind: 'route',
      to: `/circles/${CIRCLE_A}?slot_date=2026-11-20&slot_time=08:00:00`,
    });
  });

  it('N a slot with an unusable date or time opens plain Today (never a crafted URL)', () => {
    for (const bad of [
      { scheduledDate: '2026-02-30' },
      { scheduledDate: '../x' },
      { scheduledTime: '25:00:00' },
      { scheduledTime: '08:00&x=1' },
      { scheduledTime: undefined },
    ]) {
      const item = makeItem({ type: 'medication_slot_alert', data: { ...SLOT_DATA, ...bad } as never });
      expect(resolveInboxDestination(item)).toEqual({ kind: 'route', to: `/circles/${CIRCLE_A}` });
    }
  });

  it('N no mark-all: a slot destination never carries an event id or any bulk action', () => {
    const item = makeItem({ type: 'medication_slot_alert', data: { ...SLOT_DATA, eventId: EVENT_ID } });
    const dest = resolveInboxDestination(item);
    expect(dest.kind).toBe('route');
    const to = (dest as { to: string }).to;
    expect(to).not.toMatch(/dose=|eventId=|mark|all/i);
  });

  it('N unknown types still open the circle Today', () => {
    const item = makeItem({ type: 'brand_new_type_2027', data: { circleId: CIRCLE_A } });
    expect(resolveInboxDestination(item)).toEqual({ kind: 'route', to: `/circles/${CIRCLE_A}` });
  });

  it("N today's per-dose rows keep their destinations (dose landing / calendar sheet)", () => {
    const late = makeItem({
      type: 'medication_late',
      data: { eventId: EVENT_ID, scheduledDate: '2026-11-20', scheduledTime: '08:00:00' },
      state: {
        status: 'not_marked',
        medication_name: 'Metformin',
        scheduled_time: '08:00:00',
        scheduled_date: '2026-11-20',
      },
    });
    expect(resolveInboxDestination(late)).toEqual({
      kind: 'route',
      to: `/circles/${CIRCLE_A}?dose=${EVENT_ID}&date=2026-11-20&time=08:00:00`,
    });
    const confirmation = makeItem({
      type: 'medication_confirmation',
      data: { eventId: EVENT_ID, scheduledDate: '2026-11-20' },
    });
    expect(resolveInboxDestination(confirmation)).toEqual({
      kind: 'route',
      to: `/circles/${CIRCLE_A}/calendar?date=2026-11-20&eventId=${EVENT_ID}`,
    });
  });
});

describe('routine check-in row', () => {
  it('P opens the check-in page with source inbox', () => {
    const item = makeItem({
      type: 'routine_checkin',
      data: { type: 'routine_checkin', circleId: CIRCLE_A, circle_id: CIRCLE_A },
    });
    expect(resolveInboxDestination(item)).toEqual({
      kind: 'route',
      to: `/circles/${CIRCLE_A}/routine-check-in`,
      state: { checkinSource: 'inbox' },
    });
  });

  it('P its row shows the server text as written', () => {
    const item = makeItem({
      type: 'routine_checkin',
      title: "Has Mom's routine changed?",
      body: 'No doses have been marked lately, so we paused the extra alerts.',
    });
    expect(rowCopy(item, t, '12h')).toEqual({
      title: "Has Mom's routine changed?",
      body: 'No doses have been marked lately, so we paused the extra alerts.',
    });
  });
});

describe('grouped dose rows: copy', () => {
  it('P summary row renders the server counts as written (one row, names included)', () => {
    const item = makeItem({
      type: 'medication_taken_summary',
      title: "Mom's meds (8:00 AM)",
      body: '2 taken, 1 skipped (Sam, Ana)',
      data: SUMMARY_DATA,
    });
    expect(rowCopy(item, t, '12h')).toEqual({
      title: "Mom's meds (8:00 AM)",
      body: '2 taken, 1 skipped (Sam, Ana)',
    });
  });

  it('P blank server text: the summary renders its counts from data (pluralized)', () => {
    const item = makeItem({ type: 'medication_taken_summary', title: '', body: '', data: SUMMARY_DATA });
    expect(rowCopy(item, t, '12h')).toEqual({ title: 'Meds (8:00 AM)', body: '2 taken, 1 skipped' });
    const all = makeItem({
      type: 'medication_taken_summary',
      title: '',
      body: '',
      data: { ...SUMMARY_DATA, takenCount: 3, skippedCount: 0 },
    });
    expect(rowCopy(all, t, '24h').body).toBe('All 3 taken');
    const one = makeItem({
      type: 'medication_taken_summary',
      title: '',
      body: '',
      data: { ...SUMMARY_DATA, takenCount: 1, skippedCount: 0 },
    });
    expect(rowCopy(one, t, '12h').body).toBe('1 taken');
  });

  it('P blank server text: the alert renders unmarked (tiers) or scheduled (due) counts', () => {
    const tier = makeItem({ type: 'medication_slot_alert', title: '', body: '', data: SLOT_DATA });
    expect(rowCopy(tier, t, '12h')).toEqual({ title: 'Meds (8:00 AM)', body: "2 doses aren't marked yet" });
    const one = makeItem({
      type: 'medication_slot_alert',
      title: '',
      body: '',
      data: { ...SLOT_DATA, unmarkedCount: 1 },
    });
    expect(rowCopy(one, t, '12h').body).toBe("1 dose isn't marked yet");
    const due = makeItem({
      type: 'medication_slot_alert',
      title: '',
      body: '',
      data: { ...SLOT_DATA, slotTier: 'due', tier: 0 },
    });
    expect(rowCopy(due, t, '12h').body).toBe('3 medications scheduled');
  });

  it('N never a blank row: unusable counts fall back to the server text, then the title alone', () => {
    const noBody = makeItem({
      type: 'medication_slot_alert',
      title: "Meds not marked yet",
      body: '',
      data: { ...SLOT_DATA, unmarkedCount: 'two' as never },
    });
    expect(rowCopy(noBody, t, '12h')).toEqual({ title: 'Meds not marked yet', body: '' });
    const nothing = makeItem({ type: 'medication_slot_alert', title: '', body: '', data: {} });
    expect(slotFallbackCopy(nothing, t, '12h')).toBeNull();
    expect(rowCopy(nothing, t, '12h')).toEqual({ title: 'Medications', body: '' });
    const titleOnly = makeItem({ type: 'medication_slot_alert', title: 'Server title', body: '', data: SLOT_DATA });
    expect(rowCopy(titleOnly, t, '12h')).toEqual({ title: 'Server title', body: "2 doses aren't marked yet" });
    const bodyOnly = makeItem({ type: 'medication_slot_alert', title: '', body: 'Server body', data: {} });
    expect(rowCopy(bodyOnly, t, '12h')).toEqual({ title: 'Server body', body: '' });
  });

  it('wireCount accepts whole numbers (and digit strings) only', () => {
    expect([3, '3', 0, -1, 1.5, '1e2', 'x', null, undefined].map(wireCount)).toEqual([
      3, 3, 0, null, null, null, null, null, null,
    ]);
  });
});
