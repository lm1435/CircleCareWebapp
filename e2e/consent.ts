import type { Page, Request } from '@playwright/test';
import { expect, test as base } from './fixtures';
import {
  POSTHOG_URL_RE,
  decodePosthogBody,
  posthogCapture,
  type CapturedEvent,
  type InterceptedPosthogRequest,
  type PosthogCapture,
} from './unhappy';

// ===========================================================================
// CONSENT PROJECT fixtures — analytics exercised without sending analytics.
// ===========================================================================
//
// The main suite's Vite has no `VITE_POSTHOG_KEY`, so posthog-js never loads and
// the consent gate is unobservable there. The `consent` Playwright project runs
// `*.consent.spec.ts` against a SECOND Vite started with a FAKE key:
//
//   backend : cd backend && PORT=<be2> WEB_ORIGIN=http://localhost:<vite2> \
//               npx ts-node-dev --transpile-only --require dotenv/config src/server.ts
//   vite    : cd webapp && VITE_API_URL=http://localhost:<be2> VITE_POSTHOG_KEY=phc_e2e_fake \
//               npx vite --port <vite2> --strictPort
//   run     : PW_BASE_URL=http://localhost:<vite1> PW_CONSENT_BASE_URL=http://localhost:<vite2> \
//               npx playwright test --project=consent
//
// Guards (e2e/fixtures.ts `analyticsServerGuard`): the project FAILS (not skips)
// when PW_CONSENT_BASE_URL is unset, and when that server serves any key other
// than exactly `phc_e2e_fake`.
//
// NOTHING REACHES POSTHOG, in three layers (all in this file + `posthogCapture`):
//
//  1. `posthogCapture` (e2e/unhappy.ts) routes every *.posthog.com request at the
//     CONTEXT level, answers it locally and decodes capture bodies.
//  2. THE UNLOAD FLUSH. When a page unloads inside posthog-js's ~3s batch window
//     (reload, full navigation) the SDK sends the queue with
//     `navigator.sendBeacon(…/e/?…&beacon=1)`. Chromium issues that as a `ping`
//     that Playwright's route interception NEVER sees, so it used to escape to
//     the real host (fake key + user UUIDs) and its events were never decoded.
//     posthog-js's API host is its built-in default (src/lib/posthog.ts sets no
//     `api_host`), so it cannot be pointed at a local sink without a product
//     change. Instead an init script wraps `navigator.sendBeacon`: a PostHog
//     beacon is NOT sent; its body is read synchronously (posthog-js always
//     passes `new Blob([string | ArrayBuffer])`, and a `Blob` proxy records those
//     parts at construction) and handed to Node through a binding. A copy is
//     also parked in sessionStorage and re-delivered at the next document's start,
//     because a binding call made while a document is being torn down is not
//     guaranteed to arrive; deliveries are de-duplicated by id.
//  3. DNS. The consent workers' Chromium resolves *.posthog.com to NOTFOUND
//     (`--host-resolver-rules`), so even a transport none of the above knows
//     about cannot reach the real host.
//
// …and a test FAILS (fixture teardown, automatic) when:
//  - any *.posthog.com request was attempted that the route did not answer
//    (`escapedRequests()` — a context-level `request` listener), or
//  - any captured PostHog body (routed or beacon) failed to decode
//    (`decodeFailures()`), so "no such event" can never pass because the events
//    were undecodable. `expectNoEvent` checks both before it passes, too.
// ===========================================================================

/** Page → Node binding carrying one intercepted PostHog beacon. */
const BEACON_BINDING = '__e2ePosthogBeacon';
/** sessionStorage outbox for beacons sent while the document unloads (drained at the next document start). */
const BEACON_OUTBOX_KEY = '__e2e_cc_beacon_outbox';
/** Chromium switch: every PostHog host fails DNS in the consent workers' browser. */
const POSTHOG_DNS_BLOCK = '--host-resolver-rules=MAP *.posthog.com ~NOTFOUND, MAP posthog.com ~NOTFOUND';

interface BeaconPayload {
  id: string;
  url: string;
  contentType: string;
  /** base64 body, or null when it could not be read (then `error` says why). */
  body: string | null;
  error?: string;
  via: 'live' | 'outbox';
}

export interface BeaconRecord {
  url: string;
  via: 'live' | 'outbox';
  events: number;
  decodeError?: string;
}

