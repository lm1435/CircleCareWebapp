import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addDaysISO,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { countRequests, failRequest } from '../unhappy';
import { errorToast } from '../unhappy/writes/_helpers';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import type { ApiSession } from '../unhappy';

// K15 (docs/plans/web-test-gaps-2026-09-29-reviewed.md): the adherence report a
// caregiver hands to a clinician. The printed numbers must equal what the API
// says for the same period - compared to the API, never to a hard-coded
// denominator (memory project_adherence_denominator_fix.md: the window and the
// denominator have been wrong before).
//
// CAPTURE (same technique as flows/care-summary-share-dialog.spec.ts):
// `window.print` is replaced in every frame, so the hidden srcdoc iframe
// printHtml.ts builds is never removed by `afterprint` and can be read.
//
// TIMEZONES: PW_E2E_TZ puts the BROWSER in a zone other than the recipient's
// (America/Denver for a scoped account). The report is built from API data and
// the recipient's zone; a viewer-frame slip changes the numbers.
if (process.env.PW_E2E_TZ) test.use({ timezoneId: process.env.PW_E2E_TZ });

async function armPrintCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { __ccPrinted?: boolean }).__ccPrinted = true;
    };
  });
}

const printIframes = (page: Page) => page.locator('iframe[aria-hidden="true"]');

interface PrintedReport {
  html: string;
  text: string;
  /** label -> value from the six `.summary-box` tiles. */
  boxes: Record<string, string>;
  /** name -> the four numeric cells of the "By medication" row. */
  medRows: Record<string, string[]>;
}

async function readPrinted(page: Page): Promise<PrintedReport> {
  await expect(printIframes(page)).toHaveCount(1, { timeout: 25_000 });
  return page.evaluate(() => {
    const el = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement | null;
    const doc = el?.contentDocument;
    if (!doc) throw new Error('print iframe not readable');
    const boxes: Record<string, string> = {};
    doc.querySelectorAll('.summary-box').forEach((b) => {
      const label = b.querySelector('.label')?.textContent?.trim() ?? '';
      const value = b.querySelector('.value')?.textContent?.trim() ?? '';
      boxes[label] = value;
    });
    const medRows: Record<string, string[]> = {};
    doc.querySelectorAll('table[aria-label="By medication"] tbody tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');
      medRows[cells[0]] = cells.slice(2);
    });
    return {
      html: doc.documentElement.outerHTML,
      text: doc.body.innerText ?? doc.body.textContent ?? '',
      boxes,
      medRows,
    };
  });
}

interface ApiReport {
  summary: {
    total_scheduled: number;
    taken: number;
    taken_late: number;
    not_marked: number;
    skipped: number;
    adherence_rate: number;
  };
  by_medication: { name: string; taken: number; not_marked: number; skipped: number; adherence_rate: number }[];
  start_date: string;
  end_date: string;
}

