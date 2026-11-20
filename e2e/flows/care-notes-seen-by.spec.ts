import type { Browser, BrowserContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { sqlExec } from '../db';
import { apiSession, countRequests, dbCount, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { apiCreateCareNote } from '../unhappy/writes/_helpers';

// "SEEN BY" ON DAILY CARE NOTES (1.4.4), end to end against the real backend.
//
// A passive read receipt: member B opens Notes and A's note becomes "Seen by B" for A. Real
// geometry matters here (a row must be >= 50% visible for 1 s), which jsdom cannot give, so this is
// where it is proven: the visible note is marked, a note below the fold that was never scrolled
// into view is NOT, and A viewing their own note produces nothing.
//
// SELF-CONTAINED SCENE: fresh run-scoped owner (A) and member (B), one fresh circle. Needs a backend
// that serves POST /care-notes/seen (migration care_note_reads). FALSIFY: PW_FALSIFY=care-notes-seen-by
// scrolls the bottom note into view in the negative test, so its "never marked" control must fail.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

const FIRST_B = 'Beatriz';

async function loginCtx(browser: Browser, baseURL: string | undefined, acc: ScopedAccount): Promise<BrowserContext> {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx = await browser.newContext({
    baseURL: origin,
    timezoneId: process.env.PW_E2E_TZ || 'America/Denver',
    viewport: { width: 1280, height: 600 },
  });
  await cookieLogin(ctx, acc, baseURL);
  return ctx;
}

const readsFor = (noteId: string, userId?: string): number =>
  dbCount(
    `select 1 from care_note_reads where note_id = ${sqlStr(noteId)}::uuid` +
      (userId ? ` and user_id = ${sqlStr(userId)}::uuid` : '')
  );

async function scene(request: Parameters<typeof apiSession>[0], tag: string) {
  const a = await createScopedAccount('seen-a');
  const aApi = await apiSession(request, a);
  const circleId = await createCircle(aApi, `seen ${tag}`);
  const b = await createScopedAccount('seen-b');
  sqlExec(`update public.users set first_name = ${sqlStr(FIRST_B)} where id = ${sqlStr(b.userId)}::uuid;`);
  const bApi = await apiSession(request, b);
  const invite = await createInvite(aApi, circleId);
  const acc = await bApi.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, b.userId)).toBe(1);
  return { a, b, aApi, bApi, circleId };
}

test('member B reading a note by A makes it "Seen by B" for A, and not for B', async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  const tag = uniq('sb').replace(/[^a-z0-9]/g, '');
  const { a, b, aApi, circleId } = await scene(request, tag);
  const body = `Seen-by note ${tag}`;
  const noteId = await apiCreateCareNote(aApi, circleId, body);
  const ctxB = await loginCtx(browser, baseURL, b);
  const ctxA = await loginCtx(browser, baseURL, a);
  try {
    const pageB = await ctxB.newPage();
    const posted = pageB.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === `/api/circles/${circleId}/care-notes/seen`,
      { timeout: 30_000 }
    );
    await pageB.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    await expect(pageB.getByText(body)).toBeVisible({ timeout: 20_000 });
    const req = await posted;
    const sent = req.postDataJSON() as { notes: Array<Record<string, unknown>> };
    expect(sent.notes).toHaveLength(1);
    expect(Object.keys(sent.notes[0]).sort()).toEqual(['note_id', 'updated_at']);
    expect(sent.notes[0].note_id).toBe(noteId);
    await expect.poll(() => readsFor(noteId, b.userId), { timeout: 15_000 }).toBe(1);

    // B never reads "Seen by" about themself.
    await expect(pageB.getByText(/Seen by/)).toHaveCount(0);

    // A opens Notes and sees "Seen by Beatriz" under the note.
    const pageA = await ctxA.newPage();
    await pageA.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const row = pageA.locator('li', { hasText: body });
    await expect(row.getByText(`Seen by ${FIRST_B}`)).toBeVisible({ timeout: 20_000 });
    // Real text in the row, no "Not seen" anywhere.
    await expect(pageA.getByText(/Not seen/i)).toHaveCount(0);
    // A viewing their own note produced no read for A.
    expect(readsFor(noteId, a.userId)).toBe(0);
    // WCAG AA (contrast included) with the line present.
    await checkA11y(pageA, `/circles/${circleId}/notes`, testInfo, { include: 'main' });
  } finally {
    await ctxA.close();
    await ctxB.close();
    await aApi.delete(`/api/circles/${circleId}/care-notes/${noteId}`);
  }
});

