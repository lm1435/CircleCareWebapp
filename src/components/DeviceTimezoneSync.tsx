import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUser } from '@/api/users';
import { useAuthStore } from '@/store/authStore';
import { FOREGROUND_SETTINGS_SYNC_THROTTLE_MS, syncDeviceTimezone } from '@/utils/deviceTimezoneSync';
import { getDeviceTimezone } from '@/utils/timezone';

/**
 * The profile time zone follows the browser's: on session start, write the
 * device zone when it differs from the stored one (unless circles depend on the
 * stored zone, see utils/deviceTimezoneSync.ts). Reuses the shared `currentUser`
 * query (no extra request) and runs once per (user, stored zone, device zone).
 *
 * It also re-reads the browser zone when the tab becomes visible again (a tab left open across travel), at most
 * once per FOREGROUND_SETTINGS_SYNC_THROTTLE_MS, like mobile's foreground sync. A write that FAILED releases its
 * once-per-key guard, so the next trigger retries it.
 */
export function DeviceTimezoneSync(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: user } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  });
  const userId = user?.id;
  const stored = user?.timezone ?? null;
  const ran = useRef<string | null>(null);
  const lastAttemptAt = useRef(0);
  // The latest user for the visibility listener (it must not close over a stale render).
  const latest = useRef({ userId, stored });
  latest.current = { userId, stored };

  const attempt = useCallback(() => {
    const { userId: id, stored: storedZone } = latest.current;
    if (!id) return;
    const device = getDeviceTimezone();
    const key = `${id}|${storedZone ?? ''}|${device}`;
    if (ran.current === key) return;
    ran.current = key;
    lastAttemptAt.current = Date.now();
    void syncDeviceTimezone(storedZone, device).then((outcome) => {
      if (outcome === 'failed') {
        // Release the guard: the next trigger (return to the tab, a changed zone) retries this write.
        if (ran.current === key) ran.current = null;
        return;
      }
      if (outcome === 'written') {
        // The user AND the circles: a circle with no care-recipient account runs on its OWNER's zone, so this
        // write moved the frame of every such circle the user owns. A cached circle detail
        // (`care_recipient_timezone`) would keep date-math in the old zone while the server answers in the new
        // one (a Day view asked for the old zone's day got the new zone's doses). Reads keyed by dates in the
        // frame follow on their own once the frame changes; nothing else is refetched.
        void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
        void queryClient.invalidateQueries({ queryKey: ['circle'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
      }
    });
  }, []);

  useEffect(() => {
    attempt();
  }, [userId, stored, attempt]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAttemptAt.current < FOREGROUND_SETTINGS_SYNC_THROTTLE_MS) return;
      attempt();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [attempt]);

  return null;
}

