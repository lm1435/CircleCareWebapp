import { test, expect, uniqueLabel } from '../../fixtures';
import { API_ERRORS, apiSession, countRequests, dbQuery, failRequest, sqlStr } from '../../unhappy';
import { apiCreateEvent, dateInZone, errorToast, purgeEventsTitled, recipientTimezone } from './_helpers';

// QUIET RETRY ON A NETWORK DROP (1.4.3 item 7, web half).
//
// A completion whose request dies on the network is retried quietly (2 s
// backoff, lib/writeRetryQueue.ts); the user sees NO per-item error. If the
// retry lands the task is completed exactly once. A definite refusal (403) is
// NOT retried and keeps today's copy. The real backend answers the retry.

test.use({ persona: 'premiumOwner' });

const COMPLETE = '/api/circles/:id/events/:eventId/complete';
const TASKS = (c: string) => `/circles/${c}/tasks`;

/** A date older than every open task in the circle, so the new task is on the Tasks page. */
function olderThanEveryOpenTask(circleId: string, tz: string): string {
  const floor = dateInZone(tz, -30);
  const [{ oldest }] = dbQuery<{ oldest: string | null }>(
    `select (min(scheduled_date) - 1)::text as oldest from calendar_events
       where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'task' and completed_at is null`
  );
  return oldest && oldest < floor ? oldest : floor;
}

async function openTaskRow(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  account: Parameters<typeof apiSession>[1],
  circleId: string,
  title: string
) {
  const api = await apiSession(request, account);
  const tz = await recipientTimezone(api, circleId);
  const task = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title,
    scheduled_date: olderThanEveryOpenTask(circleId, tz),
  });
  await page.goto(TASKS(circleId), { waitUntil: 'domcontentloaded' });
  const done = page.getByRole('button', { name: `Mark "${title}" complete` });
  await expect(done).toBeVisible({ timeout: 20_000 });
  return { task, done };
}

const completedAt = (id: string) =>
  dbQuery<{ completed_at: string | null }>(
    `select completed_at from calendar_events where id = ${sqlStr(id)}::uuid`
  )[0]?.completed_at ?? null;

test('a network drop on Done is retried quietly: no error toast, completed once', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const title = uniqueLabel('Retry task');
  try {
    const { task, done } = await openTaskRow(page, request, account, circleId, title);
    // The first completion request dies on the network; the retry goes through.
    const fault = await failRequest(page, 'POST', COMPLETE, { abort: true, times: 1 });
    const posts = countRequests(page, 'POST', COMPLETE);
    await done.click();
    // The 5 s undo window runs, the first send fails, the 2 s backoff resends.
    await expect.poll(() => completedAt(task.id), { timeout: 30_000 }).not.toBeNull();
    await fault.expectHits(1);
    expect(posts.count, 'first attempt (aborted) + one retry').toBe(2);
    // Quiet: neither the per-item failure toast nor an aggregated notice.
    await expect(errorToast(page, "Couldn't save")).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /couldn.t save/i })).toHaveCount(0);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});

test('a 403 on Done is NOT retried: one request, today\'s error', async ({ page, request, account, circleId }) => {
  const title = uniqueLabel('Refused task');
  try {
    const { task, done } = await openTaskRow(page, request, account, circleId, title);
    const fault = await failRequest(page, 'POST', COMPLETE, { ...API_ERRORS.viewOnly, times: 5 });
    const posts = countRequests(page, 'POST', COMPLETE);
    await done.click();
    await fault.expectHits(1, { timeoutMs: 20_000 });
    await page.waitForTimeout(6_000); // past the 2 s retry step
    expect(posts.count, 'a refusal is never retried').toBe(1);
    expect(completedAt(task.id)).toBeNull();
  } finally {
    purgeEventsTitled(circleId, title);
  }
});
