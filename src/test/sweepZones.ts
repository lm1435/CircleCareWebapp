import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The device zones the cross-timezone sweep runs under, read from the ONE list
 * shared by webapp, mobile and backend: CircleCare/scripts/timezones.txt
 * (`../scripts/timezones.txt` from this repo's root). The sweep script exports
 * TZ_LIST_FILE, so a run with an overridden list reads the same file here.
 *
 * Mirrors the parsing in scripts/run-unit-timezones.sh: `#` lines and blank
 * lines are ignored, the zone is the first field. When the file is missing (the
 * top-level CircleCare/ directory is not a git repo, so a lone clone of this
 * repo has none) it falls back, with a warning, to the same six-zone smoke set
 * the script falls back to — so the script and this test always agree on what
 * "a sweep zone" means.
 */
export const FALLBACK_SWEEP_ZONES: readonly string[] = [
  'America/Denver',
  'UTC',
  'Pacific/Kiritimati',
  'Pacific/Midway',
  'Pacific/Chatham',
  'Asia/Kolkata',
];

export function sweepZoneListPath(): string {
  return (
    process.env.TZ_LIST_FILE ||
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/timezones.txt')
  );
}

export function parseZoneList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0]);
}

export function loadSweepZones(): { zones: string[]; fromFile: boolean } {
  const file = sweepZoneListPath();
  if (existsSync(file)) {
    const zones = parseZoneList(readFileSync(file, 'utf8'));
    if (zones.length > 0) return { zones, fromFile: true };
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[sweepZones] ${file} not found; using the six-zone fallback. ` +
      `The full cross-timezone matrix is not being checked.`
  );
  return { zones: [...FALLBACK_SWEEP_ZONES], fromFile: false };
}

/** True when scripts/run-unit-timezones.sh launched this run. */
export const RUNNING_UNDER_SWEEP = process.env.CC_TZ_SWEEP === '1';
