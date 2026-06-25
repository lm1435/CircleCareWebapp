import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getEmergencyInfo,
  updateEmergencyInfo,
  type AdditionalDoctor,
  type EmergencyContact,
  type EmergencyInfo,
  type InsurancePlan,
  type UpdateEmergencyInfoRequest,
} from '@/api/emergencyInfo';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';

/**
 * React Query hook for `GET /circles/:circleId/emergency-info` (plan Task 30).
 * Mirrors mobile/src/hooks/useEmergencyInfo.ts. Resolves to null when the
 * circle has no emergency info yet.
 */
export function useEmergencyInfo(
  circleId: string | undefined
): UseQueryResult<EmergencyInfo | null> {
  return useQuery({
    queryKey: queryKeys.emergencyInfo(circleId ?? ''),
    queryFn: () => getEmergencyInfo(circleId as string),
    enabled: !!circleId, // Only fetch when circleId is available
  });
}

// ============================================================================
// READ-MODIFY-WRITE ARRAY HELPERS (plan Task 4.2)
//
// The backend PUT replaces an array section WHOLESALE — there is no per-item
// endpoint. So the future section modals assemble the FULL next array
// client-side from the current `emergencyInfo` snapshot, then send it as the
// section's partial. These pure helpers are the canonical (and tested)
// implementation of that read-modify-write, mirroring mobile's edit screens:
//   - EditDoctorScreen / EditContactScreen / EditInsuranceScreen
//
// Semantics mirrored exactly:
//   - ADD    → append to the end of the existing array.
//   - EDIT   → replace at index (out-of-range index appends, never throws).
//   - DELETE → filter out the item at index.
//   - PRIMARY exclusivity (contacts + insurance): when the saved item is
//     primary, every OTHER item's is_primary is cleared so only one remains
//     primary. Mobile does `arr.map(x => ({ ...x, is_primary: false }))`
//     BEFORE inserting the primary item. Doctors have NO primary flag (the
//     primary doctor is the flat primary_doctor_* fields, edited separately).
//
// All helpers are PURE and return a NEW array — never mutate the input.
// ============================================================================

/** Append `item` to the end of `arr` (returns a new array). */
export function appendItem<T>(arr: readonly T[], item: T): T[] {
  return [...arr, item];
}

/**
 * Replace the element at `index` with `item` (returns a new array). If `index`
 * is out of range the item is appended instead — matching mobile, where an
 * undefined edit-index falls through to the add path.
 */
export function replaceAtIndex<T>(arr: readonly T[], index: number, item: T): T[] {
  if (index < 0 || index >= arr.length) {
    return [...arr, item];
  }
  const next = [...arr];
  next[index] = item;
  return next;
}

