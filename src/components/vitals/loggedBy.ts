import type { HealthVital } from '@/api/vitals';

/**
 * Who logged a reading, exactly as mobile's VitalsDetailScreen prints it after
 * the timestamp ("<time> · <First Last>"): the embedded `users` name, or the
 * `systemLabel` ("System") when the backend has none to give (a reading with no
 * author, e.g. a departed member whose name could not be recovered).
 *
 * `systemLabel` is passed in as an already-translated string so the caller's
 * `t('detail.system')` stays a literal key (the i18n key-audit test bans
 * dynamic `t(key)` call sites).
 */
export function getLoggedByLabel(vital: HealthVital, systemLabel: string): string {
  const user = vital.users;
  if (!user) return systemLabel;
  return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || systemLabel;
}
