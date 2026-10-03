import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';

// The page-level DELETE must remove the entry the user CHOSE. It used to keep only
// the entry's POSITION and slice the LIVE cache on confirm: a refetch while the
// confirm was open (tab refocus) after another caregiver removed an earlier entry
// made that position name the neighbour, with fresh versions, so the neighbour was
// deleted without a 409. The delete is now built from the snapshot the list was
// rendered from when Delete was picked (hooks/useEmergencyInfo buildEmergencyDelete).
// Same scenario in a real browser: e2e/flows/emergency-stale-delete.spec.ts.

vi.mock('@/hooks/useCareSummaryExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useCareSummaryExport')>();
  return {
    ...actual,
    useCareSummaryExport: () => ({
      exportPdf: vi.fn(),
      isExporting: false,
      error: null,
      clearError: vi.fn(),
    }),
  };
});

const mockedGet = vi.mocked(apiClient.get);
const mockedPut = vi.mocked(apiClient.put);
const CIRCLE_ID = 'circle-1';

const CONFLICT = {
  success: false,
  error: { code: 'EMERGENCY_INFO_CHANGED', message: 'x', details: { fields: [], versions: {} } },
};

const ana = { name: 'Ana', relationship: 'Daughter', phone: '555-0001' };
const ben = { name: 'Ben', relationship: 'Son', phone: '555-0002' };
const cara = { name: 'Cara', relationship: 'Niece', phone: '555-0003' };
const docA = { name: 'Dr A', specialty: 'Cardiology' };
const docB = { name: 'Dr B', specialty: 'Neurology' };
const docC = { name: 'Dr C', specialty: 'Oncology' };
const planA = { carrier: 'Aetna', policy_number: 'P1' };
const planB = { carrier: 'Blue Cross', policy_number: 'P2' };
const planC = { carrier: 'Cigna', policy_number: 'P3' };

const V1 = {
  emergency_contacts: 'vc1',
  additional_doctors: 'vd1',
  insurance_plans: 'vi1',
  primary_doctor_name: 'vpn1',
  primary_doctor_specialty: 'vps1',
  primary_doctor_phone: 'vpp1',
  primary_doctor_country_code: 'vpc1',
  primary_doctor_address: 'vpa1',
};

const info = (over: Partial<EmergencyInfo> = {}): EmergencyInfo => ({
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  emergency_contacts: [ana, ben, cara],
  additional_doctors: [docA, docB, docC],
  insurance_plans: [planA, planB, planC],
  primary_doctor_name: 'Dr Prim',
  primary_doctor_specialty: 'Family medicine',
  primary_doctor_phone: '555-0100',
  primary_doctor_country_code: '+1',
  primary_doctor_address: '1 Main St',
  allergies: ['Peanuts'],
  medication_allergies: [],
  medical_conditions: [],
  blood_type: 'O+',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  versions: V1,
  ...over,
});

let current: EmergencyInfo;

function mockApi(): void {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === '/circles') {
      return { success: true, data: { circles: [{ id: CIRCLE_ID, name: 'Care', recipient_name: 'Rose' }] } };
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return {
        success: true,
        data: {
          circle: {
            id: CIRCLE_ID,
            name: 'Care',
            recipient_name: 'Rose',
            recipient_photo_url: null,
            recipient_dob: '1948-03-12',
            owner_id: 'owner-1',
            created_at: '2026-01-01T00:00:00.000Z',
            is_self_care: false,
            care_recipient_timezone: 'America/New_York',
            members: [],
            access_level: 'edit',
            is_premium_circle: true,
            can_edit: true,
            view_only: false,
          },
        },
      };
    }
    if (url === `/circles/${CIRCLE_ID}/emergency-info`) {
      // Mirror getEmergencyInfo: the page reads `data.emergency_info` + `data.versions`.
      const { versions, ...row } = current;
      return { success: true, data: { emergency_info: row, versions } };
    }
    throw new Error(`Unexpected GET in test: ${url}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/circles/${CIRCLE_ID}/emergency`]}>
          <Routes>
            <Route path="/circles/:circleId/emergency" element={<EmergencyInfoPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return queryClient;
}

const emergencyGets = (): number =>
  mockedGet.mock.calls.filter(([url]) => url === `/circles/${CIRCLE_ID}/emergency-info`).length;

/**
 * The refetch a tab refocus triggers (refetchOnWindowFocus 'always'), awaited, and
 * then the page itself must have RENDERED the new list: React Query notifies
 * subscribers on a timer, so the cache holding the new data is not yet the page
 * showing it. `staleText` is something only the old list shows.
 */
