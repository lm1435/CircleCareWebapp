import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// 1.2.3 "first session focus", sections E + F — the parts jsdom cannot see.
//
//   F. Compact headers: the avatar sits LEFT of the name, in one row, on Home,
//      Profile and Circle settings; the name is never truncated.
//   E. Save always visible: the event form's Save is pinned in the dialog
//      footer (disabled until the required fields are filled) and the last
//      field scrolls fully clear of it; the Notes composer's Post row is a
//      sticky footer that stays above the floating nav pill.
//
// Non-destructive: nothing is saved.

const NAV_TIMEOUT = 20_000;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, 'element has a layout box').not.toBeNull();
  return b!;
}

/** `avatar` is left of `name`, and the two share a row (their boxes overlap vertically). */
async function expectAvatarLeftOfName(avatar: Locator, name: Locator): Promise<void> {
  const a = await box(avatar);
  const n = await box(name);
  expect(a.x + a.width, 'avatar ends before the name starts').toBeLessThanOrEqual(n.x);
  const overlap = Math.min(a.y + a.height, n.y + n.height) - Math.max(a.y, n.y);
  expect(overlap, 'avatar and name are on the same row').toBeGreaterThan(0);
}

/** Nothing is cut off: the element shows all of its text. */
async function expectNotTruncated(el: Locator): Promise<void> {
  const clipped = await el.evaluate(
    (node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
  );
  expect(clipped, 'text is not clipped').toBe(false);
  expect(await el.evaluate((node) => getComputedStyle(node).textOverflow)).not.toBe('ellipsis');
}

for (const viewport of [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'phone', width: 360, height: 740 },
]) {
  test.describe(`compact headers [${viewport.label}]`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Home: avatar left of the name, "Cared for by" under the name', async ({ page, circleId }) => {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      const hero = page.getByTestId('overview-hero');
      const name = hero.getByRole('heading', { level: 1 });
      await expect(name).toBeVisible({ timeout: NAV_TIMEOUT });
      const avatar = hero.locator(':scope > div').first();

      await expectAvatarLeftOfName(avatar, name);
      await expectNotTruncated(name);
      const a = await box(avatar);
      // About 60px (plus the 4px ring drawn outside the box).
      expect(a.width).toBeGreaterThanOrEqual(56);
      expect(a.width).toBeLessThanOrEqual(64);
      const fontSize = await name.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(24);
      expect(fontSize).toBeLessThanOrEqual(26);

      const caredFor = hero.getByText('Cared for by');
      if ((await caredFor.count()) > 0) {
        const n = await box(name);
        const c = await box(caredFor);
        expect(c.y, '"Cared for by" sits under the name').toBeGreaterThanOrEqual(n.y + n.height - 1);
        expect(Math.abs(c.x - n.x), 'and is left-aligned with it').toBeLessThanOrEqual(2);
      }
      // The whole header stays compact: well under the old 96px-avatar stack.
      expect((await box(hero)).height).toBeLessThanOrEqual(140);
    });

    test('Profile: avatar left; name with its pencil beside it; email under; no page overflow', async ({
      page,
    }) => {
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const header = page.getByTestId('profile-header');
      const name = header.getByRole('heading', { level: 1 });
      await expect(name).toBeVisible({ timeout: NAV_TIMEOUT });
      const avatar = header.locator(':scope > span').first();
      await expectAvatarLeftOfName(avatar, name);
      await expectNotTruncated(name);

      const pencil = header.getByRole('button', { name: 'Edit name', exact: true });
      const n = await box(name);
      const p = await box(pencil);
      expect(p.x, 'pencil is right beside the name').toBeGreaterThanOrEqual(n.x + n.width - 1);
      expect(p.x - (n.x + n.width)).toBeLessThanOrEqual(12);
      expect(p.width).toBeGreaterThanOrEqual(44);
      expect(p.height).toBeGreaterThanOrEqual(44);

      // The Premium chip (worker accounts are premium owners) is on its OWN
      // line under the email, left-aligned with the name.
      const chip = header.getByTestId('profile-premium-chip');
      if ((await chip.count()) > 0) {
        const c = await box(chip);
        expect(Math.abs(c.x - n.x)).toBeLessThanOrEqual(2);
        expect(c.y).toBeGreaterThan(n.y + n.height);
        await expect(chip).toHaveText('Premium');
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);

      // The pencil opens the name fields and moves focus into them.
      await pencil.click();
      await expect(page.locator('#profile-first-name')).toBeFocused();
    });

    test('Circle settings: photo left of "Edit {{name}}", in the title row', async ({ page, circleId }) => {
      await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
      const title = page.getByRole('heading', { level: 1, name: /^Edit / });
      await expect(title).toBeVisible({ timeout: NAV_TIMEOUT });
      const photo = page.getByTestId('edit-circle-photo');
      await expectAvatarLeftOfName(photo, title);
      await expectNotTruncated(title);
      // 64px: a little larger than Home's.
      expect((await box(photo)).width).toBeGreaterThanOrEqual(62);
      // The form starts right under the row — no big centred avatar in the card.
      const field = page.locator('#recipient_name');
      const formTop = (await box(field)).y;
      const titleBottom = (await box(title)).y + (await box(title)).height;
      expect(formTop - titleBottom).toBeLessThanOrEqual(120);
      // Web cannot change the recipient photo (platform exception).
      await expect(page.getByText('Change photo', { exact: true })).toHaveCount(0);
    });
  });
}

