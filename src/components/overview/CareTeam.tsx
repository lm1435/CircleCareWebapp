import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
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
import { useRemoveMember, useSetMedicationResponsible } from '@/hooks/useCircleMembers';
import { isPendingInviteExpired } from '@/api/circleMembers';
import { Analytics } from '@/lib/analytics';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';

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
 * It is INDEPENDENT of the getting-started checklist on purpose (mobile's D2
 * note): a lone owner is the single biggest retention risk, so the nudge stays
 * even when the checklist is also on screen.
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
}

/**
 * The care-team Sheet: one row per member with a role overlay on the avatar,
 * a member-count pill in the header, and — for owners — the per-member action
 * menu and an Invite button.
 *
 * ACTIONS ARE OWNER-ONLY AND NEVER TARGET THE RECIPIENT OR YOURSELF, mirroring
 * mobile's `isTappable`. The backend enforces the same rule; this only avoids
 * offering an action that would be rejected.
 */
export function CareTeam({
  circleId,
  circle,
  members,
  currentUserId,
  isOwner,
}: CareTeamProps): ReactElement {
  const { t } = useTranslation(['overview', 'members', 'common']);
  const removeMember = useRemoveMember(circleId);
  const setMedResponsible = useSetMedicationResponsible(circleId);
  const [pendingRemoval, setPendingRemoval] = useState<CircleMember | null>(null);

  const base = `/circles/${circleId}`;
  const isCurrentUserRecipient = members.some(
    (m) => m.id === currentUserId && m.is_care_recipient
  );

  // An EXPIRED invite is not an outstanding one — nobody can act on it, so it
  // must not silence the nudge. Only LIVE invites hide the solo card.
  const liveInvites = (circle?.pending_invites ?? []).filter((i) => !isPendingInviteExpired(i));
  const showSolo = isOwner && members.length === 1 && liveInvites.length === 0;

  const menuFor = (member: CircleMember): MoreMenuEntry[] => [
    {
      id: 'med-responsible',
      label: member.is_medication_responsible
        ? t('members:manage.clearMedResponsible')
        : t('members:manage.setMedResponsible'),
      icon: 'notifications-outline',
      onSelect: () =>
        setMedResponsible.mutate(member.is_medication_responsible ? null : member.id),
    },
    { divider: true },
    {
      id: 'remove',
      label: t('members:manage.remove'),
      icon: 'trash-outline',
      danger: true,
      onSelect: () => setPendingRemoval(member),
    },
  ];

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
            {isOwner ? (
              <Button as={Link} to={`${base}/members`} variant="secondary" size="sm">
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
                : t('team.familyMember');
          const canAct = isOwner && !member.is_care_recipient && !isSelf;

          return (
            <div
              key={member.id}
              className="flex items-center gap-3 border-t border-line-2 px-[18px] py-3.5 first:border-t-0"
            >
              <span className="relative shrink-0">
                <Avatar size="sm" name={member.first_name || member.email} />
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
                <span className="truncate text-md font-semibold text-ink">
                  {isSelf ? `${name} ${t('team.you')}` : name}
                </span>
                <span className="truncate text-sm text-ink-2">{role}</span>
              </span>

              {canAct ? (
                <MoreMenu
                  items={menuFor(member)}
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
    </section>
  );
}

export default CareTeam;
