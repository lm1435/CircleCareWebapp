import { test, expect } from '../fixtures';

// FIND_NOTES: "where are the notes?" is answered with WHERE the notes are plus
// buttons that open the place. The chat POST is answered by route interception
// with the exact backend contract (routes/ai.ts resolveFindNotes), so this spec
// makes NO model call and needs no OpenAI key; everything else (login, circle,
// Notes / Emergency pages) is the live local backend.
// Mobile twin: mobile/.maestro/parity/paywall/ai-notes-path.yaml.

const PROVIDER_ID = '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

async function openAssistantWithReply(
  page: import('@playwright/test').Page,
  circleId: string,
  data: Record<string, unknown>
) {
  await page.route(new RegExp(`/api/circles/${circleId}/ai/chat$`), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { conversation_id: crypto.randomUUID(), remaining_requests: 49, intent: 'FIND_NOTES', ...data },
      }),
    });
  });
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Assistant' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel('Your message', { exact: true }).fill('where are the notes?');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  return dialog;
}

test('no doctor named: the reply names the places and "Open Notes" opens Care > Notes', async ({ page, circleId }) => {
  const dialog = await openAssistantWithReply(page, circleId, {
    message:
      "Daily care notes are under Care > Notes. Notes from appointments are on each doctor's page, under Health > Emergency > Doctors.",
    actions: [{ type: 'open_notes' }, { type: 'open_doctors' }],
    notes_path: { target: 'notes', doctor_named: false, doctor_matched: false },
  });
  await expect(dialog.getByText(/Daily care notes are under Care > Notes/)).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('button', { name: 'See Doctors' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open Notes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes$`));
});

test('"See Doctors" opens the Emergency Info page', async ({ page, circleId }) => {
  const dialog = await openAssistantWithReply(page, circleId, {
    message: "I couldn't find that doctor among this circle's saved doctors.",
    actions: [{ type: 'open_doctors' }, { type: 'open_notes' }],
    notes_path: { target: 'doctor_list', doctor_named: true, doctor_matched: false },
  });
  await dialog.getByRole('button', { name: 'See Doctors' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/emergency$`));
});

test('one doctor matched: "<name>: Visits & notes" opens that doctor\'s page', async ({ page, circleId }) => {
  const dialog = await openAssistantWithReply(page, circleId, {
    message: "Dr Patel's visits and notes are on their doctor page.",
    actions: [{ type: 'open_provider', provider_id: PROVIDER_ID, provider_name: 'Dr Patel' }],
    notes_path: { target: 'doctor', doctor_named: true, doctor_matched: true },
  });
  await dialog.getByRole('button', { name: 'Dr Patel: Visits & notes' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/providers/${PROVIDER_ID}$`));
});
