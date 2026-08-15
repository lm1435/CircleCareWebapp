import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePendingInvites } from '@/hooks/useInvites';

/**
 * "You have N pending invitations" banner for the circle picker.
 *
 * PARITY: mobile's CircleListScreen has shown this banner all along
 * (renderInviteBanner). On web, /invites was reachable ONLY from the
 * no-circles empty state, so a member who already had a circle had no route to
 * an invitation at all. That gap was invisible while GET /invites/pending could
 * never return a row (it read the related circle + inviter through the RLS
 * client, which hides both from a not-yet-member invitee); with that fixed, the
 * missing entry point becomes user-visible.
 *
 * Renders nothing while loading, on error, or with no invites — it is an
 * additive nudge, never a blocker.
 */
export function PendingInvitesBanner(): ReactElement | null {
  const { t } = useTranslation('members');
  const { data: invites } = usePendingInvites();

  const count = invites?.length ?? 0;
  if (count === 0) return null;

  return (
    <Link
      to="/invites"
      className="mt-6 flex items-center gap-4 rounded-2xl border border-line bg-cream p-4 no-underline transition-colors hover:bg-bg-2"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss-soft text-moss-deep"
      >
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold text-ink">{t('pending.banner.count', { count })}</span>
        <span className="text-sm text-ink-2">
          {count === 1 ? t('pending.banner.review') : t('pending.banner.reviewPlural')}
        </span>
      </span>
    </Link>
  );
}