export interface ConsentPosthogCapture extends PosthogCapture {
  /** PostHog beacons (unload flushes) the page tried to send — blocked and decoded into `events`. */
  readonly beacons: BeaconRecord[];
  /** The events that arrived by beacon (the same objects are also in `events`). */
  readonly beaconEvents: CapturedEvent[];
  /** *.posthog.com requests the browser attempted that the route did NOT answer (must stay empty). */
  escapedRequests(): string[];
  /** Routed requests and beacons whose body failed to decode (must stay empty). */
  decodeFailures(): string[];
  /** Escapes + decode failures, polled for up to `settleMs` (a request event can precede its route record). */
  integrityProblems(settleMs?: number): Promise<string[]>;
}

/** Runs in the page before any app script. Keep it self-contained (serialized). */
function installBeaconCapture(cfg: { binding: string; outboxKey: string; hostSource: string; hostFlags: string }): void {
  const w = window as unknown as Record<string, unknown> & { __e2eBeaconCapture?: boolean };
  if (w.__e2eBeaconCapture) return;
  w.__e2eBeaconCapture = true;
  const hostRe = new RegExp(cfg.hostSource, cfg.hostFlags);
  const call = (payload: unknown): Promise<unknown> | undefined => {
    const fn = w[cfg.binding];
    return typeof fn === 'function' ? (fn as (p: unknown) => Promise<unknown>)(payload) : undefined;
  };
  const readOutbox = (): Array<Record<string, unknown>> => {
    try {
      const raw = sessionStorage.getItem(cfg.outboxKey);
      return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  };
  const writeOutbox = (items: Array<Record<string, unknown>>): void => {
    try {
      if (items.length === 0) sessionStorage.removeItem(cfg.outboxKey);
      else sessionStorage.setItem(cfg.outboxKey, JSON.stringify(items));
    } catch {
      /* storage unavailable: the live delivery is the only one */
    }
  };

  // 1) Re-deliver what the previous document parked while it unloaded.
  const parked = readOutbox();
  writeOutbox([]);
  for (const item of parked) void call({ ...item, via: 'outbox' });

  // 2) Remember Blob parts so a beacon body can be read synchronously.
  const NativeBlob = window.Blob;
  const parts = new WeakMap<Blob, unknown[]>();
  try {
    window.Blob = new Proxy(NativeBlob, {
      construct(target, args, newTarget) {
        const blob = Reflect.construct(target, args, newTarget) as Blob;
        if (Array.isArray(args[0])) parts.set(blob, [...(args[0] as unknown[])]);
        return blob;
      },
    });
  } catch {
    /* a body we cannot read is reported as a decode failure below */
  }
  const bytesOf = (value: unknown): Uint8Array | null => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof URLSearchParams) return new TextEncoder().encode(value.toString());
    if (value instanceof NativeBlob) {
      const list = parts.get(value);
      if (!list) return null;
      const chunks: Uint8Array[] = [];
      for (const p of list) {
        const b = bytesOf(p);
        if (!b) return null;
        chunks.push(b);
      }
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    }
    return null;
  };
  const base64 = (bytes: Uint8Array): string => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // 3) PostHog beacons are recorded and NOT sent; every other beacon is untouched.
  const nativeSendBeacon = Navigator.prototype.sendBeacon;
  Object.defineProperty(Navigator.prototype, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: function sendBeacon(this: Navigator, url: string | URL, data?: BodyInit | null): boolean {
      let href: string;
      try {
        href = new URL(String(url), location.href).href;
      } catch {
        href = String(url);
      }
      if (!hostRe.test(href)) return nativeSendBeacon.call(this, url, data);
      const item: Record<string, unknown> = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        url: href,
        contentType: data instanceof NativeBlob ? data.type : '',
        body: null,
      };
      try {
        const bytes = data == null ? new Uint8Array(0) : bytesOf(data);
        if (bytes) item.body = base64(bytes);
        else item.error = `unreadable beacon body (${Object.prototype.toString.call(data)})`;
      } catch (err) {
        item.error = `beacon body read failed: ${String(err)}`;
      }
      // Durable copy FIRST (survives the unload), then the live delivery; the
      // copy is dropped again once Node acknowledges it (i.e. when the document
      // outlived the call).
      writeOutbox([...readOutbox(), item]);
      const ack = call({ ...item, via: 'live' });
      void ack?.then(
        () => writeOutbox(readOutbox().filter((x) => x.id !== item.id)),
        () => undefined
      );
      return true;
    },
  });
}

