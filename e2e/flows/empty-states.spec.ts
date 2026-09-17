import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Empty-state coverage WITHOUT creating a real circle.
//
// Why stub instead of a real empty circle: stubbing each list endpoint to an
// empty (but valid) envelope on this worker's cloned circle is deterministic and
// renders the exact empty states a brand-new circle would show, without the
// create/delete round-trip (circle-lifecycle.spec.ts owns that). We verify the
// empty state renders + passes axe, and — on the calendar and meds pages, whose
// empty states carry their OWN add CTA next to the masthead's — that the
// empty-state CTA specifically opens the create modal.
//
// Every "Something went wrong" absence is checked AFTER the empty state has
// rendered; checked before, it passes on a page that has not rendered anything.

const TODAY = '2026-06-20';
const TZ = 'America/New_York';

function emptyJson(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

test.describe('empty states (list endpoints stubbed empty)', () => {
  test('empty tasks renders its empty state + a11y', async ({ page, circleId }, testInfo) => {
    await page.route(/\/api\/circles\/[^/]+\/tasks(\?|$)/, (r) =>
      r.fulfill(emptyJson({ success: true, data: { tasks: [], today: TODAY, timezone: TZ } }))
    );
    const path = `/circles/${circleId}/tasks`;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No open tasks')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await checkA11y(page, path, testInfo);
  });

  test('empty vitals renders its empty state + a11y', async ({ page, circleId }, testInfo) => {
    await page.route(/\/api\/circles\/[^/]+\/vitals(\?|$)/, (r) =>
      r.fulfill(emptyJson({ success: true, data: { vitals: [] } }))
    );
    const path = `/circles/${circleId}/vitals`;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No readings yet')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await checkA11y(page, path, testInfo);
  });

  test('empty documents renders its empty state + a11y', async ({ page, circleId }, testInfo) => {
    await page.route(/\/api\/circles\/[^/]+\/documents(\?|$)/, (r) =>
      r.fulfill(
        emptyJson({
          success: true,
          data: { documents: [], storage: { used: 0, limit: 1_073_741_824 } },
        })
      )
    );
    const path = `/circles/${circleId}/documents`;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // An editor gets the starter kit (mobile 1.1.11 parity); a viewer, or a
    // full store, keeps the generic empty state.
    await expect(
      page.getByRole('heading', { name: /Start with these four|No documents yet/ })
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await checkA11y(page, path, testInfo);
  });

  test('empty calendar: add-event CTA opens the create modal from empty', async ({
    page,
    circleId,
  }, testInfo) => {
    await page.route(/\/api\/circles\/[^/]+\/events(\?|$)/, (r) =>
      r.fulfill(emptyJson({ success: true, data: { events: [] } }))
    );
    const path = `/circles/${circleId}/calendar`;
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // The EMPTY STATE rendered (CalendarPage.tsx: EmptyState with
    // calendar:noEventsWeek, shown only once events resolved to []).
    const emptyTitle = page.getByRole('heading', { name: 'No events this week' });
    await expect(emptyTitle).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('grid')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // "Add event" exists twice on an empty, editable calendar: the masthead's
    // icon button (DOM-first) and the empty state's own CTA. The CTA is the one
    // under test, so scope to the innermost element holding BOTH the empty
    // title and an Add event button — the EmptyState itself, which the masthead
    // button is outside of.
    await expect(page.getByRole('button', { name: 'Add event' })).toHaveCount(2);
    const emptyState = page
      .locator('div')
      .filter({ has: emptyTitle })
      .filter({ has: page.getByRole('button', { name: 'Add event' }) })
      .last();
    const addBtn = emptyState.getByRole('button', { name: 'Add event' });
    await expect(addBtn).toHaveCount(1);
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });

    await checkA11y(page, path, testInfo);
  });

  // `useMedicationRoster` (src/hooks/useCalendarEvents.ts) fetches the SAME
  // GET /circles/:id/events endpoint the calendar uses, just with
  // `includeDiscontinued=true` appended — the shared `/events` stub (path
  // only, ignoring query string) empties the meds roster exactly like it
  // empties the calendar above. An editor on a circle with zero medications
  // gets the starter kit (mobile 1.1.11 parity), not the plain "No
  // medications yet" empty state.
  test('empty medications renders its empty state + a11y, and the add CTA opens the create modal', async ({
    page,
    circleId,
  }, testInfo) => {
    // `useMedicationRoster` (src/hooks/useCalendarEvents.ts) fetches the SAME
    // GET /circles/:id/events endpoint the calendar uses, just with
    // `includeDiscontinued=true` appended — the shared `/events` stub (path
    // only, ignoring query string) empties the meds roster exactly like it
    // empties the calendar above.
    await page.route(/\/api\/circles\/[^/]+\/events(\?|$)/, (r) =>
      r.fulfill(emptyJson({ success: true, data: { events: [] } }))
    );
    const path = `/circles/${circleId}/meds`;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No medications yet')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // Two "Add medication" buttons exist on an empty, editable circle (the
    // masthead's and the empty-state's; meds:page.add and meds:page.empty.cta
    // are byte-identical copy) and BOTH open the same full AddEventModal. The
    // empty-state one renders later in the DOM, so `.last()` targets it.
    const addButtons = page.getByRole('button', { name: 'Add medication' });
    await expect(addButtons).toHaveCount(2);
    await addButtons.last().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    await checkA11y(page, path, testInfo);
  });
});
