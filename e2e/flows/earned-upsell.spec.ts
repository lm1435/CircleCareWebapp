import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, uniq } from '../unhappy/auth-invites/_helpers';

// The EARNED upsell on web (PK28(1), docs/plans/approved-recs-2026-09-30.md): the SERVER decides
// (GET /subscription-status `upsell`: free OWNER, account >= 24 h, a co-member joined or >= 3 doses,
// < 3 impressions, 14-day cooldown, per-trigger dismissal); the web only raises it from Overview,
// once per session, by opening the existing /upgrade page in the earned_invite context.
// Mobile twin: mobile/.maestro/parity/prompts/earned-upsell-{shown,not-owner,day-zero}.yaml.
// Real backend; users.upsell_* and created_at are seeded with SQL (the app cannot write them).

interface Acct {
  email: string;
  password: string;
  userId: string;
}

async function account(prefix: string, ageDays: number): Promise<Acct> {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, 'free');
  sqlExec(
    `update users set created_at = now() - interval '${ageDays} days' * 1 where id = ${sqlStr(userId)};`
  );
  return { email, password: ACCOUNT_PASSWORD, userId };
}

/** A circle owned by `owner` that `member` has joined (the "co-member joined" value signal). */
function circleWithMember(owner: Acct, member: Acct): string {
  const id = randomUUID();
  const name = uniq('Upsell');
  sqlExec(`
    insert into care_circles (id, owner_id, name, recipient_name)
    values (${sqlStr(id)}, ${sqlStr(owner.userId)}, ${sqlStr(name)}, ${sqlStr(name)});
    insert into circle_memberships (circle_id, user_id, role)
    values (${sqlStr(id)}, ${sqlStr(owner.userId)}, 'owner'), (${sqlStr(id)}, ${sqlStr(member.userId)}, 'member')
    on conflict (circle_id, user_id) do nothing;
  `);
  return id;
}

function upsellRow(userId: string) {
  return dbQuery<{
    plan_tier: string;
    upsell_impressions: number;
    upsell_last_shown_at: string | null;
    upsell_dismissed_reasons: string[] | null;
  }>(
    `select plan_tier, upsell_impressions, upsell_last_shown_at, upsell_dismissed_reasons
       from users where id = ${sqlStr(userId)}`
  )[0];
}

const earnedHeading = (page: Page) => page.getByRole('heading', { name: /Your circle is\s*growing\./ });

/** Every path this page visits, so "never went to /upgrade" is checked, not assumed. */
function trackPaths(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) seen.push(new URL(f.url()).pathname);
  });
  return seen;
}

/** Wait past the hook's settle window + a status fetch, then prove nothing happened. */
async function expectNeverAsked(page: Page, paths: string[]): Promise<void> {
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3_000);
  expect(paths).not.toContain('/upgrade');
  await expect(earnedHeading(page)).toHaveCount(0);
}

/** In-app (history) navigation: the SPA stays alive, so module state survives. */
async function spaNavigate(page: Page, to: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({ usr: null, key: String(Math.random()), idx: 99 }, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, to);
}

async function login(context: BrowserContext, a: Acct, baseURL: string | undefined) {
  await cookieLogin(context, a, baseURL);
}

