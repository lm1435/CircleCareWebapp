import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { CircleAccessLost } from '@/components/circles/CircleAccessLost';
import { isSafeRouteId } from '@/lib/routeIds';

/**
 * Route boundary for `/circles/:circleId/*`. A malformed id (see lib/routeIds.ts:
 * a decoded `..%2F` path-traversal payload, or anything that is not an id) never
 * reaches AppLayout or any page, so no request is ever built from it; the user
 * gets the existing "Circle not found" state instead.
 */
export function CircleRoute(): ReactElement {
  const { circleId } = useParams<{ circleId: string }>();
  if (!isSafeRouteId(circleId)) {
    return (
      <main id="main" tabIndex={-1} className="min-h-screen bg-bg">
        <CircleAccessLost reason="NOT_FOUND" />
      </main>
    );
  }
  return <AppLayout />;
}
