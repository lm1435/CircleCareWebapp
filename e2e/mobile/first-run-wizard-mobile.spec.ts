import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { setProfileLanguage } from '../notesFirstClassShared';
import { dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createScopedAccount,
  stubJson,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// K8, PHONE COPY (project mobile-chrome, Pixel 5, 390x664; an inline copy of
// e2e/flows/first-run-wizard.spec.ts - specs do not import across projects).
// K8 (docs/plans/web-test-gaps-2026-09-29-reviewed.md): the first-run wizard
// END TO END against the real backend, plus the open "clipped autocomplete"
// bug (memory project_first_run_wizard_autocomplete_clip.md).
//
// A scoped premium account with ZERO circles creates its first circle through
// the real modal; the wizard mounts over the new circle's overview. The drug
// search is the ONLY stubbed call (RxNorm is an external service).

const DRUGS = [
  ['1001', 'Ibuprofen 200 MG Oral Tablet'],
  ['1002', 'Ibuprofen 400 MG Oral Tablet'],
  ['1003', 'Ibuprofen 600 MG Oral Tablet'],
  ['1004', 'Ibuprofen 800 MG Oral Tablet'],
  ['1005', 'Ibuprofen 100 MG/5ML Oral Suspension'],
  ['1006', 'Ibuprofen 50 MG Chewable Tablet'],
  ['1007', 'Ibuprofen and Famotidine Oral Tablet'],
  ['1008', 'Ibuprofen Lysine Injectable'],
].map(([rxcui, name]) => ({ rxcui, name, strength: null, dosageForm: null }));

async function stubDrugs(page: Page): Promise<void> {
  await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: DRUGS } } });
}

interface Copy {
  createBtn: string;
  wizardName: string;
  addMed: string;
  skip: string;
  nameLabel: RegExp;
  next: string;
  save: string;
  savedToast: string;
  whatTitle: (n: string) => RegExp;
}
const COPY: Record<'en' | 'es', Copy> = {
  en: {
    createBtn: 'Create circle',
    wizardName: 'Circle created',
    addMed: 'Add a medication',
    skip: 'Skip for now',
    nameLabel: /Medication name/i,
    next: 'Continue',
    save: 'Add medication',
    savedToast: 'Medication added.',
    whatTitle: (n) => new RegExp(`What does ${n} take\\?`),
  },
  es: {
    createBtn: 'Crear círculo',
    wizardName: 'Círculo creado',
    addMed: 'Agregar un medicamento',
    skip: 'Omitir por ahora',
    nameLabel: /Nombre del medicamento/i,
    next: 'Continuar',
    save: 'Agregar medicamento',
    savedToast: 'Medicamento agregado.',
    whatTitle: (n) => new RegExp(`¿Qué toma ${n}\\?`),
  },
};

/**
 * The default 08:00 preset may already be past in the recipient's zone, in which
 * case Save first raises a notice. Wait for whichever comes first (the notice or
 * the saved toast) and accept the notice when it is the one that appeared.
 */
async function acceptPastTimeNotice(page: Page, title: string, cont: string, toast: string): Promise<void> {
  const notice = page.getByRole('dialog', { name: title });
  await notice.or(page.getByText(toast).first()).first().waitFor({ timeout: 20_000 });
  if (await notice.isVisible()) await notice.getByRole('button', { name: cont }).click();
}

/** /circles -> Create circle -> name -> submit. Returns the new circle's id once the wizard is up. */
async function createFirstCircle(page: Page, lang: 'en' | 'es', recipient: string): Promise<string> {
  const c = COPY[lang];
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: c.createBtn }).first().click();
  const modal = page.getByRole('dialog');
  await modal.locator('#recipient_name').fill(recipient);
  // The wizard mounts with a COLD circle cache and refuses to save until the
  // circle detail (its timezone) has loaded (FirstRunWizardModal
  // `isTimezoneUnresolved`) - a real, documented race. A test that saves
  // before that GET lands sees an error toast and no POST, so wait for it.
  const circleLoaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /^\/api\/circles\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) &&
      r.ok(),
    { timeout: 30_000 }
  );
  await modal.getByRole('button', { name: c.createBtn }).click();
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole('dialog', { name: c.wizardName })).toBeVisible({ timeout: 20_000 });
  await circleLoaded;
  return /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];
}

interface Geometry {
  optionCount: number;
  lastOption: { top: number; bottom: number; cx: number; cy: number };
  visibleTop: number;
  visibleBottom: number;
  hitIsOption: boolean;
  listBottom: number;
}

/**
 * The LAST suggestion, after the list's own scroller has been moved to its end
 * (a max-h-64 list of 8 rows scrolls internally by design), must be inside the
 * region of the dialog that is actually visible (its scrolling body, above the
 * footer) and be what `elementFromPoint` finds at its centre.
 */
async function measureLastOption(listbox: Locator): Promise<Geometry> {
  return listbox.evaluate((list) => {
    (list as HTMLElement).scrollTop = (list as HTMLElement).scrollHeight;
    const options = Array.from(list.querySelectorAll('[role="option"]'));
    const last = options[options.length - 1] as HTMLElement;
    // The region a user can actually see: the wizard dialog, above its footer.
    // (The list may be portalled out of the dialog, so look the dialog up
    // from the document, not from the list.)
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    const footer = dialog.querySelector('[data-modal-footer]') as HTMLElement | null;
    const dr = dialog.getBoundingClientRect();
    const sr = { top: dr.top, bottom: footer ? footer.getBoundingClientRect().top : dr.bottom };
    const r = last.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      optionCount: options.length,
      lastOption: { top: r.top, bottom: r.bottom, cx, cy },
      visibleTop: Math.max(sr.top, dr.top),
      visibleBottom: Math.min(sr.bottom, dr.bottom),
      hitIsOption: !!hit && (hit === last || last.contains(hit)),
      listBottom: list.getBoundingClientRect().bottom,
    };
  });
}

