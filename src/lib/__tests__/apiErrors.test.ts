import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isPermissionDeniedError,
  isSubscriptionRequiredError,
  isAccessDeniedError,
  isMedicationConflictError,
  isDoseAlreadyLoggedError,
  isMedicationDiscontinuedError,
  PERMISSION_ERROR_CODES,
  SUBSCRIPTION_ERROR_CODES,
  ACCESS_ERROR_CODES,
  CONFLICT_ERROR_CODES,
  FAILURE_FALLBACK_CODES,
} from '@/lib/apiErrors';

// Shapes the apiClient interceptor rejects with: the backend envelope, never an
// AxiosError. 402 → error.response.data; 403/other → error.response.data.
function envelope(code: string) {
  return { success: false, error: { code, message: 'x' } };
}

describe('apiErrors', () => {
  describe('isSubscriptionRequiredError (402)', () => {
    it('is true for SUBSCRIPTION_REQUIRED and PAYMENT_REQUIRED', () => {
      expect(isSubscriptionRequiredError(envelope('SUBSCRIPTION_REQUIRED'))).toBe(true);
      expect(isSubscriptionRequiredError(envelope('PAYMENT_REQUIRED'))).toBe(true);
    });

    it('is false for view/read-only (403) codes', () => {
      expect(isSubscriptionRequiredError(envelope('VIEW_ONLY'))).toBe(false);
      expect(isSubscriptionRequiredError(envelope('READ_ONLY'))).toBe(false);
      expect(isSubscriptionRequiredError(envelope('FORBIDDEN'))).toBe(false);
    });
  });

  describe('isAccessDeniedError (403)', () => {
    it('is true for VIEW_ONLY, FORBIDDEN, READ_ONLY', () => {
      expect(isAccessDeniedError(envelope('VIEW_ONLY'))).toBe(true);
      expect(isAccessDeniedError(envelope('FORBIDDEN'))).toBe(true);
      expect(isAccessDeniedError(envelope('READ_ONLY'))).toBe(true);
    });

    it('is false for subscription (402) codes', () => {
      expect(isAccessDeniedError(envelope('SUBSCRIPTION_REQUIRED'))).toBe(false);
      expect(isAccessDeniedError(envelope('PAYMENT_REQUIRED'))).toBe(false);
    });
  });

  describe('isPermissionDeniedError (any 402/403)', () => {
    it('is true for every permission code (union of both sets)', () => {
      for (const code of PERMISSION_ERROR_CODES) {
        expect(isPermissionDeniedError(envelope(code))).toBe(true);
      }
    });

    it('is false for unrelated codes and malformed rejections', () => {
      expect(isPermissionDeniedError(envelope('SERVER_ERROR'))).toBe(false);
      expect(isPermissionDeniedError(envelope('NOT_FOUND'))).toBe(false);
      expect(isPermissionDeniedError(null)).toBe(false);
      expect(isPermissionDeniedError(undefined)).toBe(false);
      expect(isPermissionDeniedError(new Error('boom'))).toBe(false);
      expect(isPermissionDeniedError({ error: {} })).toBe(false);
      expect(isPermissionDeniedError({ error: { code: 42 } })).toBe(false);
    });
  });

  describe('medication 409 conflicts', () => {
    it('isDoseAlreadyLoggedError matches only DOSE_ALREADY_LOGGED', () => {
      expect(isDoseAlreadyLoggedError(envelope('DOSE_ALREADY_LOGGED'))).toBe(true);
      expect(isDoseAlreadyLoggedError(envelope('MEDICATION_DISCONTINUED'))).toBe(false);
      expect(isDoseAlreadyLoggedError(envelope('SERVER_ERROR'))).toBe(false);
      expect(isDoseAlreadyLoggedError(null)).toBe(false);
    });

    it('isMedicationDiscontinuedError matches only MEDICATION_DISCONTINUED', () => {
      expect(isMedicationDiscontinuedError(envelope('MEDICATION_DISCONTINUED'))).toBe(true);
      expect(isMedicationDiscontinuedError(envelope('DOSE_ALREADY_LOGGED'))).toBe(false);
      expect(isMedicationDiscontinuedError(new Error('boom'))).toBe(false);
      expect(isMedicationDiscontinuedError(undefined)).toBe(false);
    });

    it('isMedicationConflictError covers exactly the 409 code set', () => {
      for (const code of CONFLICT_ERROR_CODES) {
        expect(isMedicationConflictError(envelope(code))).toBe(true);
      }
      expect(isMedicationConflictError(envelope('VIEW_ONLY'))).toBe(false);
      expect(isMedicationConflictError(envelope('SERVER_ERROR'))).toBe(false);
      expect(isMedicationConflictError({ error: {} })).toBe(false);
    });

    it('409 codes never classify as permission errors', () => {
      for (const code of CONFLICT_ERROR_CODES) {
        expect(isPermissionDeniedError(envelope(code))).toBe(false);
      }
    });
  });

  describe('code sets', () => {
    it('PERMISSION = SUBSCRIPTION ∪ ACCESS, with no overlap', () => {
      const union = new Set([...SUBSCRIPTION_ERROR_CODES, ...ACCESS_ERROR_CODES]);
      expect(PERMISSION_ERROR_CODES).toEqual(union);
      for (const code of SUBSCRIPTION_ERROR_CODES) {
        expect(ACCESS_ERROR_CODES.has(code)).toBe(false);
      }
    });
  });
});

