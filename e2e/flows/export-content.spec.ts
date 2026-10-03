import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlRows, sqlStr, assertLocalDbTargets } from '../db';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { apiSession } from '../unhappy';
import { setProfileLanguage } from '../notesFirstClassShared';
import * as HD from '../exports/hard-export-dataset.mjs';
import type { ExpectedAdherence, HardFixture, RowCapFixture } from '../exports/hard-export-dataset.mjs';

// ===========================================================================
// EXPORT CONTENT — the documents a caregiver hands to a clinician or a
// paramedic, checked against the API AND against an independently computed
// truth (docs/plans/export-test-coverage-2026-09-30.md).
//
// ONE "hard" dataset shared with the mobile Maestro twin
// (mobile/.maestro/parity/exports/, same seeding + truth module byte-for-byte):
// recipient in Pacific/Kiritimati (UTC+14), two medications with two dose
// times each, an ENDED series ("This and future"), a DISCONTINUED series (stop
// instant backdated to noon three days ago), a medication DELETED after doses
// were recorded (PK3: soft delete, its doses stay in the report), a REMOVED occurrence, taken / taken late / skipped
// / legacy missed / unmarked doses, answers by a second caregiver, allergies,
// conditions and a DNR that must never print. Plus a row-cap circle whose
// 90-day report reads > 1000 dose rows and > 1000 confirmations.
//
// CAPTURE: `window.print` is replaced in every frame (addInitScript), so the
// hidden srcdoc iframe printHtml.ts builds stays in the DOM and its document
// can be read (flows/care-summary-share-dialog.spec.ts has the full why).
//
// VIEWER TIMEZONE: PW_E2E_TZ puts the browser in another zone (the plan runs
// this spec under America/Denver, Pacific/Kiritimati and Pacific/Midway —
// Midway is 25 h behind Kiritimati, always a different calendar day).
//
// FALSIFY (by hand, see the plan): PW_EXPORT_FALSIFY=removed makes the truth
// count the removed dose as due-and-unmarked (the pre-tombstone behaviour); every
// hard-dataset figure assertion must then go red.
// ===========================================================================

if (process.env.PW_E2E_TZ) test.use({ timezoneId: process.env.PW_E2E_TZ });
const FALSIFY = { countRemovedAsDue: process.env.PW_EXPORT_FALSIFY === 'removed' };
// `removed-doc`: only the PRINTED-document check gets the wrong truth (the API
// comparison stays right), proving the document assertions are not vacuous.
const DOC_FALSIFY = { countRemovedAsDue: FALSIFY.countRemovedAsDue || process.env.PW_EXPORT_FALSIFY === 'removed-doc' };

// The mirrored module must equal the canonical mobile copy when both trees are here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_COPY = path.join(HERE, '../exports/hard-export-dataset.mjs');
const MOBILE_COPY = path.join(HERE, '../../../mobile/.maestro/parity/exports/hard-export-dataset.mjs');

type Lang = 'en' | 'es';
const UI = {
  en: { history: 'History', exportBtn: 'Export report', dialog: 'Adherence report', share: 'Share', shareDialog: 'Share care summary', edit: 'Edit medical information', period: (d: number) => `Last ${d} days` },
  es: { history: 'Historial', exportBtn: 'Exportar reporte', dialog: 'Reporte de adherencia', share: 'Compartir', shareDialog: 'Compartir resumen de cuidado', edit: 'Editar información médica', period: (d: number) => `Últimos ${d} días` },
} as const;

