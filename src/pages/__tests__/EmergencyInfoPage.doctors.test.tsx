import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';

// Notes by doctor on Medical Info (docs/plans/notes-by-doctor.md flow 1 and 4):
// each doctor card has a "Visits & notes" row (count only above 0, for every
// member), and removing a doctor ARCHIVES it through /providers.

vi.mock('@/hooks/useCareSummaryExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCareSummaryExport')>()),
  useCareSummaryExport: () => ({
    exportPdf: vi.fn(),
    isExporting: false,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock('@/hooks/useEventNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useEventNotes')>()),
  useEventNotesRange: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useCareNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCareNotes')>()),
  useCareNotes: () => ({
    data: { notes: [], today: '2026-06-01', timezone: 'America/New_York' },
    isLoading: false,
    isError: false,
  }),
}));

const mockedGet = vi.mocked(apiClient.get);
const mockedPut = vi.mocked(apiClient.put);
const mockedPost = vi.mocked(apiClient.post);

const CIRCLE_ID = 'circle-1';
const PRIMARY_ID = '11111111-1111-4111-8111-111111111111';
const PATEL_ID = '22222222-2222-4222-8222-222222222222';
const KIM_ID = '33333333-3333-4333-8333-333333333333';

const info: EmergencyInfo = {
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [],
  primary_doctor_id: PRIMARY_ID,
  primary_doctor_name: 'Dr. Chen',
  primary_doctor_specialty: 'Cardiology',
  primary_doctor_phone: '555-0101',
  primary_doctor_country_code: '+1',
  primary_doctor_address: '1 Main St',
  additional_doctors: [
    { id: PATEL_ID, name: 'Dr. Patel', specialty: 'Neurology', phone: '555-0102' },
    { id: KIM_ID, name: 'Dr. Kim', specialty: 'Family medicine' },
  ],
  allergies: ['Peanuts'],
  medication_allergies: [],
  medical_conditions: [],
  blood_type: 'O+',
  emergency_contacts: [
    { name: 'Sarah', relationship: 'Daughter', phone: '555-0103', is_primary: true },
  ],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

let providersReply: () => unknown;

function mockApi(emergencyInfo: EmergencyInfo, canEdit: boolean): void {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === '/circles') {
      return {
        success: true,
        data: { circles: [{ id: CIRCLE_ID, name: 'Team', recipient_name: 'Rose' }] },
      };
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return {
        success: true,
        data: {
          circle: {
            id: CIRCLE_ID,
            name: 'Team',
            recipient_name: 'Rose',
            recipient_photo_url: null,
            recipient_dob: null,
            recipient_conditions: [],
            owner_id: 'o',
            created_at: '2026-01-01T00:00:00.000Z',
            is_self_care: false,
            care_recipient_timezone: 'America/New_York',
            members: [],
            access_level: canEdit ? 'edit' : 'view',
            is_premium_circle: false,
            can_edit: canEdit,
            view_only: !canEdit,
          },
        },
      };
    }
    if (url === `/circles/${CIRCLE_ID}/emergency-info`) {
      return { success: true, data: { emergency_info: emergencyInfo } };
    }
    if (url === `/circles/${CIRCLE_ID}/providers`) return providersReply();
    throw new Error(`Unexpected GET in test: ${url}`);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/circles/${CIRCLE_ID}/emergency`]}>
          <Routes>
            <Route path="/circles/:circleId/emergency" element={<EmergencyInfoPage />} />
            <Route
              path="/circles/:circleId/providers/:providerId"
              element={<div>visits-page</div>}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const provider = (id: string, name: string, visit_count: number) => ({
  id,
  name,
  specialty: null,
  phone: null,
  country_code: null,
  phone_extension: null,
  address: null,
  is_primary: false,
  sort_order: 0,
  archived_at: null,
  created_at: '',
  updated_at: '',
  visit_count,
});

beforeEach(() => {
  mockedGet.mockReset();
  mockedPut.mockReset();
  mockedPost.mockReset();
  providersReply = () => ({
    success: true,
    data: {
      providers: [
        provider(PRIMARY_ID, 'Dr. Chen', 6),
        provider(PATEL_ID, 'Dr. Patel', 0),
        provider(KIM_ID, 'Dr. Kim', 1),
      ],
    },
  });
});

/** The card that holds `name` as its heading. */
function cardOf(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name });
  return heading.closest('div[class*="print-card"]') as HTMLElement;
}

describe('Medical Info: Visits & notes row on each doctor card', () => {
  it('every card has the row; the count appears only above 0', async () => {
    mockApi(info, true);
    renderPage();
    await screen.findByRole('heading', { level: 3, name: 'Dr. Chen' });

    const chen = within(cardOf('Dr. Chen')).getByRole('link', { name: /Visits & notes/ });
    const patel = within(cardOf('Dr. Patel')).getByRole('link', { name: /Visits & notes/ });
    const kim = within(cardOf('Dr. Kim')).getByRole('link', { name: /Visits & notes/ });

    await waitFor(() => expect(chen).toHaveTextContent('6'));
    expect(kim).toHaveTextContent('1');
    // 0 visits: the row is there, the number is not.
    expect(patel).not.toHaveTextContent(/\d/);
    // The accessible name says whose visits these are.
    expect(chen).toHaveAccessibleName(/Visits & notes with Dr\. Chen/);
  });

  it("routes to that doctor's Visits page by stable id", async () => {
    mockApi(info, true);
    renderPage();
    await screen.findByRole('heading', { level: 3, name: 'Dr. Patel' });
    const link = within(cardOf('Dr. Patel')).getByRole('link', { name: /Visits & notes/ });
    expect(link).toHaveAttribute('href', `/circles/${CIRCLE_ID}/providers/${PATEL_ID}`);
    fireEvent.click(link);
    expect(await screen.findByText('visits-page')).toBeInTheDocument();
  });

  it('a VIEW-ONLY member sees the row too (and no edit affordances)', async () => {
    mockApi(info, false);
    renderPage();
    await screen.findByRole('heading', { level: 3, name: 'Dr. Chen' });
    expect(
      within(cardOf('Dr. Chen')).getByRole('link', { name: /Visits & notes/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for Dr\. Chen/ })).toBeNull();
  });

  it('a count that failed to load still leaves the row (just without a number)', async () => {
    providersReply = () => {
      throw new Error('boom');
    };
    mockApi(info, true);
    renderPage();
    await screen.findByRole('heading', { level: 3, name: 'Dr. Chen' });
    const row = within(cardOf('Dr. Chen')).getByRole('link', { name: /Visits & notes/ });
    expect(row).not.toHaveTextContent(/\d/);
  });

  it('a doctor with no stable id yet (older backend) gets no row to nowhere', async () => {
    const legacy = {
      ...info,
      primary_doctor_id: undefined,
      additional_doctors: [{ name: 'Dr. Patel', specialty: 'Neurology' }],
    };
    mockApi(legacy, true);
    renderPage();
    await screen.findByRole('heading', { level: 3, name: 'Dr. Chen' });
    expect(screen.queryByRole('link', { name: /Visits & notes/ })).toBeNull();
  });
});

describe('Medical Info: removing a doctor archives it through /providers', () => {
  async function pickDelete(label: string): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Actions for ${label}`) }));
    fireEvent.click(await screen.findByRole('menuitem', { name: `Delete doctor ${label}` }));
    return screen.findByRole('dialog');
  }

  it('an additional doctor: POST /providers/:id/archive, never an array PUT', async () => {
    mockApi(info, true);
    mockedPost.mockResolvedValue({
      success: true,
      data: { provider: { id: PATEL_ID }, providers: [] },
    });
    renderPage();
    const dialog = await pickDelete('Dr. Patel');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][0]).toBe(`/circles/${CIRCLE_ID}/providers/${PATEL_ID}/archive`);
    expect(mockedPut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the primary doctor is archived by primary_doctor_id', async () => {
    mockApi(info, true);
    mockedPost.mockResolvedValue({
      success: true,
      data: { provider: { id: PRIMARY_ID }, providers: [] },
    });
    renderPage();
    const dialog = await pickDelete('Dr. Chen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][0]).toBe(
      `/circles/${CIRCLE_ID}/providers/${PRIMARY_ID}/archive`
    );
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('a failed removal keeps the confirm open for a retry', async () => {
    mockApi(info, true);
    mockedPost.mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR' } });
    renderPage();
    const dialog = await pickDelete('Dr. Patel');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('already removed by someone else (PROVIDER_ARCHIVED): the confirm closes', async () => {
    mockApi(info, true);
    mockedPost.mockRejectedValue({ success: false, error: { code: 'PROVIDER_ARCHIVED' } });
    renderPage();
    const dialog = await pickDelete('Dr. Patel');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a doctor without an id still takes the legacy array write', async () => {
    const legacy = { ...info, additional_doctors: [{ name: 'Dr. Patel', specialty: 'Neurology' }] };
    mockApi(legacy, true);
    mockedPut.mockResolvedValue({ success: true, data: { emergency_info: legacy } });
    renderPage();
    const dialog = await pickDelete('Dr. Patel');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
