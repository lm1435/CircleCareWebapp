import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Modal, TextField, useToast } from '@/components/ui';
import { useLookupInviteByCode, useAcceptInviteByCode } from '@/hooks/useJoinCircle';
import { extractJoinCode, isCompleteJoinCode, normalizeJoinCode } from '@/lib/joinCode';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import { Analytics } from '@/lib/analytics';
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
//
// R4-2 (docs/plans/condition-tags.md Round 4): the code field auto-uppercases
// and strips spaces/dashes on type AND paste (normalizeJoinCode), submit
// enables at exactly 6 normalized chars, and — when the browser exposes
// navigator.clipboard.readText — a "Paste code" button reads the clipboard ON
// CLICK ONLY (never automatically) and fills the field when the clipboard
// holds exactly a 6-char alphanumeric code. Clipboard permission denials are
// swallowed silently (no toast, no error state).

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

/**
 * Most circles are named after the person being cared for, so the circle name
 * and the recipient name are frequently identical. When they are, showing both
 * the "Circle" and "Caring for" rows is pure repetition — collapse to one.
 */
function circleNameIsDistinct(invite: InviteByCode): boolean {
  const name = invite.circle.name?.trim().toLowerCase() ?? '';
  const recipient = invite.circle.recipient_name?.trim().toLowerCase() ?? '';
  return name.length > 0 && name !== recipient;
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
  // "We didn't find a code" hint after a Paste-code click with non-code content.
  const [pasteMiss, setPasteMiss] = useState(false);

  const lookup = useLookupInviteByCode();
  const accept = useAcceptInviteByCode();

  // Clipboard read is feature-detected: no readText → no button at all.
  const clipboardAvailable =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  const handlePasteFromClipboard = async (): Promise<void> => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Permission denied / unavailable — ignore silently (no error toast).
      return;
    }
    const extracted = extractJoinCode(text);
    if (extracted) {
      setCode(extracted);
      setError(null);
      setPasteMiss(false);
    } else {
      setPasteMiss(true);
    }
  };

  const handleLookup = (event: FormEvent): void => {
    event.preventDefault();
    if (!isCompleteJoinCode(code)) return;
    setError(null);
    lookup.mutate(code, {
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
    accept.mutate(code, {
      onSuccess: () => {
        // WB4: the code-entry join path fired no invite_accepted event —
        // the join-by-link path already does (InviteLandingPage). PHI-safe:
        // only the circle_id + a source enum, never the code itself.
        Analytics.inviteAccepted(invite.circle.id, 'code_entry');
        // R4-5: joined their first circle here → onboarding complete. No-op
        // when this browser already saw the user with circles. Carries no code.
        trackOnboardingCompleted('joined');
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
              // Normalizes typing AND paste-into-field (paste fires onChange).
              setCode(normalizeJoinCode(e.target.value));
              setError(null);
              setPasteMiss(false);
            }}
            placeholder={t('joinModal.placeholder')}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="text-center text-lg font-semibold tracking-[0.35em]"
          />
          {clipboardAvailable && (
            <div className="flex flex-col items-start gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handlePasteFromClipboard()}
              >
                {t('joinModal.pasteCode')}
              </Button>
              {/* Polite inline miss hint — never a toast, never an error state. */}
              <p role="status" aria-live="polite" className="m-0 text-sm text-ink-3">
                {pasteMiss ? t('joinModal.pasteNoCode') : ''}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('joinModal.cancel')}
            </Button>
            <Button type="submit" disabled={!isCompleteJoinCode(code) || lookup.isPending}>
              {lookup.isPending ? t('joinModal.lookingUp') : t('joinModal.lookUpCode')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            {circleNameIsDistinct(invite) ? (
              <div>
                <p className="eyebrow m-0">{t('joinModal.circle')}</p>
                <p className="serif m-0 text-lg text-ink">{invite.circle.name}</p>
              </div>
            ) : null}
            <div className={circleNameIsDistinct(invite) ? 'border-t border-line-2 pt-3' : undefined}>
              <p className="eyebrow m-0">{t('joinModal.caringFor')}</p>
              <p className="m-0 font-medium text-ink">{invite.circle.recipient_name}</p>
            </div>
            <div className="border-t border-line-2 pt-3">
              <p className="eyebrow m-0">{t('joinModal.invitedBy')}</p>
              <p className="m-0 font-medium text-ink">{inviterName(invite)}</p>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line-2 pt-3">
              <p className="eyebrow m-0">{t('joinModal.yourRole')}</p>
              <Badge variant={invite.member_type === 'care_recipient' ? 'terracotta' : 'moss'}>
                {invite.member_type === 'care_recipient'
                  ? t('joinModal.roleCareRecipient')
                  : t('joinModal.roleCaregiver')}
              </Badge>
            </div>
          </Card>

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
