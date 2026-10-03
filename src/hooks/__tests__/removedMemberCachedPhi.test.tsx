/**
 * A REMOVED MEMBER'S BROWSER MUST STOP HOLDING THAT CIRCLE'S PHI (web twin of
 * mobile `__tests__/privacy/removedMemberCachedPhi.test.tsx`).
 *
 * Test-gap audit 2026-09-29 #12 (docs/plans/test-gap-audit-2026-09-29.md).
 * `grep removeQueries` over webapp/src finds no non-test hit, and React Query
 * keeps `data` when a refetch fails: after a caregiver is removed from a circle
 * (or it is deleted), the emergency info, meds and documents already read keep
 * rendering in the open tab.
 *
 * REAL: the app's own `queryClient` (lib/queryClient.ts — so a QueryCache-level
 * purge counts), `useCircle` / `useCircleMembers` (so a hook-level purge
 * counts), `useEmergencyInfo`, `api/*` and the real `lib/api` client with its
 * interceptors. FAKED: the network (axios adapter).
 */
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

vi.unmock('@/lib/api');

import { apiClient } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { queryClient as qc } from '@/lib/queryClient';
import { useCircle } from '@/hooks/useCircle';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';

const PHI = { allergies: ['penicillin'], medical_conditions: ['CKD stage 3'], emergency_contacts: [] };
type Mode = 'member' | 'removed' | 'deleted' | 'down' | 'viewOnly' | 'subscription';
let mode: Mode = 'member';
const originalAdapter = apiClient.defaults.adapter;

function fail(config: InternalAxiosRequestConfig, status: number, code: string): never {
  throw new AxiosError('fail', AxiosError.ERR_BAD_REQUEST, config, null, {
    data: { success: false, error: { code, message: code } },
    status,
    statusText: String(status),
    headers: {},
    config,
  });
}

