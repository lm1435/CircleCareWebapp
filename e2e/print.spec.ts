import { test, expect } from './fixtures';

// Print-layout smoke test for the Emergency Info page (Task 18, spec §6.6).
//
// The page used to break under print: a desktop CSS-columns masonry
// (`.emergency-sections { lg:columns-2 }`) was never fully reset for print,
// so a printed/PDF'd sheet could split a doctor/contact/insurance card
// mid-card across a column or page break — exactly the kind of thing a
// family member relies on when a paramedic is standing in the room. This
// spec verifies the fix holds under real `print` media emulation and a real
// generated PDF, not just a `print.css` source-code review.
//
// No mutations: this only reads the demo circle's emergency info and asks
// the browser to render/print it.

test('emergency info prints as a clean single column with whole cards', async ({
  page,
  circleId,
  browserName,
}) => {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({
    timeout: 20_000,
  });
  // Let the emergency-info + circle-detail queries settle so the sectioned
  // view (not the loading skeleton) is what gets measured under print.
  await expect(page.locator('.emergency-sections')).toBeVisible({ timeout: 20_000 });

  await page.emulateMedia({ media: 'print' });

  // 1) The desktop masonry is fully reset — no leftover CSS column count.
  // (`display: block` alone does not reset `column-count`; see print.css.)
  const columnCount = await page
    .locator('.emergency-sections')
    .evaluate((el) => getComputedStyle(el).columnCount);
  expect(columnCount).toBe('auto');

  // 2) Every section/recipient card spans (close to) the full print width —
  // the old masonry could squeeze a card into a half-width column. The
  // at-a-glance tiles are the one INTENTIONAL exception (spec §6.6: a fixed
  // 2-up grid even on paper), so they're checked separately below.
  const cardWidths = await page.evaluate(() => {
    const out: { width: number; parentWidth: number; inGlance: boolean }[] = [];
    document.querySelectorAll<HTMLElement>('.print-card').forEach((card) => {
      const parent = card.parentElement;
      if (!parent) return;
      out.push({
        width: card.getBoundingClientRect().width,
        parentWidth: parent.getBoundingClientRect().width,
        inGlance: card.closest('.glance-tiles-grid') !== null,
      });
    });
    return out;
  });

  expect(cardWidths.length).toBeGreaterThan(0);

  const sectionCards = cardWidths.filter((c) => !c.inGlance);
  expect(sectionCards.length).toBeGreaterThan(0);
  for (const card of sectionCards) {
    expect(card.width).toBeGreaterThanOrEqual(card.parentWidth * 0.9);
  }

  // At-a-glance tiles: a fixed 2-up grid (spec §6.6), not the 90% "full
  // width" bar above. Checked by track COUNT rather than a pixel ratio — a
  // longer allergy-pill list legitimately grows its `1fr` track's min-content
  // share, so the two columns are not always pixel-equal, but there must
  // still be exactly two of them (not one, and not the screen breakpoint's
  // four).
  const glanceCards = cardWidths.filter((c) => c.inGlance);
  if (glanceCards.length > 0) {
    const glanceColumnCount = await page
      .locator('.glance-tiles-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    expect(glanceColumnCount).toBe(2);
  }

  // 3) Print chrome (masthead actions, tabs, per-card MoreMenus) is hidden.
  const printHideVisible = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-print-hide]')).filter(
        (el) => el.offsetParent !== null || getComputedStyle(el).display !== 'none'
      ).length
  );
  expect(printHideVisible).toBe(0);

  // 4) A real generated PDF is short and not blank — Chromium only (the only
  // engine Playwright can drive `page.pdf()` with).
  test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only');

  const pdf = await page.pdf({ format: 'Letter' });
  expect(pdf.length).toBeGreaterThan(0);

  // Count pages the crude-but-reliable way: every page object in the PDF
  // structure carries `/Type /Page` (not `/Type /Pages`, the one collection
  // object) — the negative lookahead keeps that plural node out of the count.
  const pageMatches = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g) ?? [];
  expect(pageMatches.length).toBeGreaterThan(0);
  expect(pageMatches.length).toBeLessThanOrEqual(4);
});
