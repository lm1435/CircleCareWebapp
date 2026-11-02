import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUser } from '@/api/users';
import { useAuthStore } from '@/store/authStore';
import { syncDeviceTimezone } from '@/utils/deviceTimezoneSync';
import { getDeviceTimezone } from '@/utils/timezone';

/**
 * The profile time zone follows the browser's: on session start, write the
 * device zone when it differs from the stored one (unless circles depend on the
 * stored zone, see utils/deviceTimezoneSync.ts). Reuses the shared `currentUser`
 * query (no extra request) and runs once per (user, stored zone, device zone).
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

  useEffect(() => {
    if (!userId) return;
    const device = getDeviceTimezone();
    const key = `${userId}|${stored ?? ''}|${device}`;
    if (ran.current === key) return;
    ran.current = key;
    void syncDeviceTimezone(stored, device).then((outcome) => {
      if (outcome === 'written') {
        // Everything on screen, not only the user: a circle with no care-recipient account runs on its
        // OWNER's zone, so this write moved the frame of every such circle the user owns. A cached
        // circle detail (`care_recipient_timezone`) would keep date-math in the old zone while the server
        // answers in the new one (a Day view asked for the old zone's day got the new zone's doses).
        void queryClient.invalidateQueries();
      }
    });
  }, [userId, stored]);

  return null;
}

