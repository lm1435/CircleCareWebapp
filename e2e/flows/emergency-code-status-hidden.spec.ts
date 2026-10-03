import { test, expect } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// CODE STATUS IS HIDDEN, BUT KEPT (decision T1,
// docs/plans/mobile-web-decisions-2026-09-29.md).
//
// Code status / advance directives are no longer shown or editable on web
// (mobile hides the same section, and the care-summary PDF no longer prints
// them). The STORED values stay: nothing may delete or overwrite them.
//
// Real backend, real DB: a DNR + directives note is seeded through the API on
// this worker's isolated circle, the page must not show either, and a save
// from the medical-info modal must leave both exactly as they were (the PUT is
// a partial merge; a body naming those keys would wipe them). The original
// values are PUT back in `finally`.
// ===========================================================================

type Json = Record<string, unknown>;

async function readInfo(api: ApiSession, circleId: string): Promise<Json> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok(), `GET emergency-info → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { emergency_info?: Json | null } };
  return body.data?.emergency_info ?? {};
}

async function putInfo(api: ApiSession, circleId: string, patch: Json): Promise<void> {
  const res = await api.put(`/api/circles/${circleId}/emergency-info`, patch);
  expect(res.ok(), `PUT emergency-info → ${res.status()} ${await res.text()}`).toBe(true);
}

test('code status on file is never shown, and a medical-info save keeps it', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const original = await readInfo(api, circleId);
  const note = `No intubation ${Date.now()}`;
  await putInfo(api, circleId, { has_dnr: true, advance_directives: note });

  try {
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.emergency-sections')).toBeVisible({ timeout: 20_000 });

    // Hidden: no section, no nav anchor, no value.
    await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.getByText(/code status/i)).toHaveCount(0);
    await expect(page.getByText(/advance directives/i)).toHaveCount(0);
    await expect(page.locator('#directives')).toHaveCount(0);
    await expect(page.locator('a[href="#directives"]')).toHaveCount(0);

    // Save another emergency field through the UI…
    await page.getByRole('button', { name: 'Edit medical information' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/circles/${circleId}/emergency-info`) && r.request().method() === 'PUT'
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const sent = response.request().postDataJSON() as Json;
    for (const key of ['has_dnr', 'advance_directives', 'dnr_document_url']) {
      expect(sent, `PUT body must not name ${key}`).not.toHaveProperty(key);
    }

    // …and the stored code status is untouched.
    const after = await readInfo(api, circleId);
    expect(after.has_dnr).toBe(true);
    expect(after.advance_directives).toBe(note);
  } finally {
    await putInfo(api, circleId, {
      has_dnr: (original.has_dnr as boolean | null | undefined) ?? false,
      advance_directives: (original.advance_directives as string | null | undefined) ?? null,
    });
  }
});
