// Single source of truth for the routes the crawl visits. Mirrors src/router.tsx.
// When a route is added there, add it here too (the crawl is only as complete as
// this list).

/** Public routes — reachable without auth. */
export const PUBLIC_ROUTES: string[] = [
  '/login',
  '/signup',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  // '/auth/callback' is an OAuth redirect handler (expects provider params) and
  // '/invite/:code' needs a real code — both are exercised in flow specs, not
  // the bare crawl.
];

/** Authenticated routes that don't need a circle context. */
export const AUTH_ROUTES: string[] = ['/circles', '/invites', '/profile', '/help'];

/**
 * Circle-scoped routes (need a real :circleId). Returned as a builder so the
 * crawl can fill in the demo account's first circle id at runtime.
 */
export function circleRoutes(circleId: string): string[] {
  return [
    `/circles/${circleId}/calendar`,
    `/circles/${circleId}/tasks`,
    `/circles/${circleId}/activity`,
    `/circles/${circleId}/emergency`,
    `/circles/${circleId}/documents`,
    `/circles/${circleId}/vitals`,
    `/circles/${circleId}/members`,
    `/circles/${circleId}/settings`,
  ];
}
