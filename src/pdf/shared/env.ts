/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */

/**
 * Everything platform-specific a template needs, injected by the adapter that
 * calls it. The templates themselves know nothing about i18next, the device
 * clock setting, or which timezone helper library either app ships.
 */
export interface PdfEnv {
  /**
   * String lookup in MOBILE's key namespace (`careSummary.*`,
   * `medicationHistory.export.*`, `vitals.types.*`). The web adapter maps those
   * onto its own namespaces before delegating to its i18n instance.
   */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** BCP-47 formatting locale for `Date#toLocaleDateString` (month names). */
  locale: string;
  /** The `<img>` tag for the header's logo (mobile `pdfBranding.LOGO_IMG`). */
  logoImg: string;
  /**
   * The shared stylesheet body. OPTIONAL: templates fall back to this folder's
   * own `getSharedPdfStyles()`. Mobile passes it explicitly, read from its
   * `utils/pdfBranding` at call time, so a suite that stubs that module's
   * `getSharedPdfStyles` still sees its stub in the rendered document.
   */
  sharedStyles?: string;
  /** YYYY-MM-DD of `date` (default: now) as a wall-clock day in `tz`. */
  getDateInTimezone(tz: string, date?: Date): string;
  /**
   * A naive wall-clock time rendered on the reader's 12h/24h convention. The
   * ADAPTER resolves the hour cycle (`resolveHourCycle(tz)` on mobile, the
   * signed-in user's preference on web); the template only hands over the
   * digits and the zone they belong to.
   */
  formatTimeOfDay(hours: number, minutes: number, tz: string): string;
  /** A real instant's wall-clock time in `tz`, same convention as above. */
  formatInstantTimeOfDay(instant: Date, tz: string): string;
  /** The zone's display name ("Denver", "Ciudad de México"), '' when unknown. */
  getTimezoneLabel(tz: string, lang: 'en' | 'es'): string;
  /**
   * The human label for an event's recurrence ("Daily", "Every 2 days"), or ''
   * when the event carries no rule. Takes the event-ish object rather than the
   * bare rule because web's formatter also reads `recurrence_days`.
   */
  formatRecurrence(event: {
    recurrence_rule?: string | null;
    recurrence_days?: number[] | null;
  }): string;
}
