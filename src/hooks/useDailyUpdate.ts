import { useEffect, useMemo, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getDailyUpdate, type DailyUpdateResponse } from '@/api/dailyUpdate';
import { queryKeys } from '@/lib/queryKeys';
import {
  evaluateDailyUpdateWindow,
  type DailyUpdateWindowState,
} from '@/lib/dailyUpdateWindow';

/**
 * The recipient-frame window state, kept current while the tab stays open
 * (docs/plans/daily-update.md §5.2 / §6):
 *
 * - one `setTimeout` to the next boundary (19:00 opening or midnight closing,
 *   preferring the server's `closes_at` instant while the window is open);
 * - a re-check whenever the tab becomes visible or the window regains focus,
 *   because background tabs throttle timers.
 *
 * `null` while the recipient's zone is unknown (circle still loading): the
 * caller must gate on it, never default to a placeholder zone
 * (project_placeholder_timezone_double_fetch).
 */
export function useDailyUpdateWindow(
  timezone: string | null,
  closesAt?: string | null
): DailyUpdateWindowState | null {
  const [now, setNow] = useState(() => new Date());

  const state = useMemo(
    () => (timezone ? evaluateDailyUpdateWindow(timezone, now) : null),
    [timezone, now]
  );

  useEffect(() => {
    if (!state) return undefined;
    let delay = state.msToNextBoundary;
    if (state.inWindow && closesAt) {
      const untilClose = Date.parse(closesAt) - Date.now();
      if (Number.isFinite(untilClose) && untilClose > 0) delay = Math.min(delay, untilClose);
    }
    const id = setTimeout(() => setNow(new Date()), delay);
    return () => clearTimeout(id);
  }, [state, closesAt]);

  useEffect(() => {
    const recheck = (): void => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  return state;
}

const UNAVAILABLE_CODES = new Set(['DATE_OUT_OF_RANGE', 'VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND']);

/**
 * The server answered with a definitive "no" (out-of-range or malformed date, not
 * a member, no such circle): the dated view reads "This update is no longer
 * available." rather than offering a retry that cannot succeed.
 */
export function isDailyUpdateUnavailableError(err: unknown): boolean {
  const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' && UNAVAILABLE_CODES.has(code);
}

/**
 * Whether the rollout switch is on for this viewer (mobile `useDailyUpdateEnabled`):
 * the invite line must never promise a daily update that rollout has turned off.
 * One date-less read per circle, same key as mobile.
 */
export function useDailyUpdateEnabled(circleId: string): boolean {
  const query = useQuery({
    queryKey: ['dailyUpdate', circleId, 'enabled'] as const,
    queryFn: () => getDailyUpdate(circleId),
    enabled: Boolean(circleId),
    staleTime: 10 * 60 * 1000,
    retry: (count, err) => {
      const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
      if (typeof code === 'string') return false;
      return count < 1;
    },
    select: (r: DailyUpdateResponse) => r?.enabled === true,
  });
  return query.data === true;
}

/** GET /circles/:circleId/daily-update?date= — keyed per recipient-local date. */
export function useDailyUpdate(
  circleId: string,
  date: string | null,
  enabled: boolean
): UseQueryResult<DailyUpdateResponse> {
  return useQuery({
    queryKey: queryKeys.dailyUpdate(circleId, date ?? ''),
    queryFn: () => getDailyUpdate(circleId, date as string),
    enabled: enabled && Boolean(circleId) && Boolean(date),
    // Computed live on the server; a minute is fresh enough for an evening card.
    staleTime: 60 * 1000,
    // A 4xx (out of range, not a member) will not change on retry.
    retry: (count, err) => {
      const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
      if (typeof code === 'string') return false;
      return count < 1;
    },
  });
}
