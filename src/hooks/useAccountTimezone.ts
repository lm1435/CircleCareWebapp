import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { normalizeZone } from '@/lib/checkoutCountry';
import { useAuthStore } from '@/store/authStore';

export interface AccountTimezone {
  /** The saved IANA id, or `undefined` when there is no usable one. */
  timezone: string | undefined;
  /**
   * The row has been asked for and has not answered yet.
   *
   * False when signed out and false once the read fails: neither will ever
   * resolve on its own, so waiting on them would hang the page instead of
   * reaching a state the user can act on.
   */
  isPending: boolean;
  /** Re-run the `/users/me` read behind the retry affordance. */
  refetch: () => void;
}

/**
 * The signed-in ACCOUNT's saved IANA timezone (`users.timezone`) — the country
 * gate's only input.
 *
 * THE ACCOUNT'S, NOT THE BROWSER'S. `Intl.resolvedOptions().timeZone` is the
 * machine in front of you; this is the value the user's phone wrote to their
 * row (backend default `America/New_York`, so in practice always present) and
 * the one every other surface — reminders, the digest, the PDF exports —
 * already agrees on. A gate decided by the browser would change answer when
 * someone travels or sets their laptop to UTC.
 *
 * Reuses the SHARED `queryKeys.currentUser` query — the same row App.tsx's
 * LanguageSync, ProfilePage and `useHourCycle` read — so this costs no extra
 * request and re-resolves for free when a profile change invalidates the key.
 * Do NOT mint a new key.
 *
 * WHAT THIS HOOK DELIBERATELY DOES NOT DO IS DECIDE. It reports the account
 * zone and whether the read has settled; `webCheckoutVerdict` combines it
 * with the browser's live zone and produces the allowed / store-only /
 * unresolved answer. Keeping the decision in one pure function is what stops
 * "no zone yet", "no zone ever" and "a zone we cannot sell into" from drifting
 * apart — they have different consequences and only one of them is the user's
 * fault. See lib/checkoutCountry.ts.
 *
 * `undefined` HERE MEANS "NOTHING USABLE", including `''` and whitespace: a
 * blank string is absence wearing a string's clothes, and it must not reach
 * the gate looking like a zone.
 */
export function useAccountTimezone(): AccountTimezone {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // `isError` is deliberately NOT read: a failure that still has a cached row
  // from an earlier success should keep using that row's zone, and a failure
  // with no data reports `timezone: undefined` by the same route as a row that
  // simply carries no zone. One condition, one branch, one place to decide.
  const { data: user, isPending, refetch } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  });

  // A DISABLED query reports `isPending` too (React Query v5 keeps the status
  // at 'pending' with an idle fetchStatus), so the authentication check is
  // what stops a signed-out visitor waiting forever on a read that was never
  // started. `/upgrade` sits inside AuthGuard, so signed-out is unreachable in
  // practice; it resolves to "unresolved" rather than to a silent allow.
  const pending = isAuthenticated && isPending;
  // The zone is only usable once it survives normalization — `''` and
  // whitespace are absence wearing a string's clothes.
  const timezone = normalizeZone(user?.timezone) === null ? undefined : user?.timezone;

  return { timezone, isPending: pending, refetch: () => void refetch() };
}
