/**
 * A recipient zone guaranteed to be a DIFFERENT CLOCK from the viewer's (the
 * process zone) at `at`, for tests asserting the "(City)" zone suffix.
 *
 * Tests used to hard-code America/Chicago with the comment "the viewer (test
 * process) is not in Chicago". True for every zone the sweep ran until
 * 2026-10-27; then America/Chicago joined the shared list
 * (CircleCare/scripts/timezones.txt) and five tests failed under
 * TZ=America/Chicago — the app correctly drew no suffix for a same-zone viewer.
 * Each test now states the relationship it needs instead of inheriting it.
 *
 * Returns `preferred` unless the viewer is on the same offset at `at`, then
 * `fallback` (which must itself differ — asserted, so a bad pair fails loudly).
 */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const g = (t: string): number => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

export function recipientZoneOtherThanViewer(preferred: string, fallback: string, at: Date): string {
  const viewer = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const differs = (z: string): boolean => offsetMinutes(z, at) !== offsetMinutes(viewer, at);
  if (differs(preferred)) return preferred;
  if (!differs(fallback)) {
    throw new Error(`Neither ${preferred} nor ${fallback} differs from the viewer zone ${viewer}`);
  }
  return fallback;
}

/** The city label the app shows for a zone id, e.g. "America/Los_Angeles" -> "Los Angeles". */
export function cityOf(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}
