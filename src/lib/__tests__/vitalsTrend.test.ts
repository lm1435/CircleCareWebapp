import { describe, expect, it } from 'vitest';
import { formatAverageDelta } from '../vitalsTrend';

// Mirrors mobile's vitalsChart.test.ts coverage for `formatAverageDelta`:
// exact strings, asserted with the real U+2212 MINUS SIGN (not a hyphen) —
// `toHaveTextContent`-style substring checks would silently pass on either.

describe('formatAverageDelta', () => {
  it('blood pressure — both components up', () => {
    const result = formatAverageDelta(
      'blood_pressure',
      { avg: 124, avg2: 81 },
      { avg: 120, avg2: 80 },
      'mmHg'
    );
    expect(result).toEqual({ delta: '+4/+1 mmHg', direction: 'up' });
  });

  it('blood pressure — mixed direction (systolic up, diastolic down) gets no single direction', () => {
    const result = formatAverageDelta(
      'blood_pressure',
      { avg: 124, avg2: 79 },
      { avg: 120, avg2: 80 },
      'mmHg'
    );
    expect(result).toEqual({ delta: '+4/−1 mmHg', direction: 'mixed' });
  });

  it('blood pressure — one component exactly zero still reports the other\'s direction', () => {
    const result = formatAverageDelta(
      'blood_pressure',
      { avg: 124, avg2: 80 },
      { avg: 120, avg2: 80 },
      'mmHg'
    );
    expect(result).toEqual({ delta: '+4/0 mmHg', direction: 'up' });
  });

  it('blood pressure — a missing diastolic on either side falls back to systolic only', () => {
    const result = formatAverageDelta(
      'blood_pressure',
      { avg: 124, avg2: null },
      { avg: 120, avg2: 80 },
      'mmHg'
    );
    expect(result).toEqual({ delta: '+4 mmHg', direction: 'up' });
  });

  it('weight — a sub-rounding difference rounds to 0, reported as "same"', () => {
    // 150.04 - 150.0 = 0.04, rounds to 0.0 at weight's 1-decimal precision.
    const result = formatAverageDelta(
      'weight',
      { avg: 150.04, avg2: null },
      { avg: 150.0, avg2: null },
      'lbs'
    );
    expect(result).toEqual({ delta: '0 lbs', direction: 'same' });
  });

  it('weight — rounds to one decimal place and keeps the sign', () => {
    const result = formatAverageDelta(
      'weight',
      { avg: 148.26, avg2: null },
      { avg: 150.04, avg2: null },
      'lbs'
    );
    expect(result).toEqual({ delta: '−1.8 lbs', direction: 'down' });
  });

  it('heart rate — down', () => {
    const result = formatAverageDelta(
      'heart_rate',
      { avg: 68, avg2: null },
      { avg: 76, avg2: null },
      'bpm'
    );
    expect(result).toEqual({ delta: '−8 bpm', direction: 'down' });
  });

  it('heart rate — exactly equal averages is "same"', () => {
    const result = formatAverageDelta(
      'heart_rate',
      { avg: 72, avg2: null },
      { avg: 72, avg2: null },
      'bpm'
    );
    expect(result).toEqual({ delta: '0 bpm', direction: 'same' });
  });
});
