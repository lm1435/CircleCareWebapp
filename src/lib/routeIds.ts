/**
 * SECURITY (web audit 2026-10-01; twin of mobile `navigation/linkingConfig.ts`
 * SAFE_CIRCLE_ID): React Router DECODES `%2F` inside a path param, so
 * `/circles/..%2F..%2Fx/notes` hands the app circleId `../../x`. Every API
 * module interpolates that id raw into `/circles/${circleId}/...`, and the
 * browser resolves the dot segments, so a crafted link sent the user's Bearer
 * token to a backend path of the link author's choosing (client-side path
 * traversal). Real ids are UUIDs; anything outside this alphabet is refused at
 * the route boundary.
 */
export const SAFE_ROUTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeRouteId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ROUTE_ID.test(id);
}

/** Dot segments in any spelling the WHATWG URL parser resolves (`..`, `.%2e`, `%2E%2E`, ...). */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * True when a request path (query/hash ignored) contains a segment the URL
 * parser would resolve as `.` or `..`, or a backslash (treated as `/` in http
 * URLs). Defence in depth for ids that never pass through the route guard.
 */
export function hasTraversalSegment(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/, 1)[0];
  if (path.includes('\\')) return true;
  return path.split('/').some((segment) => DOT_SEGMENT.test(segment));
}
