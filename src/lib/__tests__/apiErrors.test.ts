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
