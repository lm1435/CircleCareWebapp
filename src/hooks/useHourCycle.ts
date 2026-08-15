import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { resolveHourCycle, type HourCycle } from '@/utils/hourCycle';

// The viewer's 12h/24h clock, for DISPLAY only (see utils/hourCycle.ts).
//
// Reuses the SHARED queryKeys.currentUser query (the same one App.tsx's
// LanguageSync and ProfilePage read) — no extra request, and it re-resolves for
// free after a profile change invalidates that key. Do NOT mint a new key.
//
// The web can never read the OS 12/24-hour toggle itself; `uses_24h_clock` is
// synced to the server by the user's PHONE. Until it is, resolveHourCycle falls
// back to the browser locale and then to the timezone heuristic, so this hook
// always returns a usable value — including while the query is still loading or
// when the user is signed out.
export function useHourCycle(): HourCycle {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: user } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  });

  return resolveHourCycle({
    uses_24h_clock: user?.uses_24h_clock,
    timezone: user?.timezone,
  });
}
