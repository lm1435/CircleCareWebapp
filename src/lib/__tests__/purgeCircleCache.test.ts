/**
 * purgeCircleCache / purgeCircleCacheOnLostAccess (PK14): unit tests on a bare
 * QueryCache. Twin: mobile/src/__tests__/utils/purgeCircleCache.test.ts.
 */
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { purgeCircleCache, purgeCircleCacheOnLostAccess, purgeCirclesAbsentFromList } from '../purgeCircleCache';

function makeClient() {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (e, q) => purgeCircleCacheOnLostAccess(e, q, qc) }),
  });
  qc.setQueryData(['circles'], [{ id: 'a' }, { id: 'b' }]);
  qc.setQueryData(['circles', 'a'], { id: 'a' });
  qc.setQueryData(['circle', 'a'], { id: 'a' });
  qc.setQueryData(['emergencyInfo', 'a'], { x: 1 });
  qc.setQueryData(['calendarEvents', 'a', '2026-09-30', '2026-09-30'], [1]);
  qc.setQueryData(['eventNotesRange', 'a', { from: 'x', to: 'y' }], [1]);
  qc.setQueryData(['x-param', { circleId: 'a' }], [1]);
  qc.setQueryData(['x-param', { circle_id: 'a' }], [1]);
  qc.setQueryData(['emergencyInfo', 'b'], { x: 2 });
  qc.setQueryData(['circles', 'b'], { id: 'b' });
  qc.setQueryData(['currentUser'], { id: 'u' });
  return qc;
}
const lose = async (qc: QueryClient, key: unknown[], code: string) => {
  const q = qc.getQueryCache().find({ queryKey: key })!;
  // Drive the real QueryCache onError path.
  qc.getQueryCache().config.onError?.({ error: { code } } as never, q as never);
};

describe('purgeCircleCache', () => {
  it('removes every query naming the circle (string parts and object params), keeps the rest', () => {
    const qc = makeClient();
    purgeCircleCache(qc, 'a');
    const keys = qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey)).sort();
    expect(keys).toEqual(
      [
        '["circles"]',
        '["circles","b"]',
        '["currentUser"]',
        '["emergencyInfo","b"]',
      ].sort()
    );
    expect(qc.getQueryData(['circles'])).toEqual([{ id: 'b' }]);
    expect(qc.getQueryState(['circles'])?.isInvalidated).toBe(true);
  });

  it('onError purges on FORBIDDEN and NOT_FOUND of the circle read only', async () => {
    for (const code of ['FORBIDDEN', 'NOT_FOUND']) {
      const qc = makeClient();
      await lose(qc, ['circles', 'a'], code);
      expect(qc.getQueryData(['emergencyInfo', 'a'])).toBeUndefined();
      expect(qc.getQueryData(['emergencyInfo', 'b'])).toEqual({ x: 2 });
      expect(qc.getQueryData(['circles', 'a'])).toBeUndefined(); // data cleared on the failing read
    }
  });

  it.each(['VIEW_ONLY', 'READ_ONLY_MEMBER', 'SUBSCRIPTION_REQUIRED', 'PAYMENT_REQUIRED', 'SERVER_ERROR'])(
    'onError with %s does not purge',
    async (code) => {
      const qc = makeClient();
      await lose(qc, ['circles', 'a'], code);
      expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 1 });
      expect(qc.getQueryData(['circles'])).toEqual([{ id: 'a' }, { id: 'b' }]);
    }
  );

  it('a FORBIDDEN from a non-circle query (a document read) does not purge the circle', async () => {
    const qc = makeClient();
    await lose(qc, ['emergencyInfo', 'a'], 'FORBIDDEN');
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 1 });
    expect(qc.getQueryData(['circles', 'a'])).toEqual({ id: 'a' });
  });
});