test.describe('earned upsell (web)', () => {
  test.setTimeout(90_000);

  test('eligible free owner: asked on Overview in the earned context; Back records the dismissal; never asked again this session', async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account('upown', 2);
    const member = await account('upmem', 2);
    const circleId = circleWithMember(owner, member);
    await login(context, owner, baseURL);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(earnedHeading(page)).toBeVisible();

    // The impression is recorded server-side the moment it is shown (shared cap with mobile).
    await expect
      .poll(() => upsellRow(owner.userId).upsell_impressions, { timeout: 10_000 })
      .toBe(1);
    expect(upsellRow(owner.userId).upsell_last_shown_at).not.toBeNull();

    await page.getByRole('button', { name: /Back to profile/i }).click();
    await page.waitForURL(/\/profile$/);
    await expect
      .poll(() => upsellRow(owner.userId).upsell_dismissed_reasons ?? [], { timeout: 10_000 })
      .toContain('invite_accepted');
    expect(upsellRow(owner.userId).plan_tier).toBe('free');

    // Once per session: reset the server so it would say YES again, then come back to Overview
    // WITHOUT a reload (the guard is client state). Only the client guard can stop this ask.
    sqlExec(`update users set upsell_impressions = 0, upsell_last_shown_at = null,
               upsell_last_offered_at = null, upsell_dismissed_reasons = '{}'
             where id = ${sqlStr(owner.userId)};`);
    // Make the page re-ask the server (tab refocus refetches subscription-status) and PROVE the
    // server said yes again: a granted offer stamps upsell_last_offered_at.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect
      .poll(
        () =>
          dbQuery<{ o: string | null }>(
            `select upsell_last_offered_at as o from users where id = ${sqlStr(owner.userId)}`
          )[0]?.o ?? null,
        { timeout: 10_000 }
      )
      .not.toBeNull();
    const paths = trackPaths(page);
    await spaNavigate(page, `/circles/${circleId}`);
    await page.waitForURL(new RegExp(`/circles/${circleId}$`));
    await page.waitForTimeout(3_500);
    expect(paths).not.toContain('/upgrade');
    await expect(earnedHeading(page)).toHaveCount(0);
    expect(upsellRow(owner.userId).upsell_impressions).toBe(0);
  });

  test('the free co-member (never an owner) is never asked, and nothing is recorded', async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account('upo2', 2);
    const member = await account('upm2', 2);
    const circleId = circleWithMember(owner, member);
    await login(context, member, baseURL);
    const paths = trackPaths(page);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expectNeverAsked(page, paths);
    const row = upsellRow(member.userId);
    expect(row.upsell_impressions ?? 0).toBe(0);
    expect(row.upsell_last_shown_at).toBeNull();
  });

  test('an eligible free owner viewing a circle they only JOINED is not asked there (owner of THIS circle only)', async ({
    page,
    context,
    baseURL,
  }) => {
    const host = await account('uphost', 2);
    const me = await account('upme', 2);
    const guest = await account('upgst', 2);
    const joinedId = circleWithMember(host, me); // I only joined this one
    circleWithMember(me, guest); // ...but I own another circle someone joined: server says YES
    await login(context, me, baseURL);
    const paths = trackPaths(page);

    await page.goto(`/circles/${joinedId}`, { waitUntil: 'domcontentloaded' });
    await expectNeverAsked(page, paths);
    expect(upsellRow(me.userId).upsell_impressions ?? 0).toBe(0);
  });

  test('day zero: an owner whose account is minutes old is not asked, even with a co-member', async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account('upnew', 0);
    const member = await account('upm3', 2);
    const circleId = circleWithMember(owner, member);
    await login(context, owner, baseURL);
    const paths = trackPaths(page);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expectNeverAsked(page, paths);
    expect(upsellRow(owner.userId).upsell_impressions ?? 0).toBe(0);
  });

  test('cap respected: an owner with 3 impressions already is not asked again', async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account('upcap', 60);
    const member = await account('upm4', 60);
    const circleId = circleWithMember(owner, member);
    sqlExec(`update users set upsell_impressions = 3, upsell_last_shown_at = now() - interval '40 days',
               upsell_last_offered_at = now() - interval '40 days'
             where id = ${sqlStr(owner.userId)};`);
    await login(context, owner, baseURL);
    const paths = trackPaths(page);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expectNeverAsked(page, paths);
    expect(upsellRow(owner.userId).upsell_impressions).toBe(3);
  });

  test('cooldown respected: shown 2 days ago (impressions 1) is not asked again', async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account('upcool', 60);
    const member = await account('upm5', 60);
    const circleId = circleWithMember(owner, member);
    sqlExec(`update users set upsell_impressions = 1, upsell_last_shown_at = now() - interval '2 days',
               upsell_last_offered_at = now() - interval '2 days'
             where id = ${sqlStr(owner.userId)};`);
    await login(context, owner, baseURL);
    const paths = trackPaths(page);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expectNeverAsked(page, paths);
    expect(upsellRow(owner.userId).upsell_impressions).toBe(1);
  });
});
