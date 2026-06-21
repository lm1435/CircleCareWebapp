import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, EmptyState, Skeleton, useToast } from '@/components/ui';
import { usePendingInvites, useAcceptInvite } from '@/hooks/useInvites';
import type { PendingInvite } from '@/api/invites';
import { Analytics } from '@/lib/analytics';

// Task 5.5 — list the current user's pending invites with Accept.
//
// MIRRORS mobile/src/screens/circle/PendingInvitesScreen.tsx. NOTE: there is NO
// decline endpoint (mobile's "Decline" is a client-only dismiss), so this page
// offers Accept only — no decline UI.
//
// Built on Stage 0 primitives (Card, Button, Badge, EmptyState, Skeleton) +
// design tokens. Owner gating is not relevant here — these are invites
// addressed TO the current user.

/** Decorative envelope glyph for the empty state tile. */
function MailIcon(): ReactElement {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function inviterName(invite: PendingInvite): string {
  const { first_name, last_name, email } = invite.invited_by;
  const name = [first_name, last_name].filter(Boolean).join(' ');
  return name || email;
}

function InviteRowSkeleton(): ReactElement {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-cream p-6">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-11 w-28 rounded-full" />
    </li>
  );
}

export default function PendingInvitesPage(): ReactElement {
  const { t } = useTranslation('members');
  const { showToast } = useToast();
  const { data: invites, isPending, isError, refetch } = usePendingInvites();
  const acceptInvite = useAcceptInvite();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const handleAccept = (invite: PendingInvite): void => {
    setAcceptingId(invite.id);
    acceptInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          // PHI-safe: only the circle_id (available here; the hook takes only an
          // inviteId, so the capture lives at the call site).
          Analytics.inviteAccepted(invite.circle.id);
          showToast(t('pending.accepted', { circle: invite.circle.name }), 'success');
          setAcceptingId(null);
        },
        onError: () => {
          // The hook's shared onError already toasts the failure.
          setAcceptingId(null);
        },
      }
    );
  };

  let content: ReactElement;
  if (isPending) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
      >
        <InviteRowSkeleton />
        <InviteRowSkeleton />
      </ul>
    );
  } else if (isError) {
    content = (
      <Card role="alert" className="mt-6 max-w-lg p-8 text-center">
        <h2 className="serif m-0 text-lg text-ink">{t('pending.errorTitle')}</h2>
        <p className="mt-2 text-ink-2">{t('pending.errorBody')}</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (!invites || invites.length === 0) {
    content = (
      <div className="mt-6">
        <EmptyState
          icon={<MailIcon />}
          title={t('pending.emptyTitle')}
          description={t('pending.emptyBody')}
        />
      </div>
    );
  } else {
    content = (
      <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-col gap-3 rounded-2xl border border-line bg-cream p-6"
          >
            <div className="flex flex-col gap-1">
              <p className="m-0 font-medium text-ink">
                {t('pending.invitedYou', {
                  inviter: inviterName(invite),
                  recipient: invite.circle.recipient_name,
                })}
              </p>
              <p className="m-0 text-sm text-ink-3">
                <span className="eyebrow">{t('invite.circleLabel')}</span> {invite.circle.name}
              </p>
              <Badge variant={invite.member_type === 'caregiver' ? 'moss' : 'terracotta'}>
                {t(`roles.${invite.member_type === 'caregiver' ? 'caregiver' : 'careRecipient'}`)}
              </Badge>
            </div>
            <div>
              <Button
                onClick={() => handleAccept(invite)}
                disabled={acceptInvite.isPending && acceptingId === invite.id}
              >
                {acceptInvite.isPending && acceptingId === invite.id
                  ? t('pending.accepting')
                  : t('pending.accept')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl p-8">
      <h1 className="serif m-0 text-xl text-ink">{t('pending.heading')}</h1>
      <p className="mt-2 text-ink-3">{t('pending.subheading')}</p>
      {content}
    </section>
  );
}