function adapters(ctx: APIRequestContext): HD.Adapters {
  assertLocalDbTargets('export-content seeding');
  return {
    api: async (method, p, token, body) => {
      const res = await ctx.fetch(`/api${p}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { data: body }),
      });
      let json: Record<string, any> = {};
      try {
        const parsed = await res.json();
        json = parsed && typeof parsed === 'object' ? parsed : { value: parsed };
      } catch {
        json = {};
      }
      return Object.assign(json, { __status: res.status() });
    },
    sqlExec,
    sqlRows: <T,>(q: string) => sqlRows<T>(q),
  };
}

async function armPrintCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { __ccPrinted?: boolean }).__ccPrinted = true;
    };
  });
}

interface Printed {
  text: string;
  printed: boolean;
}

async function readPrinted(page: Page): Promise<Printed> {
  await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(1, { timeout: 30_000 });
  const doc = await page.evaluate(() => {
    const el = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement | null;
    const doc = el?.contentDocument;
    if (!doc) throw new Error('print iframe not readable');
    return {
      text: doc.body.innerText ?? doc.body.textContent ?? '',
      printed: (el!.contentWindow as unknown as { __ccPrinted?: boolean } | null)?.__ccPrinted === true,
    };
  });
  // Evidence: the printed document's text rides along with the result.
  await test.info().attach(`printed-${Date.now()}.txt`, { body: doc.text, contentType: 'text/plain' });
  // PW_EXPORT_DUMP_DIR keeps every printed document's text on disk (run evidence).
  const dumpDir = process.env.PW_EXPORT_DUMP_DIR;
  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    const name = test.info().title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
    writeFileSync(path.join(dumpDir, `${name}-${Date.now()}.txt`), doc.text);
  }
  return doc;
}

async function apiReport(ctx: APIRequestContext, token: string, circleId: string, period: string) {
  const res = await ctx.get(`/api/circles/${circleId}/medications/adherence-report?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: { report: any } }).data.report;
}

/** The API's numbers, in the truth's shape (by-medication merged by name + dose, as the document does). */
function apiAsTruth(r: any): ExpectedAdherence {
  const merged = new Map<string, any>();
  for (const m of r.by_medication as any[]) {
    const k = `${m.name}|${m.dosage}`;
    const cur = merged.get(k) ?? { name: m.name, dosage: m.dosage, total: 0, taken: 0, taken_late: 0, skipped: 0, not_marked: 0 };
    cur.total += m.total;
    cur.taken += m.taken;
    cur.skipped += m.skipped;
    cur.not_marked += m.not_marked;
    merged.set(k, cur);
  }
  const s = r.summary;
  return {
    start_date: r.start_date,
    end_date: r.end_date,
    summary: { total: s.total_scheduled, taken: s.taken, taken_late: s.taken_late, skipped: s.skipped, not_marked: s.not_marked, rate: s.adherence_rate },
    byMedication: [...merged.values()].map((m) => ({ ...m, rate: m.total > 0 ? Math.round((m.taken / m.total) * 100) : 0 })),
    bySlot: (r.time_breakdown as any[]).map((b) => ({
      time: b.time.slice(0, 5),
      total: b.total,
      taken: b.taken,
      taken_late: 0,
      not_marked: b.not_marked,
      skipped: b.total - b.taken - b.not_marked,
      rate: b.adherence_rate,
    })),
    byDay: (r.daily_breakdown as any[]).map((d) => ({
      date: d.date,
      total: d.total,
      taken: d.taken,
      taken_late: 0,
      not_marked: d.not_marked,
      skipped: d.skipped,
      rate: d.adherence_rate,
    })),
  };
}

/** Compare truth and API on the fields the truth defines (taken_late per med is not in the API). */
function sameFigures(api: ExpectedAdherence, truth: ExpectedAdherence) {
  const pick = (m: { name: string; dosage: string; total: number; taken: number; skipped: number; not_marked: number; rate: number }) =>
    [m.name, m.dosage, m.total, m.taken, m.skipped, m.not_marked, m.rate].join('|');
  expect({ start: api.start_date, end: api.end_date, summary: api.summary }).toEqual({
    start: truth.start_date,
    end: truth.end_date,
    summary: truth.summary,
  });
  expect(api.byMedication.map(pick).sort()).toEqual(truth.byMedication.map(pick).sort());
  if (truth.byDay) {
    const day = (d: any) => [d.date, d.total, d.taken, d.not_marked, d.skipped].join('|');
    expect(api.byDay!.map(day)).toEqual(truth.byDay.map(day));
  }
  if (truth.bySlot) {
    const slot = (b: any) => [b.time, b.total, b.taken, b.not_marked, b.skipped, b.rate].join('|');
    expect(api.bySlot!.map(slot)).toEqual(truth.bySlot.map(slot));
  }
}

async function openHistory(page: Page, circleId: string, lang: Lang): Promise<void> {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('tab', { name: UI[lang].history })
    .or(page.getByRole('button', { name: UI[lang].history, exact: true }))
    .first()
    .click();
  await expect(page.getByRole('button', { name: UI[lang].exportBtn })).toBeVisible({ timeout: 30_000 });
}

async function exportPeriod(page: Page, days: number, lang: Lang): Promise<void> {
  await page.getByRole('button', { name: UI[lang].exportBtn }).click();
  const dialog = page.getByRole('dialog', { name: UI[lang].dialog });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('radio', { name: UI[lang].period(days) }).check();
  await dialog.getByRole('button', { name: UI[lang].exportBtn }).click();
}

/** The export hands off and comes back: print() requested, the dialog gone, the control idle (no hang). */
async function expectHandedOff(page: Page, printed: Printed, lang: Lang, control: string): Promise<void> {
  expect(printed.printed, 'window.print() was requested on the document frame').toBe(true);
  await expect(page.getByRole('dialog', { name: lang === 'en' ? /Adherence report|Share care summary/ : /Reporte de adherencia|Compartir resumen/ })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('button', { name: control, exact: true }).first()).toBeEnabled({ timeout: 10_000 });
}

async function shareCareSummary(page: Page, circleId: string, lang: Lang): Promise<Printed> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  // Wait for the owner masthead to settle (care-summary-share-dialog.spec.ts: Share moves slots).
  await expect(page.getByRole('button', { name: UI[lang].edit }).first()).toBeVisible({ timeout: 25_000 });
  const share = page.getByRole('button', { name: UI[lang].share, exact: true });
  await expect(share).toBeEnabled({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: UI[lang].shareDialog });
  for (let attempt = 0; attempt < 3; attempt++) {
    await share.click();
    if (await dialog.isVisible().catch(() => false)) break;
    try {
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      break;
    } catch {
      if (attempt === 2) throw new Error('share dialog never opened');
    }
  }
  await dialog.getByRole('button', { name: UI[lang].share, exact: true }).click();
  return readPrinted(page);
}

