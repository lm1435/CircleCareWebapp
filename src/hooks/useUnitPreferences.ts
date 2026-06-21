import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getUnitPreferences, type UnitPreferences } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';

// Read hook for the user's display unit preferences (Plan Task 6.4 support).
//
// PORT of mobile/src/hooks/useUnitPreferences.ts. The vitals form reads this to
// render canonical stored values in the user's preferred display unit and to
// drive the per-type display-unit validation ranges. Uses the SHARED
// queryKeys.unitPreferences key (the units mutation in useProfile seeds/
// invalidates the same key — do NOT mint a new key here).
//
// Units are user-scoped (not circle-scoped) and rarely change, so a long
// staleTime is appropriate; callers fall back to DEFAULT_UNIT_PREFERENCES while
// loading or on error.
export function useUnitPreferences(): UseQueryResult<UnitPreferences> {
  return useQuery({
    queryKey: queryKeys.unitPreferences,
    queryFn: getUnitPreferences,
    staleTime: 1000 * 60 * 30,
  });
}
