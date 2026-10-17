import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';

const detail = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, getCircleDetail: vi.fn(async () => detail.value) };
});

import { useCircleMembers } from '@/hooks/useCircleMembers';

const m = (id: string, over: Partial<CircleMember>): CircleMember => ({
  id,
  email: `${id}@example.com`,
  first_name: id,
  last_name: null,
  role: 'member',
  is_care_recipient: false,
  is_medication_responsible: false,
  joined_at: '2026-01-01T00:00:00Z',
  timezone: null,
  ...over,
});

// Manager role: owner → managers → care recipient → caregivers, each group by
// join date (mirrors the backend's owner → manager → member order).
it('sorts owner, then managers, then the care recipient, then caregivers', async () => {
  detail.value = {
    members: [
      m('cg-late', { joined_at: '2026-03-01T00:00:00Z' }),
      m('mgr-late', { role: 'manager', joined_at: '2026-04-01T00:00:00Z' }),
      m('rose', { is_care_recipient: true, joined_at: '2026-01-02T00:00:00Z' }),
      m('cg-early', { joined_at: '2026-02-01T00:00:00Z' }),
      m('owner', { role: 'owner', joined_at: '2026-01-01T00:00:00Z' }),
      m('mgr-early', { role: 'manager', joined_at: '2026-02-15T00:00:00Z' }),
    ],
  } as Partial<CircleDetail>;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCircleMembers('c1'), { wrapper });
  await waitFor(() => expect(result.current.members).toHaveLength(6));
  expect(result.current.members.map((x) => x.id)).toEqual([
    'owner',
    'mgr-early',
    'mgr-late',
    'rose',
    'cg-early',
    'cg-late',
  ]);
});
