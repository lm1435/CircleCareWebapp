import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Icon,
  MoreMenu,
  SectionHeader,
  Sheet,
  Text,
  type MoreMenuEntry,
} from '@/components/ui';
import {
  useRemoveMember,
  useSetMedicationResponsible,
  useSetMemberRole,
} from '@/hooks/useCircleMembers';
import { memberRowActions, viewerCanManageMembers } from '@/lib/premiumOwnership';
import { isPendingInviteExpired } from '@/api/circleMembers';
import { Analytics } from '@/lib/analytics';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';
import type { GettingStartedStatus } from '@/components/circles/GettingStartedChecklist';
import { pickHomeNudge } from './homeNudge';
import { blockOfflineWrite, guardOfflineWrite } from '@/lib/offlineWrite';

// Spec §6.3.7 + §6.3.8 — port of mobile CircleDetailScreen's care-team Sheet
// (CircleDetailScreen.tsx:1375-1520) and `components/circle/SoloInviteCard.tsx`.

function displayName(member: CircleMember): string {
  const named = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  return named || member.email;
}

export interface SoloInviteCardProps {
  circleName: string;
  isSelfCare: boolean;
  to: string;
  /**
   * Observes the CTA press (the Link still navigates). Kept a plain callback
   * so this card stays presentational and the host owns which event it means.
   */
  onCtaClick?: () => void;
}

/**
 * The solo-owner nudge (spec §6.3.8). Deliberately typographic and centred,
 * with NO icon: mobile keeps it visually disjoint from the left-aligned,
 * icon-tiled rows it can share a screen with, so the two never read as a
 * stutter.
 *
 * It WAITS FOR the getting-started checklist: Home shows one nudge card at a
 * time (`pickHomeNudge`), so this appears only once the checklist is finished
 * or dismissed and the owner is still alone. It used to be independent of the
 * checklist (mobile's D2 note); the owner reversed that, because the two cards
 * asked for the same invite one above the other.
 */
export function SoloInviteCard({
  circleName,
  isSelfCare,
  to,
  onCtaClick,
}: SoloInviteCardProps): ReactElement {
  const { t } = useTranslation('overview');
  const body = isSelfCare ? t('solo.bodySelfCare') : t('solo.body', { name: circleName });

  return (
    <Card padding="lg" className="rounded-2xl text-center">
      <Text variant="h2" className="text-center">
        {t('solo.title')}
      </Text>
      <Text variant="caption" className="mt-2 text-center">
        {body}
      </Text>
      <Button as={Link} to={to} variant="primary" className="mt-5" onClick={onCtaClick}>
        {t('solo.cta')}
      </Button>
    </Card>
  );
}

export interface CareTeamProps {
  circleId: string;
  circle: CircleDetail | undefined;
  members: CircleMember[];
  /** The signed-in user's id — drives the "(You)" suffix and the action gate. */
  currentUserId: string | undefined;
  isOwner: boolean;
  /** The getting-started card's state — the solo invite card waits its turn. */
  checklistStatus: GettingStartedStatus;
}

/**
 * The care-team Sheet: one row per member with a role overlay on the avatar,
 * a member-count pill in the header, and — for the owner and managers — the
 * per-member action menu and an Invite button.
 *
 * ACTIONS NEVER TARGET THE OWNER, THE RECIPIENT OR YOURSELF, mirroring mobile's
 * `isTappable`; a manager only gets Remove, and only on plain members. The rule
 * is `memberRowActions` (shared with MembersPage). The backend enforces the
 * same rule; this only avoids offering an action that would be rejected.
 */
