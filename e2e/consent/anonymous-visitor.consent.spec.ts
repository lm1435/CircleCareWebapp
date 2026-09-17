import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import type { CapturedEvent } from '../unhappy';
import {
  APP_LOCAL_KEY_RE,
  POSTHOG_STORAGE_RE,
  cookieNames,
  expectAnonymousEvents,
  identifierKeys,
  readStorage,
  recordStorageAtDocumentStart,
  setServerConsent,
} from './_helpers';

// ===========================================================================
// DECLINED and UNASKED visitors (both resolve to the anonymous mode on web,
// src/lib/analyticsMode.ts GRANDFATHER_UNASKED_WEB_USERS=false).
//
// Signed in as this worker's account (two circles), server consent pinned to
// 'unasked' so the local record decides. Every "absence" below sits next to a
// positive control in the same test: $pageview and circle_viewed (an event
// whose call site passes circle_id — granted-identify.consent.spec.ts proves it
// arrives WITH circle_id in full mode) must be captured first.
// ===========================================================================

test.describe.configure({ timeout: 90_000 });

const restores: Array<() => void> = [];
test.afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

for (const state of ['declined', 'unasked'] as const) {
  test(`${state} visitor: captured anonymously — no $identify, no ids, no email, nothing stored by PostHog`, async ({
    page,
    posthog,
    account,
    circleId,
    secondCircleId,
  }) => {
    restores.push(setServerConsent(account.userId, 'unasked'));
    await presetAnalyticsConsent(page, state, state === 'declined' ? account.userId : undefined);
    await recordStorageAtDocumentStart(page);

    await page.goto('/circles');
    await posthog.waitForEvent('$pageview', { timeoutMs: 20_000 });

    // Positive control with an id-bearing call site. A full document reload
    // right after the click (seen under load: the dev server reloads the page
    // when another session edits a source file) no longer loses posthog's
    // unsent batch — its unload beacon is decoded by the fixture
    // (e2e/consent.ts). The click itself can still be undone by such a reload,
    // so it stays retried as an ACTION, not relaxed: a circle_viewed must
    // arrive, and every event captured in ANY attempt is scanned below.
    let viewed!: CapturedEvent;
    await expect(async () => {
      if (new URL(page.url()).pathname !== '/circles') await page.goto('/circles');
      await page.locator(`a[href="/circles/${circleId}"]`).click({ timeout: 10_000 });
      viewed = await posthog.waitForEvent('circle_viewed', { timeoutMs: 10_000 });
    }).toPass({ timeout: 60_000 });
    await posthog.waitForEvent('$pageview', {
      timeoutMs: 20_000,
      predicate: (e) => String(e.properties.$pathname).startsWith('/circles/[id]'),
    });

    await posthog.expectNoEvent('$identify', { settleMs: 5_000 });
    expect(identifierKeys(viewed.properties), 'circle_viewed must arrive with circle_id stripped').toEqual([]);
    expectAnonymousEvents(
      posthog.events,
      { userId: account.userId, email: account.email, circleIds: [circleId, secondCircleId] },
      state
    );

    // ── Storage: nothing written by PostHog, compared with document start ──
    const storage = await readStorage(page);
    expect(storage.atStart, 'document-start storage snapshot was taken').not.toBeNull();
    const start = storage.atStart!;
    expect(
      [...Object.keys(storage.local), ...Object.keys(storage.session)].filter((k) => POSTHOG_STORAGE_RE.test(k)),
      'posthog keys in localStorage/sessionStorage'
    ).toEqual([]);
    const newLocal = Object.keys(storage.local).filter((k) => !start.local.includes(k));
    expect(newLocal.filter((k) => !APP_LOCAL_KEY_RE.test(k)), 'localStorage keys added during the visit that are not the app’s').toEqual([]);
    const newSession = Object.keys(storage.session).filter((k) => !start.session.includes(k));
    expect(newSession, 'sessionStorage keys added during the visit').toEqual([]);
    expect(cookieNames(storage.cookie), 'document.cookie names unchanged').toEqual(cookieNames(start.cookie));
    const contextCookies = (await page.context().cookies()).map((c) => c.name);
    expect(contextCookies.filter((n) => POSTHOG_STORAGE_RE.test(n)), 'posthog cookies').toEqual([]);
    expect(contextCookies.filter((n) => !['cc_refresh', 'cc_session'].includes(n)), 'unexpected cookies').toEqual([]);

    if (state === 'unasked') {
      // Nothing was answered, so nothing may be recorded on the auth path.
      expect(storage.local.cc_analytics_enabled, 'unasked stays unrecorded').toBeUndefined();
      expect(storage.local.cc_analytics_consent_user, 'no owner stamped for an unasked visitor').toBeUndefined();
    } else {
      expect(storage.local.cc_analytics_enabled).toBe('false');
    }
  });
}
