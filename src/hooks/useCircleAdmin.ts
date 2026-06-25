import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createCircle,
  deleteCircle,
  updateCircle,
  type Circle,
  type CreateCircleRequest,
  type UpdateCircleRequest,
} from '@/api/circles';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';

// Plan Stage 8, Task 8.2 — owner-only circle edit/delete mutations.
//
// New file (does NOT collide with useCircle.ts / useCircles.ts /
// useCircleMembers.ts). Mirrors the SHIPPED mutation pattern in
// useMedConfirmation.ts / useCircleMembers.ts: mutationFn → onSuccess
// invalidates the same circle query families those hooks touch (reuse
// queryKeys — do NOT invent shapes) → onError distinguishes a 402/403
// rejection from a generic failure via the shared apiErrors helpers.
//
// Navigation is intentionally NOT wired here: deleteCircle resolves cleanly and
// the calling page navigates to the circle picker (the hook stays nav-agnostic
// so it's reusable + trivially testable).

/** Refresh the circle detail (members/recipient fields) + summary + list. */
function invalidateCircleQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.circle(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
}

/** Shared onError for circle-admin mutations (owner-gated → mostly 403). */
function useCircleAdminOnError(): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation('common');

  return (error: unknown) => {
    if (isSubscriptionRequiredError(error)) {
      promptUpgrade();
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else {
      showToast(t('errors.saveFailed'), 'error');
    }
  };
}

/**
 * True for a 403 `CIRCLE_LIMIT_REACHED` rejection — the user already owns the
 * maximum of 5 circles and no upgrade can lift it (distinct from the free-tier
 * 402 `SUBSCRIPTION_REQUIRED` path, which CAN be lifted by upgrading). The
 * caller shows a "max 5 circles" message rather than "open the app to upgrade".
 *
 * apiErrors.ts is intentionally not extended for this single create-only code,
 * so it's classified inline here (same envelope shape: `{ error: { code } }`).
 */
function isCircleLimitReachedError(err: unknown): boolean {
  const code = (err as { error?: { code?: string } } | null)?.error?.code;
  return code === 'CIRCLE_LIMIT_REACHED';
}

/**
 * POST /circles — create a new care circle (plan Stage 8, Task 8.6b).
 *
 * On success, invalidates the circle list and resolves with the new `Circle`
 * so the caller can navigate to its calendar. Error handling distinguishes the
 * three freemium outcomes:
 *   - 402 SUBSCRIPTION_REQUIRED (free tier, ≥1 circle) → "open app to upgrade"
 *   - 403 CIRCLE_LIMIT_REACHED  (any tier, ≥5 circles) → "max 5 circles"
 *   - 403 view/read-only        → generic permission toast
 * The dedicated onError is local (not the shared `useCircleAdminOnError`) so it
 * can surface the distinct circle-limit message.
 */
export function useCreateCircle(): UseMutationResult<Circle, unknown, CreateCircleRequest> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation(['common', 'circles']);

  return useMutation({
    mutationFn: (data: CreateCircleRequest) => createCircle(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
    onError: (error: unknown) => {
      if (isSubscriptionRequiredError(error)) {
        promptUpgrade();
      } else if (isCircleLimitReachedError(error)) {
        showToast(t('circles:create.limitReached'), 'error');
      } else if (isPermissionDeniedError(error)) {
        showToast(t('common:errors.permissionDenied'), 'error');
      } else {
        showToast(t('common:errors.saveFailed'), 'error');
      }
    },
  });
}

/** PATCH /circles/:circleId — owner edits recipient name / DOB / conditions. */
export function useUpdateCircle(
  circleId: string
): UseMutationResult<void, unknown, UpdateCircleRequest> {
  const queryClient = useQueryClient();
  const onError = useCircleAdminOnError();

  return useMutation({
    mutationFn: (data: UpdateCircleRequest) => updateCircle(circleId, data),
    onSuccess: () => invalidateCircleQueries(queryClient, circleId),
    onError,
  });
}

/**
 * DELETE /circles/:circleId — owner deletes (soft-archives) the circle.
 * On success the circle is gone from the list; the caller navigates to the
 * circle picker (this hook does not touch navigation).
 */
export function useDeleteCircle(
  circleId: string
): UseMutationResult<void, unknown, void> {
  const queryClient = useQueryClient();
  const onError = useCircleAdminOnError();

  return useMutation({
    mutationFn: () => deleteCircle(circleId),
    onSuccess: () => {
      // The circle no longer exists — drop its detail and refresh the list so
      // the picker reflects the deletion immediately.
      void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
    onError,
  });
}