async function refocus(queryClient: QueryClient, staleText: string): Promise<void> {
  const before = emergencyGets();
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: queryKeys.emergencyInfo(CIRCLE_ID) });
  });
  expect(emergencyGets()).toBe(before + 1);
  await waitFor(() => expect(screen.queryByText(staleText)).not.toBeInTheDocument());
}

async function openDelete(name: string, menuItem: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: menuItem }));
  return screen.findByRole('dialog');
}

describe('EmergencyInfoPage delete: the list shifts while the confirm is OPEN', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPut.mockReset();
    mockedPut.mockRejectedValue(CONFLICT); // what the server answers to the stale versions
    current = info();
    mockApi();
  });

  it.each([
    {
      kind: 'contact',
      chosen: 'Ben',
      menuItem: 'Delete contact Ben',
      field: 'emergency_contacts',
      version: 'vc1',
      shifted: { emergency_contacts: [ben, cara] }, // another member removed Ana
      gone: 'Ana',
      versions: { emergency_contacts: 'vc2' },
      expected: ['Ana', 'Cara'],
      label: (e: Record<string, string>) => e.name,
    },
    {
      kind: 'doctor',
      chosen: 'Dr B',
      menuItem: 'Delete doctor Dr B',
      field: 'additional_doctors',
      version: 'vd1',
      shifted: { additional_doctors: [docB, docC] },
      gone: 'Dr A',
      versions: { additional_doctors: 'vd2' },
      expected: ['Dr A', 'Dr C'],
      label: (e: Record<string, string>) => e.name,
    },
    {
      kind: 'insurance',
      chosen: 'Blue Cross',
      menuItem: 'Delete insurance Blue Cross',
      field: 'insurance_plans',
      version: 'vi1',
      shifted: { insurance_plans: [planB, planC] },
      gone: 'Aetna',
      versions: { insurance_plans: 'vi2' },
      expected: ['Aetna', 'Cigna'],
      label: (e: Record<string, string>) => e.carrier,
    },
  ])(
    '$kind: confirming deletes what the user chose from what they saw, guarded by the versions they saw; the server 409 refuses it',
    async ({ chosen, menuItem, field, version, shifted, gone, versions, expected, label }) => {
      const queryClient = renderPage();
      const dialog = await openDelete(chosen, menuItem);

      // Another caregiver removes the FIRST entry; the tab refocuses; the list behind the
      // confirm is now the shifted one, with fresh versions.
      current = info({ ...shifted, versions: { ...V1, ...versions } });
      await refocus(queryClient, gone);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      const body = mockedPut.mock.calls[0][1] as Record<string, unknown> & {
        if_match: Record<string, string>;
      };
      // The entry removed is the CHOSEN one (the neighbour stays), and the precondition is
      // the version of the list the user saw, so the server refuses instead of applying it.
      expect((body[field] as Record<string, string>[]).map(label)).toEqual(expected);
      expect(body.if_match).toEqual({ [field]: version });
      expect(Object.keys(body).sort()).toEqual([field, 'if_match'].sort());

      // Refused: the conflict message shows, the stale confirm is dropped, the list reloaded.
      expect(await screen.findByText(/Someone else updated this/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mockedPut).toHaveBeenCalledTimes(1);
    }
  );

  it('primary doctor: the flat-field delete is guarded by the versions the user saw', async () => {
    const queryClient = renderPage();
    const dialog = await openDelete('Dr Prim', 'Delete doctor Dr Prim');

    // Another caregiver changes the primary doctor's specialty; the tab refocuses.
    current = info({
      primary_doctor_specialty: 'Hematology',
      versions: { ...V1, primary_doctor_specialty: 'vps2' },
    });
    await refocus(queryClient, 'Family medicine');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    const body = mockedPut.mock.calls[0][1] as { if_match: Record<string, string> };
    expect(body.if_match).toEqual({
      primary_doctor_name: 'vpn1',
      primary_doctor_specialty: 'vps1', // not 'vps2': the delete is NOT silently re-based
      primary_doctor_phone: 'vpp1',
      primary_doctor_address: 'vpa1',
    });
    expect(await screen.findByText(/Someone else updated this/)).toBeInTheDocument();
  });

  it('no shift: the delete goes through as before and closes the confirm', async () => {
    mockedPut.mockReset();
    mockedPut.mockResolvedValue({ success: true, data: { emergency_info: info() } });
    renderPage();
    const dialog = await openDelete('Ben', 'Delete contact Ben');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    const body = mockedPut.mock.calls[0][1] as { emergency_contacts: { name: string }[] };
    expect(body.emergency_contacts.map((c) => c.name)).toEqual(['Ana', 'Cara']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