describe('purgeCirclesAbsentFromList (circles LIST refetch)', () => {
  function listClient() {
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (e, q) => purgeCircleCacheOnLostAccess(e, q, qc),
        onSuccess: (d, q) => purgeCirclesAbsentFromList(d, q as never, qc),
      }),
    });
    qc.setQueryData(['circles'], [{ id: 'a' }, { id: 'b' }]);
    for (const id of ['a', 'b']) {
      qc.setQueryData(['circles', id], { id });
      qc.setQueryData(['emergencyInfo', id], { x: id });
      qc.setQueryData(['calendarEvents', id, 'f', 't'], [id]);
    }
    return qc;
  }
  const refetchList = (qc: QueryClient, fn: () => Promise<unknown>) =>
    qc.fetchQuery({ queryKey: ['circles'], queryFn: fn, staleTime: 0, retry: false });

  it('a successful list without circle a purges a (and only a)', async () => {
    const qc = listClient();
    await refetchList(qc, async () => [{ id: 'b' }]);
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toBeUndefined();
    expect(qc.getQueryData(['circles', 'a'])).toBeUndefined();
    expect(qc.getQueryData(['calendarEvents', 'a', 'f', 't'])).toBeUndefined();
    expect(qc.getQueryData(['emergencyInfo', 'b'])).toEqual({ x: 'b' });
    expect(qc.getQueryData(['circles', 'b'])).toEqual({ id: 'b' });
    expect(qc.getQueryData(['circles'])).toEqual([{ id: 'b' }]); // list itself untouched by the purge
    expect(qc.getQueryState(['circles'])?.isInvalidated).toBe(false); // no refetch loop
  });

  it('a successful EMPTY list purges every cached circle (removed from the only circle)', async () => {
    const qc = listClient();
    await refetchList(qc, async () => []);
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toBeUndefined();
    expect(qc.getQueryData(['emergencyInfo', 'b'])).toBeUndefined();
  });

  it('a list that still contains every circle purges nothing', async () => {
    const qc = listClient();
    await refetchList(qc, async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 'a' });
    expect(qc.getQueryData(['emergencyInfo', 'b'])).toEqual({ x: 'b' });
  });

  it('a FAILED list refetch (5xx / network / 403) purges nothing', async () => {
    for (const err of [{ error: { code: 'SERVER_ERROR' } }, new Error('Network Error'), { error: { code: 'FORBIDDEN' } }]) {
      const qc = listClient();
      await refetchList(qc, async () => {
        throw err;
      }).catch(() => undefined);
      expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 'a' });
      expect(qc.getQueryData(['emergencyInfo', 'b'])).toEqual({ x: 'b' });
    }
  });

  it('a malformed list payload (non-array, entry without id) purges nothing', async () => {
    for (const payload of [null, { circles: [] }, [{ id: 'b' }, { name: 'no id' }], [{ id: 'b' }, null]]) {
      const qc = listClient();
      await refetchList(qc, async () => payload);
      expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 'a' });
    }
  });

  it('a circle whose cached detail is already archived is kept (list cannot tell archived from removed)', async () => {
    const qc = listClient();
    qc.setQueryData(['circles', 'a'], { id: 'a', archived_at: '2026-09-01T00:00:00Z' });
    await refetchList(qc, async () => [{ id: 'b' }]);
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 'a' });
  });

  it('optimistic setQueryData on the list (delete / rollback) never purges', () => {
    const qc = listClient();
    qc.setQueryData(['circles'], [{ id: 'b' }]);
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 'a' });
  });

  it('only the circles LIST key triggers it (a circle detail success does not)', async () => {
    const qc = listClient();
    await qc.fetchQuery({ queryKey: ['circles', 'b'], queryFn: async () => ({ id: 'b' }), staleTime: 0 });
    expect(qc.getQueryData(['emergencyInfo', 'a'])).toEqual({ x: 'a' });
  });

  it('does not livelock with the 403 path: a detail already in its lost-access error is left alone', async () => {
    const qc = listClient();
    // the failing circle read, exactly as purgeCircleCacheOnLostAccess leaves it
    const q = qc.getQueryCache().find({ queryKey: ['circles', 'a'] })!;
    q.setState({ data: undefined, dataUpdatedAt: 0, error: { error: { code: 'FORBIDDEN' } } as never, status: 'error' });
    await refetchList(qc, async () => [{ id: 'b' }]);
    expect(qc.getQueryCache().find({ queryKey: ['circles', 'a'] })).toBe(q); // not evicted
    expect(qc.getQueryState(['circles', 'a'])?.error).toEqual({ error: { code: 'FORBIDDEN' } });
  });
});
