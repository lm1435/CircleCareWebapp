import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import { apiSession, countRequests, dbCount, sqlStr, type ApiSession } from '../../unhappy';
import {
  apiCreateEvent,
  dateInZone,
  errorToast,
  openCalendarEvent,
  purgeEventsTitled,
  recipientTimezone,
  successToast,
} from './_helpers';

// RECURRING COMPLETION ERROR BRANCHES (useEventMutationOnError).
//
// Completing a later occurrence of a recurring task posts the series root plus
// the day. Two answers can never succeed on retry and must not read as "try
// again": 400 INVALID_OCCURRENCE_DATE (the series no longer lands on that day)
// and 404 NOT_FOUND (someone deleted it). Both must say what happened, REFETCH
// the calendar (the dead row on screen would only fail the next press the same
// way), and show no completed state.
//
// NOTHING IS INJECTED. The calendar is opened on a daily series' day +2, and
// only THEN is the series changed behind the open tab, the way another member
// would change it:
//   - shortened to end on day +1 (the row PATCH writes: `recurrence_end_date`),
//     so the REAL backend answers the press 400 INVALID_OCCURRENCE_DATE
//     (routes/calendarEvents.ts:4875-4884, `isOnPattern` utils/occurrence.ts:260-272);
//   - deleted through DELETE /events/:id?deleteScope=series, so the REAL backend
//     answers 404 NOT_FOUND (routes/calendarEvents.ts:4828-4833).
//
// "Stamps nothing" is asserted for the 400 only: the series still exists, and a
// resolver that let an off-pattern date through would materialize a child for
// day +2 and stamp it (utils/occurrence.ts:348+). For the 404 the series is gone
// before the press, so there is no row left that could be stamped and a
// database check would be vacuous; the real 404 answer is asserted instead.

test.use({ persona: 'premiumOwner' });

const COMPLETE = '/api/circles/:id/events/:eventId/complete';
const EVENTS_LIST = '/api/circles/:id/events';

interface Case {
  label: string;
  status: number;
  code: string;
  toast: string;
  /** Change the series behind the open tab. */
  stale(args: { api: ApiSession; circleId: string; rootId: string; start: string; dayAfterStart: string }): Promise<void>;
  stampsNothingCheck: boolean;
}

const CASES: Case[] = [
  {
    label: '400 INVALID_OCCURRENCE_DATE',
    status: 400,
    code: 'INVALID_OCCURRENCE_DATE',
    toast: 'This event no longer repeats on that day — the calendar has been refreshed.',
    async stale({ rootId, dayAfterStart }) {
      sqlExec(
        `update calendar_events set recurrence_end_date = ${sqlStr(dayAfterStart)}::date, updated_at = now()
          where id = ${sqlStr(rootId)}::uuid;`
      );
    },
    stampsNothingCheck: true,
  },
  {
    label: '404 NOT_FOUND',
    status: 404,
    code: 'NOT_FOUND',
    toast: 'That event no longer exists. Someone else may have deleted it.',
    async stale({ api, circleId, rootId }) {
      const res = await api.delete(`/api/circles/${circleId}/events/${rootId}?deleteScope=series`);
      expect(res.status(), `delete the series: ${await res.text()}`).toBe(200);
    },
    stampsNothingCheck: false,
  },
];

for (const c of CASES) {
  test(`recurring task occurrence: series changed behind the open tab, complete answered ${c.label} by the backend → toast, events refetched, no completed state`, async ({
    page,
    request,
    account,
    circleId,
  }) => {
    const title = uniqueLabel('RC err');
    const api = await apiSession(request, account);
    const tz = await recipientTimezone(api, circleId);
    const start = dateInZone(tz, 0);
    const occurrence = dateInZone(tz, 2);
    const root = await apiCreateEvent(api, circleId, {
      event_type: 'task',
      title,
      scheduled_date: start,
      recurrence_rule: 'daily',
    });
    const r = `${sqlStr(root.id)}::uuid`;
    try {
      const detail = await openCalendarEvent(page, circleId, occurrence, title);
      const markComplete = detail.getByRole('button', { name: 'Mark complete', exact: true });
      await expect(markComplete).toBeEnabled();

      const completes = countRequests(page, 'POST', COMPLETE);
      const eventsGets = countRequests(page, 'GET', EVENTS_LIST);
      // Quiet baseline: the calendar is idle before the press, so any events
      // GET after it is the error branch's refetch.
      await eventsGets.expectCount(0, { settleMs: 1_500 });

      await c.stale({ api, circleId, rootId: root.id, start, dayAfterStart: dateInZone(tz, 1) });

      const answered = page.waitForResponse(
        (res) => res.request().method() === 'POST' && /\/events\/[^/]+\/complete$/.test(new URL(res.url()).pathname),
        { timeout: 20_000 }
      );
      await markComplete.click();
      const res = await answered;
      expect(res.status(), 'the real backend answer').toBe(c.status);
      expect(((await res.json()) as { error?: { code?: string } }).error?.code, 'the real error code').toBe(c.code);

      await expect(errorToast(page, c.toast)).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => eventsGets.count, { message: 'the calendar events were refetched after the error', timeout: 10_000 })
        .toBeGreaterThan(0);
      await completes.expectCount(1);

      // No completed state anywhere: no "Completed on/by" and no success toast.
      await expect(page.getByText(/^Completed (on|by)$/)).toHaveCount(0);
      await expect(successToast(page, 'Marked complete')).toHaveCount(0);

      if (c.stampsNothingCheck) {
        expect(
          dbCount(`select 1 from calendar_events where (id = ${r} or parent_event_id = ${r}) and completed_at is not null`),
          'nothing stamped'
        ).toBe(0);
        expect(
          dbCount(`select 1 from calendar_events where parent_event_id = ${r} and scheduled_date = ${sqlStr(occurrence)}::date`),
          'no occurrence row materialized for the off-pattern day'
        ).toBe(0);
      }
    } finally {
      purgeEventsTitled(circleId, title);
    }
  });
}
