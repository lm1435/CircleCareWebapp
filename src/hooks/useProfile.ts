import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  deleteAccount,
  updateEmailDigest,
  updateNotificationPrefs,
  updateProfile,
  updateQuietHours,
  updateUnitPreferences,
  type UnitPreferences,
  type UpdateEmailDigestRequest,
  type UpdateNotificationPreferencesRequest,
  type UpdateProfileRequest,
  type UpdateQuietHoursRequest,
  type UpdateUnitPreferencesRequest,
  type User,
} from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import i18n from '@/i18n';

// Stage 7, Task 7.2 — profile & settings mutation hooks. Mirror the shipped
// mutation pattern in useMedConfirmation.ts: mutationFn → onSuccess invalidates
// the relevant query family → onError surfaces a toast.
//
// The backend routes live in backend/src/routes/users.ts; the api functions in
// src/api/users.ts. These are USER-scoped (PATCH/PUT/DELETE /users/me/*), so the
// only invalidation needed is queryKeys.currentUser (and unitPreferences for the
// units PUT, which returns the bare prefs payload rather than a full user).

/**
 * PATCH /users/me — name / timezone / language. When `language` changes, also
 * switch the live i18n instance so the UI re-renders in the new locale
 * immediately (mirrors mobile ProfileScreen which calls i18n.changeLanguage on
 * language select). We import the CONFIGURED instance from '@/i18n'.
 */
export function useUpdateProfile(): UseMutationResult<User, unknown, UpdateProfileRequest> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: (data: UpdateProfileRequest) => updateProfile(data),
    onSuccess: (_user, variables) => {
      if (variables.language && variables.language !== i18n.language) {
        void i18n.changeLanguage(variables.language);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
    },
    onError: () => {
      showToast(t('errors.saveFailed'), 'error');
    },
  });
}

/** PATCH /users/me/notification-preferences — partial boolean flags. */
export function useUpdateNotificationPrefs(): UseMutationResult<
  User,
  unknown,
  UpdateNotificationPreferencesRequest
> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: (data: UpdateNotificationPreferencesRequest) => updateNotificationPrefs(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
    },
    onError: () => {
      showToast(t('errors.saveFailed'), 'error');
    },
  });
}

/** PATCH /users/me/quiet-hours — both values nullable to disable quiet hours. */
export function useUpdateQuietHours(): UseMutationResult<
  User,
  unknown,
  UpdateQuietHoursRequest
> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: (data: UpdateQuietHoursRequest) => updateQuietHours(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
    },
    onError: () => {
      showToast(t('errors.saveFailed'), 'error');
    },
  });
}

/**
 * PUT /users/me/unit-preferences. The route returns the bare prefs (not a full
 * user), so we seed the cache directly AND invalidate the shared
 * queryKeys.unitPreferences key (reused — do NOT mint a new key).
 */
export function useUpdateUnitPrefs(): UseMutationResult<
  UnitPreferences,
  unknown,
  UpdateUnitPreferencesRequest
> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: (data: UpdateUnitPreferencesRequest) => updateUnitPreferences(data),
    onSuccess: (prefs) => {
      queryClient.setQueryData(queryKeys.unitPreferences, prefs);
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences });
    },
    onError: () => {
      showToast(t('errors.saveFailed'), 'error');
    },
  });
}

/**
 * PATCH /users/me/email-digest — Premium feature. Enabling on a FREE tier
 * rejects with 402 SUBSCRIPTION_REQUIRED; the web cannot transact, so we surface
 * "open the app to upgrade". Disabling is always allowed.
 */
export function useUpdateEmailDigest(): UseMutationResult<
  User,
  unknown,
  UpdateEmailDigestRequest
> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: (data: UpdateEmailDigestRequest) => updateEmailDigest(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
    },
    onError: (error) => {
      if (isSubscriptionRequiredError(error)) {
        promptUpgrade();
      } else {
        showToast(t('errors.saveFailed'), 'error');
      }
    },
  });
}

/**
 * DELETE /users/me — account deletion (soft-delete server-side). On success the
 * CALLER clears the React Query cache + signs out (we do not wire navigation or
 * cache-clear here — it is exposed cleanly for the ProfilePage danger zone).
 */
export function useDeleteAccount(): UseMutationResult<void, unknown, void> {
  const { showToast } = useToast();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: () => deleteAccount(),
    onError: () => {
      showToast(t('errors.saveFailed'), 'error');
    },
  });
}
