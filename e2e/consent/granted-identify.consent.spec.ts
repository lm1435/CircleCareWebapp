import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import type { CapturedEvent } from '../unhappy';
import {
  eventTimeSec,
  eventsSince,
  findStrings,
  personNeedles,
  setServerConsent,
} from './_helpers';

// ===========================================================================
// GRANTED user: identified by opaque id only, events carry that id, and URL
// credentials are masked.
// ===========================================================================

test.describe.configure({ timeout: 90_000 });

const restores: Array<() => void> = [];
test.afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

const PERSON_TRAIT_KEY_RE = /(^|\$|_)(email|name|first_name|last_name|full_name|phone)$/i;
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Fake credentials planted in the landing URL. Distinctive so a substring scan is exact.
const FAKE_ACCESS = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlMmVsZWFrcHJvYmUifQ.e2eFakeSignatureValue123';
const FAKE_REFRESH = 'e2eFakeRefreshTokenValue456';
const FAKE_GCLID = 'e2eFakeGclidValue789';
const TOKEN_URL =
  `/profile?access_token=${FAKE_ACCESS}&refresh_token=${FAKE_REFRESH}&gclid=${FAKE_GCLID}` +
  `#access_token=${FAKE_ACCESS}&refresh_token=${FAKE_REFRESH}`;

test('granted user: exactly one $identify by id only; later events carry that id (circle_id kept)', async ({
  page,
  posthog,
  account,
  circleId,
}) => {
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);
  await page.goto('/circles');

  const identify = await posthog.waitForEvent('$identify', { timeoutMs: 20_000 });
  expect(identify.distinctId, '$identify distinct_id').toBe(account.userId);
  expect(identify.properties.distinct_id).toBe(account.userId);
  const traitKeys = [...Object.keys(asRecord(identify.set)), ...Object.keys(asRecord(identify.setOnce))].filter((k) =>
    PERSON_TRAIT_KEY_RE.test(k)
  );
  expect(traitKeys, '$identify must carry no person traits ($set/$set_once)').toEqual([]);

  // SPA navigation: an id-bearing event and a $pageview after the identify.
  // The click is retried as an ACTION (see anonymous-visitor.consent.spec.ts:
  // a dev-server reload can undo the click; the batch it interrupts is now
  // decoded from the unload beacon). A reload is a new page load, so the
  // identify checks below are scoped per page load ($session_id is per
  // document under memory persistence).
  let viewed!: CapturedEvent;
  await expect(async () => {
    if (new URL(page.url()).pathname !== '/circles') await page.goto('/circles');
    await page.locator(`a[href="/circles/${circleId}"]`).click({ timeout: 10_000 });
    viewed = await posthog.waitForEvent('circle_viewed', { timeoutMs: 10_000 });
  }).toPass({ timeout: 60_000 });
  expect(viewed.distinctId, 'circle_viewed carries the identified id').toBe(account.userId);
  expect(viewed.properties.circle_id, 'full mode keeps circle_id (control for the anonymous strip)').toBe(circleId);
  await posthog.waitForEvent('$pageview', {
    timeoutMs: 20_000,
    predicate: (e) => String(e.properties.$pathname).startsWith('/circles/[id]'),
  });

  // Exactly one identify per page load, always for this account.
  await posthog.expectNoEvent('$identify', {
    settleMs: 5_000,
    predicate: (e) => e !== identify && e.properties.$session_id === identify.properties.$session_id,
  });
  const identifiesPerLoad = new Map<string, number>();
  for (const e of posthog.identifies()) {
    const key = String(e.properties.$session_id);
    identifiesPerLoad.set(key, (identifiesPerLoad.get(key) ?? 0) + 1);
  }
  expect([...identifiesPerLoad.entries()].filter(([, n]) => n !== 1), 'exactly one $identify per page load').toEqual([]);
  expect(posthog.identifies().filter((e) => e.distinctId !== account.userId), 'every $identify is this account').toEqual([]);

  const after = eventsSince(posthog, eventTimeSec(identify)).filter(
    (e) => e.properties.$session_id === identify.properties.$session_id
  );
  expect(after.length, 'events after the identify').toBeGreaterThan(1);
  expect(
    after.filter((e) => e.distinctId !== account.userId).map((e) => `${e.event}:${e.distinctId}`),
    'every event after $identify (same page load) carries the identified distinct id'
  ).toEqual([]);

  expect(findStrings(posthog.events, personNeedles(account)), 'no email (or its local part) in any payload').toEqual([]);
});

test('granted user: credentials in the URL query/hash are masked in $current_url', async ({ page, posthog, account }) => {
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);
  await page.goto(TOKEN_URL);
  await posthog.waitForEvent('$identify', { timeoutMs: 20_000 });

  const withTokenUrl = posthog.events.filter(
    (e) => typeof e.properties.$current_url === 'string' && e.properties.$current_url.includes('access_token=')
  );
  expect(withTokenUrl.length, 'positive control: events captured while the credential URL was live').toBeGreaterThan(0);
  for (const e of withTokenUrl) {
    const url = e.properties.$current_url as string;
    expect(url, `${e.event} $current_url`).not.toContain(FAKE_ACCESS);
    expect(url, `${e.event} $current_url`).not.toContain(FAKE_REFRESH);
    expect(url, `${e.event} $current_url`).not.toContain(FAKE_GCLID);
    expect(url, `${e.event} $current_url access_token redacted`).toContain('access_token=[redacted]');
    expect(url, `${e.event} $current_url refresh_token redacted`).toContain('refresh_token=[redacted]');
    // mask_personal_data_properties' own masking is visibly on.
    expect(url, `${e.event} $current_url gclid masked by posthog-js`).toContain('gclid=<masked>');
  }
  expect(
    findStrings(posthog.events.map((e) => e.properties), [FAKE_ACCESS, FAKE_REFRESH]),
    'no raw credential anywhere in event PROPERTIES'
  ).toEqual([]);
});

// REGRESSION GUARD for a privacy leak fixed 2026-09-13. posthog-js puts
// `$current_url` / `$initial_current_url` (from location.href) into the
// `$identify` event's TOP-LEVEL `$set_once`, outside `properties`; `before_send`
// used to redact `event.properties` only, so credentials in the landing URL
// became permanent PERSON properties. `mask_personal_data_properties` masks only
// ad-click params (gclid, fbclid, …), never credentials. The fix redacts every
// field of the event (src/lib/posthog.ts `redactCaptureEvent`). This scans the
// whole decoded payload, `$set_once` included.
test('$identify $set_once carries no raw credentials from the landing URL', async ({
  page,
  posthog,
  account,
}) => {
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);
  await page.goto(TOKEN_URL);
  await posthog.waitForEvent('$identify', { timeoutMs: 20_000 });
  const leaks = findStrings(posthog.events, [FAKE_ACCESS, FAKE_REFRESH]);
  test.info().annotations.push({ type: 'leak', description: leaks.join('; ') || '(none)' });
  expect(leaks, 'raw credentials anywhere in the decoded payloads').toEqual([]);
});
