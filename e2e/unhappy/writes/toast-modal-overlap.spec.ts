import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { failRequest, type FaultOptions } from '../../unhappy';
import { errorToast, localDate } from './_helpers';

// A TOAST MUST NEVER COVER AN OPEN DIALOG'S CONTROLS — measured in real pixels.
//
// For each dialog, at each viewport, a save is forced to fail so the REAL toast
// renders, its entrance animation is allowed to FINISH (`getAnimations()`), and
// then the toast's FULL box is intersected with the full visible box of EVERY
// interactive element in the dialog — fields, selects, chips and their remove
// buttons, footer buttons, the header close button. Any intersection is a
// failure. Three shapes of toast:
//   1. one error toast (English copy);
//   2. a retry that fails AGAIN — the region must still hold ONE toast (the
//      replacement), not a stack growing over the dialog body;
//   3. the LONGEST real Spanish toasts the dialogs raise — the premium gate
//      (107 chars + "Mejorar") and, in InviteMemberModal, the pending-invite-seat
//      explanation (178 chars + "Mejorar") — which must clamp to two lines
//      while the full text stays in the live region and a "More" toggle shows it.
// The companion `retry-after-failure.spec.ts` clicks the save buttons for real
// while the toast is up; `toast-page-overlap.spec.ts` does this for pages.

test.use({ persona: 'premiumOwner' });
test.setTimeout(60_000);

type Lang = 'en' | 'es';

function locale(lang: Lang, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../src/i18n/${lang}/${file}.json`, import.meta.url)), 'utf8'));
}
function tr(lang: Lang, file: string, key: string, vars: Record<string, string> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], locale(lang, file));
  if (typeof value !== 'string') throw new Error(`missing ${lang}/${file}:${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '');
}

interface ModalCase {
  name: string;
  method: 'POST' | 'PUT';
  path: string;
  /** English error copy for a plain failure. */
  toast: string;
  file: string;
  keys: { trigger: string; dialog: string; save: string };
  /** Fill the open dialog (id-based, language-independent) so the save sends. */
  fill(dialog: Locator): Promise<void>;
  /** The longest real toast this dialog raises on a 402, per language. */
  gate(lang: Lang): { fault: FaultOptions; text: string };
}

const BLOCKING_EMAIL = 'lucia.fernandez-arriaga@example.com';
const plainGate = (lang: Lang) => ({ fault: { status: 402 }, text: tr(lang, 'common', 'upgradeGate.message') });

const MODALS: ModalCase[] = [
  {
    name: 'AddEventModal',
    method: 'POST',
    path: '/api/circles/:id/events',
    toast: "Couldn't save your changes. Please try again.",
    file: 'calendar',
    keys: { trigger: 'addEvent.addEvent', dialog: 'addEvent.newTitle', save: 'addEvent.create' },
    async fill(dialog) {
      await dialog.locator('#event_type').selectOption('appointment');
      await dialog.locator('#title').fill(uniqueLabel('TOV'));
      await dialog.locator('#scheduled_date').fill(localDate(3));
    },
    gate: plainGate,
  },
  {
    name: 'EditMedicalInfoModal',
    method: 'PUT',
    path: '/api/circles/:id/emergency-info',
    toast: "We couldn't save your changes. Please try again.",
    file: 'emergency',
    keys: { trigger: 'edit.editMedicalInfo', dialog: 'edit.medical.title', save: 'edit.save' },
    async fill(dialog) {
      const label = uniqueLabel('TOV');
      const input = dialog.locator('#allergies-input');
      await input.fill(label);
      await input.press('Enter');
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    },
    gate: plainGate,
  },
  {
    name: 'InviteMemberModal',
    method: 'POST',
    path: '/api/circles/:id/invites',
    toast: 'Something went wrong. Please try again.',
    file: 'members',
    keys: { trigger: 'invite.cta', dialog: 'invite.title', save: 'invite.send' },
    async fill(dialog) {
      await dialog
        .locator('#invite-email')
        .fill(`e2e-tov-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`);
    },
    gate: (lang) => ({
      fault: {
        status: 402,
        details: {
          reason: 'pending_invite_seat',
          blocking_invite: { id: '00000000-0000-4000-8000-00000000e2e2', invited_email: BLOCKING_EMAIL },
        },
      },
      text: tr(lang, 'members', 'errors.pendingInviteSeat', { email: BLOCKING_EMAIL }),
    }),
  },
  {
    name: 'VitalFormModal',
    method: 'POST',
    path: '/api/circles/:id/vitals',
    toast: "Couldn't save your changes. Please try again.",
    file: 'vitals',
    keys: { trigger: 'add.cta', dialog: 'add.title', save: 'add.save' },
    async fill(dialog) {
      await dialog.locator('#vital_type').selectOption('heart_rate');
      await dialog.locator('#value1').fill('72');
      await dialog.locator('#notes').fill(uniqueLabel('TOV'));
    },
    gate: plainGate,
  },
];

