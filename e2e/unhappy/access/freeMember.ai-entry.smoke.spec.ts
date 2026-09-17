import { test, expect } from '../../fixtures';
import { apiSession, errorCodeOf } from '../../unhappy';
import { aiEntrySurface, gotoCirclePage, loadSurfaceData } from './_helpers';

// ===========================================================================
// FREE MEMBER — the AI entry is HIDDEN (resolveAiEntry: not premium, not the
// owner), on whichever navigation this viewport renders:
//   >= 1024px  the desktop sidebar's "Assistant" button   (chromium project)
//   <  1024px  the FloatingNavBar pill's "AI" cell         (mobile-chrome project)
//
// Named `*.smoke.spec.ts` ON PURPOSE: that suffix is what `playwright.config.ts`
// matches for the `mobile-chrome` (and `tablet`) projects, and it is the only
// way to put a spec outside `e2e/mobile/` in front of the pill without editing
// the config. The branch is on the rendered viewport, never a skip: every
// project asserts the surface it actually draws. The premium control is
// `premiumOwner.ai-entry.smoke.spec.ts`.
//
// And the server agrees on its own: the AI endpoints answer 402.
// ===========================================================================

test.use({ persona: 'freeMember' });

test('AI entry is absent from the navigation this viewport renders', async ({ page, personaHandle: h }) => {
  const data = loadSurfaceData(h);
  await gotoCirclePage(page, h.circleId, 'notes');
  await expect(page.getByText(data.careNoteBody!).first()).toBeVisible({ timeout: 20_000 });

  const surface = aiEntrySurface(page);
  // The navigation that would carry the entry rendered, with the editor's
  // create control live — the same loaded state the premium control uses.
  await expect(surface.navSignal, `${surface.kind} navigation rendered`).toBeVisible();
  await expect(surface.navSignal).toBeEnabled();
  await expect(surface.aiEntry, `${surface.kind} AI entry`).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('server refuses the AI assistant to a non-owner of a free circle (402)', async ({ request, personaHandle: h }) => {
  const api = await apiSession(request, h);
  const suggestions = await api.get(`/api/circles/${h.circleId}/ai/suggestions`);
  expect(suggestions.status(), 'GET ai/suggestions').toBe(402);
  expect(await errorCodeOf(suggestions)).toBe('SUBSCRIPTION_REQUIRED');

  const chat = await api.post(`/api/circles/${h.circleId}/ai/chat`, { message: 'What is on the calendar today?' });
  expect(chat.status(), 'POST ai/chat').toBe(402);
  expect(await errorCodeOf(chat)).toBe('SUBSCRIPTION_REQUIRED');
});
