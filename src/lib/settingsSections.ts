/**
 * Settings sub-pages (design pass 2026-11-08, owner-approved "Settings grouping" mock).
 *
 * The Profile page is a header plus four grouped lists; each row opens one of these
 * pages at `/profile/:section`, holding the controls that used to sit inline on the
 * long single-column page, unchanged in behaviour. Same ids and order as the mobile
 * twin, mobile/src/screens/profile/settingsSections.ts.
 *
 * Web differences: "My circles" and "Help & support" link to the existing `/circles`
 * and `/help` pages instead of a settings page of their own, and Language gets a page
 * (mobile opens its language sheet, which is already a page there).
 */
export const SETTINGS_ROWS = [
  'subscription',
  'circles',
  'color',
  'alerts',
  'quietHours',
  'digest',
  'appearance',
  'language',
  'units',
  'timezone',
  'privacy',
  'data',
  'help',
  'account',
] as const;

export type SettingsRowId = (typeof SETTINGS_ROWS)[number];

/** Rows that open a page of their own under `/profile/:section`. */
export const SETTINGS_PAGES = [
  'subscription',
  'color',
  'alerts',
  'quietHours',
  'digest',
  'appearance',
  'language',
  'units',
  'timezone',
  'privacy',
  'data',
  'account',
] as const satisfies readonly SettingsRowId[];

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export const isSettingsPage = (v: unknown): v is SettingsPage =>
  typeof v === 'string' && (SETTINGS_PAGES as readonly string[]).includes(v);

/** The URL of a settings page. */
export const settingsPath = (page: SettingsPage): string => `/profile/${page}`;
