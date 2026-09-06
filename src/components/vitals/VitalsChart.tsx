import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

// Task 21 — the vitals trend chart, drawn as pure inline SVG.
//
// MIRRORS mobile/src/screens/vitals/VitalsDetailScreen.tsx's
// `react-native-gifted-charts` <LineChart>: 160 tall, curved, thickness 2.5,
// 4 horizontal sections in the hairline colour, an area fill under the FIRST
// series only (`areaChart1`, never the unnumbered flag — see the mobile
// comment), radius-3 data points, y labels 11px inkMute and an x axis hair.
// No chart library is added on web: that dependency buys one line chart.
//
// This file is the ONE hand-drawn <svg> allowlisted outside components/ui
// (src/__tests__/bans/iconNames.test.ts SVG_ALLOWLIST).
//
// GEOMETRY (deliberate, and the one place this diverges from the task sketch):
// the SVG's viewBox is the container's PIXEL box, measured with a
// ResizeObserver, rather than a fixed `0 0 320 160` box scaled by
// `preserveAspectRatio`. Both suggested alternatives are wrong here:
//   - `preserveAspectRatio="none"` stretches the data dots into ellipses;
//   - `preserveAspectRatio="xMidYMid meet"` scales UNIFORMLY, so in a 800px
//     card the 320×160 viewBox renders 320 wide and centred, leaving the chart
//     marooned in the middle of its own Card.
// Measuring gives round dots, exact 2.5px strokes and a full-bleed plot. Before
// the first measurement (and under jsdom, where layout has no size) the
// FALLBACK_WIDTH below applies, which also makes the rendered path `d`
// deterministic in tests.

export type VitalsChartColor = 'clay' | 'dusk' | 'terracotta' | 'moss';

export interface VitalsChartPoint {
  /** Any monotonic scalar — the page passes `recorded_at` epoch milliseconds. */
  x: number;
  /** The value in the reader's DISPLAY unit (converted before it gets here). */
  y: number;
}

export interface VitalsChartSeries {
  points: VitalsChartPoint[];
  color: VitalsChartColor;
  /** Fill the band under this line at 15%. Honoured for series 0 ONLY. */
  area?: boolean;
}

export interface VitalsChartProps {
  series: VitalsChartSeries[];
  /** Plot height in px. Mobile's chart is 160. */
  height?: number;
  /** Renders a y-axis value — the caller owns rounding and units. */
  yFormatter: (value: number) => string;
  /** Axis labels; the FIRST and LAST are rendered beneath the plot. */
  xLabels?: string[];
  /** Sentence describing the plot for screen readers (lowest/highest/latest). */
  label: string;
  className?: string;
}

/** Colour tokens, resolved at paint time so the chart follows the palette. */
const STROKE: Record<VitalsChartColor, string> = {
  clay: 'var(--color-clay)',
  dusk: 'var(--color-dusk)',
  terracotta: 'var(--color-terracotta)',
  moss: 'var(--color-moss)',
};

const DEFAULT_HEIGHT = 160;

/** Room for the y labels on the left; the plot never runs under them. */
const MARGIN = { left: 36, right: 8, top: 12, bottom: 14 } as const;

/** Mobile's `noOfSections={4}`: four dashed rules above the solid x axis. */
const GUIDE_COUNT = 4;

const FALLBACK_WIDTH = 320;

/** Two decimals is well under a device pixel and keeps the `d` string short. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Catmull-Rom through every point, emitted as cubic Béziers — the curve
 * gifted-charts draws for `curved`. Endpoints duplicate their neighbour so the
 * first and last segments have a control point to reflect.
 *
 * Exactly one `M` and `points.length - 1` `C` segments, always.
 */
export function catmullRomPath(points: VitalsChartPoint[]): string {
  if (points.length === 0) return '';
  let d = `M ${r(points[0]!.x)},${r(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(p2.x)},${r(p2.y)}`;
  }
  return d;
}

/** `useLayoutEffect` in the browser, `useEffect` where there is no layout. */
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The vitals trend chart. Renders nothing at all when no series carries a
 * point — an empty plot frame is a large block of screen saying "nothing here",
 * which the caller says better in one line.
 */
