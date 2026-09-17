import { redactAuthTokens, redactInviteCode, sanitizeErrorText } from './analytics';
import { discardBootErrors, flushBootErrors } from './bootErrorBuffer';
import { env } from './env';
import {
  analyticsCollectionAllowed,
  collectionAllowed,
  currentAnalyticsMode,
  identifyAllowed,
  resolveAnalyticsMode,
} from './analyticsMode';
import {
  clearPendingQueue,
  getLoadedPosthogModule,
  loadPosthogModule,
  markPosthogReady,
  withPosthog,
  type PostHogInstance,
} from './posthogLoader';

/**
 * PostHog is OPTIONAL — when VITE_POSTHOG_KEY is unset the app runs with
 * analytics silently disabled (never crashes, never warns in production).
 *
 * BUNDLE NOTE: `posthog-js` is ~64 KB gzip and this file never statically
 * imports it — `initAnalytics` loads it via `./posthogLoader` (a dynamic
 * `import()` shared with lib/analytics.ts + lib/pageview.ts) so it lands in
 * its own chunk, fetched only after first paint (see main.tsx) rather than
 * blocking the entry bundle. Every function below that would have touched
 * `posthog` directly now goes through `withPosthog`, which queues the call if
 * the SDK isn't configured yet and replays it once `initAnalytics` finishes.
 *
 * Security posture (plan: Security section):
 * - maskAllInputs: session replay never captures form input.
 * - autocapture off: no accidental capture of PHI-adjacent text.
 * - memory persistence: nothing written to cookies/localStorage.
 * - Never put names, emails, or health data in event properties.
 * - `$ip: null` registered as a super property: PostHog treats a null $ip as
 *   "do not record", so no IP address is stored on any event and the GeoIP
 *   enrichment plugin has nothing to resolve. IP addresses are personal data
 *   under GDPR and we have no product use for them — caregiving analytics only
 *   ever needs counts and enums. Suppressing at the source beats retention
 *   policy: an IP we never store cannot leak, be subpoenaed, or be exported.
 *   TRADE-OFF (intentional): this also drops the derived geo properties
 *   ($geoip_country_code, $geoip_city_name, $geoip_time_zone, ...), so
 *   country/region breakdowns are NOT available for web events. If geography is
 *   ever needed, add an explicit coarse property rather than re-enabling $ip.
 * - Free-text error strings are scrubbed via `sanitizeErrorText` before capture
 *   (see lib/analytics.ts) — including `$exception` messages below.
 * - ANONYMOUS MODE (visitor declined; lib/analyticsMode.ts): no identify, and
 *   `before_send` runs `anonymizeProperties`: drops every stable `*_id`
 *   property (`stripIdentifiersForAnonymous`) AND masks every UUID inside every
 *   string (`maskUuidsDeep`). The distinct id is random and in RAM, but
 *   `circle_id` / `event_id` / `member_id` are UUIDs that join straight back to
 *   real people through our database — and posthog-js attaches `$current_url` /
 *   `$pathname` / `$referrer` from `location.href` to every capture, which on
 *   this app reads `/circles/<uuid>/...`; exception messages and stack frames
 *   carry the same URL. Leaving any of those in would make "anonymous" a claim
 *   about PostHog's side only.
 * - `sanitize_properties` strips invite codes from EVERY event. posthog-js reads
 *   `$current_url` / `$pathname` / `$referrer` from `location.href` on every
 *   capture (`capture_pageview: false` does NOT prevent this), so an event fired
 *   on `/invite/ABC123` published a still-redeemable invite code — and
 *   `$referrer` carried it onto the next page. Accept-by-code does no email
 *   match, so that code IS access to the circle's PHI. Doing this at init covers
 *   every current and future call site, plus posthog's own auto-properties;
 *   fixing one page would not.
 */