function toEvents(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const batch = (payload as { batch?: unknown }).batch;
    if (Array.isArray(batch)) return batch as Array<Record<string, unknown>>;
    if ('event' in (payload as object)) return [payload as Record<string, unknown>];
  }
  return [];
}

/** Same event shape `posthogCapture` builds for routed requests. */
function toCaptured(e: Record<string, unknown>, endpoint: string, compression: string): CapturedEvent {
  const props = (e.properties ?? {}) as Record<string, unknown>;
  return {
    event: String(e.event),
    distinctId: (props.distinct_id ?? e.distinct_id) as string | undefined,
    properties: props,
    set: e.$set ?? props.$set,
    setOnce: e.$set_once ?? props.$set_once,
    uuid: e.uuid as string | undefined,
    timestamp: e.timestamp as string | undefined,
    endpoint,
    compression,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `posthogCapture` plus the beacon capture, the escape detector and the decode
 * checks described in the header. Register BEFORE the first navigation.
 */
export async function consentPosthogCapture(page: Page): Promise<ConsentPosthogCapture> {
  const context = page.context();
  const capture = await posthogCapture(page);
  const beacons: BeaconRecord[] = [];
  const beaconEvents: CapturedEvent[] = [];
  const beaconEntries = new Set<InterceptedPosthogRequest>();
  const deliveredIds = new Set<string>();
  const attempted: Request[] = [];

  context.on('request', (req) => {
    if (POSTHOG_URL_RE.test(req.url())) attempted.push(req);
  });

  await context.exposeBinding(BEACON_BINDING, (_source, raw: BeaconPayload) => {
    if (!raw || typeof raw.id !== 'string' || deliveredIds.has(raw.id)) return;
    deliveredIds.add(raw.id);
    const endpoint = (() => {
      try {
        return new URL(raw.url).pathname;
      } catch {
        return raw.url;
      }
    })();
    const record: BeaconRecord = { url: raw.url, via: raw.via, events: 0 };
    const entry: InterceptedPosthogRequest = { url: raw.url, method: 'BEACON', kind: 'capture', compression: '', events: 0 };
    try {
      if (raw.body === null) throw new Error(raw.error ?? 'beacon body missing');
      const { compression, payload } = decodePosthogBody(raw.url, Buffer.from(raw.body, 'base64'));
      entry.compression = compression;
      for (const e of toEvents(payload)) {
        const captured = toCaptured(e, endpoint, compression);
        capture.events.push(captured);
        beaconEvents.push(captured);
        entry.events += 1;
      }
      record.events = entry.events;
    } catch (err) {
      entry.decodeError = record.decodeError = `beacon: ${err instanceof Error ? err.message : String(err)}`;
    }
    beacons.push(record);
    beaconEntries.add(entry);
    capture.requests.push(entry);
  });
  await context.addInitScript(installBeaconCapture, {
    binding: BEACON_BINDING,
    outboxKey: BEACON_OUTBOX_KEY,
    hostSource: POSTHOG_URL_RE.source,
    hostFlags: POSTHOG_URL_RE.flags,
  });

  const escapedRequests = (): string[] => {
    // Multiset: every attempted request must be matched by one routed entry.
    const routed = new Map<string, number>();
    for (const r of capture.requests) {
      if (beaconEntries.has(r)) continue;
      const key = `${r.method} ${r.url}`;
      routed.set(key, (routed.get(key) ?? 0) + 1);
    }
    const escaped: string[] = [];
    for (const req of attempted) {
      const key = `${req.method()} ${req.url()}`;
      const n = routed.get(key) ?? 0;
      if (n > 0) routed.set(key, n - 1);
      else escaped.push(`${key} (resourceType=${req.resourceType()})`);
    }
    return escaped;
  };
  const decodeFailures = (): string[] =>
    capture.requests.filter((r) => r.decodeError).map((r) => `${r.method} ${r.url}: ${r.decodeError}`);

  const integrityProblems = async (settleMs = 0): Promise<string[]> => {
    // A request event can land a moment before its route handler records it.
    const started = Date.now();
    for (;;) {
      const problems = [
        ...escapedRequests().map((s) => `ESCAPED (not answered by the route): ${s}`),
        ...decodeFailures().map((s) => `UNDECODABLE: ${s}`),
      ];
      if (problems.length === 0 || Date.now() - started >= settleMs) return problems;
      await sleep(100);
    }
  };

  return {
    get events() {
      return capture.events;
    },
    get requests() {
      return capture.requests;
    },
    beacons,
    beaconEvents,
    captures: capture.captures,
    identifies: capture.identifies,
    waitForEvent: capture.waitForEvent,
    async expectNoEvent(name, opts) {
      await capture.expectNoEvent(name, opts);
      const problems = await integrityProblems(1_000);
      expect(problems, `posthogCapture: "no ${name}" is only meaningful when every PostHog request was captured and decoded`).toEqual([]);
    },
    escapedRequests,
    decodeFailures,
    integrityProblems,
    clear() {
      capture.clear();
      beacons.length = 0;
      beaconEvents.length = 0;
      beaconEntries.clear();
      attempted.length = 0;
    },
    dispose: () => capture.dispose(),
  };
}

/** `test` for `*.consent.spec.ts`: adds `posthog`, a capture registered before the first navigation. */
export const consentTest = base.extend<{ posthog: ConsentPosthogCapture }>({
  // Layer 3 (see header): no PostHog host resolves in this project's browser.
  // `browser`, not `launchOptions`: the config's top-level `use` sets
  // `launchOptions`, and Playwright forbids a fixture override of a value the
  // config supplies. `launch` still merges the runner's default launch options
  // (traces/artifacts dirs), and the config's own `launchOptions` are spread in.
  browser: [
    async ({ playwright, browserName, launchOptions, headless, channel }, use) => {
      const browser = await playwright[browserName].launch({
        handleSIGINT: false,
        ...launchOptions,
        ...(headless !== undefined ? { headless } : {}),
        ...(channel !== undefined ? { channel } : {}),
        args: [...(launchOptions.args ?? []), POSTHOG_DNS_BLOCK],
      });
      await use(browser);
      await browser.close();
    },
    { scope: 'worker' },
  ],
  posthog: async ({ page }, use) => {
    const capture = await consentPosthogCapture(page);
    await use(capture);
    const problems = await capture.integrityProblems(2_000);
    await capture.dispose();
    if (problems.length > 0) {
      throw new Error(
        `[e2e consent] PostHog capture integrity failed — a "no event" result in this test cannot be trusted:\n  ` +
          problems.join('\n  ')
      );
    }
  },
});

export { expect };

/** localStorage keys of the web consent record (src/lib/analyticsConsent.ts:47,154). */
export const CONSENT_STORAGE = {
  enabled: 'cc_analytics_enabled',
  owner: 'cc_analytics_consent_user',
} as const;

/**
 * Put the browser's LOCAL consent record in a state BEFORE the app boots, once
 * per tab (later reloads keep whatever the app wrote since). `granted` →
 * full mode (identify allowed); `declined` → the anonymous memory-only mode;
 * `unasked` → no record (resolves to the declined mode on web —
 * src/lib/analyticsMode.ts:92,116-120). Pass `ownerUserId` with a decision,
 * or `reconcileAnalyticsConsentOwner` adopts the next signed-in user.
 *
 * The SERVER's copy (`users.analytics_consent_granted_at/withdrawn_at`) wins
 * when it disagrees (src/lib/analyticsConsentServerReconcile.ts); fresh persona
 * accounts have neither set (`unasked`), so the local record stands.
 */
export async function presetAnalyticsConsent(
  page: Page,
  state: 'granted' | 'declined' | 'unasked',
  ownerUserId?: string
): Promise<void> {
  await page.addInitScript(
    ([s, owner, keys]) => {
      try {
        if (sessionStorage.getItem('__e2e_consent_preset') === '1') return;
        sessionStorage.setItem('__e2e_consent_preset', '1');
        if (s === 'unasked') {
          localStorage.removeItem(keys.enabled);
          localStorage.removeItem(keys.owner);
          return;
        }
        localStorage.setItem(keys.enabled, s === 'granted' ? 'true' : 'false');
        if (owner) localStorage.setItem(keys.owner, owner);
      } catch {
        /* storage unavailable */
      }
    },
    [state, ownerUserId ?? '', CONSENT_STORAGE] as const
  );
}