async function openNewEntry(page: Page, circleId: string, item: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const trigger = page.locator('aside').getByRole('button', { name: 'New', exact: true });
  await expect(trigger).toBeVisible({ timeout: NAV_TIMEOUT });
  await trigger.click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe('Save is always visible on the add form', () => {
  // Wide enough for the sidebar's "New", and SHORT, so the form must scroll.
  test.use({ viewport: { width: 1280, height: 560 } });

  for (const item of ['Medication', 'Appointment', 'Task']) {
    test(`${item}: Save is pinned in the footer, disabled until the required fields are filled`, async ({
      page,
      circleId,
    }) => {
      const dialog = await openNewEntry(page, circleId, item);
      const save = dialog.getByTestId('add-event-save');
      const form = dialog.locator('#add-event-form');
      const scroller = form.locator('xpath=..');

      // On screen without scrolling, and disabled while the form is empty.
      await expect(save).toBeInViewport({ ratio: 1 });
      await expect(save).toBeDisabled();
      expect(
        await scroller.evaluate((el) => el.scrollHeight > el.clientHeight),
        'the form is taller than the dialog body, so the footer has something to stay above'
      ).toBe(true);

      // Scrolled to the very end, the LAST field is fully clear of the footer
      // and Save has not moved.
      const before = await box(save);
      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const after = await box(save);
      expect(after.y).toBe(before.y);
      const footerTop = (await box(dialog.locator('[data-modal-footer]'))).y;
      const lastField = form.locator('input:visible, textarea:visible, select:visible, button:visible').last();
      const last = await box(lastField);
      expect(last.y + last.height, 'last control ends above the footer').toBeLessThanOrEqual(footerTop);

      // Filling the required fields enables it, wherever the form is scrolled.
      await dialog.locator(item === 'Medication' ? '#medication_name' : '#title').fill('Layout check');
      if (item === 'Medication') {
        await expect(save).toBeDisabled(); // a medication also needs its time
        await dialog.locator('#scheduled_time').fill('09:00');
      }
      await expect(save).toBeEnabled();
      await expect(save).toBeInViewport({ ratio: 1 });

      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    });
  }
});

test.describe('Notes composer: the Post row is a sticky footer', () => {
  // The composer is taller than what is left of a 360x520 viewport.
  test.use({ viewport: { width: 360, height: 520 } });

  test('Post stays on screen above the nav pill while the composer is in view', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const body = page.getByLabel(/^Add a note/);
    await expect(body).toBeVisible({ timeout: NAV_TIMEOUT });
    const footer = page.getByTestId('note-composer-footer').first();
    const post = footer.getByRole('button', { name: 'Post', exact: true });
    await expect(post).toBeDisabled();

    // Bring the textarea to the top of the viewport: the composer's own end is
    // now below the fold, which is when the row has to stick.
    await body.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(post).toBeInViewport({ ratio: 1 });
    const nav = page.getByTestId('floating-nav');
    const p = await box(post);
    const n = await box(nav);
    expect(p.y + p.height, 'Post sits above the floating nav pill').toBeLessThanOrEqual(n.y);
    // And it is not covering the field being typed in.
    const b = await box(body);
    expect(p.y).toBeGreaterThanOrEqual(b.y);

    await body.fill('Sticky footer check');
    await expect(post).toBeEnabled();
    await body.fill('');
  });
});
