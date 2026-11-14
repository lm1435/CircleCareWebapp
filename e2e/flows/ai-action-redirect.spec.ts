import { test, expect } from '../fixtures';
import type { Page, Request } from '@playwright/test';

// Care-assistant understanding fix (1.4.2, docs/plans/care-assistant-understanding-fix.md §9).
// The assistant no longer asks people to "rephrase": a reply it did not understand offers the
// starter chips again, and a request it cannot do itself ("add Tylenol at 8pm") offers a button to
// where it is done. Both /ai/suggestions and /ai/chat are answered by route interception with the
// exact backend contract, so this spec makes NO model call and needs no OpenAI key; everything else
// (login, circle, the destination pages, the add form) is the live local backend.
// Mobile twin: mobile/.maestro/parity/ai/action-redirect.yaml.

const EMPTY_SET = [
  { id: 'capabilities', text: 'What can you help me with?' },
  { id: 'help_add_medication', text: 'How do I add a medication?' },
  { id: 'help_invite', text: 'How do I invite family to help?' },
  { id: 'help_emergency_info', text: 'What should go in the emergency info?' },
  { id: 'tips_first_weeks', text: 'Tips for the first weeks of caregiving' },
  { id: 'tips_medication_schedules', text: 'Give me tips for managing medication schedules' },
];

/** Answers the suggestions GET once and every chat POST with the next queued reply. */
async function interceptAssistant(
  page: Page,
  circleId: string,
  replies: Record<string, unknown>[]
): Promise<Request[]> {
  const chatRequests: Request[] = [];
  await page.route(new RegExp(`/api/circles/${circleId}/ai/suggestions(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          suggestions: EMPTY_SET.map((c) => c.text),
          suggestion_items: EMPTY_SET,
          circle_empty: true,
        },
      }),
    });
  });
  await page.route(new RegExp(`/api/circles/${circleId}/ai/chat$`), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    chatRequests.push(route.request());
    const next = replies.shift() ?? { message: 'ok', outcome: 'answered', intent: 'GET_CAPABILITIES' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { conversation_id: crypto.randomUUID(), remaining_requests: 49, history_len: 0, ...next },
      }),
    });
  });
  return chatRequests;
}

async function openAssistant(page: Page, circleId: string) {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Assistant' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

async function ask(dialog: import('@playwright/test').Locator, text: string) {
  await dialog.getByLabel('Your message', { exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
}

test('P: the empty-circle starter set renders and a chip sends its suggestion_id', async ({ page, circleId }) => {
  const requests = await interceptAssistant(page, circleId, [
    { message: 'Open New, then Medication.', outcome: 'app_help', intent: 'APP_HELP', actions: [{ type: 'open_add_medication' }] },
  ]);
  const dialog = await openAssistant(page, circleId);
  for (const chip of EMPTY_SET) {
    await expect(dialog.getByRole('button', { name: chip.text })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'How do I add a medication?' }).click();
  await expect(dialog.getByText('Open New, then Medication.')).toBeVisible({ timeout: 10_000 });
  expect(requests[0].postDataJSON()).toMatchObject({
    message: 'How do I add a medication?',
    suggestion_id: 'help_add_medication',
  });
});

test('P: a reply that did not understand offers the chips again (no "rephrase"), and a chip sends its id', async ({ page, circleId }) => {
  const requests = await interceptAssistant(page, circleId, [
    {
      message: "I can answer questions about this circle's medications, schedule and records. Try one of these:",
      outcome: 'not_understood',
      reason: 'off_topic',
      intent: 'UNKNOWN',
      suggestion_items: EMPTY_SET,
    },
    { message: 'I can help with medications, appointments and more.', outcome: 'answered', intent: 'GET_CAPABILITIES' },
  ]);
  const dialog = await openAssistant(page, circleId);
  await ask(dialog, 'what is the capital of France');
  const chips = dialog.getByTestId('ai-chat-reply-suggestions');
  await expect(chips).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText(/rephrase/i)).toHaveCount(0);
  await chips.getByRole('button', { name: 'What can you help me with?' }).click();
  await expect(dialog.getByText('I can help with medications, appointments and more.')).toBeVisible({ timeout: 10_000 });
  expect(requests[1].postDataJSON()).toMatchObject({ suggestion_id: 'capabilities' });
  // A typed question never carries an id.
  expect(requests[0].postDataJSON()).not.toHaveProperty('suggestion_id');
  // Only the latest reply keeps chips.
  await expect(dialog.getByTestId('ai-chat-reply-suggestions')).toHaveCount(0);
});

test('P: "Add a medication" closes the assistant and opens the New medication form', async ({ page, circleId }) => {
  await interceptAssistant(page, circleId, [
    {
      message: "I can only read the care records, I can't make changes. Here's where to do it:",
      outcome: 'action_redirect',
      intent: 'ACTION_REQUEST',
      actions: [{ type: 'open_add_medication' }],
    },
  ]);
  const dialog = await openAssistant(page, circleId);
  await ask(dialog, 'add tylenol at 8pm');
  await dialog.getByRole('button', { name: 'Add a medication' }).click();
  await expect(page.getByRole('dialog', { name: 'New medication' })).toBeVisible({ timeout: 10_000 });
});

test('P: "Open Activity" opens the activity feed', async ({ page, circleId }) => {
  await interceptAssistant(page, circleId, [
    { message: 'Ana gave the 8:00 AM dose.', outcome: 'answered', intent: 'GET_RECENT_ACTIONS', actions: [{ type: 'open_activity' }] },
  ]);
  const dialog = await openAssistant(page, circleId);
  await ask(dialog, 'who gave the 8am dose?');
  await dialog.getByRole('button', { name: 'Open Activity' }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/activity$`));
});

test('P: "Alert settings" opens Settings > Alerts', async ({ page, circleId }) => {
  await interceptAssistant(page, circleId, [
    { message: 'Reminders are set in Settings > Alerts.', outcome: 'app_help', intent: 'APP_HELP', actions: [{ type: 'open_settings_notifications' }] },
  ]);
  const dialog = await openAssistant(page, circleId);
  await ask(dialog, 'how do I turn off reminders?');
  await dialog.getByRole('button', { name: 'Alert settings' }).click();
  await expect(page).toHaveURL(/\/profile\/alerts$/);
});

test('N: unknown action types from a newer backend are dropped, not rendered', async ({ page, circleId }) => {
  await interceptAssistant(page, circleId, [
    { message: 'Somewhere new.', outcome: 'answered', intent: 'GET_ACTIVITY', actions: [{ type: 'open_teleport' }] },
  ]);
  const dialog = await openAssistant(page, circleId);
  await ask(dialog, 'anything');
  await expect(dialog.getByText('Somewhere new.')).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByTestId('ai-chat-reply-actions')).toHaveCount(0);
});
