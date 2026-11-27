import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import { useEffect, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircle } from '@/hooks/useCircle';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  IconTile,
  SectionHeader,
  Sheet,
  SheetRowPressable,
  Skeleton,
} from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { MemberRow } from '@/components/members/MemberRow';
import { useCareTeamManager } from '@/components/members/useCareTeamManager';

function MemberRowSkeleton(): ReactElement {
  return (
    <li className="flex items-center gap-3 border-t border-line-2 px-[18px] py-3.5 first:border-t-0">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-2 h-3 w-24" />
      </div>
    </li>
  );
}

/**
 * The Care team page (1.4.4; mobile `CareTeamScreen`). It was "Members"; Today's own members list,
 * Manage rows and Leave circle moved here, so every care-team action lives on this ONE page:
 *
 *   eyebrow = the recipient's name, title "Care team" ("My care team" for the recipient),
 *   member-count pill; members; pending + declined invites; Invite member; Manage
 *   (Edit circle, Delete circle) for the owner; Leave circle for everyone else.
 *
 * Members page (plan Tasks 35-36 + Stage 5 Task 5.4; mobile-parity Task 22).
 *
 * Read-only roster for everyone, plus management for those allowed it:
 *   - owner AND managers (`canManageMembers`): invite, the pending-invite list
 *     (copy link / resend / cancel), remove members (a manager: plain members
 *     only — never the owner or another manager);
 *   - owner only: medication reminders, Make / Remove manager (when the server
 *     grants `assign_manager`).
 * Non-owners (managers included) additionally see "Leave circle" (the owner
 * cannot leave — backend blocks it).
 *
 * Gating reads the server's `viewer_permissions` (owner_id fallback on an older
 * backend) through `lib/premiumOwnership.ts`. The backend enforces each action
 * independently — UI gating is cosmetic.
 */