const PAGE_OF: Record<string, string> = {
  AddEventModal: 'calendar',
  EditMedicalInfoModal: 'emergency',
  InviteMemberModal: 'members',
  VitalFormModal: 'vitals',
};

async function openModal(page: Page, circleId: string, modal: ModalCase, lang: Lang): Promise<{ dialog: Locator; save: Locator }> {
  await page.goto(`/circles/${circleId}/${PAGE_OF[modal.name]}`, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: tr(lang, modal.file, modal.keys.trigger), exact: true })
    .first()
    .click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: tr(lang, modal.file, modal.keys.dialog), exact: true });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await modal.fill(dialog);
  return { dialog, save: dialog.getByRole('button', { name: tr(lang, modal.file, modal.keys.save), exact: true }) };
}

const VIEWPORTS = [
  { label: 'desktop 1280x720', width: 1280, height: 720 },
  { label: 'desktop 1440x900', width: 1440, height: 900 },
  { label: 'tablet 1024x768', width: 1024, height: 768 },
  { label: 'phone 390x844', width: 390, height: 844 },
  { label: 'phone 360x640', width: 360, height: 640 },
  { label: 'landscape 667x375', width: 667, height: 375 },
];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ControlGeometry {
  label: string;
  where: 'footer' | 'close' | 'body';
  box: Box;
  /** px² of the control's visible box under the toast's box. */
  overlap: number;
}

interface Geometry {
  viewport: { width: number; height: number };
  toastCount: number;
  toast: Box;
  controls: ControlGeometry[];
}

/** The one live (non-leaving) toast, once its entrance animation has finished. */
async function settledToast(page: Page): Promise<Locator> {
  const toast = page.locator('[data-toast-region] > [data-toast]:not([data-leaving])');
  await expect(toast).toHaveCount(1);
  await expect
    .poll(
      () => toast.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished').length),
      { message: 'the toast entrance animation has finished' }
    )
    .toBe(0);
  return toast;
}

/** Every visible interactive element of the topmost dialog, intersected (full box) with the toast. */
async function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    type B = { left: number; top: number; right: number; bottom: number };
    const box = (r: DOMRect): B => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    const clip = (a: B, b: B): B => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    });
    const area = (b: B) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
    const inToast = (n: Element | null) => !!n?.closest('[data-toast-region]');
    const viewport: B = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };

    const toasts = Array.from(document.querySelectorAll('[data-toast-region] > [data-toast]'));
    if (toasts.length === 0) throw new Error('no toast on screen to measure');
    const toastBox = box(toasts[toasts.length - 1].getBoundingClientRect());
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).pop();
    if (!dialog) throw new Error('no open dialog to measure');
    const closeButton = dialog.querySelector(':scope > div:first-child button');

    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="combobox"], [role="slider"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    const controls = [];
    for (const el of Array.from(dialog.querySelectorAll<HTMLElement>(selector))) {
      // The scrollable body is itself `tabIndex=0` (role=region) — a container.
      if (el.getAttribute('role') === 'region') continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let visible = clip(box(el.getBoundingClientRect()), viewport);
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(`${ps.overflowX} ${ps.overflowY}`)) visible = clip(visible, box(p.getBoundingClientRect()));
      }
      if (area(visible) < 1) continue;
      // Painted — ignoring the toast itself — at one of nine sample points?
      let painted = false;
      for (const fx of [0.1, 0.5, 0.9])
        for (const fy of [0.2, 0.5, 0.8]) {
          const top = document
            .elementsFromPoint(visible.left + (visible.right - visible.left) * fx, visible.top + (visible.bottom - visible.top) * fy)
            .find((n) => !inToast(n));
          if (top && (top === el || el.contains(top))) painted = true;
        }
      if (!painted) continue;
      controls.push({
        label: (el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 40) || el.id || el.tagName.toLowerCase()).trim(),
        where: el.closest('[data-modal-footer]') ? ('footer' as const) : el === closeButton ? ('close' as const) : ('body' as const),
        box: visible,
        overlap: area(clip(visible, toastBox)),
      });
    }
    return { viewport: { width: innerWidth, height: innerHeight }, toastCount: toasts.length, toast: toastBox, controls };
  });
}