test('negative: A viewing their own note sends nothing; a note below the fold B never scrolled to is not marked', async ({
  browser,
  request,
  baseURL,
}) => {
  const falsify = (process.env.PW_FALSIFY ?? '').split(',').includes('care-notes-seen-by');
  const tag = uniq('sb').replace(/[^a-z0-9]/g, '');
  const { a, b, aApi, circleId } = await scene(request, tag);
  // The bottom note is created FIRST, so it is the OLDEST: the list is newest first and it sits last.
  const bottomBody = `Bottom note ${tag}`;
  const ids: string[] = [];
  const bottomId = await apiCreateCareNote(aApi, circleId, bottomBody);
  ids.push(bottomId);
  const topBodies: string[] = [];
  for (let i = 0; i < 12; i++) {
    const text = `Filler note ${i} ${tag} ${'x'.repeat(120)}`;
    topBodies.push(text);
    ids.push(await apiCreateCareNote(aApi, circleId, text));
  }
  const topId = ids[ids.length - 1]; // newest: first on screen
  const ctxA = await loginCtx(browser, baseURL, a);
  const ctxB = await loginCtx(browser, baseURL, b);
  try {
    // A views their OWN notes: no POST at all, no read rows for A.
    const pageA = await ctxA.newPage();
    const aPosts = countRequests(pageA, 'POST', '/api/circles/:id/care-notes/seen');
    await pageA.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    await expect(pageA.getByText(bottomBody)).toBeAttached({ timeout: 20_000 });
    await pageA.waitForTimeout(3500); // dwell (1 s) + debounce (1.5 s) + slack
    await aPosts.expectCount(0, { settleMs: 500 });
    for (const id of ids) expect(readsFor(id, a.userId)).toBe(0);
    await expect(pageA.getByText(/Seen by/)).toHaveCount(0);

    // B opens Notes: the top note is read, the bottom one (below the fold) is not.
    const pageB = await ctxB.newPage();
    await pageB.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const bottomRow = pageB.locator('li', { hasText: bottomBody });
    await expect(bottomRow).toBeAttached({ timeout: 20_000 });
    const box = await bottomRow.boundingBox();
    expect(box, 'bottom row laid out').not.toBeNull();
    expect(box!.y, 'precondition: the bottom note is below the fold (viewport height 600)').toBeGreaterThan(600);
    await expect.poll(() => readsFor(topId, b.userId), { timeout: 20_000 }).toBe(1);
    await pageB.waitForTimeout(3500);
    expect(readsFor(bottomId), 'the never-scrolled bottom note has no read').toBe(0);

    // Positive control: scrolled into view for >= 1 s, it IS marked. (Falsify mode scrolls first and
    // so makes the "never marked" assertion above fail on purpose.)
    if (falsify) {
      await bottomRow.scrollIntoViewIfNeeded();
      await pageB.waitForTimeout(3500);
      expect(readsFor(bottomId), 'FALSIFY: scrolled-into-view note was marked').toBe(0);
    }
    await bottomRow.scrollIntoViewIfNeeded();
    await expect.poll(() => readsFor(bottomId, b.userId), { timeout: 20_000 }).toBe(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
    for (const id of ids) await aApi.delete(`/api/circles/${circleId}/care-notes/${id}`);
  }
});

// FULL READER LIST (3+ readers): the caption becomes a button that reveals every reader name.
// Real geometry (viewport clipping, horizontal scroll at 360 px) and axe with the popover open.
test('4 readers: caption is a button; hover shows the full list, focus + Escape works, axe passes, no horizontal scroll at 360 px', async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  const tag = uniq('sb').replace(/[^a-z0-9]/g, '');
  const { a, aApi, circleId } = await scene(request, tag);
  const body = `Reader list note ${tag}`;
  const noteId = await apiCreateCareNote(aApi, circleId, body);
  // Four readers other than the author (B from the scene plus these three; B is the 4th via SQL too).
  const firstNames = ['Carla', 'Diego', 'Elena', 'Felix'];
  const extra: ScopedAccount[] = [];
  for (const [i, first] of firstNames.entries()) {
    const acc = await createScopedAccount(`seen-r${i}`);
    sqlExec(`update public.users set first_name = ${sqlStr(first)}::text where id = ${sqlStr(acc.userId)}::uuid;`);
    const api = await apiSession(request, acc);
    const invite = await createInvite(aApi, circleId);
    const res = await api.post(`/api/invites/code/${invite.code}/accept`);
    expect(res.status(), await res.text()).toBeLessThan(300);
    extra.push(acc);
  }
  // Reads written straight to the table (the passive-read geometry is proven by the specs above).
  for (const acc of extra) {
    sqlExec(
      `insert into public.care_note_reads (note_id, circle_id, user_id, note_updated_at) ` +
        `select id, circle_id, ${sqlStr(acc.userId)}::uuid, updated_at from public.care_notes where id = ${sqlStr(noteId)}::uuid;`
    );
  }
  const ctx = await loginCtx(browser, baseURL, a);
  try {
    const page = await ctx.newPage();
    await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('li', { hasText: body });
    const caption = row.getByRole('button', { name: /^Seen by Carla, Diego and 2 others$/ });
    await expect(caption).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('group', { name: 'Seen by' })).toHaveCount(0);

    // Hover shows the whole list, in order.
    await caption.hover();
    const list = page.getByRole('group', { name: 'Seen by' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveText(firstNames);
    await expect(caption).toHaveAttribute('aria-expanded', 'true');
    // Hoverable: the pointer can move onto the list and it stays open.
    await list.hover();
    await page.waitForTimeout(400);
    await expect(list).toBeVisible();
    await checkA11y(page, `/circles/${circleId}/notes`, testInfo, { include: 'main' });

    // Leaving closes it; keyboard focus opens it; Escape closes it with focus kept.
    await page.mouse.move(2, 2);
    await expect(list).toBeHidden();
    await caption.focus();
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(caption).toBeFocused();
    await expect(caption).toHaveAttribute('aria-expanded', 'false');

    // 360 px wide: open by click, no horizontal page scroll, list inside the viewport.
    await page.setViewportSize({ width: 360, height: 700 });
    await caption.click();
    await expect(list).toBeVisible();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(m.sw, 'no horizontal scroll with the popover open').toBeLessThanOrEqual(m.cw);
    const box = await list.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await checkA11y(page, `/circles/${circleId}/notes`, testInfo, { include: 'main' });
  } finally {
    await ctx.close();
    await aApi.delete(`/api/circles/${circleId}/care-notes/${noteId}`);
  }
});

test('negative: 2 readers have no button and no popover', async ({ browser, request, baseURL }) => {
  const tag = uniq('sb').replace(/[^a-z0-9]/g, '');
  const { a, aApi, b, circleId } = await scene(request, tag);
  const body = `Two readers note ${tag}`;
  const noteId = await apiCreateCareNote(aApi, circleId, body);
  const c = await createScopedAccount('seen-c');
  sqlExec(`update public.users set first_name = 'Carla' where id = ${sqlStr(c.userId)}::uuid;`);
  const cApi = await apiSession(request, c);
  const invite = await createInvite(aApi, circleId);
  expect((await cApi.post(`/api/invites/code/${invite.code}/accept`)).status()).toBeLessThan(300);
  for (const uid of [b.userId, c.userId]) {
    sqlExec(
      `insert into public.care_note_reads (note_id, circle_id, user_id, note_updated_at) ` +
        `select id, circle_id, ${sqlStr(uid)}::uuid, updated_at from public.care_notes where id = ${sqlStr(noteId)}::uuid;`
    );
  }
  const ctx = await loginCtx(browser, baseURL, a);
  try {
    const page = await ctx.newPage();
    await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('li', { hasText: body });
    const line = row.getByText(`Seen by ${FIRST_B} and Carla`);
    await expect(line).toBeVisible({ timeout: 20_000 });
    await line.hover();
    await expect(row.getByRole('button', { name: /Seen by/ })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Seen by' })).toHaveCount(0);
  } finally {
    await ctx.close();
    await aApi.delete(`/api/circles/${circleId}/care-notes/${noteId}`);
  }
});

// TALL NOTE: a 2000-character note on a short screen is more than twice the viewport high, so it
// can never be 50% visible (the ratio is against the row's own area). The second rule (the visible
// part covers >= 60% of the viewport height) must still mark it. jsdom has no layout, so real
// geometry is proven here.
test('tall note: a note more than twice the viewport height is marked "Seen by B" once it fills the screen', async ({
  browser,
  request,
  baseURL,
}) => {
  const tag = uniq('sb').replace(/[^a-z0-9]/g, '');
  const { a, b, aApi, circleId } = await scene(request, tag);
  // Many short lines (the API maximum is 2000 characters) so the rendered note is very tall.
  const head = `Tall note ${tag}`;
  const lines = [head];
  for (let i = 1; head.length + lines.slice(1).join('\n').length < 1900; i++) lines.push(`l${i}`);
  const body = lines.join('\n').slice(0, 2000);
  expect(body.length).toBeLessThanOrEqual(2000);
  const noteId = await apiCreateCareNote(aApi, circleId, body);
  const ctxB = await browser.newContext({
    baseURL: new URL(baseURL ?? 'http://localhost:5173').origin,
    timezoneId: process.env.PW_E2E_TZ || 'America/Denver',
    viewport: { width: 390, height: 500 },
  });
  await cookieLogin(ctxB, b, baseURL);
  const ctxA = await loginCtx(browser, baseURL, a);
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const rowB = pageB.locator('li', { hasText: head });
    await expect(rowB).toBeAttached({ timeout: 20_000 });
    const box = await rowB.boundingBox();
    expect(box, 'tall row laid out').not.toBeNull();
    expect(box!.height, 'precondition: the note is more than twice the 500 px viewport').toBeGreaterThan(1000);
    // Scroll so the note fills the screen (its middle), then just read for a few seconds.
    await pageB.evaluate((y) => window.scrollTo(0, y), Math.max(0, box!.y + box!.height / 2 - 250));
    await pageB.waitForTimeout(3500);
    await expect.poll(() => readsFor(noteId, b.userId), { timeout: 20_000 }).toBe(1);

    const pageA = await ctxA.newPage();
    await pageA.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const rowA = pageA.locator('li', { hasText: head });
    await expect(rowA.getByText(`Seen by ${FIRST_B}`)).toBeVisible({ timeout: 20_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
    await aApi.delete(`/api/circles/${circleId}/care-notes/${noteId}`);
  }
});
