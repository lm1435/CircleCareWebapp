import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, Icon, IconTile, Text } from '@/components/ui';
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
 *
 * `bg-coral-soft!` (the `!` important suffix, the same idiom `Eyebrow.tsx`
 * uses): `Card`'s `elevated` variant bakes in `bg-cream`, and Tailwind's
 * compiled utility order puts `bg-coral-soft` BEFORE `bg-cream` (color tokens
 * are ordered by name — "coral" < "cream"), so a plain `className="bg-coral-soft"`
 * would silently lose the cascade and the banner would render cream, not
 * coral. The `!` forces the override deterministically.
 */
export function PendingInvitesBanner(): ReactElement | null {
  const { t } = useTranslation('members');
  const { data: invites } = usePendingInvites();

  const count = invites?.length ?? 0;
  if (count === 0) return null;

  return (
    <Link
      to="/invites"
      className="mt-6 block rounded-xl transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-deep"
    >
      <Card variant="elevated" padding="sm" className="flex items-center gap-4 bg-coral-soft!">
        <IconTile tone="coral" name="mail-outline" size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-md font-semibold text-coral-deep">
            {t('pending.banner.count', { count })}
          </span>
          <Text variant="caption" className="text-coral-deep!">
            {count === 1 ? t('pending.banner.review') : t('pending.banner.reviewPlural')}
          </Text>
        </span>
        <Icon name="chevron-forward" size="inline" className="shrink-0 text-coral" />
      </Card>
    </Link>
  );
}
