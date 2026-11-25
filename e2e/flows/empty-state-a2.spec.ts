import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// 1.4.3 Circles first-time empty state "A2-complete" (docs/mocks-143/empty-state,
// A2-complete-web.png), on a real backend + DB. Mobile twin: Maestro
// night-parity/backstack-one-circle.yaml + CircleListEmptyStateA2.test.tsx.
//
// POSITIVE: new copy, the Example card named as an example, free + private lines,
// both doors open their dialogs, invitations / Learn more / badges kept, the
// pending-invite banner still shows, Spanish, axe clean, 320px reflow.
// NEGATIVE: the old headline / steps / "or" are gone; no "offline" claim on web;
// a person with a circle never sees the example.

test.describe('Circles empty state (A2)', () => {
  test('EN: copy, Example card, doors, kept footer, no old copy, axe + 320px', async ({
    page,
    context,
    baseURL,
  }) => {
    const person = await createScopedAccount('a2-empty');
    await cookieLogin(context, person, baseURL);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1, name: 'One place for care' })).toBeVisible({
      timeout: 30_000,
    });
    const card = page.getByRole('figure', { name: 'Example: Today for Rosa' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Example', { exact: true })).toBeVisible();
    await expect(card.getByText('You choose who gets reminders')).toBeVisible();
    await expect(card.getByText('Allergies, doctors and insurance in seconds', { exact: true })).toBeVisible();
    await expect(page.getByText('Free to start. Medications and reminders are always free.')).toBeVisible();
    await expect(page.getByText('Private & secure')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check your invitations' })).toHaveAttribute('href', '/invites');
    await expect(page.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/help');
    await expect(page.getByRole('link', { name: 'Download on the App Store' })).toBeVisible();

    // NEGATIVE: none of the old page survives; web makes no offline claim.
    await expect(page.getByText("Let's set up your care circle")).toHaveCount(0);
    await expect(page.getByText('How CircleCare works')).toHaveCount(0);
    await expect(page.getByText('or', { exact: true })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/offline/i);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    // Doors: Start -> the one first-run question (first run v2, 1.4.3: no create dialog for a first
    // circle); Back returns to the empty state. I have an invite code -> the join dialog.
    await page.getByRole('button', { name: 'Start a care circle', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New care circle' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('button', { name: 'I have an invite code', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'I have an invite code', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Join a circle', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // 320px: stacks, no horizontal scroll (WCAG 1.4.10).
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(card).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the pending-invite banner still shows above the empty state', async ({ page, context, request, baseURL }) => {
    const owner = await createScopedAccount('a2-owner');
    const ownerSession = await ownerApi(request, owner);
    const circleId = await createCircle(ownerSession, uniq('a2'));
    const invitee = await createScopedAccount('a2-invitee');
    const res = await ownerSession.post(`/api/circles/${circleId}/invites`, {
      email: invitee.email,
      member_type: 'caregiver',
    });
    expect(res.status(), await res.text()).toBeLessThan(300);

    await cookieLogin(context, invitee, baseURL);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'One place for care' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('You have 1 pending invitation')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('figure', { name: 'Example: Today for Rosa' })).toBeVisible();
  });

  test('ES: the Latin American Spanish strings from the mock', async ({ page, context, baseURL }) => {
    const person = await createScopedAccount('a2-es');
    sqlExec(`update public.users set language = 'es', language_set_at = now() where id = ${sqlStr(person.userId)}::uuid;`);
    await cookieLogin(context, person, baseURL);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', /^es/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Un solo lugar para el cuidado' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('figure', { name: 'Ejemplo: Hoy para Rosa' })).toBeVisible();
    await expect(page.getByText('Tú eliges quién recibe los recordatorios')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear un círculo de cuidado', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tengo un código de invitación', exact: true })).toBeVisible();
    await expect(page.getByText('Privado y seguro')).toBeVisible();
  });

  test('NEGATIVE: a person with circles never sees the example', async ({ page, context, request, baseURL }) => {
    const person = await createScopedAccount('a2-has');
    const session = await ownerApi(request, person);
    await createCircle(session, uniq('a2-has-1'));
    await cookieLogin(context, person, baseURL);
    // One circle: the picker auto-skips into it; the empty state never renders on the way.
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/circles\/[0-9a-f-]+/, { timeout: 30_000 });
    await expect(page.getByRole('figure', { name: /Example/ })).toHaveCount(0);
    await expect(page.getByText('One place for care')).toHaveCount(0);
    await expect(page.getByText('Today for Rosa')).toHaveCount(0);
  });
});
