import { describe, expect, it } from 'vitest';
import { groupInbox, type InboxItem } from '../notificationsInbox';

// Regression (failed on HEAD with 0 rows): the server returns/counts rows with updated_at within the last 72h
// (backend/src/routes/inbox.ts WINDOW_MS), but the client keeps only rows from today, yesterday and
// 2 local days ago. A row 69h old viewed at 18:58 local is 3 local days back => dropped, while the
// server's unread_count (bell, subtitle) still counts it. Observed 2026-11-07 on the demo account.
const TZ_NOTE = 'Denver (the suite runs in America/Denver)';

describe(`inbox server 72h window vs client local-day buckets (${TZ_NOTE})`, () => {
  it('shows every row the server counted inside its 72h window', () => {
    const now = new Date('2026-11-07T18:58:10-07:00');
    const updated = new Date(now.getTime() - 69 * 3_600_000).toISOString(); // inside 72h
    const item = {
      id: 'a',
      type: 'medication_missed',
      circle_id: 'c1',
      updated_at: updated,
      read_at: null,
    } as unknown as InboxItem;
    const visible = groupInbox([item], now).flatMap((s) => s.items);
    expect(visible).toHaveLength(1);
  });
});

const mk = (updated_at: string, read_at: string | null = null): InboxItem =>
  ({ id: updated_at, type: 'medication_missed', circle_id: 'c1', updated_at, read_at }) as unknown as InboxItem;

describe('inbox window: every returned row is listed (Denver local days)', () => {
  const now = new Date('2026-11-07T18:58:10-07:00');

  it('a row exactly 72h old (the server window edge) is listed under Earlier', () => {
    const edge = mk(new Date(now.getTime() - 72 * 3_600_000).toISOString());
    const sections = groupInbox([edge], now);
    expect(sections.map((s) => s.key)).toEqual(['earlier']);
    expect(sections[0].items).toEqual([edge]);
  });

  it('day boundary: 23:59 two days back is "2 days ago", 00:01 three days back is Earlier', () => {
    const lateTwo = mk(new Date(2026, 10, 5, 23, 59).toISOString());
    const earlyThree = mk(new Date(2026, 10, 4, 0, 1).toISOString());
    const keys = Object.fromEntries(
      groupInbox([lateTwo, earlyThree], now).map((s) => [s.key, s.items.length])
    );
    expect(keys).toEqual({ twoDaysAgo: 1, earlier: 1 });
  });

  it('listed rows always equal the input, so unread listed == unread counted', () => {
    const items = [
      mk(new Date(2026, 10, 7, 9).toISOString()),
      mk(new Date(2026, 10, 6, 9).toISOString()),
      mk(new Date(2026, 10, 5, 9).toISOString()),
      mk(new Date(2026, 10, 4, 9).toISOString()),
      mk(new Date(2026, 10, 3, 9).toISOString(), '2026-11-04T00:00:00Z'),
      mk('not-a-date'),
    ];
    const listed = groupInbox(items, now).flatMap((s) => s.items);
    expect(listed).toHaveLength(items.length);
    expect(listed.filter((i) => !i.read_at)).toHaveLength(items.filter((i) => !i.read_at).length);
  });
});
