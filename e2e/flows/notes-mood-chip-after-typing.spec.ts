import { test, expect, uniqueLabel } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';

// Web twin of the mobile Maestro flow notes/mood-chip-after-typing (plan
// docs/plans/mobile-e2e-parity.md P-N1). On mobile the composer's mood /
// category chips spent the FIRST tap with the keyboard up on dismissing it, so
// "type the note, tap Good day, Post" saved mood null. Web has no soft
// keyboard, but the same user outcome can be lost another way: the textarea
// blurs on the chip's mousedown, and anything that re-renders or shifts on that
// blur swallows the click. This guards the whole sequence with REAL typing
// (focus stays in the textarea until the chip click) and checks the STORED row,
// not just the UI. The touch twin is e2e/mobile/notes-mood-chip-after-typing-touch.spec.ts.

test('type a note, click a mood chip ONCE, post: the stored note has that mood', async ({
  page,
  circleId,
}) => {
  const body = uniqueLabel('ZZ_E2E_MOODCHIP');
  try {
    await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const composer = page.getByLabel(/^Add a note/);
    await expect(composer).toBeVisible({ timeout: 20_000 });

    await composer.click();
    await composer.pressSequentially(body);
    // The click below must start from a focused textarea — that is the case
    // under test (blur fires on the chip's mousedown).
    await expect(composer).toBeFocused();

    const mood = page.getByRole('radio', { name: 'Good day' });
    await mood.click();
    await expect(mood).toHaveAttribute('aria-checked', 'true');

    // Same for a category chip clicked straight after typing more.
    await composer.click();
    await composer.press('End');
    await composer.pressSequentially('.');
    await expect(composer).toBeFocused();
    const meal = page.getByRole('button', { name: 'Meal', exact: true });
    await meal.click();
    await expect(meal).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Post', exact: true }).click();

    await expect
      .poll(
        () =>
          dbQuery<{ mood: string | null; categories: string }>(
            `select mood, array_to_string(categories, ',') as categories from care_notes where circle_id = ${sqlStr(circleId)} and body = ${sqlStr(`${body}.`)}`
          ),
        { timeout: 20_000 }
      )
      .toEqual([{ mood: 'good', categories: 'meal' }]);
  } finally {
    sqlExec(`delete from care_notes where circle_id = ${sqlStr(circleId)} and body like ${sqlStr(`${body}%`)}`);
  }
});
