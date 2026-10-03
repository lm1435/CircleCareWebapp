import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbCount } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// OS-vitals-redesign (09-26, VitalsPage + lib/vitalsTrend.ts, mobile parity):
//   1. NEVER LOGGED: one type selected that has no reading at all says so for
//      that type ("No heart rate readings yet") with a CTA that opens the form
//      on that type;
//   2. OUT OF RANGE: a type whose only reading is older than the window says
//      "No readings in the past 7 days", shows the last reading, and offers
//      "Show past 30 days", which widens the window to it;
//   3. TREND: with readings in this window and the previous one, the hero says
//      "Average +10 bpm vs the previous 7 days" (a signed absolute delta in
//      display units, not the old percent-of-average).
// Only the generic "No readings yet" (with /latest stubbed) had e2e coverage.
//
// Readings are SEEDED through the public API with backdated recorded_at; the
// states are read and driven through the UI. Fresh run-scoped circle per test.
//
// FALSIFY: PW_FALSIFY=vitals-empty-states-trend seeds the "previous period"
// readings at the same value as the current ones, so the delta is 0 and the
// "+10 bpm" assertion must go red. App-level proofs (scratch-copy mutations)
// are logged in docs/plans/web-e2e-coverage-2026-10-02.md.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('vitals-empty-states-trend');
const DAY = 86_400_000;

interface Copy {
  heartRate: string;
  neverTitle: string;
  neverCta: string;
  rangeLabel: string;
  last7: string;
  last30: string;
  outOfRangeTitle: string;
  lastReading: RegExp;
  show30: string;
  trend: string;
}

const COPY: Record<'en' | 'es', Copy> = {
  en: {
    heartRate: 'Heart rate',
    neverTitle: 'No heart rate readings yet',
    neverCta: 'Log heart rate',
    rangeLabel: 'Time range',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    outOfRangeTitle: 'No readings in the past 7 days',
    lastReading: /^Last reading: 70 bpm · \S/,
    show30: 'Show past 30 days',
    trend: 'Average \\+10 bpm vs the previous 7 days', // a regex source
  },
  es: {
    heartRate: 'Frecuencia cardíaca',
    neverTitle: 'Aún no hay lecturas de frecuencia cardíaca',
    neverCta: 'Registrar frecuencia cardíaca',
    rangeLabel: 'Período',
    last7: 'Últimos 7 días',
    last30: 'Últimos 30 días',
    outOfRangeTitle: 'Sin lecturas en los últimos 7 días',
    lastReading: /^Última lectura: 70 (bpm|lpm) · \S/,
    show30: 'Ver los últimos 30 días',
    trend: 'Promedio \\+10 (bpm|lpm) frente a los 7 días anteriores', // a regex source
  },
};

async function setup(request: Parameters<typeof ownerApi>[0], lang: 'en' | 'es') {
  const acct = await createScopedAccount(`vitst-${lang}`);
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(acct.userId)}::uuid;`
  );
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq(`vitst${lang}`));
  return { acct, api, circleId };
}

async function seedHeartRate(api: Awaited<ReturnType<typeof ownerApi>>, circleId: string, bpm: number, daysAgo: number) {
  const res = await api.post(`/api/circles/${circleId}/vitals`, {
    vital_type: 'heart_rate',
    value1: bpm,
    unit: 'bpm',
    recorded_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    notes: `E2E vitst ${daysAgo}d`,
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function pickRange(page: Page, c: Copy, label: string) {
  await page.getByRole('button', { name: new RegExp(`^${c.rangeLabel}:`) }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page.getByRole('button', { name: `${c.rangeLabel}: ${label}`, exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

async function openHeartRate(page: Page, circleId: string, c: Copy) {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  const chip = page.locator('#vitals-type-filter').getByRole('radio', { name: c.heartRate, exact: true });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  await expect(chip).toBeChecked();
}

for (const lang of ['en', 'es'] as const) {
  const c = COPY[lang];
  test(`${lang.toUpperCase()}: never logged -> CTA opens the form on that type; out of range -> last reading + "${c.show30}"; trend -> "${c.trend.replace(/\(bpm\|lpm\)/, 'bpm').replace('\\', '')}"`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const { acct, api, circleId } = await setup(request, lang);
    await cookieLogin(context, acct, baseURL);

    // --- 1. never logged ---
    await openHeartRate(page, circleId, c);
    await expect(page.getByText(c.neverTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: c.neverCta, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#vital_type')).toHaveValue('heart_rate');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    // --- 2. out of range: the only reading is 20 days old, the window is 7 days ---
    await seedHeartRate(api, circleId, 70, 20);
    await openHeartRate(page, circleId, c);
    await pickRange(page, c, c.last7);
    await expect(page.getByText(c.outOfRangeTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(c.lastReading)).toBeVisible();
    await page.getByRole('button', { name: c.show30, exact: true }).click();
    await expect(page.getByRole('button', { name: `${c.rangeLabel}: ${c.last30}`, exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(c.outOfRangeTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText('E2E vitst 20d').first()).toBeVisible({ timeout: 20_000 });

    // --- 3. trend: previous 7 days avg 60, this 7 days avg 70 -> +10 bpm ---
    const previous = FALSIFY ? 70 : 60;
    await seedHeartRate(api, circleId, previous, 10);
    await seedHeartRate(api, circleId, previous, 9);
    await seedHeartRate(api, circleId, 70, 2);
    await seedHeartRate(api, circleId, 70, 1);
    expect(
      dbCount(`select 1 from health_vitals where circle_id = ${sqlStr(circleId)}::uuid and vital_type = 'heart_rate'`)
    ).toBe(5);
    await openHeartRate(page, circleId, c);
    await pickRange(page, c, c.last7);
    await expect(page.getByText(new RegExp(`^${c.trend}$`))).toBeVisible({ timeout: 20_000 });
  });
}
