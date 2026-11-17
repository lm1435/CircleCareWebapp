import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getAppConfig, type AppConfig } from '@/api/appConfig';
import { queryKeys } from '@/lib/queryKeys';

/** Public app config (mobile hooks/useAppConfig.ts: same key, same 30 min stale time). */
export function useAppConfig(): UseQueryResult<AppConfig> {
  return useQuery<AppConfig>({
    queryKey: queryKeys.appConfig,
    queryFn: getAppConfig,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}
