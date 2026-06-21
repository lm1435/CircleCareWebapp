import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's read function so we can assert the exact args the hook
// passes and drive the resolved value.
vi.mock('@/api/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/tasks')>();
  return {
    ...actual,
    getTasks: vi.fn(),
  };
});

import { getTasks, type GetTasksResponse } from '@/api/tasks';
import { queryKeys } from '@/lib/queryKeys';
import { useTasks } from '@/hooks/useTasks';

const CIRCLE_ID = 'circle-1';
const mockGetTasks = vi.mocked(getTasks);

const RESPONSE: GetTasksResponse = {
  tasks: [],
  today: '2026-06-19',
  timezone: 'America/Chicago',
};

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

describe('useTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTasks.mockResolvedValue(RESPONSE);
  });

  it('calls GET tasks with the given status/sort/limit params', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useTasks(CIRCLE_ID, { status: 'completed', sort: 'assignee', limit: 10 }),
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetTasks).toHaveBeenCalledWith(CIRCLE_ID, {
      status: 'completed',
      sort: 'assignee',
      limit: 10,
    });
    expect(result.current.data).toEqual(RESPONSE);
  });

  it('uses a query key that appends only the defined params, in order', async () => {
    const { Wrapper, queryClient } = wrapper();
    renderHook(() => useTasks(CIRCLE_ID, { status: 'open', sort: 'due_date' }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(mockGetTasks).toHaveBeenCalled());

    const expectedKey = queryKeys.tasksList(CIRCLE_ID, { status: 'open', sort: 'due_date' });
    expect(expectedKey).toEqual(['tasks', CIRCLE_ID, 'open', 'due_date']);
    // The hook registered the query under exactly that key.
    expect(queryClient.getQueryData(expectedKey)).toEqual(RESPONSE);
  });

  it('keys with only the circle id when no params are passed', async () => {
    const { Wrapper, queryClient } = wrapper();
    renderHook(() => useTasks(CIRCLE_ID), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetTasks).toHaveBeenCalled());

    expect(queryClient.getQueryData(['tasks', CIRCLE_ID])).toEqual(RESPONSE);
    expect(mockGetTasks).toHaveBeenCalledWith(CIRCLE_ID, undefined);
  });

  it('stays a superset of tasks(circleId) so prefix invalidation matches', () => {
    const listKey = queryKeys.tasksList(CIRCLE_ID, { status: 'open', sort: 'due_date' });
    const prefix = queryKeys.tasks(CIRCLE_ID);
    expect(listKey.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it('is disabled when circleId is empty', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useTasks(''), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGetTasks).not.toHaveBeenCalled();
  });
});
