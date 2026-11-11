import { getTimezoneDependentCircles, updateProfile } from '@/api/users';
import { Analytics } from '@/lib/analytics';
import { getDeviceTimezone, isSameTimezone } from '@/utils/timezone';

/**
 * Returning to a tab re-reads the browser zone at most this often (mobile's constant of the same name,
 * `useDeviceSettingsForegroundSync`): a tab left open across travel would otherwise keep the old zone.
 */
export const FOREGROUND_SETTINGS_SYNC_THROTTLE_MS = 5 * 60 * 1000;

export type DeviceTimezoneSyncOutcome = 'same' | 'written' | 'failed';

/**
 * The profile time zone FOLLOWS THE DEVICE and is read-only in the UI ("their
 * phone dictates"; twin of mobile's `syncDeviceSettings` timezone half): PATCH
 * when the stored zone is null or differs from the browser's. There is NO
 * exception for circles whose schedule follows the user's zone: they move with
 * it. The dependent-circles read only fills the analytics boolean (best effort;
 * a failed read reports false and never blocks the write).
 */
export async function syncDeviceTimezone(
  stored: string | null | undefined,
  device: string = getDeviceTimezone()
): Promise<DeviceTimezoneSyncOutcome> {
  if (!device || isSameTimezone(stored, device)) return 'same';
  try {
    await updateProfile({ timezone: device });
  } catch {
    return 'failed';
  }
  let hadDependentCircles = false;
  try {
    hadDependentCircles = (await getTimezoneDependentCircles()).length > 0;
  } catch {
    hadDependentCircles = false;
  }
  Analytics.timezoneSynced(hadDependentCircles);
  return 'written';
}
