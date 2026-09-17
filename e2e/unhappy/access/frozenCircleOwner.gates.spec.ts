import { test, expect } from '../../fixtures';
import { dbCount, sqlStr } from '../../unhappy';
import {
  CIRCLE_SELECTION_BANNER,
  SURFACES,
  circleNameOf,
  expectGated,
  gotoCirclePage,
  loadSurfaceData,
  runWriteProbes,
} from './_helpers';

// ===========================================================================
// FROZEN CIRCLE — a free owner of TWO circles who has not chosen which one to
// keep (`needsCircleSelection: true`). Both circles derive `read_only` on the
// list and `can_edit: false` on the detail.
//
//   selection   the persistent "choose which circle to keep" prompt is shown on
//               the picker and inside the circle; opening the chooser and
//               cancelling it writes nothing (`selected_on_downgrade` stays
//               false on both rows).
//   UI          every canEdit-gated surface withholds its write controls (same
//               surface definitions as the view-only spec; Members is left out
//               because its invite/manage controls are OWNER-gated, not
//               canEdit-gated, and this persona is the owner).
//   server      every write answers 403 SUBSCRIPTION_REQUIRED (documents
//               READ_ONLY_MEMBER; invites 402 at the cap) and nothing is written.
// ===========================================================================

test.use({ persona: 'frozenCircleOwner' });

test('circle list: both circles read-only and the circle-selection prompt is shown; cancelling the chooser writes nothing', async ({
  page,
  personaHandle: h,
}) => {
  const selected = `select 1 from care_circles where owner_id = ${sqlStr(h.userId)}::uuid and selected_on_downgrade`;
  expect(dbCount(selected)).toBe(0);

  await page.goto('/circles');
  for (const id of h.liveCircleIds) {
    await expect(
      page.getByRole('link', { name: new RegExp(`^Open ${circleNameOf(id)} .*Read-only`) }),
      `card for ${circleNameOf(id)} marked read-only`
    ).toBeVisible({ timeout: 20_000 });
  }
  const banner = page.getByRole('status').filter({ hasText: CIRCLE_SELECTION_BANNER });
  await expect(banner).toBeVisible();

  await banner.getByRole('button', { name: 'Choose circle' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const id of h.liveCircleIds) {
    await expect(dialog.getByRole('radio', { name: new RegExp(circleNameOf(id)) })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(dbCount(selected), 'no circle was selected').toBe(0);
});

test('inside a frozen circle the circle-selection prompt stays up', async ({ page, personaHandle: h }) => {
  const data = loadSurfaceData(h);
  await gotoCirclePage(page, h.circleId, 'notes');
  await expect(page.getByText(data.careNoteBody!).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: CIRCLE_SELECTION_BANNER })).toBeVisible();
});

for (const surface of SURFACES.filter((s) => s.name !== 'members')) {
  test(`${surface.name}: no write affordance is offered in a frozen circle`, async ({ page, personaHandle }) => {
    const data = loadSurfaceData(personaHandle);
    const affordances = await surface.open(page, data);
    await expectGated(affordances);
  });
}

test('server refuses every write to the frozen circle with SUBSCRIPTION_REQUIRED, and nothing is written', async ({
  request,
  personaHandle,
}) => {
  await runWriteProbes(request, personaHandle, {
    default: { status: 403, code: 'SUBSCRIPTION_REQUIRED' },
    documents: { status: 403, code: 'READ_ONLY_MEMBER' },
    invite: { status: 402, code: 'SUBSCRIPTION_REQUIRED' },
  });
});