/** Remove the element at `index` (returns a new array; no-op if out of range). */
export function filterOutIndex<T>(arr: readonly T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

/**
 * Clear `is_primary` on every item EXCEPT the one at `keepIndex`. Pass
 * `keepIndex < 0` (e.g. -1) to clear it on ALL items. Pure — returns a new
 * array of new objects.
 */
function clearPrimaryExcept<T extends { is_primary?: boolean }>(
  arr: readonly T[],
  keepIndex: number
): T[] {
  return arr.map((item, i) => (i === keepIndex ? item : { ...item, is_primary: false }));
}

/**
 * Upsert a primary-capable item (emergency contact OR insurance plan) into a
 * read-modify-write array with single-primary exclusivity.
 *
 * Mirrors EditContactScreen / EditInsuranceScreen `handleSave`:
 *   1. start from the current array,
 *   2. if the incoming item is primary, clear is_primary on all OTHERS,
 *   3. replace at `index` (edit) or append (add when `index` is undefined).
 *
 * Returns the FULL next array to send as the section's partial.
 */
export function upsertWithPrimaryExclusivity<T extends { is_primary?: boolean }>(
  arr: readonly T[],
  item: T,
  index?: number
): T[] {
  const isAdd = index === undefined || index < 0 || index >= arr.length;
  // The kept index is where the (possibly primary) item will live afterwards.
  const keepIndex = isAdd ? arr.length : index;
  const cleared = item.is_primary ? clearPrimaryExcept(arr, keepIndex) : [...arr];
  return isAdd ? appendItem(cleared, item) : replaceAtIndex(cleared, index, item);
}

// ============================================================================
// NULL → UNDEFINED NORMALIZERS
//
// The READ types (`EmergencyContact` / `InsurancePlan`) allow `country_code:
// string | null`, but the PUT body schema (`updateEmergencyInfoSchema`, mirror
// of backend) types those `country_code` fields as `.optional()` only — the
// backend REJECTS an explicit null there. A read-modify-write that round-trips
// an existing item with a null country_code would otherwise send null and 400.
// These map null → undefined so the assembled array matches the request type
// and the backend constraint. (Doctors' country_code IS nullable in the schema,
// so additional_doctors needs no normalization.)
// ============================================================================

/** Strip nulls from contact `country_code` so the array matches the PUT schema. */
export function toRequestContacts(
  arr: readonly EmergencyContact[]
): UpdateEmergencyInfoRequest['emergency_contacts'] {
  return arr.map((c) => ({ ...c, country_code: c.country_code ?? undefined }));
}

/** Strip nulls from plan `country_code`/`photo_url` so it matches the PUT schema. */
export function toRequestPlans(
  arr: readonly InsurancePlan[]
): UpdateEmergencyInfoRequest['insurance_plans'] {
  return arr.map((p) => ({
    ...p,
    label: p.label ?? undefined,
    policy_number: p.policy_number ?? undefined,
    group_number: p.group_number ?? undefined,
    phone: p.phone ?? undefined,
    country_code: p.country_code ?? undefined,
    photo_url: p.photo_url ?? undefined,
    rx_bin: p.rx_bin ?? undefined,
    rx_pcn: p.rx_pcn ?? undefined,
    rx_group: p.rx_group ?? undefined,
  }));
}

// Re-export the array element types so the future modals import everything
// emergency-edit-related from this hook module.
export type { AdditionalDoctor, EmergencyContact, InsurancePlan, UpdateEmergencyInfoRequest };

// ============================================================================
// WRITE HOOK (plan Task 4.2) — mirrors the canonical mutation pattern in
// useMedConfirmation.ts / useDocuments.ts: mutationFn → onSuccess invalidates
// queryKeys.emergencyInfo(circleId) → onError classifies 402/403 via
// lib/apiErrors so the section modals show distinct messages.
// ============================================================================

/**
 * PUT /circles/:circleId/emergency-info — partial merge. Send only the slice(s)
 * the user changed; assemble array sections with the read-modify-write helpers
 * above. Invalidates the emergency-info query (and the activity feed, which the
 * backend appends an `emergency_info_updated` entry to) on success.
 *
 * On 402 SUBSCRIPTION_REQUIRED (free-tier write block) → "open the app to
 * upgrade" + refetch circle flags. On 403 (view/read-only) → "no permission" +
 * refetch flags. Everything else → generic save-failed.
 */
export function useUpdateEmergencyInfo(
  circleId: string
): UseMutationResult<EmergencyInfo, unknown, UpdateEmergencyInfoRequest> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation('emergency');

  return useMutation({
    mutationFn: (partial: UpdateEmergencyInfoRequest) => updateEmergencyInfo(circleId, partial),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.emergencyInfo(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
    },
    onError: (error) => {
      if (isSubscriptionRequiredError(error)) {
        // Free-tier write block — web cannot transact, point at the app.
        promptUpgrade();
        void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
      } else if (isPermissionDeniedError(error)) {
        showToast(t('errors.permissionDenied'), 'error');
        void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
      } else {
        showToast(t('errors.saveFailed'), 'error');
        // Refetch so the UI reflects whatever the server actually has after a
        // failed last-write-wins partial merge.
        void queryClient.invalidateQueries({ queryKey: queryKeys.emergencyInfo(circleId) });
      }
    },
  });
}
