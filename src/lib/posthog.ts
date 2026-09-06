import { redactAuthTokens, redactInviteCode, sanitizeErrorText } from './analytics';
import { discardBootErrors, flushBootErrors } from './bootErrorBuffer';
import { env } from './env';
import {
  analyticsCollectionAllowed,
  collectionAllowed,
  currentAnalyticsMode,
  identifyAllowed,
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
    // MASK THE URL/REFERRER PERSON PROPERTIES.
    //
    // posthog-js registers `$initial_person_info` ONCE, on the first capture,
    // via `set_initial_person_info()` — and that helper is gated on exactly this
    // option, which defaults to FALSE (unmasked). It records the landing URL and
    // referrer verbatim.
    //
    // The first capture in an OAuth sign-in is PageviewTracker's `$pageview`.
    // `router.tsx` renders `<PageviewTracker />` BEFORE `<Outlet />`, so its
    // effect runs before AuthCallbackPage's `history.replaceState` scrubs the
    // hash — and at that moment `location.href` is
    // `/auth/callback#access_token=…&refresh_token=…`. Our explicit
    // `$current_url` in trackPageview overrides the EVENT property only; it does
    // nothing about the PERSON property. `before_send`'s `redactDeep` only
    // strips invite codes, not tokens.
    //
    // Net effect without this line: live OAuth credentials land in PostHog for
    // anyone with read access, permanently (register_once never re-evaluates).
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
    // values are touched, and only the invite credential inside them is removed
    // -- the invite EVENTS themselves (sent/accepted counts) are untouched,
    // since those drive the activation funnel.
    //
    // `before_send`, not `sanitize_properties`: the latter is deprecated, and it
    // only ever saw TOP-LEVEL properties. `$current_url` / `$pathname` are
    // top-level so the invite code was caught there, but nested payloads were
    // not -- most importantly `$exception_list`, an array of objects whose
    // `value` and `stacktrace` frames can carry the URL the crash happened on,
    // i.e. `/invite/<code>` verbatim. This walks the whole property tree.
    before_send: (event) => {
      if (!event) return event;
      try {
        return { ...event, properties: redactDeep(event.properties) as typeof event.properties };
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
  posthog.register({
    platform: 'web',
    app_env: import.meta.env.DEV ? 'development' : 'production',
    $ip: null,
  });

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
  // THE CONSENT GATE. The privacy policy promises analytics is optional and
  // that declining means nothing is collected; initialising here and calling
  // opt_out afterwards would already have constructed a client and started
  // capturing. Defaults OFF — see analyticsConsent.ts for why this app cannot
  // grandfather the way mobile does.
  //
  // 'off' constructs NOTHING — not even the SDK fetch below. 'anonymous' (only
  // reachable when ANONYMOUS_ANALYTICS_WHEN_DECLINED is flipped on) constructs
  // the client and captures events, but never reaches `identifyUser` below —
  // so nothing is ever joined to an account. `persistence: 'memory'` already
  // applies in every mode, so nothing is written to the device either way.
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
 * Associate subsequent events with a user id, plus the user's email as the ONLY
 * person property (disclosed in the privacy policy's PostHog row — needed so
 * founders can correlate analytics with support requests). No other traits are
 * ever attached. No-op when PostHog isn't initialized (optional key).
 */
export function identifyUser(userId: string, email?: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  // PERMISSION, not just a key.
  //
  // This used to be gated on VITE_POSTHOG_KEY alone, so signing in transmitted
  // `$identify` carrying the EMAIL for a visitor who had declined analytics —
  // the single most identifying thing this client sends, sent to the one group
  // who had said no. `identifyAllowed` is false in BOTH 'off' and 'anonymous':
  // in anonymous mode identify is the whole point of what is being withheld.
  if (!identifyAllowed(currentAnalyticsMode())) return;
  withPosthog((posthog) => {
    if (email) {
      posthog.identify(userId, { email });
    } else {
      posthog.identify(userId);
    }
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
  const shouldStayOptedOut = !analyticsCollectionAllowed();
  withPosthog((posthog) => {
    posthog.reset();
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
 * Stop collecting and discard anything buffered but not yet sent.
 *
 * Called when the visitor withdraws consent. `opt_out_capturing` alone stops
 * FUTURE events; `reset` drops the queue and the distinct id so the batch
 * leading up to the opt-out — the worst possible one — is never transmitted,
 * and a later opt-in starts a fresh identity rather than resuming the old one.
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
  // ORDER IS LOAD-BEARING: reset FIRST, opt out SECOND.
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
