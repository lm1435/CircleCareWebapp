import { firstRunItemDefault, FIRST_RUN_ITEM_TIME } from '../firstRunDefaults';

// Owner, locked (plan.md 5 + 7): a first appointment / task opens on 9:00 AM, TOMORROW once 9:00 has
// passed on the CARE RECIPIENT's clock. The dev machine is America/Denver; every case names an
// instant and a zone, so none depends on the machine's clock.

describe('firstRunItemDefault', () => {
  it('POSITIVE: before 9:00 in the recipient zone -> today at 9:00', () => {
    // 07:30 in New York.
    expect(firstRunItemDefault('America/New_York', new Date('2026-11-17T12:30:00Z'))).toEqual({
      date: '2026-11-17',
      time: FIRST_RUN_ITEM_TIME,
    });
  });

  it('NEGATIVE: at exactly 9:00 the slot is already due -> tomorrow (never late on save)', () => {
    expect(firstRunItemDefault('America/New_York', new Date('2026-11-17T14:00:00Z'))).toEqual({
      date: '2026-11-18',
      time: '09:00',
    });
  });

  it('NEGATIVE: after 9:00 -> tomorrow, across a month end', () => {
    expect(firstRunItemDefault('America/New_York', new Date('2026-11-30T22:00:00Z'))).toEqual({
      date: '2026-12-01',
      time: '09:00',
    });
  });

  it('NEGATIVE: the RECIPIENT\'s clock decides, not the browser\'s (Tokyo is already past 9:00)', () => {
    // 2026-11-17 01:00Z = 18:00 Denver (16 Nov) but 10:00 Tokyo (17 Nov).
    const now = new Date('2026-11-17T01:00:00Z');
    expect(firstRunItemDefault('Asia/Tokyo', now)).toEqual({ date: '2026-11-18', time: '09:00' });
    // Same instant in Honolulu is 15:00 on the 16th: already past -> the 17th.
    expect(firstRunItemDefault('Pacific/Honolulu', now)).toEqual({ date: '2026-11-17', time: '09:00' });
  });
});
