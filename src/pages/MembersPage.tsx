import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircle } from '@/hooks/useCircle';
import { useRemoveMember, useLeaveCircle, useSetMedicationResponsible } from '@/hooks/useCircleMembers';
import { useCancelInvite, useResendInvite } from '@/hooks/useInvites';
import { Badge, Button, Card, ConfirmDialog, Skeleton, useToast } from '@/components/ui';
import { MemberRow } from '@/components/members/MemberRow';
import { InviteMemberModal } from '@/components/members/InviteMemberModal';
import { ClockIcon } from '@/components/circles/icons';
import { useAuthStore } from '@/store/authStore';
import { getInviteExpiryState, isPendingInviteExpired } from '@/api/circleMembers';
import type { CircleMember, PendingCircleInvite } from '@/api/circleMembers';

function MemberRowSkeleton(): ReactElement {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-cream px-6 py-4">
      <div>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-4 w-28" />
      </div>
      <Skeleton className="h-6 w-24 rounded-full" />
    </li>
  );
}

function memberName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

/**
 * Members page (plan Tasks 35-36 + Stage 5 Task 5.4).
 *
 * Read-only roster for everyone, plus owner-only management: invite a member,
 * remove a member, set/clear the medication-responsible caregiver, and cancel
 * pending invites. Non-owners additionally see a "Leave circle" action (the
 * owner cannot leave — backend blocks it).
 *
 * Gating: owner === `circle.owner_id === currentUserId`. The backend enforces
 * each action independently — UI gating is cosmetic.
 */
