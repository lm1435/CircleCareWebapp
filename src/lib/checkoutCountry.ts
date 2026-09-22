/**
 * WHERE WEB CHECKOUT IS OFFERED, AND WHY IT IS NOT OFFERED EVERYWHERE.
 *
 * Web purchases run through RevenueCat Web Billing on Stripe, where MAPLE
 * RIDGE LLC is the merchant of record. On the App Store, Apple is. That single
 * difference is the whole reason this file exists: a web sale creates a
 * VAT/GST registration obligation for us, and in the UK, the EU, Mexico,
 * Colombia, Chile and Peru it attaches on the FIRST B2C sale, with no
 * threshold to sit under. Canada, Australia and New Zealand have rolling
 * 12-month thresholds (CAD 30k / A$75k / NZ$60k) that we are orders of
 * magnitude below.
 *
 * So web checkout is offered in the US, Canada, Australia and New Zealand, and
 * everybody else is routed to the App Store / Google Play, where Apple and
 * Google are the merchant of record and handle tax for us. Sending web users
 * TO the app stores is fine: Apple's anti-steering rules restrict app -> web,
 * not web -> app.
 *
 * Full background: docs/plans/country-pricing.md, Part 5.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS AN ALLOWLIST AND IT FAILS CLOSED. DO NOT INVERT IT.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A zone that is not on the list below does not transact — and that includes
 * zones nobody enumerated anywhere, `Africa/Lagos` and `Asia/Bangkok` and
 * whatever the tzdb adds next year. An earlier revision of this file kept a
 * partial table of BLOCKED countries and let anything unrecognised through;
 * that turned every zone somebody forgot into a sale in a jurisdiction we are
 * not registered in, which is precisely the event the gate exists to prevent.
 * One sale is the whole trigger, so "probably fine" is not a state this
 * function is allowed to return.
 *
 * WHAT THAT COSTS, AND WHY IT IS AFFORDABLE. The only wrong answer this
 * direction can produce is a real US/CA/AU/NZ buyer sent to the app stores,
 * where they can still subscribe. That requires the zone table below to be
 * MISSING a zone, which is why the four countries are enumerated exhaustively,
 * legacy aliases and territories included. It is finite and it does not grow.
 *
 * NOT KNOWING IS A THIRD STATE, AND IT IS NOT "BLOCKED". A `/users/me` that
 * has not answered, that failed, or that carries no usable zone is not a
 * foreign buyer — it is a network condition. `isWebCheckoutAllowed` answers
 * `false` for all of them because they must not reach Subscribe, but the
 * CALLER is responsible for telling them apart: UpgradePage shows a spinner
 * while the read is in flight and a retryable error when it fails, and reaches
 * the store-only card only for a zone it actually resolved. Telling a Denver
 * user to go to the App Store because their request timed out is both a bad
 * outcome and a lie.
 *
 * WHY A TIMEZONE AND NOT AN IP LOOKUP. RevenueCat returns a CURRENCY, which
 * cannot separate Honduras from the United States (both USD). `users.timezone`
 * is an IANA id already stored on every user row (backend default
 * `America/New_York`), already delivered by `GET /users/me`, and already read
 * on the client by `useHourCycle`. It costs no request and no dependency. IP
 * geolocation would be no better here anyway — the incentive is reversed;
 * nobody spoofs their location to win the right to pay us.
 *
 * ── WHY TWO SIGNALS, AND WHY NEITHER ALONE IS ENOUGH ──────────────────────
 *
 * `webCheckoutVerdict` requires the ACCOUNT zone AND the BROWSER's live zone
 * to be on the allowlist. Do not simplify this back to one of them.
 *
 * THE ACCOUNT ZONE IS STALE BY DESIGN. Mobile's `syncDeviceSettings()`
 * (mobile/src/store/authStore.ts) writes `users.timezone` from the device
 * ONLY when the column is currently empty — `if (currentUser.timezone) skip`.
 * It is written once, at signup, and never updated again. So it records where
 * someone WAS when they created the account, possibly years ago: a user who
 * signed up in Mexico and has lived in Denver ever since is permanently
 * `America/Mexico_City`, and a user who signed up while visiting the US is
 * permanently allowlisted no matter where they have been since. Mobile's
 * timezone util also falls back to `America/New_York` when device detection
 * fails, which stamps a non-US signup as US outright. On its own the account
 * zone is therefore a historical record, not a location.
 *
 * THE BROWSER ZONE IS LIVE BUT BELONGS TO A MACHINE, not an account — a
 * borrowed laptop, a VPS, a work VM. On its own it is equally weak.
 *
 * Requiring both narrows the gate to "this account was created somewhere we
 * can sell AND is being used from somewhere we can sell". Neither signal can
 * open the gate by itself, which is the property we want when the cost of a
 * false open is a registration obligation in a jurisdiction we are not in.
 *
 * ACCEPTED TRADEOFF, AND IT IS NOT A BUG: a genuine US customer subscribing
 * from a hotel in Lisbon is blocked on web and has to buy in the app. That is
 * deliberate. The instruction for this gate is that eligibility be settled
 * "100% without question", and a rare inconvenienced traveller — who still has
 * a working purchase path two taps away — is cheaper than one sale in an
 * unregistered jurisdiction. THERE IS NO BYPASS AND NONE MAY BE ADDED.
 */

