import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession, countRequests } from '../../unhappy';
import { apiCreateEvent, dateInZone, errorToast, purgeEventsTitled, recipientTimezone } from './_helpers';

// A TASK DELETED BEHIND THE OPEN PAGE, COMPLETED FROM A TASKS SURFACE (plan
// mobile-e2e-parity P12, web half).
//
// The calendar twin (recurring-complete-errors.spec) proves the 400/404 branch
// toasts and refetches the CALENDAR. The Tasks page and Home's Open tasks card
// read a different query — GET /circles/:id/tasks — so a refusal that refetches
// only `calendarEvents` leaves the dead row on those surfaces, still offering
// Done, which can only 404 again. Mobile completes tasks through the same hook
// on all three surfaces and refetches `tasks` too; this pins web to the same.
//
// NOTHING IS INJECTED: the task is deleted through the real API after the page
// has drawn it, and the real backend answers the press 404 NOT_FOUND.

test.use({ persona: 'premiumOwner' });

const TASKS_LIST = '/api/circles/:id/tasks';
const TOAST = 'That event no longer exists. Someone else may have deleted it.';

const SURFACES = [
  { name: 'Tasks page', path: (c: string) => `/circles/${c}/tasks`, heading: 'Tasks' },
  { name: 'Home Open tasks card', path: (c: string) => `/circles/${c}`, heading: 'Open tasks' },
] as const;

for (const s of SURFACES) {
  test(`${s.name}: a task deleted elsewhere, completed → 404 toast and the row leaves the list`, async ({
    page,
    request,
    account,
    circleId,
  }) => {
    const title = uniqueLabel('Stale task');
    const api = await apiSession(request, account);
    const tz = await recipientTimezone(api, circleId);
    const task = await apiCreateEvent(api, circleId, {
      event_type: 'task',
      title,
      // Dated well in the PAST: Home's Open tasks card shows only the 3 oldest open
      // tasks, so a task dated today fell off it once the persona seed's own open
      // tasks aged into overdue (a date bomb, not an app change). Oldest sorts first.
      scheduled_date: dateInZone(tz, -30),
    });
    try {
      await page.goto(s.path(circleId), { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible({ timeout: 15_000 });
      const done = page.getByRole('button', { name: `Mark "${title}" complete` });
      await expect(done).toBeVisible({ timeout: 20_000 });

      // Deleted by "another member" while the row is on screen.
      const del = await api.delete(`/api/circles/${circleId}/events/${task.id}`);
      expect(del.status(), `delete the task: ${await del.text()}`).toBe(200);

      const taskGets = countRequests(page, 'GET', TASKS_LIST);
      const answered = page.waitForResponse(
        (res) => res.request().method() === 'POST' && /\/events\/[^/]+\/complete$/.test(new URL(res.url()).pathname),
        { timeout: 20_000 }
      );
      await done.click();
      // The 5 s undo window runs first; then the real backend answers.
      const res = await answered;
      expect(res.status(), 'the real backend answer').toBe(404);

      await expect(errorToast(page, TOAST)).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => taskGets.count, { message: 'the tasks list was refetched after the 404', timeout: 10_000 })
        .toBeGreaterThan(0);
      // The dead row is gone — nothing left to press that can only fail again.
      await expect(page.getByRole('button', { name: `Mark "${title}" complete` })).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    } finally {
      purgeEventsTitled(circleId, title);
    }
  });
}
