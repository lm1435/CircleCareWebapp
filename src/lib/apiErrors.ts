// Shared API error classification for the web companion.
//
// The apiClient response interceptor (src/lib/api.ts) rejects with the backend
// envelope (`{ success: false, error: { code, message } }`), NOT an AxiosError:
//   - 402 Payment Required → `error.response.data` (envelope) — purchase flow is
//     mobile-only, so the web caller shows "open the app to upgrade".
//   - 403 / other failures → `error.response.data` (envelope) via the final
//     `Promise.reject(error.response?.data || error)`.
// So every write hook can classify a rejection by reading `err.error.code`.
//
// This generalizes the `isPermissionDeniedError` helper that originally lived in
// src/api/medicationConfirmations.ts so all write hooks classify 402/403 the
// same way and can distinguish "subscription required" (open app to upgrade)
// from "no permission" (view/read-only).

interface ApiErrorEnvelope {
  success?: boolean;
  error?: { code?: string; message?: string };
}

/**
 * 402 Payment Required codes — the user must upgrade to perform this write.
 * Web cannot transact (RevenueCat is mobile-SDK-only), so the caller shows an
 * "open the CircleCare app to upgrade" affordance.
 */
export const SUBSCRIPTION_ERROR_CODES = new Set(['SUBSCRIPTION_REQUIRED', 'PAYMENT_REQUIRED']);

/**
 * 403 Forbidden codes — the user does not have edit permission on this circle
 * (membership view-only, or non-selected free-tier circle = read-only). The
 * caller shows a "you don't have permission" toast and refetches circle flags.
 */
export const ACCESS_ERROR_CODES = new Set(['VIEW_ONLY', 'FORBIDDEN', 'READ_ONLY']);

/**
 * 413 Payload Too Large codes — the PREMIUM circle has hit its hard storage cap
 * (1GB) and no upgrade can lift it (unlike the free-tier 402 path). The caller
 * shows "storage full", NOT "open the app to upgrade". Backend emits this from
 * the documents upload route (backend/src/routes/documents.ts) once a premium
 * circle exceeds PREMIUM_STORAGE_BYTES.
 */
export const STORAGE_FULL_ERROR_CODES = new Set(['STORAGE_LIMIT_EXCEEDED']);

/**
 * Union of all 402/403 access-rejection codes from `requireCircleEditAccess`
 * and friends. Kept verbatim from the original medicationConfirmations helper
 * so nothing that imported it changes behavior.
 */
export const PERMISSION_ERROR_CODES = new Set([
  ...SUBSCRIPTION_ERROR_CODES,
  ...ACCESS_ERROR_CODES,
]);

/** Extract the backend error code from an apiClient rejection, if present. */
function errorCode(err: unknown): string | undefined {
  const code = (err as ApiErrorEnvelope | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * True when the rejection is any 402/403 access rejection — the caller cannot
 * perform this write. Prefer `isSubscriptionRequiredError` /
 * `isAccessDeniedError` when the UI needs to distinguish the two.
 */
export function isPermissionDeniedError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && PERMISSION_ERROR_CODES.has(code);
}

/**
 * True for a 402 `SUBSCRIPTION_REQUIRED` / `PAYMENT_REQUIRED` rejection — the
 * write is premium-gated and the user must upgrade. Web shows "open the app to
 * upgrade" (no web purchase flow).
 */
export function isSubscriptionRequiredError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && SUBSCRIPTION_ERROR_CODES.has(code);
}

/**
 * True for a 403 view-only / read-only rejection — the user lacks edit
 * permission on this circle. Web shows "no permission" and refetches flags.
 */
export function isAccessDeniedError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && ACCESS_ERROR_CODES.has(code);
}

/**
 * True for a 413 `STORAGE_LIMIT_EXCEEDED` rejection — a PREMIUM circle has hit
 * its 1GB hard cap. Distinct from `isSubscriptionRequiredError` (the free-tier
 * 402 path): there is nothing to upgrade to, so the caller shows "storage full"
 * rather than "open the app to upgrade".
 */
export function isStorageFullError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && STORAGE_FULL_ERROR_CODES.has(code);
}
