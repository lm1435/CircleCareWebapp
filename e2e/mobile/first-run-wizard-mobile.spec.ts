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
  skip: string;
  nameLabel: RegExp;
  save: string;
  savedToast: string;
  addMed: (n: string) => string;
  title: (n: string) => RegExp;
}
const COPY: Record<'en' | 'es', Copy> = {
  en: {
    createBtn: 'Create circle',
    wizardName: 'Circle created',
    skip: 'Skip for now',
    nameLabel: /Medication name/i,
    save: 'Add medication',
    savedToast: 'Medication added.',
    addMed: (n) => `Add ${n}'s first med`,
    title: (n) => new RegExp(`What does ${n} take\\?`),
  },
  es: {
    createBtn: 'Crear círculo',
    wizardName: 'Círculo creado',
    skip: 'Omitir por ahora',
    nameLabel: /Nombre del medicamento/i,
    save: 'Agregar medicamento',
    savedToast: 'Medicamento agregado.',
    addMed: (n) => `Agrega el primer medicamento de ${n}`,
    title: (n) => new RegExp(`¿Qué toma ${n}\\?`),
  },
};

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
  await page.getByTestId('first-run-primary').click();
  const input = page.getByLabel(COPY.en.nameLabel);
  await input.click();
  await input.pressSequentially('Ibu', { delay: 30 });
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible({ timeout: 10_000 });
  await expect(listbox.getByRole('option')).toHaveCount(DRUGS.length + 1);
  return listbox;
}

