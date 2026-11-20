/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */
import type { PdfVitalsSeriesPoint } from './types';
import { PDF_PALETTE as CC } from './palette';

/** Most points a series keeps; longer ones are reduced by equal-count binning. */
export const VITAL_SERIES_MAX_POINTS = 120;
/** Dots on every point only up to this many points (the last point always gets one). */
export const VITAL_TREND_DOTS_MAX = 12;
export const VITAL_TREND_WIDTH = 120;
export const VITAL_TREND_HEIGHT = 28;

/** Plotted y-range is at least this fraction of the series' mean absolute value. */
export const VITAL_TREND_MIN_SPAN_RATIO = 0.1;

const PAD_X = 4;
const PAD_Y = 4;

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

type RawReading = { value1: number; value2?: number | null; recorded_at: string };

/**
 * Time-ordered trend points from raw readings: ascending by `recorded_at`, readings with a
 * non-finite value or an unparseable date dropped, values rounded like the summary, and at
 * most {@link VITAL_SERIES_MAX_POINTS} points (equal-count bins: mean value, middle time).
 */
export function buildVitalSeries(entries: RawReading[]): PdfVitalsSeriesPoint[] {
  const pts: Array<{ ms: number; value1: number; value2?: number }> = [];
  for (const e of entries) {
    const ms = new Date(e.recorded_at).getTime();
    if (!Number.isFinite(ms) || typeof e.value1 !== 'number' || !Number.isFinite(e.value1)) continue;
    const hasDia = typeof e.value2 === 'number' && Number.isFinite(e.value2);
    pts.push({ ms, value1: e.value1, value2: hasDia ? (e.value2 as number) : undefined });
  }
  // Stable sort: equal instants keep their input order.
  pts.sort((a, b) => a.ms - b.ms);

  let binned = pts;
  const n = pts.length;
  if (n > VITAL_SERIES_MAX_POINTS) {
    binned = [];
    for (let i = 0; i < VITAL_SERIES_MAX_POINTS; i++) {
      const from = Math.floor((i * n) / VITAL_SERIES_MAX_POINTS);
      const to = Math.floor(((i + 1) * n) / VITAL_SERIES_MAX_POINTS);
      const bin = pts.slice(from, to);
      const v2 = bin.filter((p) => p.value2 != null);
      binned.push({
        ms: Math.round((bin[0].ms + bin[bin.length - 1].ms) / 2),
        value1: bin.reduce((s, p) => s + p.value1, 0) / bin.length,
        value2: v2.length ? v2.reduce((s, p) => s + (p.value2 as number), 0) / v2.length : undefined,
      });
    }
  }
  return binned.map((p) => ({
    at: new Date(p.ms).toISOString(),
    value1: round1(p.value1),
    ...(p.value2 != null ? { value2: round1(p.value2) } : {}),
  }));
}

/**
 * The inline-SVG sparkline for one vital row, or '' when there are fewer than two points.
 * X is by real time, Y is the series' own min..max (both lines of a blood-pressure series share
 * one scale), widened to at least {@link VITAL_TREND_MIN_SPAN_RATIO} of the mean absolute value,
 * centred on the midpoint, so noise (SpO2 96 to 97) draws nearly flat instead of as a full swing.
 * Decorative: the row already states the numbers in text.
 */
export function renderVitalTrendSvg(series: PdfVitalsSeriesPoint[] | undefined): string {
  const pts = (series ?? [])
    .map((p) => ({ ms: new Date(p.at).getTime(), v1: p.value1, v2: p.value2 }))
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.v1));
  if (pts.length < 2) return '';

  const w = VITAL_TREND_WIDTH;
  const h = VITAL_TREND_HEIGHT;
  const vals: number[] = [];
  for (const p of pts) {
    vals.push(p.v1);
    if (p.v2 != null && Number.isFinite(p.v2)) vals.push(p.v2);
  }
  const dataLo = Math.min(...vals);
  const dataHi = Math.max(...vals);
  const meanAbs = vals.reduce((sum, v) => sum + Math.abs(v), 0) / vals.length;
  const span = Math.max(dataHi - dataLo, meanAbs * VITAL_TREND_MIN_SPAN_RATIO);
  const mid = (dataLo + dataHi) / 2;
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const t0 = pts[0].ms;
  const t1 = pts[pts.length - 1].ms;
  const innerW = w - 2 * PAD_X;
  const innerH = h - 2 * PAD_Y;

  const x = (ms: number) => round2(t1 > t0 ? PAD_X + ((ms - t0) / (t1 - t0)) * innerW : w / 2);
  const y = (v: number) => round2(hi > lo ? PAD_Y + (1 - (v - lo) / (hi - lo)) * innerH : h / 2);

  const line = (pick: (p: (typeof pts)[number]) => number | undefined, stroke: string, sw: number, dash: string) => {
    const xy = pts
      .filter((p) => pick(p) != null && Number.isFinite(pick(p) as number))
      .map((p) => ({ x: x(p.ms), y: y(pick(p) as number) }));
    if (xy.length < 2) return '';
    const d = xy.map((c) => `${c.x},${c.y}`).join(' ');
    const dots = xy
      .map((c, i) => {
        const isLast = i === xy.length - 1;
        if (!isLast && xy.length > VITAL_TREND_DOTS_MAX) return '';
        return `<circle cx="${c.x}" cy="${c.y}" r="${isLast ? 2 : 1.2}" fill="${stroke}"/>`;
      })
      .join('');
    return `<polyline points="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  };

  const hasDia = pts.some((p) => p.v2 != null);
  const dia = hasDia ? line((p) => p.v2, CC.inkMute, 1, ' stroke-dasharray="3 2"') : '';
  const sys = line((p) => p.v1, CC.moss, 1.5, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false" style="display:block">${dia}${sys}</svg>`;
}