/**
 * THE GATE. Edit this line and nothing else when a threshold is approached or
 * a registration is taken out — this is deliberately the single knob, and it
 * is load-bearing: the zone set below is built by looking each of these
 * countries up in `ZONES_BY_COUNTRY`, so removing one here stops its zones
 * transacting even though the table still lists them.
 *
 * ISO 3166-1 alpha-2. The UK is the one to watch: web nets ~$63.50 per
 * subscriber there against Apple's $56.65, so if UK web demand ever appears,
 * registering beats blocking.
 */
export const WEB_CHECKOUT_COUNTRIES = ['US', 'CA', 'AU', 'NZ'] as const;

export type WebCheckoutCountry = (typeof WEB_CHECKOUT_COUNTRIES)[number];

/**
 * Every IANA zone in the four countries where we can be merchant of record,
 * written country-first so a row is easy to read and easy to edit.
 *
 * THIS HALF MUST BE EXHAUSTIVE — it is now the only thing standing between a
 * real buyer and a wrongly-blocked checkout. Legacy links are included
 * deliberately: older platforms still hand us `US/Eastern` and
 * `America/Indianapolis`, and a row stored that way has to resolve.
 *
 * There is deliberately NO table of blocked countries. Under an allowlist it
 * would be dead data, and a stale copy of it is exactly how the previous
 * revision leaked.
 */
export const ZONES_BY_COUNTRY: Readonly<Record<WebCheckoutCountry, readonly string[]>> = {
  // US TERRITORIES (Puerto Rico, the USVI, Guam, American Samoa, the Northern
  // Marianas) ARE LISTED AS US DELIBERATELY. They are US persons on the US App
  // Store paying in USD with US cards; blocking them buys no protection from a
  // FOREIGN registration obligation, which is the only thing this gate exists
  // to avoid. If a territory-specific sales-tax question ever arises it is a
  // domestic one for a US LLC, and it is not answered by hiding the button.
  US: [
    'America/Adak',
    'America/Anchorage',
    'America/Boise',
    'America/Chicago',
    'America/Denver',
    'America/Detroit',
    'America/Indiana/Indianapolis',
    'America/Indiana/Knox',
    'America/Indiana/Marengo',
    'America/Indiana/Petersburg',
    'America/Indiana/Tell_City',
    'America/Indiana/Vevay',
    'America/Indiana/Vincennes',
    'America/Indiana/Winamac',
    'America/Juneau',
    'America/Kentucky/Louisville',
    'America/Kentucky/Monticello',
    'America/Los_Angeles',
    'America/Menominee',
    'America/Metlakatla',
    'America/New_York',
    'America/Nome',
    'America/North_Dakota/Beulah',
    'America/North_Dakota/Center',
    'America/North_Dakota/New_Salem',
    'America/Phoenix',
    'America/Sitka',
    'America/Yakutat',
    'Pacific/Honolulu',
    // Territories — see the note above.
    'America/Puerto_Rico',
    'America/St_Thomas',
    'America/Virgin',
    'Pacific/Guam',
    'Pacific/Saipan',
    'Pacific/Pago_Pago',
    'Pacific/Midway',
    'Pacific/Johnston',
    // Legacy links still emitted by older platforms and stored on old rows.
    'America/Atka',
    'America/Fort_Wayne',
    'America/Indianapolis',
    'America/Knox_IN',
    'America/Louisville',
    'America/Shiprock',
    'Navajo',
    'US/Alaska',
    'US/Aleutian',
    'US/Arizona',
    'US/Central',
    'US/East-Indiana',
    'US/Eastern',
    'US/Hawaii',
    'US/Indiana-Starke',
    'US/Michigan',
    'US/Mountain',
    'US/Pacific',
    'US/Samoa',
  ],
  CA: [
    'America/Atikokan',
    'America/Blanc-Sablon',
    'America/Cambridge_Bay',
    'America/Coral_Harbour',
    'America/Creston',
    'America/Dawson',
    'America/Dawson_Creek',
    'America/Edmonton',
    'America/Fort_Nelson',
    'America/Glace_Bay',
    'America/Goose_Bay',
    'America/Halifax',
    'America/Inuvik',
    'America/Iqaluit',
    'America/Moncton',
    'America/Montreal',
    'America/Nipigon',
    'America/Pangnirtung',
    'America/Rainy_River',
    'America/Rankin_Inlet',
    'America/Regina',
    'America/Resolute',
    'America/St_Johns',
    'America/Swift_Current',
    'America/Thunder_Bay',
    'America/Toronto',
    'America/Vancouver',
    'America/Whitehorse',
    'America/Winnipeg',
    'America/Yellowknife',
    'Canada/Atlantic',
    'Canada/Central',
    'Canada/Eastern',
    'Canada/Mountain',
    'Canada/Newfoundland',
    'Canada/Pacific',
    'Canada/Saskatchewan',
    'Canada/Yukon',
  ],
  AU: [
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Broken_Hill',
    'Australia/Currie',
    'Australia/Darwin',
    'Australia/Eucla',
    'Australia/Hobart',
    'Australia/Lindeman',
    'Australia/Lord_Howe',
    'Australia/Melbourne',
    'Australia/Perth',
    'Australia/Sydney',
    'Antarctica/Macquarie',
    'Australia/ACT',
    'Australia/Canberra',
    'Australia/LHI',
    'Australia/NSW',
    'Australia/North',
    'Australia/Queensland',
    'Australia/South',
    'Australia/Tasmania',
    'Australia/Victoria',
    'Australia/West',
    'Australia/Yancowinna',
  ],
  NZ: [
    'Pacific/Auckland',
    'Pacific/Chatham',
    'NZ',
    'NZ-CHAT',
    'Antarctica/McMurdo',
    'Antarctica/South_Pole',
  ],
};

