import { afterEach, describe, expect, it } from 'vitest';
import {
  WEB_CHECKOUT_COUNTRIES,
  ZONES_BY_COUNTRY,
  isWebCheckoutAllowed,
  normalizeZone,
  readBrowserTimezone,
  webCheckoutVerdict,
} from '@/lib/checkoutCountry';

/**
 * THIS IS AN ALLOWLIST AND IT FAILS CLOSED.
 *
 * An earlier revision kept a partial table of BLOCKED countries and let
 * anything unrecognised through to checkout. Every zone nobody thought to
 * enumerate — `Africa/Lagos`, `Asia/Bangkok`, whatever the tzdb adds next —
 * was a sale in a jurisdiction we are not registered in, and one sale is the
 * whole trigger. The tests below pin the inversion; if one of them ever needs
 * "just this once" relaxing, that is the leak reopening.
 */

describe('WEB_CHECKOUT_COUNTRIES', () => {
  it('is exactly the four merchant-of-record-safe jurisdictions', () => {
    expect([...WEB_CHECKOUT_COUNTRIES]).toEqual(['US', 'CA', 'AU', 'NZ']);
  });

  it('has a non-empty zone list for every allowed country', () => {
    for (const country of WEB_CHECKOUT_COUNTRIES) {
      expect(ZONES_BY_COUNTRY[country].length).toBeGreaterThan(0);
    }
  });

  // Dead data is how the previous revision leaked: a half-maintained table of
  // countries that no longer decided anything.
  it('carries no country the allowlist does not name', () => {
    expect(Object.keys(ZONES_BY_COUNTRY).sort()).toEqual([...WEB_CHECKOUT_COUNTRIES].sort());
  });

  it('never lists the same zone under two countries', () => {
    const seen = new Map<string, string>();
    for (const [country, zones] of Object.entries(ZONES_BY_COUNTRY)) {
      for (const zone of zones) {
        const key = zone.toLowerCase();
        expect(seen.has(key), `${zone} is listed under both ${seen.get(key)} and ${country}`).toBe(
          false
        );
        seen.set(key, country);
      }
    }
  });
});

describe('normalizeZone', () => {
  it('lowercases and trims a real zone', () => {
    expect(normalizeZone('  America/New_York ')).toBe('america/new_york');
  });

  // `null` is the "we do not know" signal the page needs to tell a network
  // condition apart from a foreign buyer.
  it.each([undefined, null, '', '   ', '\t\n'])('returns null for %p', (value) => {
    expect(normalizeZone(value as string | null | undefined)).toBeNull();
  });
});