test.describe.configure({ mode: 'serial' });

test.describe('export content: hard dataset (recipient Pacific/Kiritimati)', () => {
  test.setTimeout(180_000);
  let ctx: APIRequestContext;
  let owner: ScopedAccount;
  let second: ScopedAccount;
  let ownerToken: string;
  let circleId: string;
  let rowCapCircleId: string;
  let recipient: string;
  let rowCapRecipient: string;
  let fixture: HardFixture;
  let rowCap: RowCapFixture;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    if (existsSync(MOBILE_COPY)) {
      expect(readFileSync(WEB_COPY, 'utf8'), 'e2e/exports/hard-export-dataset.mjs drifted from the mobile canonical copy — cp it over').toBe(
        readFileSync(MOBILE_COPY, 'utf8')
      );
    }
    ctx = await pwRequest.newContext({ baseURL: testInfo.project.use.baseURL });
    owner = await createScopedAccount('expown');
    second = await createScopedAccount('expcg2');
    const ownerApi = await apiSession(ctx, owner);
    const secondApi = await apiSession(ctx, second);
    ownerToken = ownerApi.token;
    const label = uniq('exp');
    recipient = `E2E ${label}`;
    circleId = await createCircle(ownerApi, label);
    // The second caregiver joins through the real invite + accept API.
    const inv = await ownerApi.post(`/api/circles/${circleId}/invites`, { email: second.email, member_type: 'caregiver' });
    expect(inv.status(), await inv.text()).toBeLessThan(300);
    const inviteId = ((await inv.json()) as { data: { invite: { id: string } } }).data.invite.id;
    const acc = await secondApi.post(`/api/invites/${inviteId}/accept`);
    expect(acc.status(), await acc.text()).toBeLessThan(300);

    const ad = adapters(ctx);
    fixture = await HD.seedHardDataset(ad, {
      circleId,
      owner: { id: owner.userId, token: ownerApi.token },
      second: { id: second.userId, token: secondApi.token },
    });
    const rlabel = uniq('exprowcap');
    rowCapRecipient = `E2E ${rlabel}`;
    rowCapCircleId = await createCircle(ownerApi, rlabel);
    rowCap = await HD.seedRowCap(ad, { circleId: rowCapCircleId, owner: { id: owner.userId, token: ownerApi.token } });
  });

  test.afterAll(async () => {
    // The run-scoped accounts are purged by global teardown; the circles (and
    // with them every seeded row, ON DELETE CASCADE) go now.
    for (const id of [circleId, rowCapCircleId].filter(Boolean)) {
      sqlExec(`delete from public.care_circles where id = ${sqlStr(id)}`);
    }
    await ctx?.dispose();
  });

  test.beforeEach(async ({ page: _page, context, baseURL }) => {
    void _page;
    await cookieLogin(context, owner, baseURL);
  });

  for (const days of [7, 30]) {
    test(`${days}-day adherence report: printed == API == seeded truth`, async ({ page }) => {
      await armPrintCapture(page);
      await openHistory(page, circleId, 'en');
      const todayR = HD.todayIn(HD.HARD_TZ);
      const truth = HD.expectedAdherence(fixture, todayR, days, FALSIFY);
      const api = apiAsTruth(await apiReport(ctx, ownerToken, circleId, `${days}d`));
      sameFigures(api, truth);

      await exportPeriod(page, days, 'en');
      const doc = await readPrinted(page);
      const docTruth = HD.expectedAdherence(fixture, todayR, days, DOC_FALSIFY);
      expect(HD.checkAdherenceText(doc.text, docTruth, { lang: 'en', recipientName: recipient })).toEqual([]);
      await expectHandedOff(page, doc, 'en', UI.en.exportBtn);
    });
  }

  test('care summary: current / recently stopped (discontinued by recipient-zone day, ended by end date, newest first) / deleted med absent, allergies, conditions, no DNR', async ({ page }) => {
    await armPrintCapture(page);
    const truth = HD.expectedCareSummary(fixture);
    // `stopday`: expect the stop DAY in the viewer's (Denver) frame instead of the recipient's.
    if (process.env.PW_EXPORT_FALSIFY === 'stopday') truth.stopped = truth.stopped.map((x) => ({ ...x, stoppedDay: HD.addDays(x.stoppedDay, -1) }));
    const doc = await shareCareSummary(page, circleId, 'en');
    expect(HD.checkCareSummaryText(doc.text, truth, { lang: 'en', recipientName: recipient })).toEqual([]);
    expect(doc.printed).toBe(true);
    await expect(page.getByRole('dialog', { name: UI.en.shareDialog })).toHaveCount(0, { timeout: 10_000 });
    // The stored DNR is untouched by exporting (hidden, not deleted).
    const [info] = sqlRows<{ has_dnr: boolean; advance_directives: string }>(
      `select has_dnr, advance_directives from public.emergency_info where circle_id = ${sqlStr(circleId)}`
    );
    expect(info).toEqual({ has_dnr: true, advance_directives: HD.DNR_MARKER });
  });

  // PK3: the whole-medication delete after recorded doses is a SOFT delete. Hidden from every
  // list (roster, calendar window) and from the Care Summary (the test above), while the
  // adherence report keeps counting its recorded doses (printed == API == truth above, with
  // Ibuprofen in by-medication). Not vacuous: rows and confirmations are still in the DB.
  test('PK3: the deleted medication is gone from the roster and calendar reads but its doses stay in the report', async () => {
    const [kept] = sqlRows<{ soft: number; confs: number }>(
      `select (select count(*)::int from public.calendar_events where circle_id = ${sqlStr(circleId)} and medication_name = 'Ibuprofen' and deleted_at is not null) as soft,
              (select count(*)::int from public.medication_confirmations mc join public.calendar_events ce on ce.id = mc.event_id
                where ce.circle_id = ${sqlStr(circleId)} and ce.medication_name = 'Ibuprofen') as confs`
    );
    expect(kept.soft).toBeGreaterThan(0);
    expect(kept.confs).toBe(7);
    const today = HD.todayIn(HD.HARD_TZ);
    const reads = [
      `/api/circles/${circleId}/events?includeDiscontinued=true&includeInactiveRoots=true`,
      `/api/circles/${circleId}/events?start_date=${HD.addDays(today, -30)}&end_date=${HD.addDays(today, 30)}`,
    ];
    for (const url of reads) {
      const res = await ctx.get(url, { headers: { Authorization: `Bearer ${ownerToken}` } });
      expect(res.status(), await res.text()).toBe(200);
      const events = ((await res.json()) as { data: { events: { medication_name?: string }[] } }).data.events;
      expect(events.length, `precondition: ${url} returned events`).toBeGreaterThan(0);
      expect(events.filter((e) => e.medication_name === 'Ibuprofen'), url).toEqual([]);
    }
    const api = apiAsTruth(await apiReport(ctx, ownerToken, circleId, '7d'));
    expect(api.byMedication.find((m) => m.name === 'Ibuprofen')).toMatchObject({ total: 7, taken: 4, skipped: 2, not_marked: 1 });
  });

  test('row cap: 90-day report over 1080 due doses / 1068 confirmations (> PostgREST 1000) equals the truth', async ({ page }) => {
    await armPrintCapture(page);
    await openHistory(page, rowCapCircleId, 'en');
    const truth = HD.expectedRowCap(rowCap, HD.todayIn(HD.HARD_TZ), 90);
    // Not vacuous: the window really holds more rows than one PostgREST page.
    const [n] = sqlRows<{ kids: number; confs: number }>(
      `select (select count(*) from public.calendar_events where circle_id = ${sqlStr(rowCapCircleId)} and parent_event_id is not null
                 and scheduled_date between ${sqlStr(truth.start_date)} and ${sqlStr(truth.end_date)})::int as kids,
              (select count(*) from public.medication_confirmations where circle_id = ${sqlStr(rowCapCircleId)})::int as confs`
    );
    expect(n.kids).toBeGreaterThan(1000);
    expect(n.confs).toBeGreaterThan(1000);
    const api = apiAsTruth(await apiReport(ctx, ownerToken, rowCapCircleId, '90d'));
    sameFigures(api, truth);
    await exportPeriod(page, 90, 'en');
    const doc = await readPrinted(page);
    expect(HD.checkAdherenceText(doc.text, truth, { lang: 'en', recipientName: rowCapRecipient })).toEqual([]);
    await expectHandedOff(page, doc, 'en', UI.en.exportBtn);
  });

  // PK25 (was KNOWN BUG D1): the trend compares the two halves of the window; a half with NO
  // dose due used to score 0%, so a history that starts inside the second half read
  // "Improving (+80%)" on the clinician PDF. The hard dataset's first dose is at T-12, so the
  // 30-day window's first half (T-30..T-16) owes nothing: the server now says
  // trend_available:false (trend stable, change 0), the History hero shows no trend chip and
  // the printed report shows no direction at all.
  test('PK25: a 30-day trend with nothing due in the first half shows no direction (API flag, hero chip, printed report)', async ({ page }) => {
    const r = await apiReport(ctx, ownerToken, circleId, '30d');
    const firstHalfEnd = HD.addDays(r.start_date, 14);
    expect(
      (r.daily_breakdown as { date: string }[]).filter((d) => d.date < firstHalfEnd),
      'precondition: nothing was due in the first half'
    ).toEqual([]);
    expect(r.summary).toMatchObject({ trend: 'stable', trend_change: 0, trend_available: false });
    await armPrintCapture(page);
    await openHistory(page, circleId, 'en');
    await expect(page.getByText(/vs last month|Same as last month/)).toHaveCount(0);
    await exportPeriod(page, 30, 'en');
    const doc = await readPrinted(page);
    expect(HD.norm(doc.text)).not.toMatch(/Improving|Declining|Stable/i);
  });

  // LAST: switches the owner's language (the account is run-scoped, nothing to restore).
  test('Spanish: the 7-day report and the care summary print the same figures in Spanish', async ({ page }) => {
    await setProfileLanguage(page, 'es');
    await armPrintCapture(page);
    await openHistory(page, circleId, 'es');
    const truth = HD.expectedAdherence(fixture, HD.todayIn(HD.HARD_TZ), 7, FALSIFY);
    await exportPeriod(page, 7, 'es');
    const report = await readPrinted(page);
    expect(HD.checkAdherenceText(report.text, truth, { lang: 'es', recipientName: recipient })).toEqual([]);
    await expectHandedOff(page, report, 'es', UI.es.exportBtn);

    await page.goto('about:blank');
    const summary = await shareCareSummary(page, circleId, 'es');
    expect(HD.checkCareSummaryText(summary.text, HD.expectedCareSummary(fixture), { lang: 'es', recipientName: recipient })).toEqual([]);
  });
});
