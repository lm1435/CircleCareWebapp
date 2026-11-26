import { test, expect } from '../../fixtures';
import { today, openToday, driveCoachingTo } from './_todayRoleAware';

// ===========================================================================
// ROLE-AWARE TODAY (1.4.4). Production week-2 return: 53% for circle owners, 29% for invited
// helpers, who were shown the OWNER's setup checklist ("Next step · 1 of 2: Add <name>'s first
// medication"). A plain helper now gets ONE calm, dismissible card instead; the care recipient keeps
// their steps in the first person.
//
// NOT VACUOUS: every assertion waits for Today's settled signal first (`data-today-ready="true"` on
// the page section, set by OverviewPage only once Next up, the next step and the dose alerts have all
// answered; `data-coaching` then names the ONE coaching element on screen). Without that wait a
// `toHaveCount(0)` passes while coaching is still unknown. The helper card is the calmest element, so
// the two elements that teach something (first-dose hint, shifts nudge) outrank it; the helper test
// DRIVES them out of the way with their own dismiss buttons instead of branching on what the seed has,
// and then asserts the card positively.
// ===========================================================================

test.use({ persona: 'freeMember' });

test.describe('helper (freeMember: an editor who is not the owner)', () => {
  test('NEGATIVE: never the owner checklist, at any point of the settle; POSITIVE: the calm card with a TRUE body', async ({
    page,
    personaHandle: h,
  }) => {
    // Whether the circle uses shifts decides the card (1.4.4): Overview loads no shift list, so in a
    // shifts circle "Nothing needs you right now" could be false for a helper on shift, and the card
    // is not shown there. Read the flag from the page's own circle response, never from the seed.
    const circleResponse = page.waitForResponse(
      (r) => new RegExp(`/api/circles/${h.circleId}(\\?|$)`).test(r.url()) && r.request().method() === 'GET' && r.ok()
    );
    await openToday(page, h.circleId);
    const findHasShifts = (v: unknown): boolean | undefined => {
      if (!v || typeof v !== 'object') return undefined;
      const o = v as Record<string, unknown>;
      if (typeof o.has_shifts === 'boolean') return o.has_shifts;
      for (const k of Object.keys(o)) {
        const found = findHasShifts(o[k]);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const hasShifts = findHasShifts(await (await circleResponse).json()) === true;
    // Settled: the coaching element on screen is final, and it is never the owner's checklist.
    expect(await today(page).getAttribute('data-coaching')).not.toBe('next_step');
    await expect(page.getByTestId('next-step-card')).toHaveCount(0);
    await expect(page.getByText(/Add .* first medication/)).toHaveCount(0);

    if (hasShifts) {
      // NEGATIVE (shifts circle): no helper card, at any point, and still no owner checklist.
      await driveCoachingTo(page, 'none');
      await expect(page.getByTestId('helper-card')).toHaveCount(0);
      await expect(page.getByTestId('next-step-card')).toHaveCount(0);
      return;
    }

    await driveCoachingTo(page, 'helper_card');
    const card = page.getByTestId('helper-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: /^You're helping with / })).toBeVisible();

    // B2: the body must never be false, and the web never promises a push it cannot send.
    const rows = await page.getByTestId('next-up-row').count();
    if (rows > 0) {
      await expect(card).toContainText(/Here is what is coming up for .+ today\./);
      await expect(card).not.toContainText('Nothing needs you');
    } else {
      await expect(card).toContainText('Nothing needs you right now.');
    }
    await expect(card).not.toContainText('hear from us');

    // An editor is offered the note composer's page, never a write action she cannot use.
    await expect(card.getByRole('button', { name: 'Leave a note' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'See the care team' })).toHaveCount(0);

    // The dismissal persists across a reload (and the settled page really is settled again first).
    await page.getByTestId('helper-card-dismiss').click();
    await expect(page.getByTestId('helper-card')).toHaveCount(0);
    await page.reload();
    await expect(today(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('helper-card')).toHaveCount(0);
    expect(await today(page).getAttribute('data-coaching')).not.toBe('helper_card');
  });
});