/**
 * Depth-limited recursive redaction of every string in a property tree.
 *
 * Cycles are impossible in the JSON posthog serialises, but the depth cap makes
 * that a guarantee rather than an assumption. Non-string leaves are returned
 * untouched, so numbers, booleans and nulls keep their types.
 */
function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactAuthTokens(redactInviteCode(value));
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/** SDK internals (`$device_id`, `$session_id`, ...) — random under memory persistence. */
const SDK_PROPERTY_PREFIX = '$';
/** `distinct_id` rides inside `properties` and ingestion REQUIRES it; it is the random memory-only id. */
const INGESTION_REQUIRED_ID = 'distinct_id';
/** `id`, `circle_id`, `event_id`, `member_id`, `document_id`, ... */
const IDENTIFIER_KEY_RE = /(^|_)id$/i;

/**
 * Drop every TOP-LEVEL property that is a stable identifier, for anonymous mode.
 *
 * Pure and posthog-free so it can be unit-tested directly. Only top-level keys
 * are considered: our own event properties are flat (lib/analytics.ts), and the
 * nested payloads posthog builds (`$exception_list`, `$set`, ...) do not carry
 * our ids. Exempt: `$`-prefixed SDK keys (random per session/device in memory
 * persistence — `$device_id` would otherwise match) and `distinct_id`, which the
 * capture endpoint rejects an event without.
 */
export function stripIdentifiersForAnonymous(
  props: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!props || typeof props !== 'object') return props;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      IDENTIFIER_KEY_RE.test(key) &&
      !key.startsWith(SDK_PROPERTY_PREFIX) &&
      key !== INGESTION_REQUIRED_ID
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** GLOBAL, unanchored: a UUID anywhere inside a URL, message or stack frame. */
const UUID_ANYWHERE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_MASK = '[id]';

/**
 * Replace every UUID inside every string of a property tree with `[id]`.
 *
 * The key strip above cannot reach these: posthog-js attaches `$current_url`,
 * `$pathname` and `$referrer` from `location.href` to EVERY capture, and on this
 * app those read `/circles/<uuid>/calendar`; `$exception_list[].value` and
 * stack frames quote the same URL. Same shape as `redactDeep` (depth cap 8,
 * non-string leaves returned untouched, so numbers/booleans keep their types).
 * Pure and posthog-free so it can be unit-tested directly.
 */
export function maskUuidsDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') return value.replace(UUID_ANYWHERE_RE, UUID_MASK);
  if (Array.isArray(value)) return value.map((item) => maskUuidsDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskUuidsDeep(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Top-level keys the deep mask must NOT rewrite: the SDK's OWN random ids,
 * which are UUID-shaped (uuidv7) and, under memory persistence, minted fresh
 * per page load — nothing of ours to hide. `distinct_id` is required by
 * ingestion (an event whose distinct_id is `[id]` is garbage); `$session_id` /
 * `$device_id` / `$window_id` must stay valid for PostHog's session handling.
 */
const SDK_RANDOM_ID_KEYS = new Set(['distinct_id', '$device_id', '$session_id', '$window_id']);

/**
 * The anonymous-mode property pipeline, after `redactDeep`: key strip, then
 * UUID mask on everything except the SDK's own random ids. Pure.
 */
export function anonymizeProperties(
  props: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const stripped = stripIdentifiersForAnonymous(props);
  if (!stripped) return stripped;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stripped)) {
    out[key] = SDK_RANDOM_ID_KEYS.has(key) ? value : maskUuidsDeep(value);
  }
  return out;
}

/** Envelope fields that carry no user-controlled string worth walking. */
const EVENT_ENVELOPE_PASSTHROUGH = new Set(['event', 'uuid', 'timestamp']);

