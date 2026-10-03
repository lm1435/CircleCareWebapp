import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// approved-recs-2026-09-30 B6 / PK10: changing the Profile time zone ASKS FIRST
// when an owned circle's recipient has no zone of their own (their dose times
// follow the owner's zone). Cancel keeps the old zone; confirm saves; with no
// such circle there is no prompt. Mobile twin:
// mobile/.maestro/parity/profile/pk10-tz-warning.yaml.
//
// Run-scoped accounts only.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const zoneOf = (userId: string): string | null =>
  dbQuery<{ timezone: string | null }>(
    `select timezone from users where id = ${sqlStr(userId)}::uuid`
  )[0]?.timezone ?? null;

test('owner with a recipient-without-account circle: prompt, cancel keeps, confirm saves', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('tz-owner');
  const ownerSession = await ownerApi(request, owner);
  const recipient = uniq('tzrecipient');
  const circleId = await createCircle(ownerSession, recipient);
  expect(circleId).toBeTruthy();
  const before = zoneOf(owner.userId);
  const target = before === 'America/Chicago' ? 'America/Los_Angeles' : 'America/Chicago';
  const targetLabel = target === 'America/Chicago' ? 'Central' : 'Pacific';

  await cookieLogin(context, owner, baseURL);
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const select = page.getByLabel('Time zone');
  await expect(select).toBeVisible({ timeout: 20_000 });

  // 1. Cancel keeps the old zone.
  await select.selectOption(target);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Change your time zone?')).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText(`E2E ${recipient}`);
  await expect(dialog).toContainText(targetLabel);
  // Let the dialog's entrance animation finish: axe reads the mid-fade blended
  // colours as a contrast failure that never exists once it settles.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  );
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    axe.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => `${n.html.slice(0, 140)} :: ${n.any[0]?.message ?? ''}`).join(' ;; ')}`
    )
  ).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(dialog).toBeHidden();
  await expect(select).toHaveValue(before ?? 'America/New_York');
  expect(zoneOf(owner.userId)).toBe(before);

  // 2. Confirm saves.
  await select.selectOption(target);
  await expect(dialog.getByText('Change your time zone?')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Change time zone' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => zoneOf(owner.userId), { timeout: 20_000 }).toBe(target);
  await expect(select).toHaveValue(target);
});

test('owner with no dependent circle: the zone saves with no prompt', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('tz-solo');
  await ownerApi(request, owner); // no circles at all
  const before = zoneOf(owner.userId);
  const target = before === 'America/Chicago' ? 'America/Los_Angeles' : 'America/Chicago';

  await cookieLogin(context, owner, baseURL);
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const select = page.getByLabel('Time zone');
  await expect(select).toBeVisible({ timeout: 20_000 });
  await select.selectOption(target);
  await expect.poll(() => zoneOf(owner.userId), { timeout: 20_000 }).toBe(target);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
