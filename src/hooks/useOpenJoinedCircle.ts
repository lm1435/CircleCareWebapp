import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import {
  inviteeWelcomePath,
  recordPendingInviteeWelcome,
  type InviteeWelcomeInput,
} from '@/lib/inviteeWelcome';

/** The part of a joined circle the post-accept handoff needs. */
export interface JoinedCircleRef {
  id: string;
  name?: string | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The confirmation for a successful accept. Parity with mobile's
 * `joinedCircleConfirmation` (mobile/src/navigation/joinedCircleHandoff.ts):
 * name the circle when we know it, otherwise the generic "you joined" copy —
 * a `null` circle (the backend's post-join read failed) is still a success.
 */
export function joinedCircleMessage(t: Translate, circle: JoinedCircleRef | null): string {
  const circleName = circle?.name?.trim();
  return circleName
    ? t('circles:joinModal.youveJoined', { circleName })
    : t('invite:acceptSuccess');
}

/** Where a successful accept lands: the joined circle, or the picker when unknown. */
export function joinedCirclePath(circle: JoinedCircleRef | null): string {
  return circle?.id ? `/circles/${circle.id}` : '/circles';
}

/**
 * After an accept: toast "You've joined <name>" and open the joined circle
 * (`/circles/:id` — the same path CirclePickerPage uses to open a circle;
 * AppLayout owns the needs-circle-selection banner and the view-only gates, so
 * a frozen or read-only join is handled there). With no circle in the response
 * it falls back to the generic toast and the circle picker.
 *
 * Onboarding 1.3.1 (invitee welcome): when the caller passes what it knows of
 * the invite (`welcome`) and the circle is known, a pending welcome is recorded
 * for this user + circle and the joiner lands on `/circles/:id/welcome` (which
 * is itself the confirmation, so no toast) and then Today. Without it, or with
 * no signed-in user / no circle, the old toast + circle handoff is unchanged.
 *
 * Callers invalidate the circle list BEFORE calling this (the accept hooks
 * await it in their `onSuccess`), so the circle is already in the cache.
 */
export function useOpenJoinedCircle(): (
  circle: JoinedCircleRef | null,
  welcome?: InviteeWelcomeInput
) => void {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useTranslation(['circles', 'invite']);
  const { user } = useAuth();
  const userId = user?.id;

  return useCallback(
    (circle: JoinedCircleRef | null, welcome?: InviteeWelcomeInput) => {
      if (welcome && circle?.id && recordPendingInviteeWelcome(userId, circle.id, welcome)) {
        navigate(inviteeWelcomePath(circle.id));
        return;
      }
      showToast(joinedCircleMessage(t, circle), 'success');
      navigate(joinedCirclePath(circle));
    },
    [navigate, showToast, t, userId]
  );
}