/**
 * The `before_send` pipeline over a WHOLE posthog-js capture, not just its
 * `properties`. Pure and posthog-free.
 *
 * WHY NOT ONLY `properties`: posthog-js@1.386.6 `capture()` writes the person
 * payloads to the TOP LEVEL of the event before `before_send` runs —
 * `c.$set = options.$set` and `c.$set_once = this.Rn(options.$set_once, …)`,
 * where `Rn` folds in `persistence.get_initial_props()` (`$initial_current_url`,
 * `$initial_referrer`, …) and the session's set-once props (`$current_url`,
 * `$session_entry_url`, …). `$identify` always carries both. Other paths nest
 * them as `properties.$set` / `properties.$set_once` instead. Redacting only
 * `properties` let a consented user's landing-URL tokens become PERMANENT
 * person properties (e2e/consent/granted-identify.consent.spec.ts).
 *
 * So EVERY field except the scalar envelope (`event`, `uuid`, `timestamp`) is
 * deep-redacted: `properties` (which covers nested `$set` / `$set_once`), the
 * top-level `$set` / `$set_once`, and any field a future SDK adds. Every string
 * at any depth goes through `redactDeep`, so every URL-bearing key is covered —
 * `$current_url`, `$initial_current_url`, `$referrer`, `$initial_referrer`,
 * `$session_entry_url`, `$session_entry_referrer`, `$pathname`,
 * `$initial_pathname`, and any other `*_url` / `*_referrer`.
 *
 * Anonymous mode: `properties` get `anonymizeProperties` (key strip + UUID
 * mask); the person payloads get the UUID mask.
 */
export function redactCaptureEvent<T extends object>(event: T, anonymous: boolean): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
    if (EVENT_ENVELOPE_PASSTHROUGH.has(key)) {
      out[key] = value;
    } else if (key === 'properties') {
      const redacted = redactDeep(value) as Record<string, unknown> | undefined;
      out[key] = anonymous ? anonymizeProperties(redacted) : redacted;
    } else {
      const redacted = redactDeep(value);
      out[key] = anonymous ? maskUuidsDeep(redacted) : redacted;
    }
  }
  return out as T;
}

/**
 * Configure `posthog` (already loaded), then mark it ready so anything queued
 * by an eager capture is flushed. Split out so `initAnalytics` can call it
 * SYNCHRONOUSLY when the SDK module is already loaded (warm cache) instead of
 * always paying a `.then()` microtask.
 *
 * Re-reads consent itself rather than trusting a `mode` computed by the
 * caller: `initAnalytics` may have decided to load the SDK several AWAITS
 * ago, and a visitor can withdraw consent in that window (toggle Privacy off
 * the instant the app boots, before the dynamic import even resolves). If
 * collection is no longer allowed by the time this actually runs, the
 * instance is NEVER `.init()`-ed and NEVER marked ready — a later, genuinely
 * consenting `initAnalytics()` call must still see "not configured" and run
 * this for real — and anything queued under the stale decision is dropped
 * outright (see `clearPendingQueue`'s doc comment).
 */
/**
 * The three privacy super properties, and the ONLY place they are written.
 *
 * ── WHY THIS IS A FUNCTION AND NOT AN INLINE `register` ──────────────────
 *
 * Super properties live in posthog-js's PERSISTENCE, and `reset()` calls
 * `this.persistence.clear()` — which takes them with it, re-registering only
 * `distinct_id`, `$device_id` and `$last_posthog_reset` afterwards (verified in
 * the installed posthog-js@1.386.6 `dist/module.js`). Registering once at init
 * therefore held the invariant stated above only until the FIRST reset.
 *
 * Two paths reset: `resetAnalytics()` (logout) and `disableAnalytics()`
 * (consent withdrawal). Both continue running in the same document afterwards,
 * so every event that followed — the SPA route change to /login, `$pageview`,
 * `login_started`, `login_completed` — went out with no `$ip: null`, meaning
 * PostHog recorded the source IP and derived GeoIP from it; and with no
 * `platform` / `app_env`, which mixes web into mobile's numbers and dev traffic
 * into the admin error digest. On the withdrawal path the person whose IP is
 * then captured is precisely the one who just declined.
 *
 * Mobile solves the same problem the same way: `services/analytics.ts` extracts
 * `registerPrivacySuperProperties` and re-runs it from every entry point that
 * can hand it an instance, rather than trusting one call site.
 *
 * CALL THIS AFTER EVERY `reset()`. A fourth reset site must not be able to miss
 * it — that is the whole reason the registration is not inline.
 */