export default function MembersPage(): ReactElement {
  const { t } = useTranslation('members');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { circleId = '' } = useParams<{ circleId: string }>();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { circle, members, isLoading, isError, refetch } = useCircle(circleId);
  const isOwner = circle != null && currentUserId != null && circle.owner_id === currentUserId;
  const pendingInvites: PendingCircleInvite[] = circle?.pending_invites ?? [];
  // Live (non-lapsed) invites only. An expired invite is not "someone you
  // invited" — nobody can join through it — so it must not suppress the
  // solo-owner nudge the same way a live one does. It still renders in the
  // pending list below with its Expired badge + Resend, so the owner has both
  // paths: retry the old one, or invite someone new.
  const liveInvites = pendingInvites.filter((invite) => !isPendingInviteExpired(invite));

  const removeMember = useRemoveMember(circleId);
  const leaveCircle = useLeaveCircle(circleId);
  const setMedResponsible = useSetMedicationResponsible(circleId);
  const cancelInvite = useCancelInvite(circleId);
  const resendInvite = useResendInvite(circleId);

  const [showInvite, setShowInvite] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<CircleMember | null>(null);
  const [inviteToCancel, setInviteToCancel] = useState<PendingCircleInvite | null>(null);
  // Which row is mid-resend. The mutation's own `isPending` is shared by every
  // row, so it can't disable just the one that was clicked.
  const [invitePendingResend, setInvitePendingResend] = useState<string | null>(null);
  const [showLeave, setShowLeave] = useState(false);

  const handleRemove = (): void => {
    if (!memberToRemove) return;
    const name = memberName(memberToRemove);
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
        navigate('/circles');
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
   * Resend a lapsed OR soon-to-lapse invite (the backend extends it by 7 days
   * and re-sends the email). Guarded in-handler (not via the `disabled` prop) —
   * `disabled` only lands on the next render commit, so a double tap would fire
   * two resends. Errors are toasted by the hook's shared onError mapper.
   */
  const handleResendInvite = (invite: PendingCircleInvite): void => {
    // Guard THIS row only. Guarding on "any resend in flight" made a second
    // expired invite's button a silent dead click: the `disabled` prop is
    // applied per-row, so that row looked live, showed no spinner, and produced
    // no toast. The guard exists to stop a double tap on one button, not to
    // serialise unrelated rows.
    if (invitePendingResend === invite.id) return;
    setInvitePendingResend(invite.id);
    resendInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          showToast(
            t('manage.resendInviteSuccess', { email: invite.invited_email }),
            'success'
          );
          setInvitePendingResend(null);
        },
        onError: () => setInvitePendingResend(null),
      }
    );
  };

  const handleToggleMedResponsible = (member: CircleMember): void => {
    const next = member.is_medication_responsible ? null : member.id;
    setMedResponsible.mutate(next, {
      onSuccess: () => {
        showToast(
          next ? t('manage.medResponsibleSet', { name: memberName(member) }) : t('manage.medResponsibleCleared'),
          'success'
        );
      },
    });
  };

  let content: ReactElement;
  if (isLoading) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
      >
        <MemberRowSkeleton />
        <MemberRowSkeleton />
        <MemberRowSkeleton />
      </ul>
    );
  } else if (isError) {
    content = (
      <Card role="alert" className="mt-6 max-w-lg p-8 text-center">
        <h2 className="serif m-0 text-lg text-ink">{t('list.errorTitle')}</h2>
        <p className="mt-2 text-ink-2">{t('list.errorBody')}</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (members.length === 0) {
    content = (
      <Card className="mt-6 max-w-lg p-8 text-center">
        <p className="m-0 text-ink-2">{t('list.empty')}</p>
      </Card>
    );
  } else {
    content = (
      <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {members.map((member) => {
          const isSelf = member.id === currentUserId;
          // Owners can manage caregivers, but never the care recipient or themselves.
          const canManage = isOwner && !member.is_care_recipient && !isSelf;
          const actions =
            canManage && member.role !== 'owner' ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleMedResponsible(member)}
                  disabled={setMedResponsible.isPending}
                >
                  {member.is_medication_responsible
                    ? t('manage.clearMedResponsible')
                    : t('manage.setMedResponsible')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMemberToRemove(member)}
                  aria-label={t('manage.removeMemberLabel', { name: memberName(member) })}
                >
                  {t('manage.remove')}
                </Button>
              </>
            ) : undefined;
          return <MemberRow key={member.id} member={member} actions={actions} />;
        })}
      </ul>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="serif m-0 text-xl text-ink">{t('list.heading')}</h1>
          <p className="mt-2 text-ink-3">
            {isOwner ? t('manage.subheading') : t('list.subheadingReadOnly')}
          </p>
        </div>
        {isOwner ? <Button onClick={() => setShowInvite(true)}>{t('invite.cta')}</Button> : null}
      </div>

      {content}

      {/* Solo owner: a welcoming prompt to invite the first caregiver. Shown
          only when the owner is the lone member and there is no LIVE pending
          invite — an expired one has stopped being an invitation, so it no
          longer counts. Non-destructive, reuses the Invite trigger. */}
      {isOwner && members.length === 1 && liveInvites.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <h2 className="serif m-0 text-lg text-ink">{t('list.soloTitle')}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">{t('list.soloBody')}</p>
          <Button className="mt-6" onClick={() => setShowInvite(true)}>
            {t('list.soloCta')}
          </Button>
        </Card>
      ) : null}

      {/* Owner-only pending invites list with cancel + resend.
          Expired invites stay in this list (the backend returns them with
          `is_expired`), so the badge is the only thing telling them apart —
          and resend is the only way out other than cancel-and-retype. */}
      {isOwner && pendingInvites.length > 0 ? (
        <div className="mt-10">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('manage.pendingHeading')}</h2>
          <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
            {pendingInvites.map((invite) => {
              const expiry = getInviteExpiryState(invite);
              const isExpired = expiry.state === 'expired';
              // Resend covers `soon` too, not just `expired`. The backend
              // extends a live invite by 7 days and re-sends the email, and it
              // consumes no extra seat (that invite already holds one), so the
              // owner can rescue an invitation BEFORE it dies rather than only
              // after. Cancel stays available in every state.
              // Resend is EXPIRED-ONLY. The backend also permits resending a
              // live invite, but offering it here misreads the situation:
              // "Resend" implies the first one failed to arrive, and on a live
              // invite nothing has — the recipient holds a working link. It
              // would just re-email them to reset a clock they cannot see. The
              // countdown informs; the button appears when it is actually needed.
              const canResend = isExpired;
              return (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-cream px-6 py-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="m-0 min-w-0 truncate text-ink">{invite.invited_email}</p>
                      {isExpired ? (
                        <Badge variant="clay">
                          <ClockIcon size={12} />
                          {t('manage.inviteExpired')}
                        </Badge>
                      ) : null}
                    </div>
                    {/* Countdown line. Emphasized caution tone (clay-deep,
                        8.03:1 on the cream row) inside the 3-day window, muted
                        otherwise — never the terracotta/emergency tone, this is
                        a heads-up and not a failure. Hidden entirely when the
                        deadline is unknown (missing/garbage `expires_at`), so
                        we never invent a countdown.
                        The visible text repeats verbatim across rows, so the
                        announced copy carries the email — same per-row
                        disambiguation as the buttons' aria-labels. An
                        aria-label on a <p> would be a prohibited-attr
                        violation, hence the sr-only/aria-hidden pair. */}
                    {!isExpired && expiry.daysLeft != null ? (
                      <p
                        className={`m-0 text-sm ${
                          expiry.state === 'soon' ? 'font-semibold text-clay-deep' : 'text-ink-3'
                        }`}
                      >
                        <span className="sr-only">
                          {t('manage.inviteExpiresInLabel', {
                            count: expiry.daysLeft,
                            email: invite.invited_email,
                          })}
                        </span>
                        <span aria-hidden="true">
                          {t('manage.inviteExpiresIn', { count: expiry.daysLeft })}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canResend ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResendInvite(invite)}
                        disabled={invitePendingResend === invite.id}
                        aria-label={t('manage.resendInviteLabel', {
                          email: invite.invited_email,
                        })}
                      >
                        {t('manage.resendInvite')}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setInviteToCancel(invite)}
                      aria-label={t('manage.cancelInviteLabel', { email: invite.invited_email })}
                    >
                      {t('manage.cancelInvite')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Non-owner: leave circle. */}
      {circle != null && !isOwner ? (
        <div className="mt-10 border-t border-line-2 pt-6">
          <Button variant="ghost" onClick={() => setShowLeave(true)}>
            {t('manage.leave')}
          </Button>
        </div>
      ) : null}

      {showInvite && circle != null ? (
        <InviteMemberModal
          circleId={circleId}
          isSelfCare={circle.is_self_care}
          onClose={() => setShowInvite(false)}
        />
      ) : null}

      {memberToRemove ? (
        <ConfirmDialog
          title={t('manage.removeConfirmTitle')}
          message={t('manage.removeConfirmBody', { name: memberName(memberToRemove) })}
          confirmLabel={t('manage.remove')}
          cancelLabel={t('common:cancel')}
          destructive
          confirmDisabled={removeMember.isPending}
          onConfirm={handleRemove}
          onCancel={() => setMemberToRemove(null)}
        />
      ) : null}

      {inviteToCancel ? (
        <ConfirmDialog
          title={t('manage.cancelInviteConfirmTitle')}
          message={t('manage.cancelInviteConfirmBody', { email: inviteToCancel.invited_email })}
          confirmLabel={t('manage.cancelInviteConfirm')}
          cancelLabel={t('manage.keepInvite')}
          destructive
          confirmDisabled={cancelInvite.isPending}
          onConfirm={handleCancelInvite}
          onCancel={() => setInviteToCancel(null)}
        />
      ) : null}

      {showLeave ? (
        <ConfirmDialog
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
    </section>
  );
}
