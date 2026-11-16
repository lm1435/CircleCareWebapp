import { useEffect } from 'react';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { browserRegion } from '@/lib/regionResolver';
import { runRegionUnitsAutoSet } from '@/lib/regionUnitsAutoSet';

/**
 * Runs the once-per-account region units decision (lib/regionUnitsAutoSet) for the signed-in user.
 * Mounted next to DeviceTimezoneSync. On a switch, the unit preferences are refetched so every
 * vitals surface reads the new units at once. Twin of mobile's `useRegionUnitsAutoSet`.
 */
export function RegionUnitsAutoSet(): null {
  const userId = useAuthStore((s) => (s.isAuthenticated ? (s.user?.id ?? null) : null));

  useEffect(() => {
    if (!userId) return;
    void runRegionUnitsAutoSet({ userId, region: browserRegion() }).then((outcome) => {
      if (outcome === 'applied') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences });
      }
    });
  }, [userId]);

  return null;
}