function registerPrivacySuperProperties(posthog: PostHogInstance): void {
  try {
    posthog.register({
      platform: 'web',
      app_env: import.meta.env.DEV ? 'development' : 'production',
      $ip: null,
    });
  } catch {
    // Best-effort, like every other analytics call in this file: an SDK that
    // throws here must not break a logout or the settings page.
  }
}

function configure(posthog: PostHogInstance): void {
  const mode = currentAnalyticsMode();
  if (!collectionAllowed(mode)) {
    clearPendingQueue();
    // Same reasoning for the pre-init error buffer: consent was withdrawn
    // between the decision to load and now, so nothing it holds may be sent.
    discardBootErrors();
    return;
  }

  // Reached in 'full' AND 'anonymous'. The explicit opt-in below is gated on
  // the mode — see the note there.
  posthog.init(env.VITE_POSTHOG_KEY as string, {
    autocapture: false,
    capture_pageview: false,
    // Capture unhandled errors/rejections as $exception events so crashes feed
    // the admin error digest. Distinct from `autocapture` (DOM events), which
    // stays off to avoid capturing PHI-adjacent text.
    capture_exceptions: true,
    // MASK AD-CLICK / CAMPAIGN PARAMS IN URL PROPERTIES — AND ONLY THOSE.
    //
    // This option makes posthog-js replace the values of its built-in list of
    // personal-data URL params (gclid, fbclid, msclkid, … — ad-click ids) with
    // `<masked>` in `$current_url` / `$initial_person_info` and friends.
    //
    // IT DOES NOT MASK CREDENTIALS. An earlier comment here claimed it closed
    // the OAuth leak (`/auth/callback#access_token=…` recorded as the landing
    // URL); it does not. e2e/consent/granted-identify.consent.spec.ts proved a
    // consented user landing on `?access_token=…#refresh_token=…` had the RAW
    // tokens stored on their PostHog PERSON via `$identify`'s
    // `$set_once.$current_url` / `$initial_current_url`, while `gclid` in the
    // same URL came out `<masked>`. Credentials are removed by `before_send`
    // below (`redactCaptureEvent` → `redactAuthTokens`), which walks the
    // event's properties AND its `$set` / `$set_once` person payloads.
    //
    // Kept on because ad-click ids are personal data we have no use for.
    mask_personal_data_properties: true,
    persistence: 'memory',
    // The privacy policy states "We do not use session recording in the
    // apps". Until now that was only true because the PostHog PROJECT
    // setting has recording turned off — a setting anyone with dashboard
    // access could flip, silently making the policy's claim false with no
    // code change on our side. `disable_session_recording` makes the promise
    // hold regardless of project settings; `session_recording.maskAllInputs`
    // stays too, belt-and-braces, in case recording is ever re-enabled.
    disable_session_recording: true,
    session_recording: {
      maskAllInputs: true,
    },
    // Runs on every event, including posthog's own auto-properties. Only string
    // values are touched, and only credentials inside them are removed (invite
    // codes, and token-like URL params — see `redactCaptureEvent`) -- the
    // invite EVENTS themselves (sent/accepted counts) are untouched, since
    // those drive the activation funnel.
    //
    // `before_send`, not `sanitize_properties`: the latter is deprecated, and it
    // only ever saw TOP-LEVEL properties. `$current_url` / `$pathname` are
    // top-level so the invite code was caught there, but nested payloads were
    // not -- most importantly `$exception_list`, an array of objects whose
    // `value` and `stacktrace` frames can carry the URL the crash happened on,
    // i.e. `/invite/<code>` verbatim. This walks the whole event.
    before_send: (event) => {
      if (!event) return event;
      try {
        // Redaction FIRST, in every mode. Then, for a declined visitor, drop
        // the stable ids and mask UUIDs in URLs/messages — re-read per event,
        // not per init, because consent can be withdrawn mid-session and the
        // client keeps running (see `disableAnalytics`).
        return redactCaptureEvent(event, currentAnalyticsMode() === 'anonymous');
      } catch {
        // Analytics must never break the app. Dropping the EVENT is safer than
        // sending one that skipped redaction, since the thing being redacted is
        // a live credential.
        return null;
      }
    },
  });

  // REGISTER BEFORE OPTING IN. The order is a privacy property, not style.
  //
  // Tag EVERY event with `platform: 'web'` so the shared PostHog project can
  // separate web from mobile (which sends the same event names) while still
  // aggregating cross-platform on the event name. `app_env` lets the admin error
  // digest exclude dev/testing activity (e.g. a dev running the site locally).
  // `$ip: null` suppresses IP capture + GeoIP enrichment on EVERY event (see the
  // security posture note above) — it must be a super property, not an init
  // option, so it also covers $exception and session-replay-adjacent events.
  //
  // "EVERY event" is only true if the super property is registered FIRST.
  // `opt_in_capturing()` CAPTURES an event of its own (`$opt_in`), so calling it
  // before this `register` sent exactly one event per consenting boot with the
  // IP captured and GeoIP-enriched — the single thing this file promises never
  // happens.
  registerPrivacySuperProperties(posthog);

  // OPT-IN ONLY IN 'full'. This used to be unconditional, justified by a comment
  // reading "we only reach here with consent" — true when written, and false
  // the moment 'anonymous' became a mode that also reaches this line. With the
  // flag on, a visitor who DECLINED would have been explicitly opted IN, on the
  // very client whose whole justification is that it is the unidentified one.
  //
  // (mobile-63 hit the identical defect in their initializer and found it while
  // looking for the equivalent of a withdraw-mid-session test. Same shape, same
  // cause: an invariant asserted in a comment three screens from the gate that
  // changed.)
  //
  // The anonymous client is deliberately left at the SDK DEFAULT rather than
  // opted in: nothing has opted it out, and with `persistence: 'memory'` it
  // holds no persisted opt-out from a previous session to undo. The explicit
  // opt-in exists ONLY to clear a remembered `opt_out_capturing()` — which by
  // definition only a consenting, previously-opted-out visitor can have.
  if (identifyAllowed(mode)) {
    try {
      // `captureEventName: null` suppresses the `$opt_in` event outright. The
      // super property above now covers it either way, but a consent action is
      // not itself a product event and there is nothing to learn from it.
      posthog.opt_in_capturing({ captureEventName: null });
    } catch {
      /* best-effort: an analytics preference must never break the app */
    }
  }

  // Flush anything an eager `Analytics.*`/`trackPageview` call queued while
  // the SDK was loading — see lib/posthogLoader.ts's doc comment for why this
  // must run LAST, after init/register/opt-in above.
  markPosthogReady(posthog);

  // Replay anything thrown BEFORE this point (see lib/bootErrorBuffer.ts).
  // After `markPosthogReady`, so each entry hits the configured SDK directly
  // instead of re-entering the loader queue; and after `init()`, so posthog's
  // own onerror/unhandledrejection handlers are installed by the time ours are
  // removed — there is no moment with nobody listening.
  flushBootErrors(captureException);
}

