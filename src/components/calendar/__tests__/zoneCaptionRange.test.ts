import { describe, expect, it } from 'vitest';
import { viewerRangeForCaption } from '../zoneCaptionRange';

// BC-4: the caption's "your time" END is the circle's end wall time resolved to an instant, read on the viewer's
// clock. Expected strings are the spec's (computed from the circle end wall time with the repo resolver). Pure and
// zone-independent: both zones are arguments.
const NNBSP = /[  ]/g;
const norm = (text: string) => text.replace(NNBSP, ' ');

describe('BC-4 viewerRangeForCaption', () => {
  it.each([
    // viewer, circle, circle start date, start, duration, expected (12h)
    ['America/Denver', 'Asia/Tokyo', '2026-03-08', '17:00', 120, '1:00 – 4:00 AM'],
    ['America/Denver', 'Asia/Tokyo', '2026-11-01', '16:00', 120, '1:00 – 2:00 AM'],
    ['America/New_York', 'America/Phoenix', '2026-03-07', '23:00', 120, '1:00 – 4:00 AM'],
    ['Europe/London', 'America/Denver', '2026-03-28', '17:00', 180, '11:00 PM – 3:00 AM'],
    ['America/Phoenix', 'America/Denver', '2026-03-08', '01:00', 120, '1:00 – 2:00 AM'],
    ['America/Denver', 'Asia/Tokyo', '2026-06-10', '17:00', 120, '2:00 – 4:00 AM'],
  ] as const)('%s viewer, %s circle, %s %s +%s min', (viewerZone, circleZone, scheduledDate, startHm, durationMinutes, expected) => {
    expect(
      norm(viewerRangeForCaption({ scheduledDate, startHm, durationMinutes, circleZone, viewerZone, cycle: '12h' }))
    ).toBe(expected);
  });
});
