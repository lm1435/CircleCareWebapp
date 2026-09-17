import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import { POSTHOG_URL_RE, type CapturedEvent } from '../unhappy';
import { openAccountMenuItem, setServerConsent } from './_helpers';

// ===========================================================================
// POSTHOG CAPTURE PROOF — runs only in the `consent` project, against the Vite
// server built with VITE_POSTHOG_KEY=phc_e2e_fake (see e2e/consent.ts).
//
// Proves that posthogCapture intercepts EVERY PostHog request (none reaches the
// network), decodes the SDK's payloads, exposes `$identify` / captures with
// their distinct ids, and fails when an event does not arrive (or does).
// ===========================================================================

// posthog-js batches (~3s flush) and the SDK loads after first paint.
test.describe.configure({ timeout: 60_000 });

test('consented: $identify carries the user id, payloads decode, nothing leaves the browser', async ({
  page,
  posthog,
  account,
  circleId,
}) => {
  const seenByBrowser: string[] = [];
  page.context().on('request', (r) => {
    if (POSTHOG_URL_RE.test(r.url())) seenByBrowser.push(r.url());
  });

  await presetAnalyticsConsent(page, 'granted', account.userId);
  await page.goto(`/circles/${circleId}/notes`);

  const identify = await posthog.waitForEvent('$identify', { timeoutMs: 20_000 });
  expect(identify.distinctId).toBe(account.userId);

  const pageview = await posthog.waitForEvent('$pageview', { timeoutMs: 20_000 });
  expect(pageview.properties.platform).toBe('web');
  expect(pageview.properties).toHaveProperty('$ip', null);

  expect(posthog.requests.filter((r) => r.decodeError), 'every payload decoded').toEqual([]);
  expect(posthog.requests.some((r) => r.kind === 'capture' && r.events > 0)).toBe(true);
  // Every PostHog request the browser issued was answered by the interceptor
  // (beacon entries are not browser requests: the wrapper never sends them).
  await expect
    .poll(() => seenByBrowser.length === posthog.requests.filter((r) => r.method !== 'BEACON').length, { timeout: 10_000 })
    .toBe(true);
  expect(posthog.escapedRequests(), 'no PostHog request escaped the route').toEqual([]);

  await expect(posthog.waitForEvent('e2e_event_that_never_fires', { timeoutMs: 1_500 })).rejects.toThrow(
    /no "e2e_event_that_never_fires" event/
  );
});

test('declined: anonymous captures continue, no $identify, ids stripped', async ({
  page,
  posthog,
  account,
  circleId,
}) => {
  await presetAnalyticsConsent(page, 'declined', account.userId);
  await page.goto(`/circles/${circleId}/notes`);

  const pageview = await posthog.waitForEvent('$pageview', { timeoutMs: 20_000 });
  expect(pageview.distinctId).toBeTruthy();
  expect(pageview.distinctId).not.toBe(account.userId);
  expect(JSON.stringify(pageview.properties)).not.toContain(circleId);

  await posthog.expectNoEvent('$identify', { settleMs: 5_000 });
  // …and expectNoEvent fails when the event DID arrive.
  await expect(posthog.expectNoEvent('$pageview', { settleMs: 200 })).rejects.toThrow(/unexpected "\$pageview"/);
});

// THE UNLOAD FLUSH. posthog-js sends whatever is still batched with
// navigator.sendBeacon when the page unloads; Playwright's route never sees that
// `ping`. e2e/consent.ts blocks it in the page, decodes it into `posthog.events`
// and fails the test on any PostHog request that escaped the route. Proven red
// by removing the beacon handling from a copy of consent.ts (no beacon events;
// the ping escapes).
for (const state of ['granted', 'declined'] as const) {
  test(`unload flush (${state}): a beacon sent during a reload is blocked, decoded and counted; nothing reaches PostHog`, async ({
    page,
    posthog,
    account,
  }) => {
    test.setTimeout(120_000);
    const restore = setServerConsent(account.userId, state === 'granted' ? 'granted' : 'unasked');
    try {
      // Context-level: any PostHog response that came from a real server address.
      const fromNetwork: Array<Promise<string | null>> = [];
      page.context().on('response', (r) => {
        if (!POSTHOG_URL_RE.test(r.url())) return;
        fromNetwork.push(
          r.serverAddr().then((addr) => (addr ? `${r.url()} from ${addr.ipAddress}:${addr.port}` : null), () => null)
        );
      });

      await presetAnalyticsConsent(page, state, account.userId);
      await page.goto('/profile');
      await posthog.waitForEvent('$pageview', { timeoutMs: 20_000 });

      // Queue a pageview by SPA navigation, then reload INSIDE the ~3s batch
      // window. Retried as a unit: a batch timer started by an earlier event can
      // fire before the reload, and then that attempt's pageview went by fetch.
      let flushed: CapturedEvent | undefined;
      await expect(async () => {
        await page.waitForTimeout(3_500); // let any running batch go out normally first
        const target = new URL(page.url()).pathname === '/help' ? '/profile' : '/help';
        const before = posthog.beaconEvents.length;
        await openAccountMenuItem(page, target === '/help' ? 'Help & FAQ' : 'Profile');
        await expect(page).toHaveURL(new RegExp(`${target}$`));
        await page.waitForTimeout(300);
        await page.reload();
        await expect
          .poll(
            () =>
              (flushed = posthog.beaconEvents
                .slice(before)
                .find((e) => e.event === '$pageview' && String(e.properties.$pathname) === target)),
            { timeout: 10_000 }
          )
          .toBeTruthy();
      }).toPass({ timeout: 90_000 });

      expect(posthog.events, 'the beacon event is counted with every other event').toContain(flushed);
      expect(posthog.beacons.filter((b) => b.decodeError), 'every beacon decoded').toEqual([]);
      expect(posthog.beacons.some((b) => b.events > 0 && /[?&]beacon=1(&|$)/.test(b.url))).toBe(true);
      test.info().annotations.push({
        type: 'beacons',
        description: posthog.beacons.map((b) => `${b.via} events=${b.events} ${new URL(b.url).pathname}`).join(' | '),
      });

      expect(await posthog.integrityProblems(2_000), 'no PostHog request escaped the route; all decoded').toEqual([]);
      expect((await Promise.all(fromNetwork)).filter(Boolean), 'no PostHog response came from a real server').toEqual([]);
    } finally {
      restore();
    }
  });
}
