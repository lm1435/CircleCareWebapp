import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// TODAY'S SHIFTS NUDGE ("{member} joined {name}'s circle" / "Share the care with shifts").
// Shown when the circle's NEWEST caregiver joined < 14 days ago and no shifts exist yet,
// and never to the newest joiner themselves:
//   premium circle  -> owner and editor members see it; "Set up shifts" opens the shifts schedule
//   FREE circle     -> only the OWNER sees it; "Set up shifts" opens the shifts teaser
//   free non-owner member -> no card.
// Each test builds owner + two caregivers (one old, one joined yesterday).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

async function arrange(request: import('@playwright/test').APIRequestContext, label: string, tier: 'premium' | 'free') {
  const owner = await createScopedAccount(label);
  const older = await createScopedAccount(`${label}o`);
  const newest = await createScopedAccount(`${label}n`);
  const session = await ownerApi(request, owner);
  const base = uniq(label);
  const recipient = `E2E ${base}`;
  const circleId = await createCircle(session, base);
  const c = `${sqlStr(circleId)}::uuid`;
  sqlExec(`
    insert into circle_memberships (circle_id, user_id, role, is_care_recipient, joined_at, view_only)
    values (${c}, ${sqlStr(older.userId)}::uuid, 'member', false, now() - interval '30 days', false),
           (${c}, ${sqlStr(newest.userId)}::uuid, 'member', false, now() - interval '1 day', false);
    update circle_memberships set joined_at = now() - interval '60 days' where circle_id = ${c} and user_id = ${sqlStr(owner.userId)}::uuid;
    update users set first_name = 'Newcomer' where id = ${sqlStr(newest.userId)}::uuid;
    update users set plan_tier = ${sqlStr(tier)} where id = ${sqlStr(owner.userId)}::uuid;
  `);
  return { owner, older, newest, circleId, recipient };
}

const card = (page: import('@playwright/test').Page) => page.getByTestId('shifts-nudge-card');

test('premium circle: the owner sees it, "Set up shifts" opens the shifts schedule, and it is gone afterwards', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const a = await arrange(request, 'nudgep', 'premium');
  await cookieLogin(context, a.owner, baseURL);
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  // Next-step card has priority: snooze it so the nudge can show.
  const step = page.getByTestId('next-step-card');
  await expect(step.or(card(page)).first()).toBeVisible({ timeout: 30_000 });
  while (await step.isVisible().catch(() => false)) {
    await step.getByRole('button', { name: 'Not now' }).click();
    await page.waitForTimeout(300);
  }
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText(`Newcomer joined ${a.recipient}'s circle`);
  await expect(card(page)).toContainText('Share the care with shifts');
  await card(page).getByRole('button', { name: 'Set up shifts' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${a.circleId}/calendar\\?mode=shifts`));
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Today');
  await expect(card(page)).toHaveCount(0);
});

test('free circle: the OWNER sees it and "Set up shifts" opens the shifts teaser (not the schedule)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const a = await arrange(request, 'nudgef', 'free');
  await cookieLogin(context, a.owner, baseURL);
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  const step = page.getByTestId('next-step-card');
  await expect(step.or(card(page)).first()).toBeVisible({ timeout: 30_000 });
  while (await step.isVisible().catch(() => false)) {
    await step.getByRole('button', { name: 'Not now' }).click();
    await page.waitForTimeout(300);
  }
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: 'Set up shifts' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).not.toHaveURL(/mode=shifts/);
});

test('free circle: a non-owner member never sees it', async ({ page, context, request, baseURL }) => {
  const a = await arrange(request, 'nudgem', 'free');
  await cookieLogin(context, a.older, baseURL);
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Today', { timeout: 30_000 });
  await expect(page.getByTestId('quick-access-grid')).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(card(page)).toHaveCount(0);
});

test('the newest joiner is never shown their own "joined" card', async ({ page, context, request, baseURL }) => {
  const a = await arrange(request, 'nudgen', 'premium');
  await cookieLogin(context, a.newest, baseURL);
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Today', { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await expect(card(page)).toHaveCount(0);
});