describe('isWebCheckoutAllowed', () => {
  it.each([
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'America/Indiana/Indianapolis',
    'Pacific/Honolulu',
    'America/Toronto',
    'America/Vancouver',
    'America/St_Johns',
    'Australia/Sydney',
    'Australia/Brisbane',
    'Australia/Perth',
    'Pacific/Auckland',
  ])('allows %s', (zone) => {
    expect(isWebCheckoutAllowed(zone)).toBe(true);
  });

  // Legacy links are still what older platforms hand us; a US row stored as
  // `US/Eastern` must not be turned away.
  it.each(['US/Eastern', 'US/Pacific', 'America/Indianapolis', 'Canada/Eastern', 'Australia/NSW', 'NZ'])(
    'allows the legacy alias %s',
    (zone) => {
      expect(isWebCheckoutAllowed(zone)).toBe(true);
    }
  );

  // US persons on the US storefront paying USD — no FOREIGN obligation exists
  // to protect against, so blocking them would be pure lost revenue.
  it.each(['America/Puerto_Rico', 'Pacific/Guam', 'America/St_Thomas'])(
    'allows the US territory zone %s',
    (zone) => {
      expect(isWebCheckoutAllowed(zone)).toBe(true);
    }
  );

  it('ignores case and surrounding whitespace', () => {
    expect(isWebCheckoutAllowed('america/new_york')).toBe(true);
    expect(isWebCheckoutAllowed('  AMERICA/TORONTO  ')).toBe(true);
  });

  // The no-threshold jurisdictions: one sale registers us.
  it.each([
    'America/Mexico_City',
    'America/Bogota',
    'America/Santiago',
    'America/Lima',
    'Europe/London',
    'Europe/Madrid',
    'Europe/Berlin',
    'America/Sao_Paulo',
  ])('blocks %s', (zone) => {
    expect(isWebCheckoutAllowed(zone)).toBe(false);
  });

  // ── THE BEHAVIOUR CHANGE ─────────────────────────────────────────────────
  // Under the old blocked-country table these all fell through to Subscribe
  // because no row mentioned them. Under the allowlist, not being named IS
  // the answer. This is the leak that was closed; do not reopen it.
  it.each([
    'Africa/Lagos',
    'Asia/Bangkok',
    'Asia/Ho_Chi_Minh',
    'Asia/Kolkata',
    'Europe/Vilnius',
    'Pacific/Fiji',
    'Atlantic/Reykjavik',
    'America/Nassau',
    'Indian/Maldives',
    'Antarctica/Troll',
  ])('blocks the unenumerated zone %s', (zone) => {
    expect(isWebCheckoutAllowed(zone)).toBe(false);
  });

  it.each(['UTC', 'GMT', 'Etc/GMT+3', 'Etc/UTC', 'Mars/Olympus_Mons', 'not a timezone at all'])(
    'blocks the unrecognisable value %p',
    (zone) => {
      expect(isWebCheckoutAllowed(zone)).toBe(false);
    }
  );

  // Not a claim that the user is abroad — only "this must not reach
  // Subscribe". UpgradePage routes these to a retry, not to the store card.
  it.each([undefined, null, '', '   '])('does NOT allow the unresolvable value %p', (zone) => {
    expect(isWebCheckoutAllowed(zone as string | null | undefined)).toBe(false);
  });

  // Ties the decision to the constant rather than to a hardcoded expectation:
  // every zone in the table is allowed because its country is on the list.
  it('allows every zone of every country named by WEB_CHECKOUT_COUNTRIES', () => {
    for (const country of WEB_CHECKOUT_COUNTRIES) {
      for (const zone of ZONES_BY_COUNTRY[country]) {
        expect(isWebCheckoutAllowed(zone), `${zone} (${country})`).toBe(true);
      }
    }
  });

  /**
   * The constant has to be what DRIVES the set, not a label beside it.
   *
   * Two things pin that together, because neither is sufficient alone:
   *   - the test above walks `WEB_CHECKOUT_COUNTRIES` and requires every zone
   *     it reaches to pass, so dropping a country from the constant fails;
   *   - "carries no country the allowlist does not name" requires the table's
   *     keys to BE the constant, so no zone can enter the set by any other
   *     door (and `ZONES_BY_COUNTRY` is typed to those four keys, so adding
   *     one is a compile error, not a silent widening).
   *
   * What remains is the closure: nothing outside that union is allowed.
   */
  it('allows nothing outside the union the constant reaches', () => {
    const reachable = new Set(
      WEB_CHECKOUT_COUNTRIES.flatMap((c) => ZONES_BY_COUNTRY[c].map((z) => z.toLowerCase()))
    );
    const outsiders = [
      'Europe/London',
      'America/Mexico_City',
      'Asia/Tokyo',
      'Africa/Nairobi',
      'America/Argentina/Buenos_Aires',
      'Pacific/Fiji',
    ];
    for (const zone of outsiders) {
      expect(reachable.has(zone.toLowerCase()), `${zone} unexpectedly in the table`).toBe(false);
      expect(isWebCheckoutAllowed(zone), zone).toBe(false);
    }
  });
});

/**
 * TWO SIGNALS, BOTH REQUIRED.
 *
 * The account zone is written once at signup by mobile's `syncDeviceSettings`
 * and never refreshed, so it says where someone WAS, not where they are. The
 * browser zone is live but describes a machine. Either alone can be wrong in
 * the expensive direction; requiring both is what closes the gap.
 */