const fmt = (b: Box) => `[${Math.round(b.left)},${Math.round(b.top)} → ${Math.round(b.right)},${Math.round(b.bottom)}]`;

function assertClear(geo: Geometry, tag: string, saveName: string): void {
  const report = geo.controls
    .map((c) => `${c.where.padEnd(6)} ${c.label.padEnd(30)} ${fmt(c.box)}${c.overlap > 0.5 ? `  OVERLAPS ${Math.round(c.overlap)}px²` : ''}`)
    .join('\n');
  console.log(`[${tag}] toast ${fmt(geo.toast)}\n${report}`);
  expect(geo.toastCount, 'exactly one toast in the region').toBe(1);
  expect(geo.toast.left, 'toast inside viewport (left)').toBeGreaterThanOrEqual(0);
  expect(geo.toast.top, 'toast inside viewport (top)').toBeGreaterThanOrEqual(0);
  expect(geo.toast.right, 'toast inside viewport (right)').toBeLessThanOrEqual(geo.viewport.width);
  expect(geo.toast.bottom, 'toast inside viewport (bottom)').toBeLessThanOrEqual(geo.viewport.height);
  // The measurement really saw the dialog: its save and its close button.
  expect(geo.controls.filter((c) => c.where === 'footer').map((c) => c.label), 'footer measured').toContain(saveName);
  expect(geo.controls.filter((c) => c.where === 'close'), 'header close measured').toHaveLength(1);
  expect(geo.controls.filter((c) => c.where === 'body').length, 'body fields measured').toBeGreaterThan(0);
  expect(
    geo.controls.filter((c) => c.overlap > 0.5).map((c) => `${c.where} ${c.label} ${fmt(c.box)} ${Math.round(c.overlap)}px²`),
    `interactive elements under the toast ${fmt(geo.toast)}\n${report}`
  ).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.label, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const modal of MODALS) {
      test(`${modal.name}: one error toast covers none of the dialog's interactive elements`, async ({ page, circleId }) => {
        const { save } = await openModal(page, circleId, modal, 'en');
        const injected = await failRequest(page, modal.method, modal.path, { status: 500, times: 1 });
        await save.click();
        await injected.expectHits(1);
        await expect(errorToast(page, modal.toast)).toBeVisible({ timeout: 15_000 });
        await expect(save).toBeEnabled();
        await settledToast(page);
        assertClear(await measure(page), `${vp.label}] [${modal.name} single`, tr('en', modal.file, modal.keys.save));
      });
    }

    for (const modal of MODALS.filter((m) => m.name !== 'InviteMemberModal')) {
      test(`${modal.name}: a retry that fails AGAIN leaves ONE (new) toast, still clear of every control`, async ({ page, circleId }) => {
        const { save } = await openModal(page, circleId, modal, 'en');
        const injected = await failRequest(page, modal.method, modal.path, { status: 500, times: 2 });
        await save.click();
        await injected.expectHits(1);
        const first = errorToast(page, modal.toast);
        await expect(first).toBeVisible({ timeout: 15_000 });
        await first.evaluate((el) => el.setAttribute('data-e2e-first-toast', ''));
        await expect(save).toBeEnabled();

        await save.click({ timeout: 3_000 });
        await injected.expectHits(2);
        // The second failure's toast REPLACED the first: one node, and not the old one.
        await expect(page.locator('[data-e2e-first-toast]')).toHaveCount(0, { timeout: 15_000 });
        await expect(errorToast(page, modal.toast)).toHaveCount(1);
        await expect(page.locator('[data-toast-region] > [data-toast]')).toHaveCount(1);
        await settledToast(page);
        assertClear(await measure(page), `${vp.label}] [${modal.name} double`, tr('en', modal.file, modal.keys.save));
      });
    }
  });
}

