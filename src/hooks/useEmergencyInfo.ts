import { useRef, useState } from 'react';
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
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import {
  classifyFailureCode,
  getEmergencyInfoConflict,
  isPermissionDeniedError,
  isSubscriptionRequiredError,
} from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { Analytics } from '@/lib/analytics';

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

// ============================================================================
// PK5 — per-field optimistic concurrency (backend: GET `data.versions`, PUT
// `if_match`, 409 EMERGENCY_INFO_CHANGED).
//
// Rules the editors rely on:
//   - `if_match` names EXACTLY the fields the body writes, with the hashes from
//     the snapshot the editor was SEEDED from (never the live cache, which a
//     background refetch may have moved past the form's draft).
//   - No `versions` (older backend / blank synthesized record) -> no `if_match`:
//     today's last-write-wins.
//   - On 409 the hook toasts, refetches, and the editor re-seeds from the fresh
//     server data (a stale draft re-submitted would resurrect what the other
//     caregiver removed — the bug being fixed). Nothing is silently overwritten.
// ============================================================================

/** Add `if_match` for exactly the fields in `partial` when `info` carries versions. */
export function withIfMatch(
  info: Pick<EmergencyInfo, 'versions'> | null | undefined,
  partial: UpdateEmergencyInfoRequest
): UpdateEmergencyInfoRequest {
  const versions = info?.versions;
  if (!versions) return partial;
  const ifMatch: Record<string, string> = {};
  for (const field of Object.keys(partial)) {
    if (field !== 'if_match' && typeof versions[field] === 'string') ifMatch[field] = versions[field];
  }
  return Object.keys(ifMatch).length > 0 ? { ...partial, if_match: ifMatch } : partial;
}

// ============================================================================
// PAGE-LEVEL DELETE: delete the ENTRY the user chose, never "whatever sits at
// that position now".
//
// The page used to remember only the POSITION of the entry (`index`) and, on
// confirm, slice the LIVE cache with it under the LIVE versions. A refetch while
// the confirm was open (tab refocus is the trigger) swapped the list underneath:
// another caregiver had removed an EARLIER entry, the position named its
// neighbour, and because the versions were fresh too there was no 409 -- the
// neighbour was deleted and the chosen entry stayed.
//
// The fix mirrors mobile (the edit screens delete from `seedRef`, a frozen seed):
// the delete is built from `base`, the snapshot the list was RENDERED from when
// the user picked Delete (array AND versions come from that one snapshot, which a
// refetch cannot replace), so the body is exactly "what the user saw, minus the
// entry they chose" with the versions of what they saw. If anything in that
// section has changed since (an entry added, removed, moved or edited, the
// chosen one included), the server refuses with 409 EMERGENCY_INFO_CHANGED and
// nothing is deleted: toast, reload, the user picks again from the fresh list.
// A silent re-target ("find the entry again and delete it there") was rejected on
// purpose: it would run a destructive action against a list the user has not
// seen. Refusing costs one extra tap and can never remove the wrong entry.
// ============================================================================

/** Which entry the user chose to remove (`index` = position in the list they saw). */
export type EmergencyDeleteTarget =
  | { kind: 'doctor-primary' }
  | { kind: 'doctor'; index: number }
  | { kind: 'contact'; index: number }
  | { kind: 'insurance'; index: number };

/**
 * The PUT body that removes `target` from `base`, with `if_match` for exactly the
 * fields it writes, taken from `base` (see the block above). Pure: nothing but
 * `base` and `target` decides the result.
 */
export function buildEmergencyDelete(
  base: EmergencyInfo | null | undefined,
  target: EmergencyDeleteTarget
): UpdateEmergencyInfoRequest {
  switch (target.kind) {
    case 'doctor-primary':
      return withIfMatch(base, {
        primary_doctor_name: null,
        primary_doctor_specialty: null,
        primary_doctor_phone: null,
        primary_doctor_address: null,
      });
    case 'doctor':
      return withIfMatch(base, {
        additional_doctors: filterOutIndex(base?.additional_doctors ?? [], target.index),
      });
    case 'contact':
      return withIfMatch(base, {
        emergency_contacts: toRequestContacts(
          filterOutIndex(base?.emergency_contacts ?? [], target.index)
        ),
      });
    case 'insurance':
      return withIfMatch(base, {
        insurance_plans: toRequestPlans(filterOutIndex(base?.insurance_plans ?? [], target.index)),
      });
  }
}

