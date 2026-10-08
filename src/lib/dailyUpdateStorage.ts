/**
 * Per-browser daily-update state (docs/plans/daily-update.md §5.3 / §6, P5).
 *
 * Both values are the recipient-local date they apply to, so they expire on
 * their own at the recipient's midnight. They hold no PHI. Every key starts
 * with `circlecare:dailyUpdate` and is wiped on sign-out
 * (`clearDailyUpdateStorage`, called from authStore's local teardown) so a
 * second account on a shared browser never inherits them.
 *
 * Every access is wrapped: storage can throw (Safari private mode, blocked
 * site data). A failed read means "not dismissed / not shown yet".
 */
export const DAILY_UPDATE_STORAGE_PREFIX = 'circlecare:dailyUpdate';

export const dailyUpdateDismissKey = (circleId: string): string =>
  `${DAILY_UPDATE_STORAGE_PREFIX}Dismissed:${circleId}`;

export const dailyUpdateShownKey = (circleId: string): string =>
  `${DAILY_UPDATE_STORAGE_PREFIX}Shown:${circleId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the card simply comes back on the next load.
  }
}

export function isDailyUpdateDismissed(circleId: string, localDate: string): boolean {
  return read(dailyUpdateDismissKey(circleId)) === localDate;
}

export function markDailyUpdateDismissed(circleId: string, localDate: string): void {
  write(dailyUpdateDismissKey(circleId), localDate);
}

export function wasDailyUpdateShown(circleId: string, localDate: string): boolean {
  return read(dailyUpdateShownKey(circleId)) === localDate;
}

export function markDailyUpdateShown(circleId: string, localDate: string): void {
  write(dailyUpdateShownKey(circleId), localDate);
}

/** Sign-out teardown: remove every daily-update key for every circle. */
export function clearDailyUpdateStorage(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(DAILY_UPDATE_STORAGE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
