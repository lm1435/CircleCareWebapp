import { test, expect } from '../fixtures';
import { PERSONA_EXPECTATIONS, type PersonaName } from '../personas';
import { apiSession, dbQuery, errorCodeOf, sqlStr } from '../unhappy';
import { resolveAiEntry } from '../../src/lib/aiAccess';

// ===========================================================================
// PERSONA PROOF — each persona is what the backend says it is.
//
// For every persona: the stored inputs are as seeded (tier, archived, seat),
// the SERVER derives the expected flags (`PERSONA_EXPECTATIONS`, constants
// taken from backend code, never from the seed), the client's own AI-entry
// rule (src/lib/aiAccess.ts, imported, not re-implemented) resolves to the
// expected state from those server flags, the gated endpoints refuse with the
// expected codes (a refusal writes nothing), and one page shows the role.
//
// A persona seeded wrong (e.g. the view-only seat left active, a free owner
// left premium) fails here — that is the point of the constants.
//
// ONE FILE PER PERSONA (`<persona>.proof.spec.ts`): `persona` is a WORKER
// option, and Playwright only accepts `test.use` of a worker option at the top
// level of a file — never inside `describe` ("it forces a new worker").
// `definePersonaProof` is called at file top level, so its `test.use` is too.
// ===========================================================================

const VIEW_ONLY_SHORT = 'View-only — you can see everything, but changes are off.';

interface CircleDetail {
  id: string;
  name: string;
  owner_id: string;
  access_level: string;
  can_edit: boolean;
  view_only: boolean;
  is_premium_circle: boolean;
}

