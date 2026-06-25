import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Empty-state coverage WITHOUT creating a real circle.
//
// Why stub instead of a real empty circle: the demo account is at the 5/5
// premium circle cap, so a throwaway circle can't be created, and freeing a slot
// would be destructive. Instead we stub each list endpoint to an empty (but
// valid) envelope on the real circle — deterministic, non-destructive, and it
// renders the exact empty states a brand-new circle would show. We verify the
// empty state renders + passes axe, and that the add entry point works from
// empty. (The list pages have no empty-ONLY CTA buttons; their add actions are
// always-present header buttons covered by the CRUD flow specs.)

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
    await expect(page.getByText('No documents yet')).toBeVisible({ timeout: 20_000 });
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
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // The primary "first action" on an empty circle: start adding an event.
    // "Add event" appears in both the header and the empty state, so scope to
    // the first match to avoid a strict-mode (multiple-element) violation.
    const addBtn = page.getByRole('button', { name: 'Add event' }).first();
    await expect(addBtn).toBeVisible({ timeout: 20_000 });
    await addBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });

    await checkA11y(page, path, testInfo);
  });
});