export function initAnalytics(): void {
  if (!env.VITE_POSTHOG_KEY) {
    // No key → nothing will ever be sent; release the boot listeners rather
    // than holding (sanitized) errors for a flush that cannot happen.
    discardBootErrors();
    return;
  }
  // THE CONSENT GATE. Consent defaults OFF, and a visitor who has not
  // consented — whether they declined or has never been asked; the two are
  // distinct records now but resolve to the same mode, see
  // `GRANDFATHER_UNASKED_WEB_USERS` in analyticsMode.ts — lands in the DECLINED
  // mode, whatever that currently resolves to.
  //
  // 'off' constructs NOTHING — not even the SDK fetch below. 'anonymous' (the
  // declined mode while ANONYMOUS_ANALYTICS_WHEN_DECLINED is on) constructs the
  // client and captures events, but `identifyUser` below refuses, so nothing
  // is ever joined to an account, and `before_send` strips the stable ids.
  // `persistence: 'memory'` already applies in every mode, so nothing is
  // written to the device either way.
  const mode = currentAnalyticsMode();
  if (!collectionAllowed(mode)) {
    // The visitor declined (or never opted in): the boot buffer is DISCARDED,
    // never flushed — errors that happened before we could ask are still
    // theirs, not ours. This also removes the boot listeners.
    discardBootErrors();
    return;
  }

  // Synchronous path on a warm cache (the module already loaded — e.g. an
  // eager capture triggered the fetch before this ran): configure immediately
  // rather than paying a `.then()` microtask for no reason.
  const loaded = getLoadedPosthogModule();
  if (loaded) {
    configure(loaded);
    return;
  }
  // `.catch` so a failed fetch (chunk 404 after a redeploy, offline, a flaky
  // CDN — see loadPosthogModule's doc comment) never becomes an unhandled
  // rejection. Analytics must never surface a load failure anywhere near the
  // app; there's nothing else to do here but swallow it.
  void loadPosthogModule()
    .then((posthog) => configure(posthog))
    .catch(() => {
      // best-effort — and with no SDK there is no flush coming, so let the
      // boot listeners go rather than buffering for nobody.
      discardBootErrors();
    });
}

