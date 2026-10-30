import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { useCircles } from '@/hooks/useCircles';
import { useInboxUnreadSummary } from '@/hooks/useInbox';
import {
  circleInboxPath,
  isInboxEnabled,
  type InboxLocationState,
} from '@/lib/notificationsInbox';

/** The count pill caps here so it never outgrows the header. */
const MAX_PILL = 99;

export interface NotificationBellProps {
  /**
   * The circle whose pages this bell sits on (the in-circle Header passes it).
   * With 2+ circles the bell is SCOPED: that circle's count, linking to that
   * circle's inbox, so it always matches the count on the circle's card. A user
   * with exactly one circle keeps the all-circles bell (no visible change).
   * Omitted (outside a circle): the all-circles bell, as before.
   */
  circleId?: string;
}

interface BellLinkProps {
  circleId?: string;
  /** The user's circles (in-circle only); undefined while loading. */
  circles?: readonly unknown[];
}

function BellLink({ circleId, circles }: BellLinkProps): ReactElement {
  const { t } = useTranslation('common');
  const { data } = useInboxUnreadSummary();
  const { pathname } = useLocation();

  const inCircle = Boolean(circleId);
  // Until the circle list is known we cannot tell a one-circle user from a
  // multi-circle one, so the count waits rather than flicking from total to scoped.
  const circlesKnown = !inCircle || circles !== undefined;
  const scoped = inCircle && (circles?.length ?? 0) >= 2;

  let raw = 0;
  if (data && circlesKnown) {
    raw =
      scoped && circleId && data.by_circle
        ? (data.by_circle[circleId] ?? 0)
        : // Old backend (no by_circle): a scoped bell shows the total.
          data.unread_count;
  }
  const count = raw > 0 ? raw : 0;

  const to = scoped && circleId ? circleInboxPath(circleId) : '/notifications';
  const state: InboxLocationState = { inboxSource: inCircle ? 'today_bell' : 'header_bell' };

  return (
    <Link
      to={to}
      state={state}
      // On the inbox itself the bell is the current page (read as "current page" by SRs).
      aria-current={pathname === to ? 'page' : undefined}
      aria-label={count > 0 ? t('inbox.bellUnread', { count }) : t('inbox.bell')}
      data-testid="notification-bell"
      data-scoped={scoped ? 'true' : 'false'}
      // Plain bell, no tile: a 44px target with a quiet hover. The pill is
      // decorative (aria-hidden): the link's label already carries the count.
      className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-bg-2"
    >
      <Icon name="notifications-outline" size="chrome" />
      {count > 0 && (
        <span
          aria-hidden="true"
          data-testid="notification-bell-count"
          className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-bold leading-none text-cream"
        >
          {count > MAX_PILL ? `${MAX_PILL}+` : count}
        </span>
      )}
    </Link>
  );
}

/**
 * Header bell with the unread count. Flag off => renders nothing and makes no
 * request (the hooks live in BellLink, which never mounts).
 */
export function NotificationBell({ circleId }: NotificationBellProps = {}): ReactElement | null {
  if (!isInboxEnabled()) return null;
  return circleId ? <InCircleBell circleId={circleId} /> : <BellLink />;
}

/** Inside a circle the bell needs the circle count (the Header's switcher already holds this query). */
function InCircleBell({ circleId }: { circleId: string }): ReactElement {
  const { data: circles } = useCircles();
  return <BellLink circleId={circleId} circles={circles} />;
}
