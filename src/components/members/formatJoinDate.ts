const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a join date in the viewer's locale.
 *
 * - Date-only strings (YYYY-MM-DD) are parsed as `T12:00:00Z` and formatted
 *   with `timeZone: 'UTC'` (project convention — never shifts a calendar day).
 * - Full ISO timestamps are formatted in the viewer's local timezone.
 */
export function formatJoinDate(value: string, locale: string): string {
  if (DATE_ONLY.test(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${value}T12:00:00Z`)
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