async function apiReport(api: ApiSession, circleId: string, period: string): Promise<ApiReport> {
  const res = await api.get(`/api/circles/${circleId}/medications/adherence-report?period=${period}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: { report: ApiReport } }).data.report;
}

async function confirmDay(
  api: ApiSession,
  circleId: string,
  rootId: string,
  date: string,
  status: 'taken' | 'skipped'
): Promise<void> {
  const res = await api.post(`/api/circles/${circleId}/medications/confirm`, {
    event_id: date === '' ? rootId : `${rootId}_${date}`,
    status,
    scheduled_time: '08:00:00',
  });
  expect(res.ok(), `confirm ${date} ${status}: ${await res.text()}`).toBe(true);
}

async function openExport(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  // The adherence hero (and its Export report button) lives on the History tab.
  await page.getByRole('tab', { name: 'History' }).or(page.getByRole('button', { name: 'History', exact: true })).first().click();
  await expect(page.getByRole('button', { name: 'Export report' })).toBeVisible({ timeout: 30_000 });
}

async function exportLast7(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Export report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adherence report' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('radio', { name: 'Last 7 days' }).check();
  await dialog.getByRole('button', { name: 'Export report' }).click();
}

test.describe('adherence report export', () => {
  test.setTimeout(120_000);
  let owner: ScopedAccount;
  let api: ApiSession;
  let circleId: string;
  let label: string;
  let tz: string;
  let medName: string;
  let rootId: string;

  // `page` is requested so the fixture that logs in the WORKER account has run
  // before cookieLogin replaces its session with the scoped owner's.
  test.beforeEach(async ({ page: _page, context, request, baseURL }) => {
    void _page;
    owner = await createScopedAccount('adh');
    api = await ownerApi(request, owner);
    label = uniq('adh');
    circleId = await createCircle(api, label);
    tz = await circleTimezone(api, circleId);
    medName = `ZZ_E2E_ADH_${uniqueSuffix()}`;
    const today = dateInTz(tz, 0);
    const day = (n: number) => addDaysISO(today, n);
    rootId = await createDailyMedication(api, circleId, medName, day(-6), { time: '08:00' });
    await confirmDay(api, circleId, rootId, day(-5), 'taken');
    await confirmDay(api, circleId, rootId, day(-4), 'skipped');
    await confirmDay(api, circleId, rootId, day(-3), 'taken');
    await cookieLogin(context, owner, baseURL);
  });

  test('the printed report equals the API report for the same period', async ({ page }) => {
    await armPrintCapture(page);
    await openExport(page, circleId);
    const before = await apiReport(api, circleId, '7d');
    // FALSIFICATION (done by hand, see the report): confirming one more dose HERE, between this
    // read and the export, must turn the tile assertions below red.
    // Not vacuous: what we confirmed is really in the numbers.
    expect(before.summary.taken).toBeGreaterThanOrEqual(2);
    expect(before.summary.skipped).toBe(1);
    expect(before.summary.total_scheduled).toBeGreaterThan(0);

    await exportLast7(page);
    const printed = await readPrinted(page);

    // Identity: recipient, medication, preparer.
    expect(printed.text).toContain(`E2E ${label}`);
    expect(printed.text).toContain(medName);
    expect(printed.text).toMatch(/Prepared by \S/);

    // The tiles are the API's numbers.
    const s = before.summary;
    expect(printed.boxes['Adherence rate']).toBe(`${s.adherence_rate}%`);
    expect(printed.boxes['Taken on time']).toBe(String(s.taken - s.taken_late));
    expect(printed.boxes['Taken late']).toBe(String(s.taken_late));
    expect(printed.boxes['Not marked']).toBe(String(s.not_marked));
    expect(printed.boxes['Skipped']).toBe(String(s.skipped));
    expect(printed.boxes['Total']).toBe(String(s.total_scheduled));
    // The sentence repeats them.
    expect(printed.text).toContain(
      `took ${s.taken} of ${s.total_scheduled} scheduled doses (${s.adherence_rate}%)`
    );
    // The by-medication row carries the same per-med counts.
    const med = before.by_medication.find((m) => m.name === medName);
    expect(med, 'the API lists the medication').toBeTruthy();
    expect(printed.medRows[medName]).toEqual([
      String(med!.taken),
      String(med!.not_marked),
      String(med!.skipped),
      `${med!.adherence_rate}%`,
    ]);
    // The period the report covers is the API's range, not the viewer's clock.
    expect(printed.html).toContain(before.start_date.slice(0, 4));
    // window.print() was really requested, on the iframe's own window.
    expect(
      await page.evaluate(() => {
        const el = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement | null;
        return (el?.contentWindow as unknown as { __ccPrinted?: boolean } | null)?.__ccPrinted;
      })
    ).toBe(true);
  });

  test('a circle with no medications offers no export (no blank document)', async ({ page, request }) => {
    const emptyCircle = await createCircle(api, uniq('adhempty'));
    void request;
    await armPrintCapture(page);
    await page.goto(`/circles/${emptyCircle}/meds`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Medications', level: 1 }).first()).toBeVisible({ timeout: 25_000 });
    await page.getByRole('tab', { name: 'History' }).or(page.getByRole('button', { name: 'History', exact: true })).first().click();
    await expect(page.getByText(/No medication history|history/i).first()).toBeVisible({ timeout: 15_000 });
    // PINNED: AdherenceHero renders nothing when there is nothing scheduled, so
    // there is no button to press and no document to print.
    await expect(page.getByRole('button', { name: 'Export report' })).toHaveCount(0);
    await expect(printIframes(page)).toHaveCount(0);
  });

  test('report fetch failure: error toast, dialog stays open, nothing printed', async ({ page }) => {
    await armPrintCapture(page);
    await openExport(page, circleId);
    const fault = await failRequest(page, 'GET', '/api/circles/:id/medications/adherence-report', { status: 500, times: 2 });
    const reports = countRequests(page, 'GET', '/api/circles/:id/medications/adherence-report');
    await exportLast7(page);
    // queryClient's default `retry: 1` means ONE failed GET is retried and the
    // export then succeeds; a user-visible failure needs both attempts to fail.
    await fault.expectHits(2, { timeoutMs: 20_000 });
    await expect(errorToast(page, 'Could not load report data. Please try again.')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByRole('dialog', { name: 'Adherence report' })).toBeVisible();
    await expect(printIframes(page)).toHaveCount(0);
    await reports.expectCount(2);
    // One click retries and prints.
    await page.getByRole('dialog', { name: 'Adherence report' }).getByRole('button', { name: 'Export report' }).click();
    await readPrinted(page);
  });
});
