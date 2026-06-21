import { apiClient } from '@/lib/api';
import {
  updateProfile,
  updateNotificationPrefs,
  updateQuietHours,
  updateUnitPreferences,
  getUnitPreferences,
  updateEmailDigest,
  deleteAccount,
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

  it('updateEmailDigestSchema requires enabled + clamps day 0-6', () => {
    expect(updateEmailDigestSchema.safeParse({}).success).toBe(false);
    expect(updateEmailDigestSchema.safeParse({ enabled: true, day: 7 }).success).toBe(false);
    expect(updateEmailDigestSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateEmailDigestSchema.safeParse({ enabled: true, day: 6 }).success).toBe(true);
  });
});