export function definePersonaProof(persona: PersonaName): void {
  test.use({ persona });

  test.describe(`persona: ${persona}`, () => {
    test('server-side flags match the backend derivation', async ({ request, personaHandle: h, account, circleId }) => {
      const exp = PERSONA_EXPECTATIONS[persona];

      // Fixture wiring: `account` and `circleId` are the persona's.
      expect(account.email).toBe(h.email);
      expect(circleId).toBe(h.circleId);

      // Stored inputs.
      const [row] = dbQuery<{ archived: boolean; owner_id: string; owner_tier: string; is_member: boolean }>(`
        select c.archived_at is not null as archived, c.owner_id::text as owner_id, u.plan_tier as owner_tier,
               exists (select 1 from circle_memberships m where m.circle_id = c.id and m.user_id = ${sqlStr(h.userId)}::uuid) as is_member
          from care_circles c join users u on u.id = c.owner_id
         where c.id = ${sqlStr(h.circleId)}::uuid`);
      expect(row, 'the persona circle exists').toBeTruthy();
      expect(row.archived, 'archived_at').toBe(exp.archived);
      expect(row.owner_id === h.userId, 'persona owns its circle').toBe(exp.isOwner);
      expect(row.owner_id).toBe(h.ownerUserId);
      expect(row.is_member, 'persona has a membership row').toBe(true);

      // Real data to act on (premiumOwner is the unchanged clone: no notes/vitals/documents).
      expect(h.seeded.medicationId, 'a medication series').not.toBeNull();
      expect(h.seeded.appointmentId, 'an appointment').not.toBeNull();
      expect(h.seeded.taskId, 'a task').not.toBeNull();
      expect(h.seeded.emergencyInfoId, 'emergency info').not.toBeNull();
      if (persona !== 'premiumOwner') {
        expect(h.seeded.careNoteId, 'a care note').not.toBeNull();
        expect(h.seeded.vitalId, 'a vital').not.toBeNull();
        expect(h.seeded.documentId, 'a document').not.toBeNull();
      }

      const api = await apiSession(request, h);

      // GET /api/circles/:id
      const detailRes = await api.get(`/api/circles/${h.circleId}`);
      const detailJson = (await detailRes.json()) as { data?: { circle?: CircleDetail } };
      const d = detailJson.data?.circle;
      const flags = d && {
        access_level: d.access_level,
        can_edit: d.can_edit,
        view_only: d.view_only,
        is_premium_circle: d.is_premium_circle,
      };
      if (exp.detail) {
        expect(detailRes.status(), 'GET /circles/:id').toBe(200);
        expect(flags).toEqual(exp.detail);
      } else {
        test.info().annotations.push({
          type: `recorded (not asserted) GET /api/circles/${h.circleId}`,
          description: `${detailRes.status()} ${JSON.stringify(flags ?? detailJson)}`,
        });
      }

      // GET /api/circles
      const listRes = await api.get('/api/circles');
      expect(listRes.status()).toBe(200);
      const circles = ((await listRes.json()) as { data: { circles: Array<{ id: string; read_only: boolean }> } }).data
        .circles;
      const entry = circles.find((c) => c.id === h.circleId);
      expect(Boolean(entry), 'listed in GET /circles').toBe(exp.listed);
      expect(entry ? entry.read_only : null, 'read_only').toBe(exp.read_only);
      // Subset, not equality: specs sharing this worker slot may create circles in the same account.
      const listedIds = circles.map((c) => c.id);
      expect(listedIds, 'every provisioned live circle is listed').toEqual(expect.arrayContaining(h.liveCircleIds));
      for (const archivedId of h.archivedCircleIds) {
        expect(listedIds, 'archived circles are not listed').not.toContain(archivedId);
      }

      // The client's AI-entry rule over the SERVER's flags.
      if (exp.aiEntry) {
        expect(d, 'detail payload for the AI rule').toBeTruthy();
        expect(
          resolveAiEntry({ viewOnly: d!.view_only, isPremiumCircle: d!.is_premium_circle, isOwner: d!.owner_id === h.userId })
        ).toBe(exp.aiEntry);
      }
      if (exp.aiSuggestions) {
        const ai = await api.get(`/api/circles/${h.circleId}/ai/suggestions`);
        expect(ai.status(), 'GET ai/suggestions').toBe(exp.aiSuggestions.status);
        if (exp.aiSuggestions.code) expect(await errorCodeOf(ai)).toBe(exp.aiSuggestions.code);
      }

      // The edit gate — only where it refuses (a refusal writes nothing).
      if (exp.writeGate) {
        const put = await api.put(`/api/circles/${h.circleId}/emergency-info`, {});
        expect(put.status(), 'PUT emergency-info').toBe(exp.writeGate.status);
        expect(await errorCodeOf(put)).toBe(exp.writeGate.code);
      }

      // GET /api/subscription-status
      const sub = await api.get('/api/subscription-status');
      expect(sub.status()).toBe(200);
      expect(((await sub.json()) as { needsCircleSelection: boolean }).needsCircleSelection).toBe(exp.needsCircleSelection);

      // Free-tier limits the free owner must hit.
      if (persona === 'freeOwner') {
        const create = await api.post('/api/circles', { recipient_name: 'E2E limit probe' });
        expect(create.status(), 'create circle on the free tier').toBe(402);
        expect(await errorCodeOf(create)).toBe('SUBSCRIPTION_REQUIRED');
        // At the caregiver cap (owner + 1 active). @example.com is swallowed by the
        // backend's blocklist should the cap ever fail to hold.
        const invite = await api.post(`/api/circles/${h.circleId}/invites`, { email: 'e2e-cap-probe@example.com' });
        expect(invite.status(), 'invite at the free caregiver cap').toBe(402);
        expect(await errorCodeOf(invite)).toBe('SUBSCRIPTION_REQUIRED');
      }
    });

    test('the UI reflects the role', async ({ page, personaHandle: h }) => {
      const exp = PERSONA_EXPECTATIONS[persona];

      if (exp.archived) {
        // The archived circle is not offered: the one live circle is, and a
        // single-circle list auto-enters it.
        await page.goto('/circles');
        await expect(page).toHaveURL(new RegExp(`/circles/${h.liveCircleIds[0]}(/|$)`), { timeout: 20_000 });
        expect(page.url()).not.toContain(h.circleId);
        return;
      }

      const [{ name }] = dbQuery<{ name: string }>(
        `select name from care_circles where id = ${sqlStr(h.circleId)}::uuid`
      );
      const detailLoaded = page.waitForResponse(
        (r) =>
          r.request().method() === 'GET' &&
          new URL(r.url()).pathname === `/api/circles/${h.circleId}` &&
          r.status() === 200,
        { timeout: 20_000 }
      );
      await page.goto(`/circles/${h.circleId}/notes`);
      await detailLoaded;
      // Anchor on something rendered FROM the circle payload, so the absence
      // checks below cannot pass merely because nothing has rendered yet.
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

      const assistant = page.getByRole('button', { name: 'Assistant', exact: true });
      if (exp.aiEntry === 'hidden') await expect(assistant).toHaveCount(0);
      else await expect(assistant).toBeVisible();

      const banner = page.getByText(VIEW_ONLY_SHORT);
      if (exp.detail?.can_edit) await expect(banner).toHaveCount(0);
      else await expect(banner).toBeVisible();
    });
  });
}
