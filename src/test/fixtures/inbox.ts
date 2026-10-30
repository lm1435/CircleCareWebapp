import type { InboxItem } from '@/lib/notificationsInbox';

export const CIRCLE_A = '11111111-1111-4111-8111-111111111111';
export const CIRCLE_B = '22222222-2222-4222-8222-222222222222';
export const EVENT_ID = '33333333-3333-4333-8333-333333333333';
export const MED_ID = '44444444-4444-4444-8444-444444444444';

let seq = 0;

/** A local wall-clock instant (the viewer's zone) as an ISO string. */
export function local(y: number, mo: number, d: number, h = 12, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi, 0).toISOString();
}

export function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    type: 'note_added',
    circle_id: CIRCLE_A,
    circle_name: 'Mom',
    title: `Title ${seq}`,
    body: `Body ${seq}`,
    data: {},
    state: null,
    read_at: null,
    created_at: local(2026, 10, 29, 9),
    updated_at: local(2026, 10, 29, 9),
    target_status: 'ok',
    ...overrides,
  };
}
