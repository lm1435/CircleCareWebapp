import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { diagnoseClickObstruction } from '../helpers';
import { apiSession, type ApiSession } from '../unhappy';

// Vitals write flow: log a manual heart-rate reading → verify it appears in the
// history list → edit its value → verify the change → delete it. Values are
// neutral numerics (PHI-safe) in a high, uncommon-but-valid band (20-300 bpm)
// so the rendered "<value> bpm" row text is unique.
//
// DETERMINISTIC GEOMETRY. This spec used to be "flaky": the Heart rate group
// had exactly ONE reading (ours), so its Accordion body was a ~82px box, and
// that body was `overflow-hidden` — the row's MoreMenu panel was painted
// clipped and "Edit" sat under the next section, unclickable. The retry only
// passed because the failed attempt left a SECOND reading behind, which made
// the group tall enough. So the spec now:
//   - asserts, before it starts, that the circle has NO heart-rate readings
//     (after clearing any leftovers this spec itself tagged), so the group is
//     always the single-reading case that exposed the bug;
//   - asserts each menu item it uses is fully in the viewport (IntersectionObserver
//     ratio 1 — ancestor clips count) AND is the element hit at its centre, before
//     clicking it;
//   - cleans up via the API in `finally`, so a failed attempt can never leave a
//     reading for a retry to pass on. Run it with --retries=0.

// `uniqueLabel(NOTE_TAG)` → "E2E vital-menu <ts>-<rand>"; the tag finds leftovers.
const NOTE_TAG = 'vital-menu';

function randomHeartRate(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface VitalRow {
  id: string;
  vital_type: string;
  notes: string | null;
}

async function listHeartRate(session: ApiSession, circleId: string): Promise<VitalRow[]> {
  const to = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const res = await session.get(
    `/api/circles/${circleId}/vitals?type=heart_rate&from=2000-01-01&to=${encodeURIComponent(to)}`
  );
  expect(res.ok(), `list vitals: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: { vitals: VitalRow[] } }).data.vitals;
}

async function deleteTagged(session: ApiSession, circleId: string, match: (n: string) => boolean) {
  for (const v of await listHeartRate(session, circleId)) {
    if (v.notes && match(v.notes)) {
      await session.delete(`/api/circles/${circleId}/vitals/${v.id}`);
    }
  }
}

/**
 * The item is not merely in the DOM: it is fully painted inside the viewport
 * (IntersectionObserver clips through every overflow ancestor, so a panel cut
 * off by a clipping container fails ratio 1) and nothing else sits on top of
 * its centre. Attaches the obstruction diagnosis on failure.
 */
async function expectOperable(page: Page, item: Locator, what: string): Promise<void> {
  await expect(item).toBeVisible();
  try {
    await expect(item, `${what} must be fully visible in the viewport`).toBeInViewport({ ratio: 1 });
    const box = await item.boundingBox();
    const viewport = page.viewportSize();
    expect(box, `${what} has no bounding box`).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    await expect
      .poll(
        () =>
          item.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return hit === el || el.contains(hit);
          }),
        { message: `${what} must be the element hit at its centre (not intercepted)` }
      )
      .toBe(true);
  } catch (error) {
    await test.info().attach(`${what} obstruction`, {
      body: JSON.stringify(await diagnoseClickObstruction(item), null, 2),
      contentType: 'application/json',
    });
    throw error;
  }
}

test('log, edit, and delete a manual vital reading', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const session = await apiSession(request, account);
  const note = uniqueLabel(NOTE_TAG);
  const bpm = randomHeartRate(240, 290);
  const editedBpm = randomHeartRate(200, 239);
  const valueText = `${bpm} bpm`;
  const editedValueText = `${editedBpm} bpm`;

  // Precondition: an EMPTY heart-rate group, so the reading we log is the only
  // row in it — the single-reading Accordion body that clipped the menu.
  await deleteTagged(session, circleId, (n) => n.startsWith(`E2E ${NOTE_TAG} `));
  expect(
    await listHeartRate(session, circleId),
    'precondition: the circle must have no heart-rate readings (the demo seed has none)'
  ).toHaveLength(0);

  try {
    await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
    const addBtn = page.getByRole('button', { name: 'Add reading' }).first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });

    // --- Log (create) ---
    await addBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#vital_type').selectOption('heart_rate');
    await dialog.locator('#value1').fill(String(bpm));
    await dialog.locator('#notes').fill(note);
    await dialog.getByRole('button', { name: 'Save reading' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // The group really is the single-reading case (grouped view, not a
    // one-type filter: the Accordion is what clipped).
    const group = page.getByRole('region', { name: 'Heart rate' });
    await expect(group.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
    await expect(group.getByText(new RegExp(esc(valueText)))).toBeVisible();

    // --- Edit ---
    await group
      .getByRole('button', { name: new RegExp(`Actions for reading .*${esc(valueText)}`) })
      .click();
    const rowMenu = page.getByRole('menu');
    await expect(rowMenu).toBeVisible();
    const edit = rowMenu.getByRole('menuitem', { name: 'Edit', exact: true });
    await expectOperable(page, edit, 'Edit');
    await edit.click({ timeout: 5_000 });

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await editDialog.locator('#value1').fill(String(editedBpm));
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(editDialog).toBeHidden({ timeout: 20_000 });
    await expect(group.getByText(new RegExp(esc(editedValueText)))).toBeVisible({
      timeout: 20_000,
    });

    // --- Delete ---
    await group
      .getByRole('button', { name: new RegExp(`Actions for reading .*${esc(editedValueText)}`) })
      .click();
    const deleteMenu = page.getByRole('menu');
    await expect(deleteMenu).toBeVisible();
    const del = deleteMenu.getByRole('menuitem', { name: 'Delete', exact: true });
    await expectOperable(page, del, 'Delete');
    await del.click({ timeout: 5_000 });

    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(new RegExp(esc(editedValueText)))).toHaveCount(0, {
      timeout: 20_000,
    });
  } finally {
    // Whatever happened above, leave the group empty again.
    await deleteTagged(session, circleId, (n) => n === note);
  }
});