/**
 * Flattened once at module load, keyed lowercase, and built by walking
 * `WEB_CHECKOUT_COUNTRIES` rather than `ZONES_BY_COUNTRY` — so the allowlist
 * constant, not the table, is what decides.
 *
 * Lowercase because IANA ids are compared case-insensitively in the tzdb
 * itself and platforms have historically round-tripped `America/New_york`. A
 * case difference must never be the reason a US buyer is turned away.
 */
const ALLOWED_ZONES: ReadonlySet<string> = new Set(
  WEB_CHECKOUT_COUNTRIES.flatMap((country) =>
    ZONES_BY_COUNTRY[country].map((zone) => zone.toLowerCase())
  )
);

/**
 * True when the timezone names a zone inside `WEB_CHECKOUT_COUNTRIES`. A
 * straight membership test — there is no "unknown country" branch, because
 * under an allowlist unknown and blocked are the same answer.
 *
 * FALSE FOR EVERYTHING ELSE, INCLUDING `undefined`, `null`, `''` AND
 * WHITESPACE. That is not a claim that the user is abroad — callers must not
 * read it as one. It is only "this must not reach Subscribe". UpgradePage
 * separates "still loading", "could not be determined" and "determined, and
 * not eligible" before it puts anything on screen; see the file header.
 */
export function isWebCheckoutAllowed(timezone: string | null | undefined): boolean {
  const zone = normalizeZone(timezone);
  return zone !== null && ALLOWED_ZONES.has(zone);
}

/**
 * The zone as a comparable key, or `null` when there is nothing to compare —
 * absent, blank, or whitespace only.
 *
 * `null` IS THE "WE DO NOT KNOW" SIGNAL, and it is why this is exported: the
 * page needs to tell a row that carries no usable zone (a network condition,
 * or a user row older than the column) apart from a row that genuinely resolves
 * somewhere we cannot sell. The first gets a retry, the second gets the store.
 */
export function normalizeZone(timezone: string | null | undefined): string | null {
  if (typeof timezone !== 'string') return null;
  const trimmed = timezone.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * The BROWSER's live IANA zone, or `null` when it cannot be read.
 *
 * Synchronous, no request, no dependency. Wrapped because `resolvedOptions()`
 * is not guaranteed: a hardened or privacy-patched engine can throw, and
 * `timeZone` has historically come back `undefined` on old or stripped ICU
 * builds. A throw here must not take the page down — it is a `null`, which
 * `webCheckoutVerdict` reads as "we do not know", never as "allow".
 *
 * Read at the moment the paywall mounts, deliberately: this is the signal
 * that says where the user is NOW, as opposed to the account zone, which says
 * where they were when they signed up (see the file header).
 */
export function readBrowserTimezone(): string | null {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** What the paywall should render, once the account row has settled. */
export type WebCheckoutVerdict = 'allowed' | 'store-only' | 'unresolved';

/**
 * The whole gate, as one pure decision over the two signals.
 *
 *   both zones on the allowlist            -> 'allowed'
 *   either zone resolves somewhere else    -> 'store-only'
 *   either zone cannot be read at all      -> 'unresolved'
 *
 * 'unresolved' OUTRANKS 'store-only', and the order of the checks below is
 * that rule. A missing zone is a machine condition — a failed read, an engine
 * that will not report, a row older than the column — and it is not evidence
 * that anybody is abroad. Sending that user to the app stores would be both
 * discouraging and false; the caller owes them a retry instead.
 *
 * 'store-only' therefore means exactly one thing: two zones were read, and at
 * least one of them is somewhere we cannot be merchant of record.
 */
export function webCheckoutVerdict(
  accountTimezone: string | null | undefined,
  browserTimezone: string | null | undefined
): WebCheckoutVerdict {
  if (normalizeZone(accountTimezone) === null) return 'unresolved';
  if (normalizeZone(browserTimezone) === null) return 'unresolved';
  const both = isWebCheckoutAllowed(accountTimezone) && isWebCheckoutAllowed(browserTimezone);
  return both ? 'allowed' : 'store-only';
}