describe('readBrowserTimezone', () => {
  const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

  afterEach(() => {
    Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
  });

  it('returns whatever the engine reports', () => {
    Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(this: Intl.DateTimeFormat) {
      return { ...realResolvedOptions.call(this), timeZone: 'Australia/Perth' };
    };
    expect(readBrowserTimezone()).toBe('Australia/Perth');
  });

  // Old/stripped ICU builds have reported no zone at all.
  it('returns null when the engine reports no zone', () => {
    Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(this: Intl.DateTimeFormat) {
      return { ...realResolvedOptions.call(this), timeZone: undefined as unknown as string };
    };
    expect(readBrowserTimezone()).toBeNull();
  });

  // A hardened or privacy-patched engine can throw. That must be a null, not
  // a white screen — and never an allow.
  it('returns null instead of propagating a throw', () => {
    Intl.DateTimeFormat.prototype.resolvedOptions = () => {
      throw new Error('blocked by privacy extension');
    };
    expect(() => readBrowserTimezone()).not.toThrow();
    expect(readBrowserTimezone()).toBeNull();
  });
});

describe('webCheckoutVerdict', () => {
  it('allows only when BOTH zones are on the allowlist', () => {
    expect(webCheckoutVerdict('America/New_York', 'America/Denver')).toBe('allowed');
    expect(webCheckoutVerdict('America/Toronto', 'Australia/Sydney')).toBe('allowed');
  });

  // THE NEW PROTECTION. The account says signup happened somewhere we can
  // sell; the browser says the purchase is not happening there. Under the
  // single-signal gate this transacted.
  it.each([
    ['America/New_York', 'Europe/London'],
    ['America/New_York', 'America/Mexico_City'],
    ['America/Denver', 'Asia/Bangkok'],
    ['Australia/Sydney', 'Europe/Madrid'],
  ])('blocks an allowlisted account (%s) used from %s', (account, browser) => {
    expect(webCheckoutVerdict(account, browser)).toBe('store-only');
  });

  // The mirror image: the account was created abroad and never updated (the
  // write-once sync), but the browser is in Denver today. Still blocked — a
  // stale allowlisted account is exactly as untrustworthy in reverse.
  it.each([
    ['America/Mexico_City', 'America/Denver'],
    ['Europe/London', 'America/New_York'],
    ['Asia/Kolkata', 'America/Toronto'],
  ])('blocks a non-allowlisted account (%s) used from %s', (account, browser) => {
    expect(webCheckoutVerdict(account, browser)).toBe('store-only');
  });

  it('blocks when neither zone is on the allowlist', () => {
    expect(webCheckoutVerdict('Europe/Madrid', 'Europe/Lisbon')).toBe('store-only');
  });

  // 'unresolved' OUTRANKS 'store-only': an unreadable zone is a machine
  // condition, not evidence that anyone is abroad, so it earns a retry rather
  // than being told to go buy on their phone.
  it.each([
    [undefined, 'America/Denver'],
    [null, 'America/Denver'],
    ['', 'America/Denver'],
    ['   ', 'America/Denver'],
    ['America/Denver', undefined],
    ['America/Denver', null],
    ['America/Denver', ''],
    ['America/Denver', '  '],
    [undefined, undefined],
  ])('is unresolved for account=%p browser=%p', (account, browser) => {
    expect(
      webCheckoutVerdict(account as string | null | undefined, browser as string | null | undefined)
    ).toBe('unresolved');
  });

  // Even when the readable half is plainly ineligible: we still do not know
  // the other half, and 'unresolved' is the honest answer.
  it('prefers unresolved over store-only when one zone is unreadable', () => {
    expect(webCheckoutVerdict('Europe/London', undefined)).toBe('unresolved');
    expect(webCheckoutVerdict(undefined, 'Europe/London')).toBe('unresolved');
  });

  it('normalizes both zones the same way', () => {
    expect(webCheckoutVerdict('  america/new_york ', 'AMERICA/TORONTO')).toBe('allowed');
  });

  // There is no bypass, and a traveller is the accepted cost of that.
  it('blocks a genuine US account subscribing from abroad — the accepted tradeoff', () => {
    expect(webCheckoutVerdict('America/Chicago', 'Europe/Lisbon')).toBe('store-only');
  });
});
