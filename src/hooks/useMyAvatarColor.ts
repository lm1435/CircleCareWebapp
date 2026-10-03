import { useContext } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/users';
import { queryClient as fallbackClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';

/**
 * The signed-in member's chosen avatar colour (`users.avatar_color`), read from
 * the shared `currentUser` query (same row LanguageSync and Profile use: one
 * request, and Profile's optimistic update repaints every avatar).
 *
 * It is used by the app header, which also renders in trees with no
 * `QueryClientProvider`. A bare `useQuery` would throw there, so with no
 * provider this stays disabled against the singleton client and returns
 * undefined (the avatar keeps its name-derived gradient).
 */
export function useMyAvatarColor(): string | null | undefined {
  const providedClient = useContext(QueryClientContext);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data } = useQuery(
    {
      queryKey: queryKeys.currentUser,
      queryFn: getCurrentUser,
      enabled: Boolean(providedClient) && isAuthenticated,
    },
    providedClient ?? fallbackClient
  );
  return data?.avatar_color;
}
