import { render, screen } from '@testing-library/react';
import { VitalsChart, catmullRomPath, straightPath, type VitalsChartSeries } from '../VitalsChart';

// Task 21 — the pure-SVG vitals trend chart.
//
// jsdom reports a 0-width layout box, so the component keeps its 320px
// fallback viewBox here. That is deliberate: every `d` asserted below is
// therefore deterministic and independent of the runner's window size.

const ONE = ['a'];

function points(ys: number[]): Array<{ x: number; y: number }> {
  return ys.map((y, i) => ({ x: i, y }));
}

function series(ys: number[], overrides: Partial<VitalsChartSeries> = {}): VitalsChartSeries {
  return { points: points(ys), color: 'moss', ...overrides };
}

function renderChart(all: VitalsChartSeries[], props: Record<string, unknown> = {}) {
  return render(
    <VitalsChart
      series={all}
      yFormatter={(v) => `${Math.round(v)}`}
      label="Trend chart summary"
      {...props}
    />
  );
}

/** Every drawn line path, in series order. */
function linePaths(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('[data-testid^="vitals-chart-line-"]'));
}

function areaPaths(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('[data-testid^="vitals-chart-area-"]'));
}

describe('VitalsChart', () => {
  it('is an announced image named by its summary label', () => {
    renderChart([series([100, 110, 120])]);
    expect(screen.getByRole('img', { name: 'Trend chart summary' })).toBeInTheDocument();
  });

  it('renders nothing at all when no series carries a point', () => {
    const { container } = renderChart([]);
    expect(container).toBeEmptyDOMElement();

    const { container: second } = renderChart([series([])]);
    expect(second).toBeEmptyDOMElement();
  });

  // ── Line shape ────────────────────────────────────────────────────────────
  //
  // The component itself draws STRAIGHT segments (`straightPath`), not the
  // Catmull-Rom curve `catmullRomPath` still produces as a pure function
  // below. With uneven, time-scaled spacing (mobile-parity `xDomain`) a
  // bezier between a close pair of points and a distant one visibly
  // overshoots — see VitalsChart.tsx's "STRAIGHT SEGMENTS" file comment.

  it('draws one M and n-1 straight line segments for n points, never a bezier', () => {
    for (const n of [2, 3, 5, 9]) {
      const { container, unmount } = renderChart([
        series(Array.from({ length: n }, (_, i) => 100 + i * 3)),
      ]);
      const d = linePaths(container)[0]!.getAttribute('d')!;
      expect(d.match(/M/g)).toHaveLength(1);
      expect(d.match(/L/g)).toHaveLength(n - 1);
      expect(d).not.toContain('C');
      unmount();
    }
  });

  it('draws a bare M with no line segment for a single point', () => {
    expect(straightPath([{ x: 10, y: 20 }])).toBe('M 10,20');
  });

  it('straightPath emits nothing for no points', () => {
    expect(straightPath([])).toBe('');
  });

  it('straightPath passes THROUGH every data point, in order', () => {
    const d = straightPath([
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 20, y: 10 },
    ]);
    expect(d).toBe('M 0,0 L 10,40 L 20,10');
  });

  // catmullRomPath is kept as a pure, unit-tested function even though the
  // component no longer calls it — it is not implementation detail of this
  // component's render, so its own contract still deserves direct coverage.

  it('catmullRomPath draws a bare M with no cubic segment for a single point', () => {
    const d = catmullRomPath([{ x: 10, y: 20 }]);
    expect(d).toBe('M 10,20');
    expect(d).not.toContain('C');
  });

  it('catmullRomPath emits nothing for no points', () => {
    expect(catmullRomPath([])).toBe('');
  });

  it('catmullRomPath passes the curve THROUGH every data point', () => {
    // Catmull-Rom interpolates (unlike a plain B-spline): each cubic segment
    // must END on the next sample, so a regression to a smoothing spline —
    // which would draw a line that misses its own readings — fails here.
    const d = catmullRomPath([
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 20, y: 10 },
    ]);
    const SEGMENT_END = /C\s+[\d.-]+,[\d.-]+\s+[\d.-]+,[\d.-]+\s+([\d.-]+),([\d.-]+)/g;
    const endpoints = [...d.matchAll(SEGMENT_END)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(endpoints).toEqual([
      [10, 40],
      [20, 10],
    ]);
  });

  // ── Area fill ─────────────────────────────────────────────────────────────

  it('fills the band under series 0 when it asks for an area', () => {
    const { container } = renderChart([series([100, 120], { area: true })]);
    const area = areaPaths(container);
    expect(area).toHaveLength(1);
    expect(area[0]).toHaveAttribute('fill-opacity', '0.15');
    // Closed back down to the axis and shut.
    expect(area[0]!.getAttribute('d')).toMatch(/Z$/);
  });

  it('never fills series 1, even when that series asks for an area', () => {
    // Mobile leaves `areaChart2` unset on purpose so the diastolic line stays a
    // plain stroke; the bare flag would tint BOTH lines.
    const { container } = renderChart([
      series([120, 130], { color: 'clay', area: true }),
      series([70, 80], { color: 'dusk', area: true }),
    ]);
    expect(areaPaths(container)).toHaveLength(1);
    expect(areaPaths(container)[0]).toHaveAttribute('data-testid', 'vitals-chart-area-0');
    expect(linePaths(container)).toHaveLength(2);
  });

  it('omits the area entirely when series 0 does not ask for one', () => {
    const { container } = renderChart([series([100, 120])]);
    expect(areaPaths(container)).toHaveLength(0);
  });

  // ── Frame ─────────────────────────────────────────────────────────────────

  it('draws exactly 4 dashed guides plus one solid x axis', () => {
    const { container } = renderChart([series([100, 120])]);
    const dashed = container.querySelectorAll('line[stroke-dasharray]');
    const solid = Array.from(container.querySelectorAll('line')).filter(
      (l) => !l.getAttribute('stroke-dasharray')
    );
    expect(dashed).toHaveLength(4);
    expect(solid).toHaveLength(1);
    for (const line of [...dashed, ...solid]) {
      expect(line).toHaveAttribute('stroke', 'var(--color-line-2)');
    }
  });

  it('labels the 4 guide levels through yFormatter, highest first', () => {
    // Domain 100..120 padded 10% each side => 98..122; the four guides sit at
    // 0, 1/4, 1/2, 3/4 of the plot from the TOP: 122, 116, 110, 104.
    renderChart([series([100, 120])], { yFormatter: (v: number) => `#${Math.round(v)}` });
    for (const expected of ['#122', '#116', '#110', '#104']) {
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });

  it('also labels the floor (minY), drawn over the solid x axis', () => {
    // Mirrors mobile's `noOfSections={4}` (VitalsDetailScreen.tsx:677): 4
    // dashed sections but 5 labels, including the bottom one. Domain
    // 100..120 padded 10% each side => 98..122, so the floor is 98.
    renderChart([series([100, 120])], { yFormatter: (v: number) => `#${Math.round(v)}` });
    expect(screen.getByText('#98')).toBeInTheDocument();
  });

  it('does not draw a fifth dashed rule for the floor label', () => {
    const { container } = renderChart([series([100, 120])]);
    expect(container.querySelectorAll('line[stroke-dasharray]')).toHaveLength(4);
  });

  it('pads a FLAT series so its line does not sit on the frame', () => {
    // Every reading identical: there is no range to take 10% of, so an
    // absolute pad applies and the labels must still differ from each other.
    renderChart([series([80, 80, 80])]);
    // 80 +/- max(80*0.1, 1) = 72..88; guides at 88, 84, 80, 76, floor 72.
    const labels = ['88', '84', '80', '76', '72'];
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders one radius-3 dot per reading, per series', () => {
    const { container } = renderChart([series([1, 2, 3]), series([4, 5, 6], { color: 'dusk' })]);
    const dots = container.querySelectorAll('circle');
    expect(dots).toHaveLength(6);
    for (const dot of dots) expect(dot).toHaveAttribute('r', '3');
  });

  it('strokes each series 2.5 in its own colour token', () => {
    const { container } = renderChart([
      series([120, 130], { color: 'clay' }),
      series([70, 80], { color: 'dusk' }),
    ]);
    const [systolic, diastolic] = linePaths(container);
    expect(systolic).toHaveAttribute('stroke', 'var(--color-clay)');
    expect(systolic).toHaveAttribute('stroke-width', '2.5');
    expect(systolic).toHaveAttribute('fill', 'none');
    expect(diastolic).toHaveAttribute('stroke', 'var(--color-dusk)');
  });

  // ── x labels ──────────────────────────────────────────────────────────────

  it('shows only the first and last x labels', () => {
    renderChart([series([1, 2, 3])], { xLabels: ['Jun 1', 'Jun 2', 'Jun 3'] });
    expect(screen.getByText('Jun 1')).toBeInTheDocument();
    expect(screen.getByText('Jun 3')).toBeInTheDocument();
    expect(screen.queryByText('Jun 2')).not.toBeInTheDocument();
  });

  it('renders no x-label row when none are given', () => {
    renderChart([series([1, 2])]);
    expect(screen.queryByText('Jun 1')).not.toBeInTheDocument();
  });

  it('does not repeat a single x label on both ends', () => {
    renderChart([series([1, 2])], { xLabels: ONE });
    expect(screen.getAllByText('a')).toHaveLength(1);
  });

  it('does not repeat the label when first and last are the same day', () => {
    // Two same-day readings: mobile's [first, last] short-day labels are both
    // "Jun 1" here, and printing both reads as "Jun 1 … Jun 1".
    renderChart([series([1, 2])], { xLabels: ['Jun 1', 'Jun 1'] });
    expect(screen.getAllByText('Jun 1')).toHaveLength(1);
  });

  // ── Range-window x domain (vitals web-parity task) ─────────────────────────

  it('scales x positions against the given xDomain, not the data\'s own min/max', () => {
    // Real readings only span the first 10% of the domain — a first-to-last
    // scaling (the pre-port behavior) would stretch the last one all the way
    // to the plot's right edge; the domain-aware scaling must not.
    const pts = [
      { x: 0, y: 100 },
      { x: 50, y: 110 },
      { x: 100, y: 90 },
    ];
    const { container } = renderChart([{ points: pts, color: 'moss' }], { xDomain: [0, 1000] });
    const d = linePaths(container)[0]!.getAttribute('d')!;
    const xCoords = [...d.matchAll(/(-?\d+(?:\.\d+)?),-?\d+(?:\.\d+)?/g)].map((m) => Number(m[1]));
    // FALLBACK_WIDTH=320, MARGIN.left=36/right=8 => plotLeft=36, plotRight=312.
    expect(xCoords[0]).toBeCloseTo(36, 1); // first point sits at the domain start.
    expect(xCoords[2]).toBeLessThan(70); // third point (10% into the domain) — NOT 312.
  });

  it('falls back to the data\'s own min/max when no xDomain is given', () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 100, y: 90 },
    ];
    const { container } = renderChart([{ points: pts, color: 'moss' }]);
    const d = linePaths(container)[0]!.getAttribute('d')!;
    const xCoords = [...d.matchAll(/(-?\d+(?:\.\d+)?),-?\d+(?:\.\d+)?/g)].map((m) => Number(m[1]));
    expect(xCoords[0]).toBeCloseTo(36, 1); // plotLeft
    expect(xCoords[1]).toBeCloseTo(312, 1); // plotRight — the data IS the domain here.
  });

  // ── Three-tick axis row (mobile parity: start / midpoint / Today) ──────────

  it('renders three axis labels (start, mid, end) when axisLabels is given', () => {
    renderChart([series([1, 2, 3])], {
      axisLabels: { start: 'Jun 1', mid: 'Jun 15', end: 'Today' },
    });
    expect(screen.getByText('Jun 1')).toBeInTheDocument();
    expect(screen.getByText('Jun 15')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('prefers axisLabels over the legacy first/last xLabels row when both are given', () => {
    renderChart([series([1, 2, 3])], {
      xLabels: ['A', 'B', 'C'],
      axisLabels: { start: 'S', mid: 'Mid', end: 'E' },
    });
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByText('Mid')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });
});