// --- the longest real Spanish toasts ------------------------------------------
const LONG_COPY_VIEWPORTS = VIEWPORTS.filter((v) => ['phone 360x640', 'phone 390x844', 'landscape 667x375', 'tablet 1024x768', 'desktop 1280x720'].includes(v.label));

test.describe('Spanish', () => {
  test.use({ locale: 'es' });

  test.beforeEach(async ({ page }) => {
    // Keep <LanguageSync> on Spanish: report the account's saved language as `es`.
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      try {
        const res = await route.fetch();
        const body = (await res.json()) as { data?: { user?: { language?: string } } };
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ response: res, json: body });
      } catch {
        await route.fallback().catch(() => undefined);
      }
    });
  });

  for (const vp of LONG_COPY_VIEWPORTS) {
    test.describe(vp.label, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const modal of MODALS) {
        test(`${modal.name}: the longest real ES toast clamps to two lines, keeps its full text, and covers nothing`, async ({
          page,
          circleId,
        }) => {
          const { save } = await openModal(page, circleId, modal, 'es');
          const gate = modal.gate('es');
          const injected = await failRequest(page, modal.method, modal.path, { ...gate.fault, times: 1 });
          await save.click();
          await injected.expectHits(1);

          const toast = await settledToast(page);
          await expect(toast).toHaveAttribute('role', 'status');
          await expect(toast.getByRole('button', { name: tr('es', 'common', 'upgradeGate.action'), exact: true })).toBeVisible();
          const message = toast.locator('[data-toast-message] > p');
          // The live region carries every character; nothing is cut from what is read out.
          expect(await message.textContent()).toBe(gate.text);
          expect(gate.text.length, 'a genuinely long string').toBeGreaterThan(100);
          const lines = await message.evaluate((p) => ({
            rendered: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
            clipped: p.scrollHeight > p.clientHeight + 1,
          }));
          expect(lines, 'two visible lines, with text beyond them').toEqual({ rendered: 2, clipped: true });

          assertClear(await measure(page), `${vp.label}] [${modal.name} ES long`, tr('es', modal.file, modal.keys.save));

          // …and the full message is one press away.
          const more = toast.getByRole('button', { name: tr('es', 'common', 'more'), exact: true });
          await expect(more).toHaveAttribute('aria-expanded', 'false');
          await more.click();
          await expect(more).toHaveAttribute('aria-expanded', 'true');
          await expect
            .poll(() => message.evaluate((p) => p.scrollHeight <= p.clientHeight + 1 && Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) > 2))
            .toBe(true);
        });
      }
    });
  }
});

// A toast that outlives its dialog goes back to the page placement.
test.describe('placement follows the dialog', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('closing the dialog while the toast is up returns it to the page placement (main column, under the header)', async ({
    page,
    circleId,
  }) => {
    const modal = MODALS.find((m) => m.name === 'InviteMemberModal')!;
    const { dialog, save } = await openModal(page, circleId, modal, 'en');
    await failRequest(page, modal.method, modal.path, { status: 500, times: 1 });
    await save.click();
    const toast = errorToast(page, modal.toast);
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await settledToast(page);
    const inDialog = await toast.boundingBox();
    expect(inDialog && { left: Math.round(inDialog.x), top: Math.round(inDialog.y) }).toEqual({ left: 16, top: 16 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toast).toBeVisible();
    await expect
      .poll(async () => {
        const b = await toast.boundingBox();
        return b ? { left: Math.round(b.x), top: Math.round(b.y), width: Math.round(b.width) } : null;
      })
      // 17rem sidebar + 24px gutter; 60px header + 16px.
      .toEqual({ left: 296, top: 76, width: 360 });
  });
});
