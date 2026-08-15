import { apiClient } from '@/lib/api';
import {
  updateProfile,
  updateNotificationPrefs,
  updateQuietHours,
  updateUnitPreferences,
  getUnitPreferences,
  updateEmailDigest,
  deleteAccount,
  exportUserData,
  updateProfileSchema,
  updateEmailDigestSchema,
  updateUnitPreferencesSchema,
  updateQuietHoursSchema,
} from '@/api/users';

// `@/lib/api` is mocked globally in src/test/setup.ts — the response interceptor
// (envelope-unwrapping) is bypassed, so we resolve each mock with the already
// "unwrapped" `{ success, data }` shape the api fns read off `response.data.*`.
const mockGet = vi.mocked(apiClient.get);
const mockPatch = vi.mocked(apiClient.patch);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);

const user = { id: 'u1', email: 'a@b.co' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateProfile', () => {
  it('PATCHes /users/me with the body and returns the user', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { user } } as never);

    const result = await updateProfile({ first_name: 'Sam', language: 'es' });

    expect(result).toEqual(user);
    expect(mockPatch).toHaveBeenCalledWith('/users/me', {
      first_name: 'Sam',
      language: 'es',
    });
  });
});

describe('updateNotificationPrefs', () => {
  it('PATCHes /users/me/notification-preferences with partial flags', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { user } } as never);

    const result = await updateNotificationPrefs({ task_assignments: false });

    expect(result).toEqual(user);
    expect(mockPatch).toHaveBeenCalledWith('/users/me/notification-preferences', {
      task_assignments: false,
    });
  });
});

describe('updateQuietHours', () => {
  it('PATCHes /users/me/quiet-hours with HH:MM strings', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { user } } as never);

    await updateQuietHours({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' });

    expect(mockPatch).toHaveBeenCalledWith('/users/me/quiet-hours', {
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
    });
  });

  it('PATCHes nulls to disable quiet hours', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { user } } as never);

    await updateQuietHours({ quiet_hours_start: null, quiet_hours_end: null });

    expect(mockPatch).toHaveBeenCalledWith('/users/me/quiet-hours', {
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
  });
});

describe('unit preferences', () => {
  const prefs = { weight_unit: 'kg', glucose_unit: 'mmol/L' } as const;

  it('PUTs /users/me/unit-preferences and returns the bare prefs', async () => {
    mockPut.mockResolvedValue({ success: true, data: prefs } as never);

    const result = await updateUnitPreferences({ weight_unit: 'kg' });

    expect(result).toEqual(prefs);
    expect(mockPut).toHaveBeenCalledWith('/users/me/unit-preferences', {
      weight_unit: 'kg',
    });
  });

  it('GETs /users/me/unit-preferences', async () => {
    mockGet.mockResolvedValue({ success: true, data: prefs } as never);

    const result = await getUnitPreferences();

    expect(result).toEqual(prefs);
    expect(mockGet).toHaveBeenCalledWith('/users/me/unit-preferences');
  });
});

describe('updateEmailDigest', () => {
  it('PATCHes /users/me/email-digest with enabled + day', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { user } } as never);

    await updateEmailDigest({ enabled: true, day: 1 });

    expect(mockPatch).toHaveBeenCalledWith('/users/me/email-digest', {
      enabled: true,
      day: 1,
    });
  });
});

describe('deleteAccount', () => {
  it('DELETEs /users/me', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);

    await deleteAccount();

    expect(mockDelete).toHaveBeenCalledWith('/users/me');
  });
});