/**
 * Associate subsequent events with a user id, BY OPAQUE ID ONLY.
 *
 * This used to send the account's EMAIL as a person property. It no longer
 * sends any person trait at all — founder decision, matching mobile, whose
 * `Analytics.identifyUser` takes no traits bag and states the reasoning:
 * "Removing the parameter removes the door" (mobile services/analytics.ts).
 *
 * `userId` is a UUID, which is everything a join key has to be: the founder
 * lookup the email existed for ("which analytics person is this support
 * request?") goes id-first through the admin tooling instead, and the id is
 * already on every event this client sends.
 *
 * DO NOT REINTRODUCE A TRAITS PARAMETER. A `Record<string, unknown>` bag that
 * is never passed anything is still one keystroke from carrying a name, an
 * email, or a health-adjacent field into PostHog's person store — where it
 * persists independently of the events and outlives any `before_send`
 * redaction. If a specific trait is ever genuinely needed, add a NAMED
 * parameter with a documented reason so it shows up in review.
 *
 * No-op when PostHog isn't initialized (optional key).
 */
export function identifyUser(userId: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  // PERMISSION, not just a key.
  //
  // This used to be gated on VITE_POSTHOG_KEY alone, so signing in transmitted
  // `$identify` for a visitor who had declined analytics — creating a named
  // PostHog person for the one group who had said no (and, until 2026-09-10,
  // stamping their EMAIL on it). `identifyAllowed` is false in BOTH 'off' and
  // 'anonymous':
  // in anonymous mode identify is the whole point of what is being withheld.
  if (!identifyAllowed(currentAnalyticsMode())) return;
  withPosthog((posthog) => {
    posthog.identify(userId);
  });
}

/**
 * Reset the analytics identity (call on logout so the next user starts fresh).
 * No-op when PostHog isn't initialized.
 */
