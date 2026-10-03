// Types for the byte-mirrored plain-ESM dataset module (hard-export-dataset.mjs;
// canonical copy in mobile/.maestro/parity/exports/). Web-only: the webapp
// type-checks e2e/, the Maestro harness does not.

export type ApiFn = (
  method: string,
  path: string,
  token: string,
  body?: unknown
) => Promise<Record<string, any> & { __status: number }>;

export interface Adapters {
  api: ApiFn;
  sqlExec: (statement: string) => void;
  sqlRows: <T = Record<string, any>>(select: string) => T[];
}

export interface Actor {
  id: string;
  token: string;
}

export interface SeriesFixture {
  key: string;
  name: string;
  dosage: string;
  time: string;
  rootId: string;
  start: string;
  end: string | null;
  stopAt: string | null;
  /** PK3: deleted as a whole medication after doses were recorded (soft delete). */
  deleted: boolean;
  answers: Record<string, { status: string; by: 'owner' | 'second' }>;
  removed: string[];
}

export interface HardFixture {
  version: number;
  tz: string;
  seedDay: string;
  circleId: string;
  series: SeriesFixture[];
}

export interface Tally {
  total: number;
  taken: number;
  taken_late: number;
  skipped: number;
  not_marked: number;
  rate: number;
}

export interface ExpectedAdherence {
  start_date: string;
  end_date: string;
  /** PK25: false when no dose is due in one half of the window (no trend may print). */
  trendAvailable?: boolean;
  summary: Tally;
  byMedication: (Tally & { name: string; dosage: string })[];
  bySlot?: (Tally & { time: string })[];
  byDay?: (Tally & { date: string })[];
}

export interface ExpectedCareSummary {
  current: { name: string; dosage: string; times: string[] }[];
  stopped: { name: string; dosage: string; stoppedDay: string }[];
  absent: string[];
  /** PK3: medications deleted with recorded doses: printed nowhere in the Care Summary. */
  deleted: string[];
  medicationAllergies: string[];
  otherAllergies: string[];
  conditions: string[];
  mustNotContain: string[];
}

export interface RowCapFixture {
  version: number;
  tz: string;
  seedDay: string;
  circleId: string;
  name: string;
  dosage: string;
  roots: { id: string; time: string; gap: string }[];
}

export const DATASET_VERSION: number;
export const HARD_TZ: string;
export const DNR_MARKER: string;
export const ROWCAP_SERIES: number;
export function todayIn(tz: string, now?: Date): string;
export function addDays(dateStr: string, n: number): string;
export function zonedToUtcMs(dateStr: string, hhmm: string, tz: string): number;
export function seedHardDataset(
  adapters: Adapters,
  opts: { circleId: string; owner: Actor; second: Actor }
): Promise<HardFixture>;
export function fixtureFromPlan(T: string): HardFixture;
export function assertSeededAsPlanned(fixture: HardFixture): void;
export function allTimeDays(fixture: HardFixture, todayR: string): number;
export function expectedAdherence(
  fixture: HardFixture,
  todayR: string,
  days: number,
  falsify?: { countRemovedAsDue?: boolean }
): ExpectedAdherence;
export function expectedCareSummary(fixture: HardFixture, now?: Date): ExpectedCareSummary;
export function seedRowCap(
  adapters: Adapters,
  opts: { circleId: string; owner: Actor; name?: string; dosage?: string }
): Promise<RowCapFixture>;
export function expectedRowCap(rc: RowCapFixture, todayR: string, days: number): ExpectedAdherence;
export function datePattern(dateStr: string, lang: string, opts?: { year?: boolean }): string;
export function timePattern(hhmm: string): string;
export function norm(text: string): string;
export function readTiles(text: string, lang?: 'en' | 'es'): number[] | null;
export function checkAdherenceText(
  text: string,
  exp: ExpectedAdherence,
  opts?: { lang?: 'en' | 'es'; recipientName?: string }
): string[];
export function checkCareSummaryText(
  text: string,
  exp: ExpectedCareSummary,
  opts?: { lang?: 'en' | 'es'; recipientName?: string }
): string[];
