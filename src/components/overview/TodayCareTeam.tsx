import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Eyebrow,
  Icon,
  IconTile,
  SectionHeader,
  Sheet,
  SheetRowPressable,
} from '@/components/ui';
import { MemberRow } from '@/components/members/MemberRow';
import { useCareTeamManager } from '@/components/members/useCareTeamManager';
import { useCircle } from '@/hooks/useCircle';

export interface TodayCareTeamProps {
  circleId: string;
}

/**
 * The care team and the circle's Manage rows at the foot of Today, as mobile's
 * CircleDetailScreen shows them (1.4.3, owner: "web matches mobile"):
 *
 *   Care team (My care team for the recipient) · N members
 *     every member (owner / managers get the member menu: med reminders, manager, remove)
 *     Pending invitations, Declined invites (owner + managers only, as the server sends them)
 *     Invite member (owner + managers; "View only access", disabled, when the circle is read-only)
 *   Manage (owner): Edit circle (disabled when read-only), Delete circle
 *   Leave circle (everyone but the owner)
 *
 * Every action is the Members page's own (`useCareTeamManager`), so the two surfaces can never
 * offer different things. Delete opens the settings page's type-to-confirm (`#danger`): one
 * destructive confirmation, not two. The Members and Settings pages keep their routes.
 */
export function TodayCareTeam({ circleId }: TodayCareTeamProps): ReactElement | null {
  const { t } = useTranslation(['overview', 'members']);
  const { circle, members, canEdit } = useCircle(circleId);
  const team = useCareTeamManager(circleId);
  if (!circle) return null;

  const base = `/circles/${circleId}`;
  const title = team.isCurrentUserRecipient
    ? t('today.careTeam.titleMine')
    : t('today.careTeam.title');

  return (
    <>
      <section aria-labelledby="today-care-team-heading" data-testid="today-care-team">
        <SectionHeader
          id="today-care-team-heading"
          title={title}
          action={
            // card-shell-ok: the member-count pill (mobile memberCountPill), a word-sized label.
            <span
              className="inline-flex items-center rounded-full border border-line-2 bg-bg-2 px-3 py-1 text-sm font-medium text-ink-2"
              data-testid="today-care-team-count"
            >
              {/* Mobile's rule exactly: the singular for one member, the plural otherwise. */}
              {members.length === 1
                ? t('today.careTeam.countOne', { count: 1 })
                : t('today.careTeam.countOther', { count: members.length })}
            </span>
          }
        />
        {/* No `overflow-hidden`: it would clip each row's inline MoreMenu. */}
        <Sheet padding="none">
          <ul className="m-0 list-none p-0" aria-label={title}>
            {members.map((member) => (
              <MemberRow key={member.id} member={member} actions={team.memberActions(member)} />
            ))}
          </ul>

          {team.canManageMembers && team.pendingInvites.length > 0 ? (
            <div className="border-t border-line-2" data-testid="today-pending-invites">
              <Eyebrow as="h3" className="m-0 px-[18px] pt-3.5">
                {t('today.careTeam.pending')}
              </Eyebrow>
              <ul className="m-0 list-none p-0">{team.pendingInvites.map(team.renderPendingInvite)}</ul>
            </div>
          ) : null}

          {team.canManageMembers && team.declinedInvites.length > 0 ? (
            <div className="border-t border-line-2" data-testid="declined-invites-section">
              <Eyebrow as="h3" className="m-0 px-[18px] pt-3.5">
                {t('today.careTeam.declined')}
              </Eyebrow>
              <ul className="m-0 list-none p-0">
                {team.declinedInvites.map(team.renderDeclinedInvite)}
              </ul>
            </div>
          ) : null}

          {team.canManageMembers ? (
            <div className="border-t border-line-2 px-[18px] py-3.5">
              {canEdit ? (
                <Button
                  variant="outline"
                  fullWidth
                  leftIcon={<Icon name="person-add-outline" size="row" />}
                  offlineKind="change"
                  onClick={team.openInvite}
                  data-testid="today-invite-member"
                >
                  {t('today.careTeam.invite')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  fullWidth
                  disabled
                  leftIcon={<Icon name="lock-closed-outline" size="row" />}
                  data-testid="today-invite-member-view-only"
                >
                  {t('today.careTeam.viewOnly')}
                </Button>
              )}
            </div>
          ) : null}
        </Sheet>
      </section>

      {team.isOwner ? (
        <section aria-labelledby="today-manage-heading" data-testid="today-manage" className="mt-6">
          <SectionHeader id="today-manage-heading" title={t('today.manage.title')} />
          <Sheet padding="none" className="overflow-hidden">
            {canEdit ? (
              <SheetRowPressable to={`${base}/settings`} className="min-h-[52px] gap-3 px-[18px]">
                <IconTile size={36} tone="moss" name="create-outline" />
                <span className="min-w-0 flex-1 text-md font-medium text-ink">
                  {t('today.manage.editCircle')}
                </span>
                <Icon name="chevron-forward" size="inline" className="text-ink-3" />
              </SheetRowPressable>
            ) : (
              // Read-only circle: shown, never a link (mobile disables the row).
              <div
                aria-disabled="true"
                data-testid="today-edit-circle-disabled"
                className="flex min-h-[52px] items-center gap-3 border-b border-line-2 px-[18px] opacity-50"
              >
                <IconTile size={36} tone="neutral" name="create-outline" />
                <span className="min-w-0 flex-1 text-md font-medium text-ink-2">
                  {t('today.manage.editCircle')}
                </span>
              </div>
            )}
            <SheetRowPressable
              to={`${base}/settings#danger`}
              className="min-h-[52px] gap-3 px-[18px]"
              data-testid="today-delete-circle"
            >
              <IconTile size={36} tone="terracotta" name="trash-outline" />
              <span className="min-w-0 flex-1 text-md font-medium text-ink">
                {t('today.manage.deleteCircle')}
              </span>
              <Icon name="chevron-forward" size="inline" className="text-ink-3" />
            </SheetRowPressable>
          </Sheet>
        </section>
      ) : (
        <div className="mt-6" data-testid="today-leave">
          <Sheet padding="none" className="overflow-hidden">
            <SheetRowPressable onClick={team.openLeave} className="min-h-[52px] gap-3 px-[18px]">
              <IconTile size={36} tone="terracotta" name="log-out-outline" />
              <span className="min-w-0 flex-1 text-left text-md font-medium text-ink">
                {t('members:manage.leave')}
              </span>
              <Icon name="chevron-forward" size="inline" className="text-ink-3" />
            </SheetRowPressable>
          </Sheet>
        </div>
      )}

      {team.dialogs}
    </>
  );
}