describe('exportUserData', () => {
  it('GETs /users/me/export as a blob and returns it', async () => {
    const blob = new Blob(['{"user":{}}'], { type: 'application/json' });
    mockGet.mockResolvedValue(blob as never);

    const result = await exportUserData();

    expect(result).toBe(blob);
    expect(mockGet).toHaveBeenCalledWith('/users/me/export', { responseType: 'blob' });
  });

  it('re-hydrates a Blob rejection into the JSON error envelope (429 RATE_LIMIT)', async () => {
    // With responseType 'blob', axios parses the 429 error BODY as a Blob, so
    // the interceptor rejects with a Blob — exportUserData must restore the
    // envelope so callers can classify via error.code.
    const envelope = {
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
    };
    mockGet.mockRejectedValue(new Blob([JSON.stringify(envelope)], {
      type: 'application/json',
    }) as never);

    await expect(exportUserData()).rejects.toEqual(envelope);
  });

  it('passes non-Blob rejections through unchanged', async () => {
    const envelope = { success: false, error: { code: 'SERVER_ERROR' } };
    mockGet.mockRejectedValue(envelope as never);

    await expect(exportUserData()).rejects.toEqual(envelope);
  });

  it('passes a non-JSON Blob rejection through as the original Blob', async () => {
    const blob = new Blob(['<html>Bad Gateway</html>'], { type: 'text/html' });
    mockGet.mockRejectedValue(blob as never);

    await expect(exportUserData()).rejects.toBe(blob);
  });
});

describe('web Zod schemas mirror the backend route constraints', () => {
  it('updateProfileSchema enforces name length + language enum', () => {
    expect(updateProfileSchema.safeParse({ first_name: '' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ first_name: 'a'.repeat(51) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ language: 'fr' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ language: 'es', first_name: 'Sam' }).success).toBe(
      true
    );
  });

  it('updateUnitPreferencesSchema enforces unit enums', () => {
    expect(updateUnitPreferencesSchema.safeParse({ weight_unit: 'stone' }).success).toBe(false);
    expect(updateUnitPreferencesSchema.safeParse({ glucose_unit: 'mmol/L' }).success).toBe(true);
  });

  it('updateQuietHoursSchema enforces HH:MM regex and allows null', () => {
    expect(
      updateQuietHoursSchema.safeParse({ quiet_hours_start: '9:00', quiet_hours_end: null })
        .success
    ).toBe(false);
    expect(
      updateQuietHoursSchema.safeParse({ quiet_hours_start: '09:00', quiet_hours_end: '21:30' })
        .success
    ).toBe(true);
    expect(
      updateQuietHoursSchema.safeParse({ quiet_hours_start: null, quiet_hours_end: null }).success
    ).toBe(true);
  });

  // quiet_hours_* are Postgres TIME columns — the API returns "22:00:00". A
  // client that hydrates that and sends it back for the field the user did NOT
  // edit must not be rejected (that bug made "edit only the end time" 400).
  it('updateQuietHoursSchema accepts HH:MM:SS and normalizes it to HH:MM', () => {
    const parsed = updateQuietHoursSchema.safeParse({
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '07:00:00',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' });
  });

  it('updateQuietHoursSchema normalizes a mixed HH:MM:SS / HH:MM pair', () => {
    // Exactly the "user edited only the end time" payload.
    const parsed = updateQuietHoursSchema.safeParse({
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '08:30',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ quiet_hours_start: '22:00', quiet_hours_end: '08:30' });
  });

  it('updateQuietHoursSchema keeps null/null (disable) working after the relax', () => {
    const parsed = updateQuietHoursSchema.safeParse({
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ quiet_hours_start: null, quiet_hours_end: null });
  });

  it('updateQuietHoursSchema still rejects genuinely invalid times', () => {
    // The old \d{2}:\d{2} regex accepted "99:99" — the ranged regex does not.
    for (const bad of [
      '99:99',
      '24:00',
      '22:60',
      '22:00:60',
      '9:00',
      '22',
      '22:0',
      '10:00 PM',
      '22:00:00.000', // seconds-with-fraction is not a wire format we accept
      '',
    ]) {
      expect(
        updateQuietHoursSchema.safeParse({ quiet_hours_start: bad, quiet_hours_end: null }).success
      ).toBe(false);
    }
  });

  it('updateEmailDigestSchema requires enabled + clamps day 0-6', () => {
    expect(updateEmailDigestSchema.safeParse({}).success).toBe(false);
    expect(updateEmailDigestSchema.safeParse({ enabled: true, day: 7 }).success).toBe(false);
    expect(updateEmailDigestSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateEmailDigestSchema.safeParse({ enabled: true, day: 6 }).success).toBe(true);
  });
});
