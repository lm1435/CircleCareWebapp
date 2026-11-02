import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDependent = vi.fn();
const mockUpdate = vi.fn();
const mockSynced = vi.fn();
vi.mock('@/api/users', () => ({
  getTimezoneDependentCircles: () => mockDependent(),
  updateProfile: (...a: unknown[]) => mockUpdate(...a),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: { timezoneSynced: (...a: unknown[]) => mockSynced(...a) },
}));

import { syncDeviceTimezone } from '../deviceTimezoneSync';
import { isSameTimezone } from '../timezone';

beforeEach(() => {
  vi.clearAllMocks();
  mockDependent.mockResolvedValue([]);
  mockUpdate.mockResolvedValue({});
});

describe('syncDeviceTimezone (the profile zone follows the browser)', () => {
  it('stored null -> PATCH the device zone', async () => {
    expect(await syncDeviceTimezone(null, 'Europe/Madrid')).toBe('written');
    expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'Europe/Madrid' });
    expect(mockSynced).toHaveBeenCalledWith(false);
  });

  it('differs, nothing depends on it -> PATCH', async () => {
    expect(await syncDeviceTimezone('America/Denver', 'Europe/Madrid')).toBe('written');
    expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'Europe/Madrid' });
    expect(mockSynced).toHaveBeenCalledWith(false);
  });

  it('differs AND circles depend on the zone -> STILL PATCHes (the phone dictates); event carries the flag', async () => {
    mockDependent.mockResolvedValue([{ id: 'c1', recipient_name: 'Mom' }]);
    expect(await syncDeviceTimezone('America/Denver', 'Europe/Madrid')).toBe('written');
    expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'Europe/Madrid' });
    expect(mockSynced).toHaveBeenCalledWith(true);
  });

  it('a failed dependency read never blocks the write', async () => {
    mockDependent.mockRejectedValue(new Error('network'));
    expect(await syncDeviceTimezone('America/Denver', 'Europe/Madrid')).toBe('written');
    expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'Europe/Madrid' });
    expect(mockSynced).toHaveBeenCalledWith(false);
  });

  it('same zone -> no PATCH, no dependency read', async () => {
    expect(await syncDeviceTimezone('America/Denver', 'America/Denver')).toBe('same');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDependent).not.toHaveBeenCalled();
  });

  it('a legacy alias of the device zone is the same zone', async () => {
    expect(await syncDeviceTimezone('Asia/Calcutta', 'Asia/Kolkata')).toBe('same');
    expect(isSameTimezone('Asia/Calcutta', 'Asia/Kolkata')).toBe(true);
    expect(isSameTimezone('Asia/Calcutta', 'Europe/Madrid')).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a failed PATCH reports failed and fires no event', async () => {
    mockUpdate.mockRejectedValue(new Error('500'));
    expect(await syncDeviceTimezone('America/Denver', 'Europe/Madrid')).toBe('failed');
    expect(mockSynced).not.toHaveBeenCalled();
  });
});
