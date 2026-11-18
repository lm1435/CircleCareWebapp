import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircle } from '@/hooks/useCircle';
import {
  useRemoveMember,
  useLeaveCircle,
  useSetMedicationResponsible,
  useSetMemberRole,
} from '@/hooks/useCircleMembers';
import { useCancelInvite, useCreateInvite, useResendInvite } from '@/hooks/useInvites';
import { formatInviteExpiryDate } from '@/lib/inviteExpiry';
import {
  Badge,
  Button,
  ConfirmDialog,
  IconTile,
  MoreMenu,
  SheetRow,
  useToast,
  type MoreMenuEntry,
} from '@/components/ui';
import { InviteMemberModal } from '@/components/members/InviteMemberModal';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import { getInviteExpiryState, isPendingInviteExpired } from '@/api/circleMembers';
import type { CircleMember, DeclinedCircleInvite, PendingCircleInvite } from '@/api/circleMembers';
import { blockOfflineWrite } from '@/lib/offlineWrite';
import {
  getCircleOwnerName,
  memberRowActions,
  viewerCanManageMembers,
  viewerCanSuggestManager,
  viewerOwnsCircle,
} from '@/lib/premiumOwnership';

/** `circle.declined_invites` is ABSENT when there are none (1.4.3). Module-level: a stable ref. */
const EMPTY_DECLINED: DeclinedCircleInvite[] = [];
const EMPTY_PENDING: PendingCircleInvite[] = [];

export function memberDisplayName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

export interface CareTeamManager {
  isOwner: boolean;
  canManageMembers: boolean;
  isCurrentUserRecipient: boolean;
  pendingInvites: PendingCircleInvite[];
  declinedInvites: DeclinedCircleInvite[];
  /** Live (non-lapsed) invites only: an expired invite is not "someone you invited". */
  liveInvites: PendingCircleInvite[];
  /** No caregiver besides the viewer and no invite out. Unknown (not loaded) reads as not empty. */
  careTeamEmpty: boolean;
  /** The member's action menu (med reminders, manager role, remove), or undefined when none apply. */
  memberActions: (member: CircleMember) => ReactNode | undefined;
  /** One pending-invite row (copy link, resend when expired, cancel). */
  renderPendingInvite: (invite: PendingCircleInvite) => ReactElement;
  /** One declined-invite row (Invite again, Remove). */
  renderDeclinedInvite: (invite: DeclinedCircleInvite) => ReactElement;
  openInvite: () => void;
  openLeave: () => void;
  /** The invite dialog and every confirm dialog: render once, anywhere in the surface. */
  dialogs: ReactElement;
}

/**
 * Everything the care team can DO, shared by the Members page and the care team on Today
 * (mobile parity: CircleDetailScreen shows the care team, its pending / declined invites and
 * Leave circle on Today; the web keeps the Members page too). One implementation of each action
 * and each confirm, so the two surfaces can never offer different things.
 *
 * Gating reads the server's `viewer_permissions` (owner_id fallback on an older backend) through
 * `lib/premiumOwnership.ts`. The backend enforces each action independently: UI gating is cosmetic.
 */