export default function MembersPage(): ReactElement {
  const { t } = useTranslation(['members', 'overview']);
  const navigate = useNavigate();
  const { circleId = '' } = useParams<{ circleId: string }>();

  const { circle, members, isLoading, isError, refetch, canEdit } = useCircle(circleId);
  // Every action and confirm lives in `useCareTeamManager`, shared with the care team on Today.
  const team = useCareTeamManager(circleId);
  const base = `/circles/${circleId}`;
  const title = team.isCurrentUserRecipient
    ? t('overview:today.careTeam.titleMine')
    : t('overview:today.careTeam.title');
  const { isOwner, canManageMembers, pendingInvites, declinedInvites, liveInvites, careTeamEmpty } =
    team;

  // The assistant's "Invite someone" button (1.4.2, aiReplyActions `open_invite`) lands here with
  // `state.openInvite`: open the same invite dialog the header button opens, for a viewer who may
  // invite. The flag is consumed (history entry replaced), so Back / refresh never re-open it. A
  // viewer who may not invite just sees the roster (the button is not offered to them anyway).
  const location = useLocation();
  const openInviteRequested =
    (location.state as { openInvite?: unknown } | null)?.openInvite === true;
  const { openInvite } = team;
  useEffect(() => {
    if (!openInviteRequested || circle == null) return;
    if (canManageMembers && circle.can_edit !== false) openInvite();
    navigate(location.pathname, { replace: true, state: null });
  }, [openInviteRequested, circle, canManageMembers, navigate, location.pathname, openInvite]);
  let content: ReactElement;
  if (isLoading) {
    content = (
      <Sheet
        as="ul"
        padding="none"
        className="mx-5 overflow-hidden"
        aria-busy="true"
        aria-label={t('common:loading')}
      >
        <MemberRowSkeleton />
        <MemberRowSkeleton />
        <MemberRowSkeleton />
      </Sheet>
    );
  } else if (isError) {
    content = (
      <Card role="alert" className="mx-5 text-center">
        <p className="m-0 font-medium text-ink">{t('list.errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-2">{t('list.errorBody')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (members.length === 0) {
    content = (
      <EmptyState tone="moss" icon="people-outline" title={t('list.empty')} className="mx-5" />
    );
  } else {
    // No `overflow-hidden` on this Sheet: the rows carry no background of
    // their own, so nothing bleeds past its radius — and clipping here would
    // cut off each row's `MoreMenu`, which renders inline inside the row.
    content = (
      <Sheet as="ul" padding="none" className="mx-5">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} actions={team.memberActions(member)} />
        ))}
      </Sheet>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl pb-8">
      <PageMasthead
        section={circle?.recipient_name ?? ''}
        tone="moss"
        title={title}
        subtitle={
          isOwner
            ? t('manage.subheading')
            : canManageMembers
              ? t('manage.subheadingManager')
              : t('list.subheadingReadOnly')
        }
        backTo={base}
        rightAction={
          canManageMembers
            ? {
                name: 'share-outline',
                label: t('invite.cta'),
                onClick: team.openInvite,
                offlineKind: 'change',
                // A read-only (lapsed) circle: shown, never usable (mobile: "View only access").
                ...(circle?.can_edit !== false ? {} : { disabled: true, title: t('overview:today.careTeam.viewOnly') }),
              }
            : undefined
        }
      >
        {!isLoading && !isError && circle != null ? (
          <div className="px-5 pb-4">
            {/* card-shell-ok: the member-count pill (mobile memberCountPill), a word-sized label. */}
            <span
              className="inline-flex items-center rounded-full border border-line-2 bg-bg-2 px-3 py-1 text-xs font-medium text-ink-2"
              data-testid="care-team-count"
            >
              {/* Mobile's rule exactly: the singular for one member, the plural otherwise. */}
              {members.length === 1
                ? t('overview:today.careTeam.countOne', { count: 1 })
                : t('overview:today.careTeam.countOther', { count: members.length })}
            </span>
          </div>
        ) : null}
      </PageMasthead>

      {/* Help only while the care team is still empty: nobody but you, nothing pending
          (owner 2026-11-08, mobile parity). */}
      {canManageMembers && careTeamEmpty ? (
        <div className="px-5">
          <HowDoesThisWork slug="invite-family" />
        </div>
      ) : null}

      {content}

      {/* Solo owner: a welcoming prompt to invite the first caregiver. Shown
          only when the owner is the lone member and there is no LIVE pending
          invite — an expired one has stopped being an invitation, so it no
          longer counts. Non-destructive, reuses the Invite trigger. */}
      {isOwner && circle?.can_edit !== false && members.length === 1 && liveInvites.length === 0 ? (
        <Card padding="lg" className="mx-5 mt-6 text-center">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('list.soloTitle')}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{t('list.soloBody')}</p>
          <Button className="mt-6" onClick={team.openInvite} offlineKind="change">
            {t('list.soloCta')}
          </Button>
        </Card>
      ) : null}

      {/* Pending invites (owner AND managers — `pending_invites` is served to
          both, `[]` to everyone else) with copy link + cancel + resend.
          Expired invites stay in this list (the backend returns them with
          `is_expired`), so the badge is the only thing telling them apart —
          and resend is the only way out other than cancel-and-retype. */}
      {canManageMembers && pendingInvites.length > 0 ? (
        <div className="mt-10">
          <SectionHeader title={t('manage.pendingHeading')} className="mx-5" />
          {/* No `overflow-hidden` — see the members list above. This Sheet is
              often ONE row tall, so clipping left the cancel/resend menu with
              nowhere to go: it flipped up and 64% of it went unpainted. */}
          <Sheet as="ul" padding="none" className="mx-5">
            {pendingInvites.map(team.renderPendingInvite)}
          </Sheet>
        </div>
      ) : null}

      {/* Declined invites (1.4.3): marked Declined, with Invite again + Remove.
          No Resend, no Copy link (a declined invite cannot be redeemed). */}
      {canManageMembers && declinedInvites.length > 0 ? (
        <div className="mt-10" data-testid="declined-invites-section">
          <SectionHeader title={t('manage.declinedHeading')} className="mx-5" />
          <Sheet as="ul" padding="none" className="mx-5">
            {declinedInvites.map(team.renderDeclinedInvite)}
          </Sheet>
        </div>
      ) : null}

      {/* Manage (owner): Edit circle (read-only circle: shown, never a link) and Delete circle,
          which opens the settings page's type-to-confirm (`#danger`): one destructive confirm. */}
      {circle != null && isOwner ? (
        <section aria-labelledby="care-team-manage-heading" data-testid="care-team-manage" className="mt-10">
          <SectionHeader
            id="care-team-manage-heading"
            title={t('overview:today.manage.title')}
            className="mx-5"
          />
          <Sheet padding="none" className="mx-5 overflow-hidden">
            {canEdit ? (
              <SheetRowPressable to={`${base}/settings`} className="min-h-[52px] gap-3 px-[18px]">
                <IconTile size={36} tone="moss" name="create-outline" />
                <span className="min-w-0 flex-1 text-md font-medium text-ink">
                  {t('overview:today.manage.editCircle')}
                </span>
                <Icon name="chevron-forward" size="inline" className="text-ink-3" />
              </SheetRowPressable>
            ) : (
              <div
                aria-disabled="true"
                data-testid="care-team-edit-circle-disabled"
                className="flex min-h-[52px] items-center gap-3 border-b border-line-2 px-[18px] opacity-50"
              >
                <IconTile size={36} tone="neutral" name="create-outline" />
                <span className="min-w-0 flex-1 text-md font-medium text-ink-2">
                  {t('overview:today.manage.editCircle')}
                </span>
              </div>
            )}
            <SheetRowPressable
              to={`${base}/settings#danger`}
              className="min-h-[52px] gap-3 px-[18px]"
              data-testid="care-team-delete-circle"
            >
              <IconTile size={36} tone="terracotta" name="trash-outline" />
              <span className="min-w-0 flex-1 text-md font-medium text-ink">
                {t('overview:today.manage.deleteCircle')}
              </span>
              <Icon name="chevron-forward" size="inline" className="text-ink-3" />
            </SheetRowPressable>
          </Sheet>
        </section>
      ) : null}

      {/* Non-owner: leave circle. */}
      {circle != null && !isOwner ? (
        <div className="mx-5 mt-10 border-t border-line-2 pt-6">
          <Button variant="ghost" onClick={team.openLeave}>
            {t('manage.leave')}
          </Button>
        </div>
      ) : null}

      {team.dialogs}
    </section>
  );
}
