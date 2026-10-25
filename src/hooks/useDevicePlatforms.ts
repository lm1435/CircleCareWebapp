import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getDevicePlatforms, type DevicePlatform } from '@/api/pushTokens';
import { useAuthStore } from '@/store/authStore';

/**
 * Which mobile platforms this user has the CircleCare app on, from their
 * active push-token registrations. `[]` means web-only (or a backend that
 * predates the endpoint — the thrown 404 lands in `error` and callers treat
 * missing data as web-only), and web-only users are never asked for a store
 * rating. A day of staleness is fine: installing the app mid-web-session is
 * not a case the banner needs to react to.
 */
export function useDevicePlatforms(): UseQueryResult<DevicePlatform[]> {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['devicePlatforms', userId],
    queryFn: getDevicePlatforms,
    enabled: !!userId,
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
  });
}
