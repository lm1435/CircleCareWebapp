import { test, expect, uniqueLabel } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';

// Touch twin of e2e/flows/notes-mood-chip-after-typing.spec.ts (plan
// docs/plans/mobile-e2e-parity.md P-N1), under the `mobile-chrome` (Pixel 5,
// hasTouch) project. Chromium does not emulate a soft keyboard, but it does
// dispatch the touch sequence (touchstart → blur of the focused textarea →
// click), which is the ordering that could swallow the first tap on a web
// phone. Type, TAP the mood chip once, Post: the stored row has that mood.

test('touch: type a note, tap a mood chip ONCE, post: the stored note has that mood', async ({
  page,
  circleId,
}) => {
  const body = uniqueLabel('ZZ_E2E_MOODCHIP_TOUCH');
  try {
    await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    const composer = page.getByLabel(/^Add a note/);
    await expect(composer).toBeVisible({ timeout: 20_000 });

    await composer.tap();
    await composer.pressSequentially(body);
    await expect(composer).toBeFocused();

    const mood = page.getByRole('radio', { name: 'Good day' });
    await mood.tap();
    await expect(mood).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Post', exact: true }).tap();

    await expect
      .poll(
        () =>
          dbQuery<{ mood: string | null }>(
            `select mood from care_notes where circle_id = ${sqlStr(circleId)} and body = ${sqlStr(body)}`
          ),
        { timeout: 20_000 }
      )
      .toEqual([{ mood: 'good' }]);
  } finally {
    sqlExec(`delete from care_notes where circle_id = ${sqlStr(circleId)} and body like ${sqlStr(`${body}%`)}`);
  }
});