export function VitalsChart({
  series,
  height = DEFAULT_HEIGHT,
  yFormatter,
  xLabels,
  label,
  className,
}: VitalsChartProps): ReactElement | null {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  const measure = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    const next = node.getBoundingClientRect().width;
    // jsdom (and a display:none ancestor) report 0 — keep the fallback rather
    // than collapsing the plot to a point.
    if (next > 0) setWidth(next);
  }, []);

  useMeasureEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  const drawable = series.filter((s) => s.points.length > 0);
  const all = drawable.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const plotLeft = MARGIN.left;
  const plotRight = Math.max(plotLeft + 1, width - MARGIN.right);
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;

  // ── y domain: the data range plus 10% headroom on each side. A flat series
  // (every reading identical) has no range to pad, so it gets an absolute one
  // — otherwise the line would sit exactly on the top and bottom rules at once.
  const ys = all.map((p) => p.y);
  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);
  const spanY = rawMax - rawMin;
  const padY = spanY > 0 ? spanY * 0.1 : Math.max(Math.abs(rawMax) * 0.1, 1);
  const minY = rawMin - padY;
  const maxY = rawMax + padY;

  const xs = all.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = maxX - minX;

  const scaleX = (x: number): number =>
    spanX === 0
      ? (plotLeft + plotRight) / 2
      : plotLeft + ((x - minX) / spanX) * (plotRight - plotLeft);
  const scaleY = (y: number): number =>
    plotBottom - ((y - minY) / (maxY - minY)) * (plotBottom - plotTop);

  const projected = drawable.map((s) => ({
    ...s,
    pixels: s.points.map((p) => ({ x: scaleX(p.x), y: scaleY(p.y) })),
  }));

  const guides = Array.from({ length: GUIDE_COUNT }, (_, i) => {
    const fraction = i / GUIDE_COUNT;
    return {
      y: plotTop + (plotBottom - plotTop) * fraction,
      value: maxY - (maxY - minY) * fraction,
    };
  });

  // The dashed rules stop short of the floor — it is drawn as the solid axis
  // line below — but mobile's `noOfSections={4}` still labels it (5 labels for
  // 4 sections). Add the floor as a label-only entry, at fraction 1.
  const yLabels = [...guides, { y: plotBottom, value: minY }];

  const firstXLabel = xLabels?.[0];
  const lastXLabel =
    xLabels && xLabels.length > 1 && xLabels[xLabels.length - 1] !== firstXLabel
      ? xLabels[xLabels.length - 1]
      : undefined;

  return (
    <div className={className}>
      <div ref={wrapRef} className="relative w-full">
        {yLabels.map((guide) => (
          <span
            key={`label-${guide.y}`}
            aria-hidden="true"
            className="pointer-events-none absolute text-right text-xs text-ink-3"
            style={{ top: guide.y - 8, left: 0, width: MARGIN.left - 6 }}
          >
            {yFormatter(guide.value)}
          </span>
        ))}

        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${r(width)} ${height}`}
          width={width}
          height={height}
          className="block"
        >
          {guides.map((guide) => (
            <line
              key={`guide-${guide.y}`}
              x1={plotLeft}
              y1={r(guide.y)}
              x2={r(plotRight)}
              y2={r(guide.y)}
              stroke="var(--color-line-2)"
              strokeDasharray="4 4"
            />
          ))}

          <line
            x1={plotLeft}
            y1={plotBottom}
            x2={r(plotRight)}
            y2={plotBottom}
            stroke="var(--color-line-2)"
          />

          {projected.map((s, index) => {
            const d = catmullRomPath(s.pixels);
            const first = s.pixels[0]!;
            const last = s.pixels[s.pixels.length - 1]!;
            // Area under the FIRST series only. Mobile leaves `areaChart2`
            // unset on purpose so the diastolic line stays a plain stroke and
            // the two never compete for the same tint underneath them.
            const withArea = index === 0 && s.area === true;
            return (
              <g key={`series-${index}`}>
                {withArea && (
                  <path
                    data-testid={`vitals-chart-area-${index}`}
                    d={`${d} L ${r(last.x)},${plotBottom} L ${r(first.x)},${plotBottom} Z`}
                    fill={STROKE[s.color]}
                    fillOpacity={0.15}
                    stroke="none"
                  />
                )}
                <path
                  data-testid={`vitals-chart-line-${index}`}
                  d={d}
                  fill="none"
                  stroke={STROKE[s.color]}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {s.pixels.map((p, i) => (
                  <circle
                    key={`dot-${index}-${i}`}
                    cx={r(p.x)}
                    cy={r(p.y)}
                    r={3}
                    fill={STROKE[s.color]}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {firstXLabel && (
        <div
          aria-hidden="true"
          className="mt-1 flex justify-between text-xs text-ink-3"
          style={{ paddingLeft: MARGIN.left, paddingRight: MARGIN.right }}
        >
          <span>{firstXLabel}</span>
          {lastXLabel && <span>{lastXLabel}</span>}
        </div>
      )}
    </div>
  );
}
