import { test, expect } from '../fixtures';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { openAllCircles } from '../unhappy/access/_helpers';
import { apiCreateEvent, dateInZone, recipientTimezone } from '../unhappy/writes/_helpers';

// W8, the TASK half: a completion still pending in its 5 s undo window when the
// caregiver switches to another circle must be delivered ONCE, to the circle it
// was tapped in. The dose half is todays-meds-undo.spec.ts (e); the task half was
// vitest only (undoFlushSentCircle.test.tsx).
//
// WHAT THIS CAN AND CANNOT PROVE. AppLayout keys the page <Outlet> by pathname,
// so every circle switch (header switcher or All circles) REMOUNTS the Tasks
// page and the pending entry is flushed by the old page, whose circle is still A.
// W8's per-entry circle is therefore not reachable through today's UI: with W8
// reverted in a scratch copy (the flush using the hook's circle) both tests stay
// green. What they do guard is the user-visible contract at a circle switch: the
// completion is SENT (the unmount flush), to A only, exactly once, and B is
// untouched. With the unmount flush dropped in a scratch copy both go red.
// Proofs logged in docs/plans/web-e2e-coverage-2026-10-02.md.
//
// Run-scoped owner with two fresh circles; the task is seeded through the API,
// completed and the circle switched through the UI.
//
// FALSIFY: PW_FALSIFY=task-complete-circle-switch presses Undo before switching,
// so no completion is sent and the "one POST, to A" assertion must go red.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('task-complete-circle-switch');
const COMPLETE = '/api/circles/:id/events/:eventId/complete';

const completedAt = (taskId: string): string | null =>
  dbQuery<{ completed_at: string | null }>(
    `select completed_at::text as completed_at from calendar_events where id = ${sqlStr(taskId)}::uuid`
  )[0]?.completed_at ?? null;

for (const via of ['header switcher (page stays mounted)', 'All circles (page unmounts)'] as const) {
  test(`Mark complete in circle A, switch to circle B via the ${via} inside the undo window: one completion POST, to A; the task is completed; B untouched`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const owner = await createScopedAccount('tcsw');
    const api = await ownerApi(request, owner);
    const circleA = await createCircle(api, uniq('tcswA'));
    const labelB = uniq('tcswB');
    const circleB = await createCircle(api, labelB);
    const tz = await recipientTimezone(api, circleA);
    const title = `ZZ_E2E_TCSW_${uniq('t').replace(/[^a-z0-9]/gi, '')}`;
    const task = await apiCreateEvent(api, circleA, { event_type: 'task', title, scheduled_date: dateInZone(tz, 0) });

    await cookieLogin(context, owner, baseURL);
    await page.goto(`/circles/${circleA}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 20_000 });
    const complete = page.getByRole('button', { name: `Mark "${title}" complete` });
    await expect(complete).toBeVisible({ timeout: 20_000 });

    const posts = countRequests(page, 'POST', COMPLETE);
    await complete.click();
    const undo = page.getByRole('button', { name: /Undo/ }).first();
    await expect(undo).toBeVisible();
    expect(completedAt(task.id), 'nothing written inside the undo window').toBeNull();
    if (FALSIFY) await undo.click();

    // Switch circles client-side, inside the window.
    if (via.startsWith('header')) {
      // Same section in the other circle: /circles/<B>/tasks, the Tasks page stays mounted.
      await page.getByRole('button', { name: /^Switch circle:/ }).click();
      await page.getByRole('menuitem', { name: new RegExp(`E2E ${labelB}`) }).click();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleB}/tasks$`));
    } else {
      await openAllCircles(page);
      await page.getByRole('link', { name: new RegExp(`^Open E2E ${labelB}`) }).click();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleB}`));
    }

    await posts.expectCount(1, { timeoutMs: 12_000 });
    const path = new URL(posts.requests[0].url()).pathname;
    expect(path).toBe(`/api/circles/${circleA}/events/${task.id}/complete`);
    expect(path).not.toContain(circleB);
    await expect.poll(() => completedAt(task.id), { timeout: 15_000, message: 'task completed in circle A' }).not.toBeNull();
    expect(
      dbQuery<{ n: string }>(
        `select count(*)::text as n from calendar_events where circle_id = ${sqlStr(circleB)}::uuid and completed_at is not null`
      )[0].n,
      'circle B has no completed event'
    ).toBe('0');
  });
}
