import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession } from '../unhappy';

// Parity with mobile's VitalsDetailScreen: every reading row (and the latest
// hero) prints "<time> · <who logged it>". The name comes from the backend's
// `users` embed on GET /vitals, so this asserts the real wire shape end to end:
// the name on screen is whatever the API returned for the reading, not a value
// the spec invented. Values are neutral numerics in an uncommon band.

const NOTE_TAG = 'vital-loggedby';

interface ListedVital {
  id: string;
  notes: string | null;
  users: { first_name: string; last_name: string } | null;
}

async function listHeartRate(
  session: Awaited<ReturnType<typeof apiSession>>,
  circleId: string
): Promise<ListedVital[]> {
  const to = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const res = await session.get(
    `/api/circles/${circleId}/vitals?type=heart_rate&from=2000-01-01&to=${encodeURIComponent(to)}`
  );
  expect(res.ok(), `list vitals: ${res.status()}`).toBe(true);
  return ((await res.json()) as { data: { vitals: ListedVital[] } }).data.vitals;
}

test('a reading row and the latest hero name who logged it', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const session = await apiSession(request, account);
  const note = uniqueLabel(NOTE_TAG);
  const bpm = 241 + Math.floor(Math.random() * 40);

  try {
    const created = await session.post(`/api/circles/${circleId}/vitals`, {
      vital_type: 'heart_rate',
      value1: bpm,
      unit: 'bpm',
      recorded_at: new Date().toISOString(),
      notes: note,
    });
    expect(created.ok(), `create vital: ${created.status()}`).toBe(true);

    const mine = (await listHeartRate(session, circleId)).find((v) => v.notes === note);
    expect(mine?.users, 'backend must embed the author on GET /vitals').toBeTruthy();
    const who = `${mine!.users!.first_name} ${mine!.users!.last_name}`.trim();
    expect(who).not.toBe('');

    await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });

    // Grouped view: the row's meta line reads "<time> · <name>" and then the note.
    const group = page.getByRole('region', { name: 'Heart rate' });
    const row = group.getByRole('listitem').filter({ hasText: `${bpm} bpm` });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(` · ${who}`);
    await expect(row).not.toContainText('System');

    // One type selected: the latest hero carries the same attribution.
    await page.getByRole('radio', { name: 'Heart rate' }).click();
    const hero = page.getByText('Latest', { exact: true }).locator('xpath=ancestor::*[self::section or self::div][1]');
    await expect(hero).toContainText(` · ${who}`);
    await page.screenshot({ path: process.env.PW_SHOT_PATH ?? 'test-results/vitals-logged-by.png' });
  } finally {
    for (const v of await listHeartRate(session, circleId)) {
      if (v.notes === note) await session.delete(`/api/circles/${circleId}/vitals/${v.id}`);
    }
  }
});
