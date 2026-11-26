import { test, expect } from '../../fixtures';
import { today, openToday } from './_todayRoleAware';

// ROLE-AWARE TODAY (1.4.4), care recipient half (see memberToday.roleAware.spec.ts for the settled-signal rationale).

test.use({ persona: 'careRecipientMember' });

test.describe('care recipient', () => {
  test('POSITIVE: next steps speak in the first person; NEGATIVE: never "Add <their own name>\'s ..." and no helper card', async ({
    page,
    personaHandle: h,
  }) => {
    await openToday(page, h.circleId);
    // Whatever coaching the recipient has, it is never the helper card.
    expect(await today(page).getAttribute('data-coaching')).not.toBe('helper_card');
    await expect(page.getByTestId('helper-card')).toHaveCount(0);
    await expect(page.getByText(/Add Rita Recipient's first medication/)).toHaveCount(0);
    // The page title is first person too: "Today", never "Today for <their own name>".
    await expect(page.getByRole('heading', { level: 1, name: /^Today$/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /Today for/ })).toHaveCount(0);
    // When the checklist is up for the recipient it is first person and never names them.
    if ((await today(page).getAttribute('data-coaching')) === 'next_step') {
      await expect(page.getByTestId('next-step-card')).not.toContainText('Rita');
    }
  });
});
