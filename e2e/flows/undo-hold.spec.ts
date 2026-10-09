import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, countRequests } from '../unhappy';
import { apiCreateEvent, dateInZone, purgeEventsTitled, recipientTimezone } from '../unhappy/writes/_helpers';

// WCAG 2.2.1 Timing Adjustable, web (owner decision 2026-10-08). A website
// cannot tell whether a screen reader is running, so the undo countdown PAUSES
// while the pointer moves over the badge or KEYBOARD focus is inside it, and
// resumes with the time left once both have gone. The write commits only when
// the timer actually runs out. In a real browser because jsdom has no hover and
// no `:focus-visible` heuristic (it answers `false` to every focus).
//
// Exercised on the Tasks page; the dose and as-needed badges share UndoBadge +
// lib/undoTimer and are pinned by vitest (TodaysMeds, AsNeededSection).

test.use({ persona: 'premiumOwner' });

const COMPLETE = /\/api\/circles\/[^/]+\/events\/[^/]+\/complete$/;

async function openTask(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  account: Parameters<typeof apiSession>[1],
  circleId: string
) {
  const title = uniqueLabel('Undo hold');
  const api = await apiSession(request, account);
  const tz = await recipientTimezone(api, circleId);
  // Dated well in the past so it sorts first on every open-task list.
  await apiCreateEvent(api, circleId, { event_type: 'task', title, scheduled_date: dateInZone(tz, -30) });
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  const done = page.getByRole('button', { name: `Mark "${title}" complete` });
  await expect(done).toBeVisible({ timeout: 20_000 });
  return { title, done };
}

test('a cursor resting where the badge appeared does not hold: the completion commits at 5 s', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const { title, done } = await openTask(page, request, account, circleId);
  try {
    const posts = countRequests(page, 'POST', COMPLETE);
    const started = Date.now();
    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && COMPLETE.test(new URL(r.url()).pathname),
      { timeout: 15_000 }
    );
    await done.click(); // the badge now sits under the resting cursor
    await answered;
    expect(Date.now() - started).toBeLessThan(9_000);
    expect(posts.count).toBe(1);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});

test('moving the pointer over the badge pauses the window; leaving resumes it, and it commits after', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const { title, done } = await openTask(page, request, account, circleId);
  try {
    const posts = countRequests(page, 'POST', COMPLETE);
    await done.click();
    const badge = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: `Undo ${title}` }) })
      .first();
    const box = await badge.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 4, box!.y + box!.height / 2, { steps: 3 });

    // Well past the 5 s window: nothing has been sent while it is hovered.
    await page.waitForTimeout(8_000);
    expect(posts.count, 'no completion POST while the badge is hovered').toBe(0);

    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && COMPLETE.test(new URL(r.url()).pathname),
      { timeout: 15_000 }
    );
    await page.mouse.move(5, 5, { steps: 3 });
    await answered;
    expect(posts.count).toBe(1);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});

test('keyboard focus on Undo pauses the window; tabbing away resumes it', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const { title, done } = await openTask(page, request, account, circleId);
  try {
    const posts = countRequests(page, 'POST', COMPLETE);
    await done.focus();
    await page.keyboard.press('Enter');
    // The badge replaced the focused button, so focus moved to its Undo.
    const undo = page.getByRole('button', { name: `Undo ${title}` }).first();
    await expect(undo).toBeFocused();

    await page.waitForTimeout(8_000);
    expect(posts.count, 'no completion POST while keyboard focus is on Undo').toBe(0);

    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && COMPLETE.test(new URL(r.url()).pathname),
      { timeout: 15_000 }
    );
    await page.keyboard.press('Tab');
    await answered;
    expect(posts.count).toBe(1);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});