// The legacy public re-export from medicationConfirmations must still resolve.
describe('medicationConfirmations re-export (public API stable)', () => {
  it('re-exports isPermissionDeniedError + PERMISSION_ERROR_CODES unchanged', async () => {
    const mod = await import('@/api/medicationConfirmations');
    expect(typeof mod.isPermissionDeniedError).toBe('function');
    expect(mod.isPermissionDeniedError(envelope('VIEW_ONLY'))).toBe(true);
    expect(mod.PERMISSION_ERROR_CODES.has('SUBSCRIPTION_REQUIRED')).toBe(true);
  });
});

/**
 * CROSS-TREE DRIFT GUARD.
 *
 * `FAILURE_FALLBACK_CODES` mirrors `mobile/src/utils/apiError.ts`'s export of
 * the same name — the admin daily digest groups `circle_creation_failed` by
 * this vocabulary across BOTH platforms, so a one-sided edit silently splits
 * one failure into two buckets there.
 *
 * Mobile's suite (`mobile/src/__tests__/utils/failureCodeIsBounded.test.ts`,
 * describe 8 "the vocabulary is identical to the webapp") already pins this
 * list against a hardcoded literal — but only in that direction, so a
 * mobile-only edit was caught by nothing on this side. This closes the other
 * direction by reading mobile's actual export (not a copy of it), so drift in
 * either tree fails on the tree that changed.
 *
 * The two projects are separate npm workspaces that cannot import each
 * other via a package specifier, but `mobile/src/utils/apiError.ts` has NO
 * imports of its own (no react-native/expo dependency) — verified by
 * inspection — so a plain relative dynamic `import()` resolves it under
 * vitest same as any other TS module. `skipIf` guards the case where the
 * mobile checkout is absent (e.g. a webapp-only clone).
 */
// Resolved from the webapp repo root (vitest's process.cwd()), not from
// import.meta.url — under the vite/vitest SSR module loader import.meta.url
// for a test file is not always a plain file:// URL, so fileURLToPath on it
// is unreliable here.
const MOBILE_API_ERROR_PATH = resolve(process.cwd(), '../mobile/src/utils/apiError.ts');
const mobileApiErrorAvailable = existsSync(MOBILE_API_ERROR_PATH);

describe.skipIf(!mobileApiErrorAvailable)('FAILURE_FALLBACK_CODES vocabulary contract', () => {
  it('pins the literal web vocabulary, in order', () => {
    expect([...FAILURE_FALLBACK_CODES]).toEqual([
      'timeout',
      'network_error',
      'api_error_no_code',
      'non_json_response',
      'client_error',
      'unknown_error',
    ]);
  });

  it('matches mobile/src/utils/apiError.ts FAILURE_FALLBACK_CODES exactly, both directions', async () => {
    // A relative specifier (not the absolute MOBILE_API_ERROR_PATH above, and
    // no @vite-ignore) so vitest's vite-node loader statically resolves and
    // transforms this plain-TS file through its normal pipeline — an absolute
    // path or a `file://` URL bypasses that transform and Node cannot execute
    // a raw .ts file on its own. Built from a variable (not an inline string
    // literal) because tsc's `--noEmit` type-check statically resolves a
    // literal `import('...ts')` specifier and rejects the `.ts` extension
    // (TS5097) even though vite-node handles it fine at test-run time.
    // @ts-expect-error TS5097 — a `.ts` extension needs
    // `allowImportingTsExtensions`, which this project does not otherwise
    // need; vite-node (this test's real runtime) resolves and transforms the
    // specifier correctly regardless of tsc's stricter static check.
    const mobileModule = (await import('../../../../mobile/src/utils/apiError.ts')) as {
      FAILURE_FALLBACK_CODES: readonly string[];
    };
    const mobileList = [...mobileModule.FAILURE_FALLBACK_CODES];
    const webList = [...FAILURE_FALLBACK_CODES];

    // Both directions: nothing on mobile is missing from web, and nothing on
    // web is missing from mobile (a Set-equality check, not just subset).
    for (const code of mobileList) {
      expect(webList).toContain(code);
    }
    for (const code of webList) {
      expect(mobileList).toContain(code);
    }
    expect(webList).toHaveLength(mobileList.length);
  });
});

if (!mobileApiErrorAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[apiErrors.test.ts] mobile checkout not found at ${MOBILE_API_ERROR_PATH} — ` +
      'FAILURE_FALLBACK_CODES vocabulary contract tests skipped.'
  );
}