test.describe('first-run wizard, phone (onboarding 1.3.1: Setup -> the ONE simple form -> payoff)', () => {
  test.setTimeout(90_000);
  let acct: ScopedAccount;

  // `page` is requested so its fixture (which logs in the WORKER account) has
  // already run: cookieLogin then replaces that session with the scoped one.
  test.beforeEach(async ({ page: _page, context, baseURL }) => {
    void _page;
    acct = await createScopedAccount('wiz');
    await cookieLogin(context, acct, baseURL);
  });

  test('medication path: folded form, pick the 3rd suggestion, DB holds its name and rxcui, payoff has no invite question', async ({
    page,
  }) => {
    await stubDrugs(page);
    const recipient = uniq('wizrx');
    const circleId = await createFirstCircle(page, 'en', recipient);

    const listbox = await typeIbu(page);
    // The folded form, headed by the first-med eyebrow and the big question.
    await expect(page.getByText(COPY.en.title(recipient))).toBeVisible();
    await expect(page.getByText(`${recipient.toUpperCase()}'S FIRST MED`, { exact: true })).toBeVisible();
    await expect(page.getByText('Just the name, the big word on the bottle. Dose is optional.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
    await listbox.getByRole('option').nth(2).click();
    await expect(page.getByLabel(COPY.en.nameLabel)).toHaveValue(DRUGS[2].name);

    const form = page.getByRole('dialog').last();
    await form.getByRole('radio', { name: /Morning/ }).click();
    await form.getByRole('button', { name: 'Add medication' }).click();

    // The payoff, in the wizard dialog: ALL SET, the reminder sentence, ONE primary.
    const wizard = page.getByRole('dialog', { name: COPY.en.wizardName });
    await expect(wizard.getByText('ALL SET')).toBeVisible({ timeout: 20_000 });
    await expect(wizard.getByRole('heading', { name: /reminder is set\.$/ })).toBeVisible();
    await expect(wizard.getByRole('button', { name: 'Invite someone' })).toHaveCount(0);
    await expect(wizard.getByText(/who.s usually there/i)).toHaveCount(0);
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    // Premium scoped account: no paywall, straight to Today.
    await expect(wizard).toHaveCount(0, { timeout: 15_000 });

    const rows = dbQuery<{ medication_name: string; rxcui: string | null }>(
      `select medication_name, rxcui from calendar_events
        where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication' and parent_event_id is null`
    );
    expect(rows).toHaveLength(1);
    // Falsification target: expecting DRUGS[0] (option 1) here must fail.
    expect(rows[0]).toEqual({ medication_name: DRUGS[2].name, rxcui: DRUGS[2].rxcui });

    // The payoff wrote the invite snooze: Today does not ask the invite question again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('dialog', { name: COPY.en.wizardName })).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('next-step-card')).toHaveCount(0);
  });

  test('Setup (1): one filled primary, the promise, OR START WITH rows, Skip for now', async ({ page }) => {
    const recipient = uniq('wizone');
    await createFirstCircle(page, 'en', recipient);
    const wizard = page.getByRole('dialog', { name: COPY.en.wizardName });

    await expect(wizard.getByText(`${recipient.toUpperCase()}'S CIRCLE`, { exact: true })).toBeVisible();
    await expect(wizard.getByRole('heading', { name: `${recipient}'s circle is ready.` })).toBeVisible();
    await expect(wizard.getByText("Start with the thing you'll check most.")).toBeVisible();
    await expect(wizard.getByTestId('first-run-primary')).toHaveText(COPY.en.addMed(recipient));
    await expect(
      wizard.getByText("About a minute. Everyone helping sees it, with a reminder when it's time.")
    ).toBeVisible();
    await expect(wizard.getByText('OR START WITH')).toBeVisible();
    await expect(wizard.getByTestId('first-run-start-with-appointment')).toHaveText('An appointment');
    await expect(wizard.getByTestId('first-run-start-with-invite')).toHaveText('Someone to help');
    await expect(wizard.getByTestId('first-run-start-with-emergency')).toHaveText('Emergency info');
    await expect(wizard.getByRole('button', { name: COPY.en.skip, exact: true })).toBeVisible();
    await expect(wizard.getByRole('button', { name: 'Close setup', exact: true })).toBeVisible();
    // The old see-what-else toggle and the progress rules are gone.
    await expect(wizard.getByTestId('first-run-more-toggle')).toHaveCount(0);
    await expect(wizard.getByRole('progressbar')).toHaveCount(0);

    // A quiet row hands off in place and Cancel returns to Setup.
    await wizard.getByTestId('first-run-start-with-appointment').click();
    await expect(page.getByRole('dialog', { name: /appointment/i }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('first-run-primary')).toBeVisible();
  });

  test('closing the first-run form unsaved returns to Today and saves nothing', async ({ page }) => {
    const circleId = await createFirstCircle(page, 'en', uniq('wizclose'));
    await page.getByTestId('first-run-primary').click();
    await expect(page.getByTestId('first-run-form-heading')).toBeVisible();
    await page.getByTestId('first-run-skip').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
    expect(
      dbQuery(`select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid`)
    ).toHaveLength(0);
  });

  test('skip path: the ghost Skip closes the wizard and leaves no events', async ({ page }) => {
    const circleId = await createFirstCircle(page, 'en', uniq('wizskip'));
    await page.getByRole('dialog', { name: COPY.en.wizardName }).getByRole('button', { name: COPY.en.skip }).click();
    await expect(page.getByRole('dialog', { name: COPY.en.wizardName })).toHaveCount(0, { timeout: 10_000 });
    expect(
      dbQuery(`select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid`)
    ).toHaveLength(0);
  });

  test('Spanish: Setup and the folded form speak Spanish and save the medication', async ({ page }) => {
    await setProfileLanguage(page, 'es');
    await stubDrugs(page);
    const recipient = uniq('wizes');
    const circleId = await createFirstCircle(page, 'es', recipient);
    const c = COPY.es;
    const wizard = page.getByRole('dialog', { name: c.wizardName });
    await expect(wizard.getByTestId('first-run-primary')).toHaveText(c.addMed(recipient));
    await wizard.getByTestId('first-run-primary').click();
    await expect(page.getByText(c.title(recipient))).toBeVisible();
    await page.getByLabel(c.nameLabel).fill('Metformina');
    const form = page.getByRole('dialog').last();
    await form.getByRole('radio').first().click();
    await form.getByRole('button', { name: c.save }).click();
    await expect(page.getByText('TODO LISTO')).toBeVisible({ timeout: 20_000 });
    expect(
      dbQuery(
        `select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid
            and event_type = 'medication' and medication_name = 'Metformina' and parent_event_id is null`
      )
    ).toHaveLength(1);
  });

  for (const viewport of [null, { width: 390, height: 664 }] as const) {
    const label = viewport ? '390x664' : 'default viewport';
    test(`the suggestion list is not clipped by the modal body (${label})`, async ({ page }) => {
      await stubDrugs(page);
      if (viewport) await page.setViewportSize(viewport);
      await createFirstCircle(page, 'en', uniq('wizclip'));
      const listbox = await typeIbu(page);
      const g = await measureLastOption(listbox);
      // 8 suggestions + the "Use ... as typed" row.
      expect(g.optionCount).toBe(DRUGS.length + 1);
      expect(g.lastOption.top, 'last option starts inside the visible dialog body').toBeGreaterThanOrEqual(g.visibleTop - 1);
      expect(g.lastOption.bottom, 'last option ends inside the visible dialog body').toBeLessThanOrEqual(g.visibleBottom + 1);
      expect(g.hitIsOption, 'the last option is what a click at its centre would hit').toBe(true);
    });
  }

  // Owner decision 2026-10-06: the drug directory (RxNorm) is US-only, so a local brand name
  // outside the US is kept as typed. 1.3.1 makes that explicit: the last suggestion row is
  // "Use "x" as typed" (alone when the directory answers empty), keeps the name, no rxcui.
  test.describe('non-US browser, name the directory does not know', () => {
    test.use({ locale: 'fr-FR', timezoneId: 'Europe/Paris' });

    test('Doliprane: the as-typed row is the way forward, saves as typed, no warning, no rxcui', async ({ page }) => {
      await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
      const recipient = uniq('wizfr');
      const circleId = await createFirstCircle(page, 'en', recipient);
      await page.getByTestId('first-run-primary').click();
      await page.getByLabel(COPY.en.nameLabel).pressSequentially('Doliprane', { delay: 20 });
      await page.waitForResponse((r) => r.url().includes('/api/drugs/search'), { timeout: 10_000 });
      await expect(page.getByText(/not found|not recogni[sz]ed|check (the )?spelling|couldn.t find/i)).toHaveCount(0);
      const asTyped = page.getByRole('option', { name: /Use .Doliprane. as typed/ });
      await expect(asTyped).toBeVisible();
      await asTyped.click();
      await expect(page.getByLabel(COPY.en.nameLabel)).toHaveValue('Doliprane');
      const form = page.getByRole('dialog').last();
      await form.getByRole('radio', { name: /Morning/ }).click();
      await form.getByRole('button', { name: 'Add medication' }).click();
      await expect(page.getByText('ALL SET')).toBeVisible({ timeout: 20_000 });
      expect(
        dbQuery(
          `select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid
              and event_type = 'medication' and medication_name = 'Doliprane' and rxcui is null
              and parent_event_id is null`
        )
      ).toHaveLength(1);
    });
  });
});