export function resetAnalytics(): void {
  if (!env.VITE_POSTHOG_KEY) return;
  // NOTHING TO RESET if the SDK has never even loaded — and, critically,
  // queuing this would be wrong even though it "does nothing yet": a
  // declined visitor logging out would queue a reset(+maybe opt-out) closure
  // that only runs LATER, whenever the SDK finally loads — which could be
  // after the same visitor re-consents. That queued closure would then
  // silently override the fresh opt-in `initAnalytics` just performed (see
  // posthogLoader.ts's 'consentControl' doc comment for the full sequence).
  // Bailing here also means a declined visitor's logout never triggers the
  // SDK fetch at all.
  if (!getLoadedPosthogModule()) return;
  // Evaluated NOW, not when this eventually runs against the loaded SDK — a
  // queued reset must re-assert (or not) the consent state that held at the
  // moment `resetAnalytics` was actually called, not whatever it drifts to
  // while the SDK is still loading.
  //
  // False in 'full' AND in 'anonymous': a declined visitor's logout is a plain
  // reset — fresh random distinct id, identity (never set) gone, capture
  // continues anonymously. Only 'off' (flag off) has an opt-out to re-assert.
  const shouldStayOptedOut = !analyticsCollectionAllowed();
  withPosthog((posthog) => {
    posthog.reset();
    // RE-REGISTER THE PRIVACY SUPER PROPERTIES. `reset()` clears persistence,
    // and the next thing this app does is route to /login in the same document
    // — `$pageview`, `login_started`, `login_completed`, all of which would
    // otherwise carry a real IP. See `registerPrivacySuperProperties`.
    registerPrivacySuperProperties(posthog);
    // RE-ASSERT THE OPT-OUT AFTER RESETTING.
    //
    // posthog-js's `reset()` runs `consent.reset()`, which DELETES the
    // `__ph_opt_in_out_<token>` key. `disableAnalytics` already accounts for that
    // by resetting BEFORE opting out — but this path is LOGOUT, and it hit the
    // same bare `reset()` with nothing after it. So: opt out -> log out -> the
    // opt-out is gone and the SDK is opted back IN, while the Privacy toggle
    // still reads off.
    //
    // Re-asserting only when consent is actually withheld keeps a consenting
    // user's logout from opting them out of their own choice.
    // (mobile-63 hit this identically; @posthog/core's reset keeps only the Queue
    // and nulls every other persisted property, including OptedOut.)
    if (shouldStayOptedOut) {
      try {
        posthog.opt_out_capturing();
      } catch {
        /* best-effort */
      }
    }
  }, 'consentControl');
}

/**
 * Withdraw consent mid-session: drop the identity and anything buffered but not
 * yet sent, then continue in whatever the DECLINED mode is.
 *
 * `reset` drops the queue and the distinct id so the batch leading up to the
 * withdrawal — the worst possible one — is never transmitted under the known
 * identity, and a later opt-in starts a fresh identity rather than resuming
 * the old one.
 *
 *   'anonymous' (flag on): reset ONLY. Opting out would silence the anonymous
 *     client until the next page load — the exact cohort the flag exists to
 *     keep visible. Capture continues under the fresh random id; `identifyUser`
 *     refuses from here on (`identifyAllowed`), and `before_send` strips ids.
 *   'off' (flag off): reset, then opt out, so FUTURE events stop too.
 *
 * Called BEFORE the toggle persists the new consent value (ProfilePage tears
 * down first so the queue is dropped before anything else runs), so the mode
 * is resolved from the answer the visitor is GIVING — `resolveAnalyticsMode
 * (false)` — not read from storage, which still says "consented" at this point.
 *
 * Best-effort: a failure here must not break the settings page the user is
 * standing on.
 */
