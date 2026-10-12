import AxeBuilder from '@axe-core/playwright';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// THE MAPS LINK (1.2.3) — a doctor's saved street address is a link that opens
// a maps site in a new tab (Google Maps off Apple devices). No geocoding, no
// embedded map. The platform is pinned to Windows in the page so the target
// does not depend on the machine running the suite (Chromium on a Mac reports
// MacIntel, which would pick Apple Maps; that branch is covered by vitest).
// Mobile twin: pending (mobile flow pending).
//
// The doctor is SEEDED THROUGH THE API on this worker's isolated circle,
// appended to whatever it already holds; the original array is PUT back in
// `finally`. The name is run-unique.
// ===========================================================================

type Json = Record<string, unknown>;

async function readDoctors(api: ApiSession, circleId: string): Promise<Json[]> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok(), `GET emergency-info → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { emergency_info?: Json | null } };
  return (body.data?.emergency_info?.additional_doctors as Json[] | null) ?? [];
}

async function putDoctors(api: ApiSession, circleId: string, doctors: Json[]): Promise<void> {
  const res = await api.put(`/api/circles/${circleId}/emergency-info`, { additional_doctors: doctors });
  expect(res.ok(), `PUT emergency-info → ${res.status()} ${await res.text()}`).toBe(true);
}

test('doctor: the saved address is a maps link that opens in a new tab', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Dr Maps');
  const original = await readDoctors(api, circleId);
  await putDoctors(api, circleId, [
    ...original,
    {
      name,
      specialty: 'Cardiology',
      phone: null,
      country_code: null,
      address: '123 Main St, Suite #4\nDenver, CO & Café',
    },
  ]);

  try {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
    });
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });

    const link = page.getByRole('link', {
      name: 'Open 123 Main St, Suite #4, Denver, CO & Café in Maps',
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Suite%20%234%2C%20Denver%2C%20CO%20%26%20Caf%C3%A9'
    );
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAccessibleDescription('Opens in a new tab');
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Keyboard: visible focus ring.
    await link.focus();
    await expect(link).toBeFocused();
    const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 140)).join(' ;; ')}`)
    ).toEqual([]);
  } finally {
    await putDoctors(api, circleId, original);
  }
});
