import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack, Icon, Sheet, SheetRowPressable, Text } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { summarizeCareTeam } from '@/lib/careTeamSummary';
import { viewerCanManageMembers } from '@/lib/premiumOwnership';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';

export interface CareTeamRowProps {
  circleId: string;
}

/**
 * ONE row on Today, under Quick access: the care team in a line. The members list, the invites,
 * Manage and Leave circle live on the Care team page (`/circles/:id/members`); this row opens it.
 *
 *   Care team (My care team for the recipient)
 *   You, Margaret and Lisa · 2 pending      [stacked avatars, max 4, then +N]
 *
 * " · N pending" shows only for people who can manage members (the server sends them the
 * pending list); everyone else sees the names alone. Mirrors mobile's Today row (1.4.4).
 */
export function CareTeamRow({ circleId }: CareTeamRowProps): ReactElement | null {
  const { t } = useTranslation('overview');
  const { circle, members } = useCircle(circleId);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const summary = useMemo(
    () =>
      summarizeCareTeam(members, currentUserId, {
        you: t('today.careTeamRow.you'),
        and: (names, last) => t('today.careTeamRow.namesAnd', { names, last }),
        more: (names, count) => t('today.careTeamRow.namesMore', { names, count }),
      }),
    [members, currentUserId, t]
  );

  if (!circle || members.length === 0) return null;

  const isRecipient = members.some((m) => m.id === currentUserId && m.is_care_recipient);
  const title = isRecipient ? t('today.careTeam.titleMine') : t('today.careTeam.title');
  const canManage = viewerCanManageMembers(circle, currentUserId);
  const pendingCount = canManage ? (circle.pending_invites?.length ?? 0) : 0;

  return (
    <section aria-labelledby="today-care-team-row-heading" data-testid="today-care-team-row">
      <Sheet padding="none" className="overflow-hidden">
        <SheetRowPressable
          to={`/circles/${circleId}/members`}
          onClick={() => Analytics.careTeamOpened('today_row')}
          className="min-h-[64px] gap-3 px-[18px] py-3"
          data-testid="today-care-team-link"
        >
          <span className="min-w-0 flex-1">
            <Text variant="h3" as="span" id="today-care-team-row-heading" className="block text-lg xl:text-base">
              {title}
            </Text>
            <span
              className="mt-0.5 block break-words text-sm text-ink-2"
              data-testid="today-care-team-names"
            >
              {summary.namesLine}
              {pendingCount > 0 ? (
                <span data-testid="today-care-team-pending">
                  {` · ${t('today.careTeamRow.pending', { count: pendingCount })}`}
                </span>
              ) : null}
            </span>
          </span>
          <AvatarStack
            people={summary.avatars.map((a) => ({ id: a.id, name: a.name, colorKey: a.avatarColor }))}
            more={summary.extraAvatars}
            testId="today-care-team-avatars"
            moreTestId="today-care-team-extra"
          />
          <Icon name="chevron-forward" size="inline" className="shrink-0 text-ink-3" />
        </SheetRowPressable>
      </Sheet>
    </section>
  );
}

export default CareTeamRow;
