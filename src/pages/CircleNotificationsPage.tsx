import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isInboxEnabled } from '@/lib/notificationsInbox';
import { InboxPage } from '@/pages/NotificationsPage';

/**
 * `/circles/:circleId/notifications`: ONE circle's notifications (reached from the
 * circle's count on the circle list, or the bell inside the circle). Same page as
 * the all-circles inbox, scoped: that circle's rows only, its own query, and
 * "Mark all read" clears that circle only. Back goes to the circle.
 *
 * Flag off => redirect to the circle; nothing is rendered and no request is made.
 */
export default function CircleNotificationsPage(): ReactElement {
  const { circleId } = useParams<{ circleId: string }>();
  if (!circleId) return <Navigate to="/circles" replace />;
  if (!isInboxEnabled()) return <Navigate to={`/circles/${circleId}`} replace />;
  // Keyed by circle: switching circles never carries one circle's state to another.
  return <InboxPage key={circleId} circleId={circleId} />;
}
