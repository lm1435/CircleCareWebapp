import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircle } from '@/hooks/useCircle';
import { useRemoveMember, useLeaveCircle, useSetMedicationResponsible } from '@/hooks/useCircleMembers';
import { useCancelInvite } from '@/hooks/useInvites';
import { Button, Card, ConfirmDialog, Skeleton, useToast } from '@/components/ui';
import { MemberRow } from '@/components/members/MemberRow';
import { InviteMemberModal } from '@/components/members/InviteMemberModal';
import { useAuthStore } from '@/store/authStore';
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

  const removeMember = useRemoveMember(circleId);
  const leaveCircle = useLeaveCircle(circleId);
  const setMedResponsible = useSetMedicationResponsible(circleId);
  const cancelInvite = useCancelInvite(circleId);

  const [showInvite, setShowInvite] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<CircleMember | null>(null);
  const [inviteToCancel, setInviteToCancel] = useState<PendingCircleInvite | null>(null);
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
          only when the owner is the lone member and there are no pending
          invites yet — non-destructive, reuses the Invite trigger. */}
      {isOwner && members.length === 1 && pendingInvites.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <h2 className="serif m-0 text-lg text-ink">{t('list.soloTitle')}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">{t('list.soloBody')}</p>
          <Button className="mt-6" onClick={() => setShowInvite(true)}>
            {t('list.soloCta')}
          </Button>
        </Card>
      ) : null}

      {/* Owner-only pending invites list with cancel. */}
      {isOwner && pendingInvites.length > 0 ? (
        <div className="mt-10">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('manage.pendingHeading')}</h2>
          <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
            {pendingInvites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-cream px-6 py-4"
              >
                <p className="m-0 min-w-0 truncate text-ink">{invite.invited_email}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setInviteToCancel(invite)}
                  aria-label={t('manage.cancelInviteLabel', { email: invite.invited_email })}
                >
                  {t('manage.cancelInvite')}
                </Button>
              </li>
            ))}
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
