import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Modal, TextField, useToast } from '@/components/ui';
import { useLookupInviteByCode, useAcceptInviteByCode } from '@/hooks/useJoinCircle';
import type { InviteByCode } from '@/api/invites';

// Web port of mobile/src/components/JoinCircleModal.tsx — the two-step
// join-by-code flow for an already-authenticated user:
//   1. Enter an invite code → look it up (GET /invites/code/:code)
//   2. Preview the circle (name / caring for / invited by + joining-as role)
//      → confirm (POST /invites/code/:code/accept)
// On success the circle list is invalidated (by useAcceptInviteByCode) and the
// caller navigates to the joined circle via onJoined.
//
// PRIVACY: the invite code is user-entered and grants circle access — it is
// never logged or sent to analytics from here.

export interface JoinCircleModalProps {
  onClose: () => void;
  /** Called after a successful join with the joined circle's id. */
  onJoined: (circleId: string) => void;
}

/** Display name for the inviter — full name when known, else the email. */
function inviterName(invite: InviteByCode): string {
  const { first_name, last_name, email } = invite.invited_by;
  if (first_name) return `${first_name} ${last_name ?? ''}`.trim();
  return email;
}

/** Pull the backend error CODE out of the `{ error: { code } }` envelope. */
function errorCodeOf(error: unknown): string | undefined {
  return (error as { error?: { code?: string } } | null)?.error?.code;
}

export function JoinCircleModal({ onClose, onJoined }: JoinCircleModalProps): ReactElement {
  const { t } = useTranslation('circles');
  const { showToast } = useToast();

  const [code, setCode] = useState('');
  const [invite, setInvite] = useState<InviteByCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useLookupInviteByCode();
  const accept = useAcceptInviteByCode();

  const handleLookup = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setError(null);
    lookup.mutate(trimmed, {
      onSuccess: (found) => setInvite(found),
      onError: (err) => {
        const c = errorCodeOf(err);
        setError(
          c === 'INVITE_EXPIRED'
            ? t('joinModal.expired')
            : c === 'INVITE_ALREADY_USED'
              ? t('joinModal.alreadyUsed')
              : t('joinModal.invalidCode')
        );
      },
    });
  };

  const handleAccept = (): void => {
    if (!invite) return;
    setError(null);
    accept.mutate(code.trim(), {
      onSuccess: () => {
        showToast(t('joinModal.youveJoined', { circleName: invite.circle.name }), 'success');
        onClose();
        onJoined(invite.circle.id);
      },
      onError: (err) => {
        const c = errorCodeOf(err);
        setError(
          c === 'ALREADY_MEMBER'
            ? t('joinModal.alreadyMember')
            : c === 'INVITE_EXPIRED'
              ? t('joinModal.expired')
              : c === 'INVITE_ALREADY_USED'
                ? t('joinModal.alreadyUsed')
                : t('joinModal.joinFailed')
        );
      },
    });
  };

  const handleReset = (): void => {
    setInvite(null);
    setError(null);
  };

  return (
    <Modal title={t('joinModal.title')} onClose={onClose} closeLabel={t('joinModal.close')}>
      <p className="m-0 text-sm text-ink-3">{t('joinModal.subtitle')}</p>

      {error ? (
        <p
          role="alert"
          className="m-0 rounded-xl bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
        >
          {error}
        </p>
      ) : null}

      {!invite ? (
        <form onSubmit={handleLookup} className="flex flex-col gap-4">
          <TextField
            id="invite-code"
            label={t('joinModal.codeLabel')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder={t('joinModal.placeholder')}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={8}
            className="text-center text-lg font-semibold tracking-[0.35em]"
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('joinModal.cancel')}
            </Button>
            <Button type="submit" disabled={!code.trim() || lookup.isPending}>
              {lookup.isPending ? t('joinModal.lookingUp') : t('joinModal.lookUpCode')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <div>
              <p className="eyebrow m-0">{t('joinModal.circle')}</p>
              <p className="serif m-0 text-lg text-ink">{invite.circle.name}</p>
            </div>
            <div className="border-t border-line-2 pt-3">
              <p className="eyebrow m-0">{t('joinModal.caringFor')}</p>
              <p className="m-0 font-medium text-ink">{invite.circle.recipient_name}</p>
            </div>
            <div className="border-t border-line-2 pt-3">
              <p className="eyebrow m-0">{t('joinModal.invitedBy')}</p>
              <p className="m-0 font-medium text-ink">{inviterName(invite)}</p>
            </div>
          </Card>

          <div className="flex justify-center">
            <Badge variant={invite.member_type === 'care_recipient' ? 'terracotta' : 'moss'}>
              {invite.member_type === 'care_recipient'
                ? t('joinModal.joiningAsCareRecipient')
                : t('joinModal.joiningAsCaregiver')}
            </Badge>
          </div>

          <Button onClick={handleAccept} disabled={accept.isPending} className="w-full">
            {accept.isPending ? t('joinModal.joining') : t('joinModal.joinCircle')}
          </Button>
          <Button type="button" variant="ghost" onClick={handleReset} disabled={accept.isPending}>
            {t('joinModal.enterDifferentCode')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
