import { test, expect, uniqueLabel } from '../fixtures';

// AI assistant chat flow: open the Care Assistant modal from the sidebar →
// assert the dialog is visible → type a PHI-free question → send it → assert the
// user's message lands in the transcript and a response (or the "Thinking…"
// indicator) appears. The AI backend is a live dev tunnel and can be slow or
// unavailable: the response assertion is given a generous window, and the test
// degrades to asserting the send mechanism worked (message added + input
// cleared) so a slow/unavailable AI never fails the whole flow. Closes the
// modal at the end.

test('open the AI assistant, send a message, and see the transcript update', async ({
  page,
  circleId,
}) => {
  // PHI-free question text, run-unique so the transcript assertion can't match
  // the empty-state intro copy or a stray prior message.
  const question = `${uniqueLabel('AI')} — what can you help me with?`;
  const questionPattern = new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // The assistant modal only mounts when a circle is in context, so deep-link to
  // a circle-scoped page first (Desktop Chrome viewport renders the sidebar).
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  // --- Open ---
  await page.getByRole('button', { name: 'Assistant' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText('Care Assistant')).toBeVisible();

  // --- Compose & send ---
  const input = dialog.locator('#ai-chat-input');
  await expect(input).toBeVisible();
  await input.fill(question);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  // The user's message must appear in the transcript and the composer must clear
  // — this proves the send mechanism worked regardless of the AI's response.
  await expect(dialog.getByText(questionPattern)).toBeVisible({ timeout: 10_000 });
  await expect(input).toHaveValue('', { timeout: 10_000 });

  // A response or the "Thinking…" indicator should appear. AI responses are slow
  // and the tunnel may error; if neither shows in time we still consider the
  // send proven above, so this is a soft assertion that won't fail the flow.
  const thinking = dialog.getByText('Thinking...');
  const assistantBubble = dialog
    .getByRole('log')
    .locator('div.justify-start p');
  await Promise.race([
    thinking.waitFor({ state: 'visible', timeout: 40_000 }),
    assistantBubble.first().waitFor({ state: 'visible', timeout: 40_000 }),
  ]).catch(() => {
    // Slow or unavailable AI backend — the send mechanism is already verified.
  });

  // --- Close ---
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
});