beforeAll(() => {
  tokenAccessor.setToken('t', null);
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? '';
    if (url.startsWith('/circles/c1')) {
      if (mode === 'removed') fail(config, 403, 'FORBIDDEN');
      if (mode === 'deleted') fail(config, 404, 'NOT_FOUND');
      if (mode === 'down') fail(config, 500, 'SERVER_ERROR');
      if (mode === 'viewOnly') fail(config, 403, 'VIEW_ONLY');
      if (mode === 'subscription') fail(config, 402, 'SUBSCRIPTION_REQUIRED');
    }
    const ok = (data: unknown) => ({
      data: { success: true, data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
    // The server's list omits a circle the user has lost.
    if (url === '/circles') {
      const lost = mode === 'removed' || mode === 'deleted';
      return ok({
        circles: lost
          ? [{ id: 'c2', name: 'Papá' }]
          : [
              { id: 'c1', name: 'Mamá' },
              { id: 'c2', name: 'Papá' },
            ],
      });
    }
    if (url === '/circles/c1') return ok({ circle: { id: 'c1', name: 'Mamá', can_edit: true, members: [] } });
    if (url === '/circles/c1/emergency-info') return ok({ emergency_info: PHI });
    return ok({});
  };
});

afterAll(() => {
  apiClient.defaults.adapter = originalAdapter;
  qc.clear();
});

beforeEach(() => {
  qc.clear();
  mode = 'member';
});

function EmergencyCard({ circleId }: { circleId: string }) {
  useCircle(circleId); // every circle page reads the circle
  const { data } = useEmergencyInfo(circleId);
  return <p data-testid="phi">{data ? (data.medical_conditions ?? []).join(',') : 'none'}</p>;
}

async function mountLoaded() {
  render(
    <QueryClientProvider client={qc}>
      <EmergencyCard circleId="c1" />
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByTestId('phi')).toHaveTextContent('CKD stage 3'));
  qc.setQueryData(['calendarEvents', 'c1', { start: '2026-09-29', end: '2026-09-29' }], [
    { id: 'm1', medication_name: 'Tacrolimus' },
  ]);
  qc.setQueryData(['documents', 'c1'], [{ id: 'd1', name: 'biopsy.pdf' }]);
  qc.setQueryData(['emergencyInfo', 'c2'], { allergies: ['latex'] });
  qc.setQueryData(['circles'], [{ id: 'c1', name: 'Mamá' }, { id: 'c2', name: 'Papá' }]);
  qc.setQueryData(['vitals', 'c1', 'latest'], [{ id: 'v1' }]);
  qc.setQueryData(['eventNotesRange', 'c1', { from: '2026-09-01', to: '2026-09-30' }], [{ id: 'n1' }]);
  qc.setQueryData(['calendarEvents', 'c2', { start: '2026-09-29', end: '2026-09-29' }], [{ id: 'other' }]);
}

async function refetchUntilCircleFails() {
  await act(async () => {
    await qc.invalidateQueries();
  });
  // The app client retries once (retry: 1) before giving up.
  await waitFor(() => expect(qc.getQueryState(['circle', 'c1'])?.status).toBe('error'), {
    timeout: 5000,
  });
}

describe('control: a transient failure keeps what is on screen', () => {
  it('a 500 on refetch leaves the cached emergency info rendering', async () => {
    await mountLoaded();
    mode = 'down';
    await refetchUntilCircleFails();
    expect(screen.getByTestId('phi')).toHaveTextContent('CKD stage 3');
    expect(qc.getQueryData(['emergencyInfo', 'c1'])).toEqual(PHI);
  }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXED 09-30 (PK14, audit #12). lib/queryClient.ts's QueryCache `onError` calls
// lib/purgeCircleCache when the CIRCLE read answers FORBIDDEN / NOT_FOUND: every
// query whose key names that circle is removed, the circle leaves the circles
// list, and the circle read keeps its error with its data cleared.
// ─────────────────────────────────────────────────────────────────────────────
describe.each<[Mode, string]>([
  ['removed', '403 FORBIDDEN'],
  ['deleted', '404 NOT_FOUND'],
])('circle access lost (%s: %s)', (lostMode) => {
  it(
    "the circle's PHI stops rendering and leaves the cache; another circle is untouched",
    async () => {
      await mountLoaded();
      mode = lostMode;
      await refetchUntilCircleFails();

      await waitFor(() => expect(screen.getByTestId('phi')).toHaveTextContent('none'));
      expect(qc.getQueryData(['emergencyInfo', 'c1'])).toBeUndefined();
      expect(
        qc.getQueryData(['calendarEvents', 'c1', { start: '2026-09-29', end: '2026-09-29' }])
      ).toBeUndefined();
      expect(qc.getQueryData(['documents', 'c1'])).toBeUndefined();
      expect(qc.getQueryData(['vitals', 'c1', 'latest'])).toBeUndefined();
      expect(
        qc.getQueryData(['eventNotesRange', 'c1', { from: '2026-09-01', to: '2026-09-30' }])
      ).toBeUndefined();
      // The circle read keeps the error but not its data.
      expect(qc.getQueryData(['circle', 'c1'])).toBeUndefined();
      expect(qc.getQueryState(['circle', 'c1'])?.status).toBe('error');
      // Another circle: untouched.
      expect(qc.getQueryData(['emergencyInfo', 'c2'])).toEqual({ allergies: ['latex'] });
      expect(
        qc.getQueryData(['calendarEvents', 'c2', { start: '2026-09-29', end: '2026-09-29' }])
      ).toEqual([{ id: 'other' }]);
    },
    10_000
  );

  it('drops the circle from the cached circles list and leaves the other in it', async () => {
    await mountLoaded();
    mode = lostMode;
    await refetchUntilCircleFails();
    await waitFor(() => expect(qc.getQueryData(['emergencyInfo', 'c1'])).toBeUndefined());
    const ids = ((qc.getQueryData(['circles']) as Array<{ id: string }> | undefined) ?? []).map(
      (c) => c.id
    );
    expect(ids).not.toContain('c1');
    expect(ids).toContain('c2');
  }, 10_000);
});

// Still a member: those codes only refetch access (invalidateCircleAccessFlags).
describe.each<[Mode, string]>([
  ['viewOnly', '403 VIEW_ONLY'],
  ['subscription', '402 SUBSCRIPTION_REQUIRED'],
])('control: still a member (%s: %s) does NOT purge', (refusalMode) => {
  it("keeps the circle's cached data", async () => {
    await mountLoaded();
    mode = refusalMode;
    await refetchUntilCircleFails();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId('phi')).toHaveTextContent('CKD stage 3');
    expect(qc.getQueryData(['emergencyInfo', 'c1'])).toEqual(PHI);
    expect(qc.getQueryData(['documents', 'c1'])).toEqual([{ id: 'd1', name: 'biopsy.pdf' }]);
    const ids = (qc.getQueryData(['circles']) as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain('c1');
  }, 10_000);
});
