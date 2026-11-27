import { test, expect } from '../../fixtures';
import { checkA11y } from '../../helpers';
import { countRequests, dbCount, sqlStr } from '../../unhappy';
import { sqlExec } from '../../db';
import {
  UPGRADE_GATE_MESSAGE,
  circleNameOf,
  gotoCirclePage,
  loadSurfaceData,
  openAllCircles,
} from './_helpers';

// ===========================================================================
// FREE OWNER — the paywall gates, against the REAL backend refusals.
//
//   AI        the entry is rendered in its 'upgrade' state: pressing it raises
//             the upgrade prompt, never the chat, and no request reaches any
//             /ai/ endpoint (counted from before the page loads).
//   circles   creating a second circle on the free tier is a real 402; the app
//             shows the upgrade prompt and the database still holds ONE circle.
//   invites   the free caregiver cap (owner + 1) is caught BEFORE the form: the
//             modal opens on the cap card with Upgrade, no POST is sent, and no
//             invite row exists (the real 402 stays the fallback).
//
// The same three flows succeed for the premium owner in
// `premiumOwner.controls.spec.ts`.
// ===========================================================================

test.use({ persona: 'freeOwner' });

test('AI entry raises the upgrade prompt, never the chat, and sends no AI request', async ({
  page,
  personaHandle: h,
}) => {
  const ai = countRequests(page, '*', '/api/circles/:id/ai/**');
  const data = loadSurfaceData(h);
  await gotoCirclePage(page, h.circleId, 'notes');
  await expect(page.getByText(data.careNoteBody!).first()).toBeVisible({ timeout: 20_000 });

  const assistant = page.getByRole('button', { name: 'Assistant', exact: true });
  await expect(assistant).toBeVisible();
  await assistant.click();

  await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Care Assistant')).toHaveCount(0);
  await ai.expectCount(0);

  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
  await ai.expectCount(0, { settleMs: 500 });
});

test('create circle at the free cap: real 402, the upgrade prompt, and still exactly one circle row', async ({
  page,
  personaHandle: h,
}) => {
  const name = `E2E cap probe ${Date.now()}`;
  const ownedLive = `select 1 from care_circles where owner_id = ${sqlStr(h.userId)}::uuid and archived_at is null`;
  expect(dbCount(ownedLive), 'free owner starts with one circle').toBe(1);

  await gotoCirclePage(page, h.circleId, '');
  await openAllCircles(page);
  await expect(page.getByRole('link', { name: new RegExp(`^Open ${circleNameOf(h.circleId)}`) })).toBeVisible();

  await page.getByRole('button', { name: /^(Start a care circle|Create circle)$/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('New care circle')).toBeVisible();
  await dialog.locator('#recipient_name').fill(name);

  const posts = countRequests(page, 'POST', '/api/circles');
  const refused = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/circles',
    { timeout: 20_000 }
  );
  await dialog.getByRole('button', { name: 'Create circle' }).click();
  const res = await refused;
  expect(res.status(), 'POST /api/circles on the free tier').toBe(402);

  await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toBeVisible();
  await posts.expectCount(1);
  await expect(page).toHaveURL(/\/circles$/);
  expect(dbCount(ownedLive), 'no second circle was created').toBe(1);
  expect(
    dbCount(`select 1 from care_circles where recipient_name = ${sqlStr(name)}`),
    'no row carries the submitted name'
  ).toBe(0);

  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
});

test('invite at the free caregiver cap: the cap card shows BEFORE the form, Upgrade, no POST, no invite row', async ({
  page,
  personaHandle: h,
}) => {
  // The seat pre-check (lib/inviteSeatPrecheck): owner + 1 active caregiver
  // fill a free circle, so the modal opens on the cap card instead of an email
  // field the owner would fill only to be refused with a 402. The 402 itself
  // stays the fallback (unit-tested in InviteMemberModal.test.tsx).
  await gotoCirclePage(page, h.circleId, 'members');
  await expect(page.getByText(h.email).first()).toBeVisible({ timeout: 20_000 });

  const posts = countRequests(page, 'POST', '/api/circles/:id/invites');
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
  const card = dialog.getByTestId('invite-cap-card');
  await expect(card).toContainText('Upgrade to invite more caregivers');
  await expect(dialog.locator('#invite-email')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  await posts.expectCount(0, { settleMs: 500 });

  await card.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
  await posts.expectCount(0);
  expect(
    dbCount(`select 1 from invites where circle_id = ${sqlStr(h.circleId)}::uuid and status = 'pending' and created_at > now() - interval '1 minute'`),
    'no invite row'
  ).toBe(0);
});

// ---------------------------------------------------------------------------
// One headline, one colour (paywall redesign 1.4.2): ONE <h1> in the page-title
// style, ink, no coral accent word (one accent = moss, the buy button). Mobile's
// PlanSelectionScreen renders the same words.
// ---------------------------------------------------------------------------
const HEADLINES = [
  { name: 'EN', locale: 'en-US', text: 'Unlock the full experience.' },
  { name: 'ES', locale: 'es-MX', text: 'Desbloquea la experiencia completa.' },
] as const;

for (const hl of HEADLINES) {
  test.describe(`upgrade headline (${hl.name})`, () => {
    test.use({ locale: hl.locale, timezoneId: 'America/Denver' });

    test('one h1 in ink at the page-title size, axe clean, no overflow at desktop and 390px', async ({
      page,
      personaHandle: h,
    }, testInfo) => {
      // users.language (not the browser locale) drives the UI once signed in.
      sqlExec(`update users set language = ${sqlStr(hl.name.toLowerCase())} where id = ${sqlStr(h.userId)}::uuid`);
      testInfo.annotations.push({ type: 'restore', description: 'language reset in finally' });
      await page.goto('/upgrade');
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1, { timeout: 20_000 });
      await expect(h1).toHaveAccessibleName(hl.text);
      await expect(h1.locator('[data-headline-accent]')).toHaveCount(0);

      const measure = async (): Promise<{ size: number; weight: number; color: string; overflow: boolean }> =>
        h1.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            size: parseFloat(cs.fontSize),
            weight: Number(cs.fontWeight),
            color: cs.color,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          };
        });

      try {
        for (const vp of [
          { width: 1280, height: 800, shot: 'desktop' },
          { width: 390, height: 844, shot: 'phone' },
        ]) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          const m = await measure();
          // 32 on desktop; 28 below 640px (phone-width type scale, globals.css, owner 2026-11-26).
          expect(m.size).toBe(vp.width < 640 ? 28 : 32);
          expect(m.weight).toBeGreaterThanOrEqual(600);
          // --color-ink #1a1916, never coral.
          expect(m.color).toBe('rgb(26, 25, 22)');
          expect(m.overflow, `no horizontal overflow @${vp.width}`).toBe(false);
          await checkA11y(page, `/upgrade (${hl.name} ${vp.width}px)`, testInfo);
        }
      } finally {
        sqlExec(`update users set language = 'en' where id = ${sqlStr(h.userId)}::uuid`);
      }
    });
  });
}
