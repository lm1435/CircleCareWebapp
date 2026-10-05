import { test, expect } from '../fixtures';

// Role-aware invite copy (owner 2026-10-04). A care RECIPIENT's circle is about
// them, so the public invite page must NOT read as a caregiver invite:
//   h1   "Your care circle"
//   body "<inviter> set up CircleCare to help with your care"
// A caregiver invite keeps "<inviter> invited you to help care for <name>".
//
// Net-zero: creates real email invites through the API (a logged-out visitor
// previews them; nobody accepts) and cancels each in `finally`.

const APP_ORIGIN = process.env.PW_BASE_URL ?? 'http://localhost:5173';

test.describe('invite landing page — care recipient copy', () => {
  test('recipient invite reads as the recipient\'s own circle; caregiver invite is unchanged', async ({
    context,
    browser,
    account,
  }) => {
    const loginRes = await context.request.post('/api/auth/login', {
      data: { email: account.email, password: account.password },
      headers: { Origin: APP_ORIGIN },
    });
    expect(loginRes.ok(), `api login failed: ${loginRes.status()}`).toBeTruthy();
    const token = (
      (await loginRes.json()) as { data: { session: { access_token: string } } }
    ).data.session.access_token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // The isolated account's own circle already HAS a care recipient (a second
    // recipient invite is rejected 400 CARE_RECIPIENT_EXISTS), so use a fresh,
    // recipient-less circle and delete it afterwards.
    const circleRes = await context.request.post('/api/circles', {
      data: { recipient_name: 'Luis' },
      headers: authHeaders,
    });
    expect(circleRes.ok(), `circle create failed: ${circleRes.status()}`).toBeTruthy();
    const circleId = ((await circleRes.json()) as { data: { circle: { id: string } } }).data.circle
      .id;

    const created: Array<{ id: string; code: string; role: string }> = [];
    const make = async (member_type: 'care_recipient' | 'caregiver'): Promise<string> => {
      const res = await context.request.post(`/api/circles/${circleId}/invites`, {
        data: { email: `e2e-${member_type}-${Date.now()}@example.com`, member_type },
        headers: authHeaders,
      });
      expect(res.ok(), `${member_type} invite create failed: ${res.status()}`).toBeTruthy();
      const body = (await res.json()) as { data: { invite: { id: string; invite_code: string } } };
      created.push({ id: body.data.invite.id, code: body.data.invite.invite_code, role: member_type });
      return body.data.invite.invite_code;
    };

    try {
      const recipientCode = await make('care_recipient');
      const caregiverCode = await make('caregiver');

      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const anonPage = await anon.newPage();
      try {
        await anonPage.goto(`/invite/${recipientCode}`, { waitUntil: 'domcontentloaded' });
        await expect(
          anonPage.getByRole('heading', { level: 1, name: 'Your care circle' })
        ).toBeVisible({ timeout: 20_000 });
        await expect(anonPage.getByText(/set up CircleCare to help with your care$/)).toBeVisible();
        await expect(anonPage.getByText('Care recipient')).toBeVisible();
        await expect(anonPage.getByText(/help care for/)).toHaveCount(0);
        await expect(anonPage.getByRole('button', { name: 'Create an account to join' })).toBeVisible();

        await anonPage.goto(`/invite/${caregiverCode}`, { waitUntil: 'domcontentloaded' });
        await expect(
          anonPage.getByRole('heading', { level: 1, name: /invited you to help care for/ })
        ).toBeVisible({ timeout: 20_000 });
        await expect(anonPage.getByText(/set up CircleCare/)).toHaveCount(0);
      } finally {
        await anon.close();
      }
    } finally {
      for (const inv of created) {
        const del = await context.request.delete(`/api/invites/${inv.id}`, { headers: authHeaders });
        expect(del.ok(), `invite cancel failed: ${del.status()}`).toBeTruthy();
      }
      await context.request.delete(`/api/circles/${circleId}`, { headers: authHeaders });
    }
  });
});