/**
 * Index of `original` in the fresh `list` (same index preferred), or -1 when the
 * other caregiver removed or rewrote it. `same` decides identity.
 */
export function relocateIndex<T>(
  list: readonly T[] | null | undefined,
  original: T | undefined,
  preferred: number,
  same: (a: T, b: T) => boolean
): number {
  if (!list || original === undefined) return -1;
  if (preferred >= 0 && preferred < list.length && same(list[preferred], original)) return preferred;
  return list.findIndex((item) => same(item, original));
}

/**
 * Editor seed that can be replaced after a 409. `info` is what the modal was
 * opened with; `reseed()` swaps in the freshly refetched cache entry and bumps
 * `epoch` (use it as the form's `key` so every field re-initializes). The
 * opening snapshot is frozen so background refetches never shift a live draft.
 */
export function useEmergencyEditSeed(
  circleId: string,
  info: EmergencyInfo | null
): {
  info: EmergencyInfo | null;
  epoch: number;
  latest: () => EmergencyInfo | null;
  reseed: () => void;
} {
  const queryClient = useQueryClient();
  const [reseeded, setReseeded] = useState<{ info: EmergencyInfo | null; epoch: number } | null>(
    null
  );
  // Freeze the snapshot the editor opened with: a background refetch must not
  // move the base array / versions under a draft the user is still typing.
  const frozen = useRef<EmergencyInfo | null>(info);
  if (!frozen.current && info) frozen.current = info;
  const latest = (): EmergencyInfo | null =>
    queryClient.getQueryData<EmergencyInfo | null>(queryKeys.emergencyInfo(circleId)) ?? null;
  const reseed = (): void => {
    const fresh = latest();
    setReseeded((prev) => ({ info: fresh, epoch: (prev?.epoch ?? 0) + 1 }));
  };
  return {
    info: reseeded ? (reseeded.info ?? frozen.current) : frozen.current,
    epoch: reseeded?.epoch ?? 0,
    latest,
    reseed,
  };
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
  // Premium-gated write — FEATURE. Circle-level: the 402 is the OWNER's tier,
  // so only the owner is offered Upgrade (see usePremiumGate).
  const { promptUpgrade } = usePremiumGate('feature', { circleId });
  const { t } = useTranslation('emergency');

  return useMutation({
    mutationFn: (partial: UpdateEmergencyInfoRequest) => updateEmergencyInfo(circleId, partial),
    onSuccess: (_info, partial) => {
      // Field NAMES only — never the values, which can carry PHI.
      Analytics.emergencyInfoUpdated(
        circleId,
        Object.keys(partial).filter((field) => field !== 'if_match')
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.emergencyInfo(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
    },
    onError: async (error) => {
      // PK5: another caregiver changed the section. Not an error to log or a
      // generic failure: tell the user, then reload the server data so the
      // editor (which re-seeds when this settles) shows the latest version.
      const conflict = getEmergencyInfoConflict(error);
      if (conflict) {
        Analytics.emergencyInfoConflict(conflict.fields.length);
        showToast(`${t('conflict.title')}. ${t('conflict.message')}`, 'error');
        await queryClient.refetchQueries({ queryKey: queryKeys.emergencyInfo(circleId) });
        return;
      }
      // `error_occurred` for the admin digest (mobile parity). ids/enums only
      // — never the field values (PHI) and never the toast copy.
      Analytics.errorOccurred('emergency_info', 'emergency_info_mutation_error', {
        circle_id: circleId,
        code: classifyFailureCode(error),
      });
      if (isSubscriptionRequiredError(error)) {
        // Free-tier write block — web cannot transact, point at the app.
        promptUpgrade();
        invalidateCircleAccessFlags(queryClient, circleId);
      } else if (isPermissionDeniedError(error)) {
        showToast(t('errors.permissionDenied'), 'error');
        invalidateCircleAccessFlags(queryClient, circleId);
      } else {
        showToast(t('errors.saveFailed'), 'error');
        // Refetch so the UI reflects whatever the server actually has after a
        // failed last-write-wins partial merge.
        void queryClient.invalidateQueries({ queryKey: queryKeys.emergencyInfo(circleId) });
      }
    },
  });
}