export function useCareTeamManager(circleId: string): CareTeamManager {
  const { t, i18n } = useTranslation('members');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { circle, members } = useCircle(circleId);
  const isOwner = viewerOwnsCircle(circle, currentUserId);
  const canManageMembers = viewerCanManageMembers(circle, currentUserId);
  const isCurrentUserRecipient = members.some((m) => m.id === currentUserId && m.is_care_recipient);
  const pendingInvites: PendingCircleInvite[] = circle?.pending_invites ?? EMPTY_PENDING;
  // 1.4.3: owner + current managers only (the server sends the key to nobody
  // else; absent = none). Never counted as a seat or as "someone invited".
  const declinedInvites: DeclinedCircleInvite[] = circle?.declined_invites ?? EMPTY_DECLINED;
  const liveInvites = pendingInvites.filter((invite) => !isPendingInviteExpired(invite));
  const careTeamEmpty =
    !!circle && members.filter((m) => !m.is_care_recipient).length <= 1 && pendingInvites.length === 0;

  const removeMember = useRemoveMember(circleId);
  const leaveCircle = useLeaveCircle(circleId);
  const setMedResponsible = useSetMedicationResponsible(circleId);
  const cancelInvite = useCancelInvite(circleId);
  const resendInvite = useResendInvite(circleId);
  const createInvite = useCreateInvite(circleId);
  const setMemberRole = useSetMemberRole(circleId);
  // Declined rows: which one is mid-action, and which one's "Invite again" confirm is open.
  const [declinedBusyId, setDeclinedBusyId] = useState<string | null>(null);
  const [declinedToReinvite, setDeclinedToReinvite] = useState<DeclinedCircleInvite | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const openInvite = useCallback(() => setShowInvite(true), []);
  const openLeave = useCallback(() => setShowLeave(true), []);
  const [memberToRemove, setMemberToRemove] = useState<CircleMember | null>(null);
  const [inviteToCancel, setInviteToCancel] = useState<PendingCircleInvite | null>(null);
  // Which row is mid-resend. The mutation's own `isPending` is shared by every
  // row, so it can't disable just the one that was clicked.
  const [invitePendingResend, setInvitePendingResend] = useState<string | null>(null);
  const [showLeave, setShowLeave] = useState(false);
  // The member whose manager role is being changed (confirm dialog open).
  const [roleTarget, setRoleTarget] = useState<CircleMember | null>(null);

  const handleRemove = (): void => {
    if (!memberToRemove) return;
    const name = memberDisplayName(memberToRemove);
    removeMember.mutate(
      { userId: memberToRemove.id },
      {
        onSuccess: () => {
          showToast(t('manage.removeSuccess', { name }), 'success');
          setMemberToRemove(null);
        },
        onError: () => setMemberToRemove(null),
      }
    );
  };

  const handleLeave = (): void => {
    leaveCircle.mutate(undefined, {
      onSuccess: () => {
        showToast(t('manage.leaveSuccess'), 'success');
        setShowLeave(false);
        // REPLACE, not push: the page this was done on belongs to a circle the
        // user is no longer in, so browser Back must not return to it (mobile
        // parity: returnToCircleList pops the left circle off the stack).
        // `fromSwitcher`: land ON the picker even when one circle is left — no
        // auto-skip into the other circle (mobile shows its list, 2026-10-17).
        navigate('/circles', { replace: true, state: { fromSwitcher: true } });
      },
      onError: () => setShowLeave(false),
    });
  };

  const handleCancelInvite = (): void => {
    if (!inviteToCancel) return;
    cancelInvite.mutate(
      { inviteId: inviteToCancel.id },
      {
        onSuccess: () => {
          showToast(t('manage.cancelInviteSuccess'), 'success');
          setInviteToCancel(null);
        },
        onError: () => setInviteToCancel(null),
      }
    );
  };

  /**
   * What names an invite row (1.4.3): its address, or "Shared link" for an
   * invite with no address. `inline` is the in-sentence form for labels and
   * screen-reader copy ("Actions for invite to a shared link"). Never renders
   * a raw null.
   */
  const inviteLabel = (invite: { invited_email: string | null }): string =>
    invite.invited_email || t('manage.sharedLink');
  const inviteLabelInline = (invite: { invited_email: string | null }): string =>
    invite.invited_email || t('manage.sharedLinkInline');

  const handleCopyInviteLink = (invite: PendingCircleInvite): void => {
    const url = invite.invite_url;
    if (!url) return;
    // Unlike the invite modal, the URL is not on screen here, so a clipboard
    // failure must be surfaced rather than swallowed.
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        showToast(t('invite.copyFailed'), 'error');
        return;
      }
      Analytics.inviteLinkCopied(circleId, invite.member_type ?? 'caregiver');
      showToast(t('invite.linkCopied'), 'success');
    })();
  };

  /**
   * Resend a lapsed invite (the backend extends it by 7 days and re-sends the email). Guarded
   * in-handler (not via the `disabled` prop) — `disabled` only lands on the next render commit,
   * so a double tap would fire two resends. Errors are toasted by the hook's shared onError mapper.
   */
  const handleResendInvite = (invite: PendingCircleInvite): void => {
    if (blockOfflineWrite('change')) return;
    // Guard THIS row only: the guard exists to stop a double tap on one button, not to
    // serialise unrelated rows.
    if (invitePendingResend === invite.id) return;
    setInvitePendingResend(invite.id);
    resendInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          // A shared link has nobody to email: the same link was renewed (1.4.3).
          showToast(
            invite.invited_email
              ? t('manage.resendInviteSuccess', { email: invite.invited_email })
              : t('manage.inviteLinkRenewed'),
            'success'
          );
          setInvitePendingResend(null);
        },
        onError: () => setInvitePendingResend(null),
      }
    );
  };

  // ── Declined invites (1.4.3, docs/plans/invite-decline-1-4-3.md) ──────────
  // "Invite again" = the normal create (a NEW pending invite with the full seat
  // checks; errors toast through the shared invite onError). "Remove" = the
  // existing cancel (DELETE), which dismisses the declined row. Never Resend.
  const handleInviteAgain = (): void => {
    const invite = declinedToReinvite;
    // A declined shared link is never re-invited from its row (no address;
    // the row offers Remove only). Belt and braces for the guard below.
    if (!invite || !invite.invited_email || declinedBusyId) return;
    setDeclinedBusyId(invite.id);
    createInvite.mutate(
      { email: invite.invited_email, member_type: invite.member_type },
      {
        onSuccess: () => {
          Analytics.declinedInviteReinvited(invite.member_type);
          showToast(t('manage.inviteAgainSuccess', { email: invite.invited_email }), 'success');
          setDeclinedBusyId(null);
          setDeclinedToReinvite(null);
        },
        onError: () => {
          setDeclinedBusyId(null);
          setDeclinedToReinvite(null);
        },
      }
    );
  };

  const handleRemoveDeclined = (invite: DeclinedCircleInvite): void => {
    if (blockOfflineWrite('change')) return;
    if (declinedBusyId) return;
    setDeclinedBusyId(invite.id);
    cancelInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          Analytics.declinedInviteRemoved(invite.member_type);
          showToast(t('manage.removeDeclinedSuccess'), 'success');
          setDeclinedBusyId(null);
        },
        onError: () => setDeclinedBusyId(null),
      }
    );
  };

  const handleToggleMedResponsible = (member: CircleMember): void => {
    if (blockOfflineWrite('change')) return;
    const next = member.is_medication_responsible ? null : member.id;
    setMedResponsible.mutate(next, {
      onSuccess: () => {
        showToast(
          next
            ? t('manage.medResponsibleSet', {
                name: memberDisplayName(member),
                recipientName: circle?.recipient_name,
              })
            : t('manage.medResponsibleCleared', { recipientName: circle?.recipient_name }),
          'success'
        );
      },
    });
  };

  const handleRoleChange = (): void => {
    if (!roleTarget) return;
    const name = memberDisplayName(roleTarget);
    const role = roleTarget.role === 'manager' ? 'member' : 'manager';
    setMemberRole.mutate({ userId: roleTarget.id, role, name }, { onSettled: () => setRoleTarget(null) });
  };

  const memberActions = (member: CircleMember): ReactNode | undefined => {
    // Never the care recipient, the owner row, or yourself; a manager only acts on plain
    // members, and only to remove them (`memberRowActions`).
    const allowed = memberRowActions(circle, currentUserId, member);
    const items: MoreMenuEntry[] = [];
    if (allowed.medResponsible) {
      items.push({
        id: 'toggle-med',
        label: t('manage.medReminders'),
        description: member.is_medication_responsible
          ? isCurrentUserRecipient
            ? t('manage.medRemindersSetDescSelf')
            : t('manage.medRemindersSetDesc', { recipientName: circle?.recipient_name })
          : t('manage.medRemindersDesc', {
              name: memberDisplayName(member),
              recipientName: circle?.recipient_name,
            }),
        checked: member.is_medication_responsible,
        icon: 'notifications-outline',
        onSelect: () => handleToggleMedResponsible(member),
        disabled: setMedResponsible.isPending,
      });
    }
    if (allowed.managerRole) {
      items.push({
        id: 'toggle-manager',
        label: member.role === 'manager' ? t('manage.removeManager') : t('manage.makeManager'),
        description:
          member.role === 'manager' ? t('manage.removeManagerDesc') : t('manage.makeManagerDesc'),
        icon: 'people-outline',
        onSelect: () => {
          if (blockOfflineWrite('change')) return;
          setRoleTarget(member);
        },
        disabled: setMemberRole.isPending,
      });
    }
    if (allowed.remove) {
      if (items.length > 0) items.push({ divider: true, id: 'divider' });
      items.push({
        id: 'remove',
        label: t('manage.remove'),
        icon: 'trash-outline',
        danger: true,
        onSelect: () => setMemberToRemove(member),
      });
    }
    return items.length > 0 ? (
      <MoreMenu
        label={t('manage.memberActionsLabel', { name: memberDisplayName(member) })}
        items={items}
      />
    ) : undefined;
  };

  const renderPendingInvite = (invite: PendingCircleInvite): ReactElement => {
    const expiry = getInviteExpiryState(invite);
    const isExpired = expiry.state === 'expired';
    // Resend is EXPIRED-ONLY. The backend also permits resending a live invite, but offering it
    // misreads the situation: "Resend" implies the first one failed to arrive, and on a live
    // invite nothing has. The countdown informs; the button appears when it is actually needed.
    const canResend = isExpired;
    const menuItems: MoreMenuEntry[] = [];
    // `invite_url` (owner/managers; absent on older backends) — no URL, no item. Expired links
    // are dead, so never offered for those.
    if (!isExpired && invite.invite_url) {
      menuItems.push({
        id: 'copy-link',
        label: t('invite.copyLink'),
        icon: 'copy-outline',
        onSelect: () => handleCopyInviteLink(invite),
      });
    }
    if (canResend) {
      menuItems.push({
        id: 'resend',
        label: t('manage.resendInvite'),
        icon: 'mail-outline',
        onSelect: () => handleResendInvite(invite),
        disabled: invitePendingResend === invite.id,
      });
    }
    menuItems.push({
      id: 'cancel',
      label: t('manage.cancelInvite'),
      icon: 'trash-outline',
      danger: true,
      onSelect: () => setInviteToCancel(invite),
    });

    return (
      <SheetRow as="li" key={invite.id} className="gap-3 px-[18px] py-3.5">
        <IconTile size={36} tone="coral" name={invite.invited_email ? 'mail-outline' : 'share-outline'} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="m-0 min-w-0 truncate text-md text-ink">{inviteLabel(invite)}</p>
            {isExpired ? (
              <Badge variant="warning" size="sm">
                {t('manage.inviteExpired')}
              </Badge>
            ) : null}
          </div>
          {/* Countdown line. Emphasized caution tone (clay-deep, 8.03:1 on the cream row) inside
              the 3-day window, muted otherwise — never the terracotta/emergency tone, this is a
              heads-up and not a failure. Hidden entirely when the deadline is unknown, so we
              never invent a countdown. The visible text repeats verbatim across rows, so the
              announced copy carries the email (sr-only / aria-hidden pair: an aria-label on a
              <p> would be a prohibited-attr violation). */}
          {!isExpired && expiry.daysLeft != null ? (
            <p
              className={`m-0 text-sm ${
                expiry.state === 'soon' ? 'font-semibold text-clay-deep' : 'text-ink-3'
              }`}
            >
              <span className="sr-only">
                {t('manage.inviteExpiresInLabel', {
                  count: expiry.daysLeft,
                  email: inviteLabelInline(invite),
                })}
              </span>
              <span aria-hidden="true">
                {t('manage.inviteExpiresIn', { count: expiry.daysLeft })}
              </span>
            </p>
          ) : null}
        </div>
        <MoreMenu
          label={t('manage.inviteActionsLabel', { email: inviteLabelInline(invite) })}
          items={menuItems}
        />
      </SheetRow>
    );
  };

  const renderDeclinedInvite = (invite: DeclinedCircleInvite): ReactElement => {
    const declinedOn = formatInviteExpiryDate(invite.declined_at, i18n.language);
    const busy = declinedBusyId === invite.id;
    return (
      <SheetRow
        as="li"
        key={invite.id}
        className="flex-wrap gap-3 px-[18px] py-3.5"
        data-testid={`declined-invite-${invite.id}`}
      >
        <IconTile size={36} tone="neutral" name="mail-outline" />
        <div className="min-w-0 flex-1">
          <p className="m-0 min-w-0 truncate text-md text-ink">{inviteLabel(invite)}</p>
          <Badge variant="default" size="sm">
            {declinedOn
              ? t('manage.inviteDeclinedOn', { date: declinedOn })
              : t('manage.inviteDeclined')}
          </Badge>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* No "Invite again" on a declined SHARED LINK (1.4.3): there is no
              address to send to; a new link is one press away in Invite. */}
          {invite.invited_email ? (
            <Button
              size="sm"
              variant="outline"
              offlineKind="change"
              disabled={busy}
              onClick={() => setDeclinedToReinvite(invite)}
              aria-label={t('manage.inviteAgainLabel', { email: invite.invited_email })}
            >
              {t('manage.inviteAgain')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            offlineKind="change"
            disabled={busy}
            onClick={() => handleRemoveDeclined(invite)}
            aria-label={t('manage.removeDeclinedLabel', { email: inviteLabelInline(invite) })}
          >
            {t('manage.removeDeclined')}
          </Button>
        </div>
      </SheetRow>
    );
  };

  const dialogs = (
    <>
      {showInvite && circle != null ? (
        <InviteMemberModal
          circleId={circleId}
          isSelfCare={circle.is_self_care}
          circleName={circle.name}
          recipientName={circle.recipient_name}
          viewerIsOwner={isOwner}
          ownerName={getCircleOwnerName(circle)}
          canSuggestManager={viewerCanSuggestManager(circle, currentUserId)}
          showHelpLink={careTeamEmpty}
          circle={circle}
          onClose={() => setShowInvite(false)}
        />
      ) : null}

      {memberToRemove ? (
        <ConfirmDialog
          offlineKind="change"
          icon="person-outline"
          title={t('manage.removeConfirmTitle')}
          message={t('manage.removeConfirmBody', { name: memberDisplayName(memberToRemove) })}
          confirmLabel={t('manage.remove')}
          cancelLabel={t('common:cancel')}
          destructive
          confirmDisabled={removeMember.isPending}
          onConfirm={handleRemove}
          onCancel={() => setMemberToRemove(null)}
        />
      ) : null}

      {roleTarget ? (
        <ConfirmDialog
          offlineKind="change"
          icon="people-outline"
          title={
            roleTarget.role === 'manager'
              ? t('manage.removeManagerConfirmTitle', { name: memberDisplayName(roleTarget) })
              : t('manage.makeManagerConfirmTitle', { name: memberDisplayName(roleTarget) })
          }
          message={
            roleTarget.role === 'manager'
              ? t('manage.removeManagerConfirmBody', { name: memberDisplayName(roleTarget) })
              : t('manage.makeManagerConfirmBody', { name: memberDisplayName(roleTarget) })
          }
          confirmLabel={
            roleTarget.role === 'manager' ? t('manage.removeManager') : t('manage.makeManager')
          }
          cancelLabel={t('common:cancel')}
          confirmDisabled={setMemberRole.isPending}
          onConfirm={handleRoleChange}
          onCancel={() => setRoleTarget(null)}
        />
      ) : null}

      {inviteToCancel ? (
        <ConfirmDialog
          offlineKind="change"
          icon="mail-outline"
          title={t('manage.cancelInviteConfirmTitle')}
          message={
            inviteToCancel.invited_email
              ? t('manage.cancelInviteConfirmBody', { email: inviteToCancel.invited_email })
              : t('manage.cancelLinkInviteConfirmBody')
          }
          confirmLabel={t('manage.cancelInviteConfirm')}
          cancelLabel={t('manage.keepInvite')}
          destructive
          confirmDisabled={cancelInvite.isPending}
          onConfirm={handleCancelInvite}
          onCancel={() => setInviteToCancel(null)}
        />
      ) : null}

      {declinedToReinvite ? (
        <ConfirmDialog
          offlineKind="change"
          icon="mail-outline"
          title={t('manage.inviteAgainConfirmTitle')}
          message={t('manage.inviteAgainConfirmBody', { email: declinedToReinvite.invited_email })}
          confirmLabel={t('manage.inviteAgain')}
          cancelLabel={t('common:cancel')}
          confirmDisabled={declinedBusyId != null}
          onConfirm={handleInviteAgain}
          onCancel={() => setDeclinedToReinvite(null)}
        />
      ) : null}

      {showLeave ? (
        <ConfirmDialog
          offlineKind="change"
          icon="log-out-outline"
          title={t('manage.leaveConfirmTitle')}
          message={t('manage.leaveConfirmBody')}
          confirmLabel={t('manage.leave')}
          cancelLabel={t('common:cancel')}
          destructive
          confirmDisabled={leaveCircle.isPending}
          onConfirm={handleLeave}
          onCancel={() => setShowLeave(false)}
        />
      ) : null}
    </>
  );

  return {
    isOwner,
    canManageMembers,
    isCurrentUserRecipient,
    pendingInvites,
    declinedInvites,
    liveInvites,
    careTeamEmpty,
    memberActions,
    renderPendingInvite,
    renderDeclinedInvite,
    openInvite,
    openLeave,
    dialogs,
  };
}
