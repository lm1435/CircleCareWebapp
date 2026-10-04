import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import {
  circleTimezone,
  createDailyMedication,
  dateInTz,
  dayCell,
  deleteSeries,
  escapeRegExp,
  gotoActivitySettled,
  gotoCalendarSettled,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';

// Dose-status vocabulary (owner decision 2026-10-04, docs/plans/med-dose-status-audit.md):
// a deliberately SKIPPED dose reads "Skipped" / "Omitido" everywhere - History
// card (badge + "Skipped at" + "Skipped by", never "Taken at"/"Confirmed by"),
// Today card, calendar chip, activity feed - in EN and ES. A dose taken reads
// Taken / Taken at / Taken by. Nothing asserts a skip as a miss.
//
// Seeding: day -2 is skipped through the Calendar detail dialog (the UI path);
// the daily 00:00 dose of TODAY is skipped through the public confirm API so the
// Today card has a skipped dose; day -1 is taken through the API (taken_late).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

const COPY = {
  en: {
    skipped: 'Skipped',
    skippedAt: 'Skipped at',
    skippedBy: 'Skipped by',
    takenLate: 'Taken late',
    takenAt: 'Taken at',
    takenBy: 'Taken by',
    forbidden: /Confirmed by/,
    feed: /\(skipped\)/,
  },
  es: {
    skipped: 'Omitido',
    skippedAt: 'Omitido a las',
    skippedBy: 'Omitido por',
    takenLate: 'Tomado tarde',
    takenAt: 'Tomado a las',
    takenBy: 'Tomado por',
    forbidden: /Confirmado por/,
    feed: /\(omitido\)/,
  },
} as const;

test('skipped and taken doses read with the approved vocabulary on History, Today, Calendar and Activity (EN + ES)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('dosevocab');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('dosevocab'));
  const tz = await circleTimezone(api, circleId);
  const name = `ZZ_E2E_VOCAB_${uniqueSuffix()}`;
  const titleRe = new RegExp(escapeRegExp(name));
  const root = await createDailyMedication(api, circleId, name, dateInTz(tz, -3), { time: '00:00' });
  const skipDay = dateInTz(tz, -2);
  const lateDay = dateInTz(tz, -1);

  const setLanguage = (lang: 'en' | 'es') =>
    sqlExec(
      `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
    );

  try {
    setLanguage('en');
    await cookieLogin(context, owner, baseURL);

    // 1. Skip day -2 through the Calendar UI.
    await gotoWeekContaining(page, circleId, dateInTz(tz, 0), skipDay);
    const detail = await openChip(page, skipDay, titleRe);
    await detail.getByRole('button', { name: 'Skip dose' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm medication' });
    await expect(dialog.getByRole('radio', { name: 'Skipped' })).toBeChecked({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as skipped/ })).toBeVisible({ timeout: 15_000 });

    // 2. Skip today's dose and take yesterday's (late) through the API.
    const today = dateInTz(tz, 0);
    for (const [d, status] of [
      [today, 'skipped'],
      [lateDay, 'taken'],
    ] as const) {
      const res = await api.post(`/api/circles/${circleId}/medications/confirm`, {
        event_id: `${root}_${d}`,
        status,
        scheduled_time: '00:00:00',
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
    }
    const rows = dbQuery<{ status: string }>(
      `select mc.status from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
        where ce.circle_id = ${sqlStr(circleId)}::uuid order by mc.status`
    );
    expect(rows.map((r) => r.status).sort()).toEqual(['skipped', 'skipped', 'taken_late']);

    for (const lang of ['en', 'es'] as const) {
      const c = COPY[lang];
      setLanguage(lang);
      await cookieLogin(context, owner, baseURL);

      // History tab: skipped cards say Skipped / Skipped at / Skipped by; the
      // taken-late card says Taken late / Taken at / Taken by.
      await page.goto(`/circles/${circleId}/meds?tab=history`, { waitUntil: 'domcontentloaded' });
      const cards = page.getByRole('listitem').filter({ hasText: name });
      await expect(cards.first()).toBeVisible({ timeout: 25_000 });
      await expect(cards).toHaveCount(3);
      const skippedCards = cards.filter({ has: page.getByText(c.skipped, { exact: true }) });
      await expect(skippedCards).toHaveCount(2);
      for (let i = 0; i < 2; i++) {
        const card = skippedCards.nth(i);
        await expect(card.getByText(c.skippedAt, { exact: true })).toBeVisible();
        await expect(card.getByText(c.skippedBy, { exact: true })).toBeVisible();
        await expect(card.getByText(c.takenAt, { exact: true })).toHaveCount(0);
        await expect(card.getByText(c.forbidden)).toHaveCount(0);
        await expect(card.getByText(/^(Missed|No tomado)$/)).toHaveCount(0);
      }
      const lateCard = cards.filter({ has: page.getByText(c.takenLate, { exact: true }) });
      await expect(lateCard).toHaveCount(1);
      await expect(lateCard.getByText(c.takenAt, { exact: true })).toBeVisible();
      await expect(lateCard.getByText(c.takenBy, { exact: true })).toBeVisible();

      // Today card (Overview): today's skipped dose wears the Skipped pill.
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      const todayRow = page.getByRole('listitem').filter({ hasText: name }).first();
      await expect(todayRow).toBeVisible({ timeout: 25_000 });
      await expect(todayRow.getByText(c.skipped, { exact: true }).first()).toBeVisible();

      // Calendar chip: the accessible name carries the status word.
      // (today's skipped dose: always in the current week, so no week-stepping,
      // whose button names are English-only in the shared helper.)
      await gotoCalendarSettled(page, circleId);
      const chip = dayCell(page, today).getByRole('button', { name: titleRe }).first();
      await expect(chip).toHaveAttribute('aria-label', new RegExp(c.skipped));

      // Activity feed: the wire string "(not taken)" still localizes as skipped.
      await gotoActivitySettled(page, circleId);
      await expect(page.getByText(c.feed).first()).toBeVisible({ timeout: 25_000 });
    }
  } finally {
    await deleteSeries(api, circleId, root);
  }
});