export function CareTeam({
  circleId,
  circle,
  members,
  currentUserId,
  isOwner,
  checklistStatus,
}: CareTeamProps): ReactElement {
  const { t } = useTranslation(['overview', 'members', 'common']);
  const removeMember = useRemoveMember(circleId);
  const setMedResponsible = useSetMedicationResponsible(circleId);
  const setMemberRole = useSetMemberRole(circleId);
  const [pendingRemoval, setPendingRemoval] = useState<CircleMember | null>(null);
  const [roleTarget, setRoleTarget] = useState<CircleMember | null>(null);
  const canManageMembers = viewerCanManageMembers(circle, currentUserId);

  const base = `/circles/${circleId}`;
  const isCurrentUserRecipient = members.some(
    (m) => m.id === currentUserId && m.is_care_recipient
  );

  // An EXPIRED invite is not an outstanding one — nobody can act on it, so it
  // must not silence the nudge. Only LIVE invites hide the solo card.
  const liveInvites = (circle?.pending_invites ?? []).filter((i) => !isPendingInviteExpired(i));
  const soloEligible = isOwner && members.length === 1 && liveInvites.length === 0;
  const showSolo = pickHomeNudge({ checklist: checklistStatus, soloEligible }) === 'soloInvite';

  const menuFor = (member: CircleMember): MoreMenuEntry[] => {
    const allowed = memberRowActions(circle, currentUserId, member);
    const items: MoreMenuEntry[] = [];
    if (allowed.medResponsible) {
      items.push({
        id: 'med-responsible',
        label: member.is_medication_responsible
          ? t('members:manage.clearMedResponsible')
          : t('members:manage.setMedResponsible'),
        icon: 'notifications-outline',
        onSelect: guardOfflineWrite(
          () => setMedResponsible.mutate(member.is_medication_responsible ? null : member.id),
          'change'
        ),
      });
    }
    if (allowed.managerRole) {
      items.push({
        id: 'toggle-manager',
        label:
          member.role === 'manager'
            ? t('members:manage.removeManager')
            : t('members:manage.makeManager'),
        icon: 'people-outline',
        onSelect: () => {
          if (blockOfflineWrite('change')) return;
          setRoleTarget(member);
        },
        disabled: setMemberRole.isPending,
      });
    }
    if (allowed.remove) {
      if (items.length > 0) items.push({ divider: true });
      items.push({
        id: 'remove',
        label: t('members:manage.remove'),
        icon: 'trash-outline',
        danger: true,
        onSelect: () => setPendingRemoval(member),
      });
    }
    return items;
  };

  const confirmRoleChange = (): void => {
    if (!roleTarget) return;
    const name = displayName(roleTarget);
    const role = roleTarget.role === 'manager' ? 'member' : 'manager';
    setMemberRole.mutate({ userId: roleTarget.id, role, name });
    setRoleTarget(null);
  };

  return (
    <section aria-labelledby="care-team-heading">
      <SectionHeader
        id="care-team-heading"
        title={isCurrentUserRecipient ? t('team.myTitle') : t('team.title')}
        tone="moss"
        action={
          <div className="flex items-center gap-2">
            {/* A count badge the size of a word, not a card: `Badge` carries
                neither the hairline nor the bg-2 fill this one needs.
                card-shell-ok: spec §6.3.7 specifies it literally (bg-2, 1px
                line-2, r-full, 12/500 ink-2). */}
            <span className="inline-flex items-center rounded-full border border-line-2 bg-bg-2 px-3 py-1 text-xs font-medium text-ink-2">
              {t('team.count', { count: members.length })}
            </span>
            {canManageMembers ? (
              <Button as={Link} to={`${base}/members`} variant="primary" size="sm">
                {t('team.invite')}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* No `overflow-hidden`: the rows have no background to clip to the
          radius, and it would cut off each row's inline `MoreMenu`. */}
      <Sheet padding="none">
        {members.map((member) => {
          const isSelf = member.id === currentUserId;
          const name = displayName(member);
          const role = member.is_care_recipient
            ? t('team.careRecipient')
            : member.first_name
              ? member.email
              : member.role === 'owner'
                ? t('team.circleAdmin')
                : member.role === 'manager'
                  ? t('members:roles.manager')
                  : t('team.familyMember');
          const items = menuFor(member);

          return (
            <div
              key={member.id}
              className="flex items-center gap-3 border-t border-line-2 px-[18px] py-3.5 first:border-t-0"
            >
              <span className="relative shrink-0">
                <Avatar
                  size="sm"
                  name={member.first_name || member.email}
                  colorKey={member.avatar_color}
                />
                {member.is_care_recipient ? (
                  <span
                    className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-coral ring-2 ring-cream"
                    data-testid={`recipient-dot-${member.id}`}
                  >
                    <Icon
                      name="heart-outline"
                      size={10}
                      className="text-cream"
                      label={t('team.recipientBadge')}
                    />
                  </span>
                ) : null}
                {member.is_medication_responsible ? (
                  <span
                    className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-moss ring-2 ring-cream"
                    data-testid={`med-manager-dot-${member.id}`}
                  >
                    <Icon
                      name="notifications-outline"
                      size={10}
                      className="text-cream"
                      label={t('team.medManagerBadge')}
                    />
                  </span>
                ) : null}
              </span>

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-md font-semibold text-ink">
                    {isSelf ? `${name} ${t('team.you')}` : name}
                  </span>
                  {/* Only a NAMED manager gets the pill: an unnamed one already
                      reads "Manager" on the line below. */}
                  {member.role === 'manager' && member.first_name ? (
                    <Badge variant="dusk" size="sm" className="shrink-0">
                      {t('members:roles.manager')}
                    </Badge>
                  ) : null}
                </span>
                <span className="truncate text-sm text-ink-2">{role}</span>
              </span>

              {items.length > 0 ? (
                <MoreMenu
                  items={items}
                  label={t('members:manage.removeMemberLabel', { name })}
                />
              ) : null}
            </div>
          );
        })}
      </Sheet>

      {showSolo ? (
        <div className="mt-4">
          <SoloInviteCard
            circleName={circle?.recipient_name ?? ''}
            isSelfCare={circle?.is_self_care === true}
            to={`${base}/members`}
            // The lone owner is the biggest retention risk on the whole
            // surface; this is the one press that tells us the nudge worked.
            onCtaClick={() => Analytics.soloInviteTapped()}
          />
        </div>
      ) : null}

      {pendingRemoval ? (
        <ConfirmDialog
          offlineKind="change"
          icon="person-outline"
          title={t('members:manage.removeConfirmTitle')}
          message={t('members:manage.removeConfirmBody', { name: displayName(pendingRemoval) })}
          confirmLabel={t('members:manage.remove')}
          cancelLabel={t('common:cancel')}
          destructive
          onConfirm={() => {
            removeMember.mutate({ userId: pendingRemoval.id });
            setPendingRemoval(null);
          }}
          onCancel={() => setPendingRemoval(null)}
        />
      ) : null}

      {roleTarget ? (
        <ConfirmDialog
          offlineKind="change"
          icon="people-outline"
          title={
            roleTarget.role === 'manager'
              ? t('members:manage.removeManagerConfirmTitle', { name: displayName(roleTarget) })
              : t('members:manage.makeManagerConfirmTitle', { name: displayName(roleTarget) })
          }
          message={
            roleTarget.role === 'manager'
              ? t('members:manage.removeManagerConfirmBody', { name: displayName(roleTarget) })
              : t('members:manage.makeManagerConfirmBody', { name: displayName(roleTarget) })
          }
          confirmLabel={
            roleTarget.role === 'manager'
              ? t('members:manage.removeManager')
              : t('members:manage.makeManager')
          }
          cancelLabel={t('common:cancel')}
          onConfirm={confirmRoleChange}
          onCancel={() => setRoleTarget(null)}
        />
      ) : null}
    </section>
  );
}

export default CareTeam;