async function typeIbu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: COPY.en.addMed }).click();
  const input = page.getByLabel(COPY.en.nameLabel);
  await input.click();
  await input.pressSequentially('Ibu', { delay: 30 });
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible({ timeout: 10_000 });
  await expect(listbox.getByRole('option')).toHaveCount(DRUGS.length);
  return listbox;
}

test.describe('first-run wizard', () => {
  test.setTimeout(90_000);
  let acct: ScopedAccount;

  // `page` is requested so its fixture (which logs in the WORKER account) has
  // already run: cookieLogin then replaces that session with the scoped one.
  // Without it the page fixture logs in AFTER this hook and the test silently
  // runs as (and mutates the language of) the worker account.
  test.beforeEach(async ({ page: _page, context, baseURL }) => {
    void _page;
    acct = await createScopedAccount('wiz');
    await cookieLogin(context, acct, baseURL);
  });

  test('medication path: pick the 3rd suggestion, finish with defaults, DB holds its name and rxcui', async ({
    page,
  }) => {
    await stubDrugs(page);
    const recipient = uniq('wizrx');
    const circleId = await createFirstCircle(page, 'en', recipient);

    const listbox = await typeIbu(page);
    await expect(page.getByText(COPY.en.whatTitle(recipient))).toBeVisible();
    await listbox.getByRole('option').nth(2).click();
    await expect(page.getByLabel(COPY.en.nameLabel)).toHaveValue(DRUGS[2].name);

    const wizard = page.getByRole('dialog', { name: COPY.en.wizardName });
    await wizard.getByRole('button', { name: 'Continue' }).click();
    await wizard.getByRole('button', { name: 'Continue' }).click(); // default schedule, step 3
    await wizard.getByRole('button', { name: 'Add medication' }).click();
    // The default 08:00 preset may already be past in the recipient's zone.
    await acceptPastTimeNotice(page, 'Starts with the next dose', 'Continue', COPY.en.savedToast);
    await expect(page.getByText('Medication added.').first()).toBeVisible({ timeout: 20_000 });
    await expect(wizard).toHaveCount(0, { timeout: 15_000 });

    const rows = dbQuery<{ medication_name: string; rxcui: string | null }>(
      `select medication_name, rxcui from calendar_events
        where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication' and parent_event_id is null`
    );
    expect(rows).toHaveLength(1);
    // Falsification target: expecting DRUGS[0] (option 1) here must fail.
    expect(rows[0]).toEqual({ medication_name: DRUGS[2].name, rxcui: DRUGS[2].rxcui });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('dialog', { name: COPY.en.wizardName })).toHaveCount(0);
  });

  test('skip path: the ghost Skip closes the wizard and leaves no events', async ({ page }) => {
    const circleId = await createFirstCircle(page, 'en', uniq('wizskip'));
    await page.getByRole('dialog', { name: COPY.en.wizardName }).getByRole('button', { name: COPY.en.skip }).click();
    await expect(page.getByRole('dialog', { name: COPY.en.wizardName })).toHaveCount(0, { timeout: 10_000 });
    expect(
      dbQuery(`select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid`)
    ).toHaveLength(0);
  });

  test('Spanish: the wizard speaks Spanish and saves the medication', async ({ page }) => {
    // Through the profile UI (setProfileLanguage), not a bare PATCH: the SPA
    // adopts users.language on its own load path, and a PATCH behind its back
    // leaves the already-cached English strings in place.
    await setProfileLanguage(page, 'es');
    await stubDrugs(page);
    const recipient = uniq('wizes');
    const circleId = await createFirstCircle(page, 'es', recipient);
    const c = COPY.es;
    const wizard = page.getByRole('dialog', { name: c.wizardName });
    await wizard.getByRole('button', { name: c.addMed }).click();
    await expect(wizard.getByText(c.whatTitle(recipient))).toBeVisible();
    await page.getByLabel(c.nameLabel).fill('Metformina');
    await wizard.getByRole('button', { name: c.next }).click();
    await wizard.getByRole('button', { name: c.next }).click();
    await wizard.getByRole('button', { name: c.save }).click();
    await acceptPastTimeNotice(page, 'Comienza con la próxima dosis', c.next, c.savedToast);
    await expect(page.getByText(c.savedToast).first()).toBeVisible({ timeout: 20_000 });
    expect(
      dbQuery(
        `select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid
            and event_type = 'medication' and medication_name = 'Metformina' and parent_event_id is null`
      )
    ).toHaveLength(1);
  });

  test('the suggestion list is not clipped by the modal body (Pixel 5, 390x664)', async ({ page }) => {
    await stubDrugs(page);
    await createFirstCircle(page, 'en', uniq('wizclip'));
    const listbox = await typeIbu(page);
    const g = await measureLastOption(listbox);
    expect(g.optionCount).toBe(DRUGS.length);
    expect(g.lastOption.top, 'last option starts inside the visible dialog body').toBeGreaterThanOrEqual(g.visibleTop - 1);
    expect(g.lastOption.bottom, 'last option ends inside the visible dialog body').toBeLessThanOrEqual(g.visibleBottom + 1);
    expect(g.hitIsOption, 'the last option is what a tap at its centre would hit').toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
  });
});