export function disableAnalytics(): void {
  if (!env.VITE_POSTHOG_KEY) return;
  // NOTHING TO DISABLE if the SDK has never even loaded — same reasoning as
  // `resetAnalytics`'s identical guard: queuing this against an unloaded SDK
  // risks the closure surviving into a LATER, different consent era.
  if (!getLoadedPosthogModule()) return;
  const keepCollecting = collectionAllowed(resolveAnalyticsMode(false));
  // ORDER IS LOAD-BEARING on the opt-out branch: reset FIRST, opt out SECOND.
  //
  // posthog-js's `reset()` calls `consent.reset()`, which DELETES the
  // `__ph_opt_in_out_<token>` key — so opting out and then resetting throws the
  // opt-out away and leaves the SDK opted back IN. Verified in
  // posthog-js@1.386.6: `reset(t){…this.consent.reset(),…}` and the consent
  // object's own `reset(){this.nr.q(this.sr,…)}` removes the key.
  //
  // Doing it the other way round keeps both properties: the queue and identity
  // built up before the opt-out are dropped, AND the opt-out is what survives.
  withPosthog((posthog) => {
    try {
      posthog.reset();
    } catch {
      /* best-effort */
    }
    // RE-REGISTER THE PRIVACY SUPER PROPERTIES, on BOTH branches. In the
    // 'anonymous' declined mode the client keeps capturing after this — and the
    // person it would start recording an IP for is the one who just withdrew.
    // In 'off' mode nothing more is sent, so this is merely harmless.
    registerPrivacySuperProperties(posthog);
    if (keepCollecting) return;
    try {
      posthog.opt_out_capturing();
    } catch {
      /* best-effort */
    }
  }, 'consentControl');
}

/**
 * Return an Error whose `message` has been run through `sanitizeErrorText`.
 *
 * An ErrorBoundary error message can legitimately embed user data — a failed
 * fetch reports the URL it was called with (query string and all), and a thrown
 * validation error can quote the value it rejected. The digest identifies errors
 * by name + message shape, and the sanitizer only redacts emails/tokens/query
 * strings while preserving the rest, so identifiability is unaffected.
 *
 * The original error is NEVER mutated (ErrorBoundary still logs it in DEV and
 * React may re-throw it): when redaction changes anything we send a clone that
 * keeps the original `name` and `stack`, with the message rewritten inside the
 * stack's header line too. Stack FRAMES are left intact — they are bundle URLs,
 * not user data, and mangling them would break digest triage.
 */
function withSanitizedMessage(error: Error): Error {
  try {
    const message = typeof error?.message === 'string' ? error.message : '';
    const safe = sanitizeErrorText(message);
    if (safe === message) return error;

    const clone = new Error(safe);
    clone.name = typeof error.name === 'string' ? error.name : 'Error';
    if (typeof error.stack === 'string') {
      clone.stack = message.length > 0 ? error.stack.replace(message, safe) : error.stack;
    }
    return clone;
  } catch {
    // Exotic/proxied error object — never let analytics break error reporting.
    return error;
  }
}

/**
 * Report a render error caught by an ErrorBoundary as a `$exception` event so it
 * feeds the admin error digest. `capture_exceptions` only auto-catches UNHANDLED
 * errors; a boundary "handles" the error, so we forward it explicitly. PHI-safe:
 * only the error name/sanitized message/stack and a non-PHI `boundary` tag are
 * sent. No-op when PostHog isn't initialized.
 *
 * `boundary` values in use: an ErrorBoundary's `boundary` prop ('root', a
 * route label, ...) and `'boot'` for errors replayed from lib/bootErrorBuffer
 * (thrown before the SDK was initialised) — the digest splits on it.
 *
 * `extra` is merged into the `$exception` properties and is for CRASH-RECORD
 * fields only (mobile parity: `fatal`, `component_stack`). Same PHI rules as
 * every other analytics property — enums, booleans, component names — and it
 * can never override `boundary` / `platform`, which are applied last.
 */
export function captureException(
  error: Error,
  boundary: string,
  extra?: Record<string, unknown>
): void {
  if (!env.VITE_POSTHOG_KEY) return;
  // Allowed in 'anonymous' — a crash report carries a sanitized message and no
  // account linkage — but never in 'off', where the visitor declined outright.
  if (!analyticsCollectionAllowed()) return;
  const sanitized = withSanitizedMessage(error);
  withPosthog((posthog) =>
    posthog.captureException(sanitized, { ...extra, boundary, platform: 'web' })
  );
}
