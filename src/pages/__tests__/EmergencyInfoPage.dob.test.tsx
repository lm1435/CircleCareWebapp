import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
// A US browser regardless of the sweep zone (week start, phone seed): src/test/regionZonePin.ts.
vi.mock('@/lib/regionResolver', async (orig) =>
  (await import('@/test/regionZonePin')).withPinnedRegionZone(await orig<typeof import('@/lib/regionResolver')>())
);
import { apiClient } from '@/lib/api';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';

// The export hook is exercised in its own suite (useCareSummaryExport.test.tsx);
// here it is a controllable stub so the page's confirm flow can be asserted
// without an iframe print. `mockExportPdf` is reset per test. `exportPdf` now
// takes the share sheet's options object (task 30) — `careSummaryNotesWindow`
// is re-exported via `importOriginal` since `CareSummaryShareDialog` imports
// it from this same module for its own count queries' window.
const mockExportPdf =
  vi.fn<(options?: { includeVisitNotes: boolean; includeCareNotes: boolean }) => Promise<void>>();
let mockIsExporting = false;
vi.mock('@/hooks/useCareSummaryExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useCareSummaryExport')>();
  return {
    ...actual,
    useCareSummaryExport: () => ({
      exportPdf: mockExportPdf,
      isExporting: mockIsExporting,
      error: null,
      clearError: vi.fn(),
    }),
  };
});

// CareSummaryShareDialog's own two count queries (task 30) — this file's
// focus is page wiring, not the counting logic itself (that is
// CareSummaryShareDialog's own suite). A quiet, resolved-empty default keeps
// every pre-existing share-flow test's dialog free of "Counting notes…".
const mockUseEventNotesRange = vi.fn();
const mockUseCareNotes = vi.fn();
vi.mock('@/hooks/useEventNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useEventNotes')>();
  return { ...actual, useEventNotesRange: (...args: unknown[]) => mockUseEventNotesRange(...args) };
});
vi.mock('@/hooks/useCareNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useCareNotes')>();
  return { ...actual, useCareNotes: (...args: unknown[]) => mockUseCareNotes(...args) };
});

// @/lib/api is mocked globally in src/test/setup.ts. The real apiClient's
// response interceptor unwraps to the `{ success, data }` envelope, so the
// mock resolves with the envelope directly.
const mockedGet = vi.mocked(apiClient.get);


const CIRCLE_ID = 'circle-1';

const circlesEnvelope = {
  success: true,
  data: {
    circles: [{ id: CIRCLE_ID, name: "Rose's Care Team", recipient_name: 'Rose' }],
  },
};

// GET /circles/:circleId — circle detail carries recipient photo/DOB/conditions
// (used by the RecipientHeader card). See src/api/circleMembers.ts.
const circleDetailEnvelope = {
  success: true,
  data: {
    circle: {
      id: CIRCLE_ID,
      name: "Rose's Care Team",
      recipient_name: 'Rose',
      recipient_photo_url: null,
      recipient_dob: '1948-03-12',
      recipient_conditions: ['Hypertension', 'Type 2 diabetes'],
      owner_id: 'owner-1',
      created_at: '2026-01-01T00:00:00.000Z',
      is_self_care: false,
      care_recipient_timezone: 'America/New_York',
      members: [],
      access_level: 'view',
      is_premium_circle: false,
      can_edit: false,
      view_only: true,
    },
  },
};

const fullInfo: EmergencyInfo = {
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [
    {
      carrier: 'Blue Cross',
      policy_number: 'POL-123',
      group_number: 'GRP-9',
      phone: '555-0100',
      is_primary: true,
    },
  ],
  primary_doctor_name: 'Dr. Chen',
  primary_doctor_specialty: 'Cardiology',
  primary_doctor_phone: '555-0101',
  primary_doctor_country_code: '+1',
  primary_doctor_address: '1 Main St',
  additional_doctors: [{ name: 'Dr. Patel', specialty: 'Neurology', phone: '555-0102' }],
  allergies: ['Peanuts'],
  medication_allergies: ['Penicillin'],
  medical_conditions: ['Hypertension'],
  blood_type: 'O+',
  emergency_contacts: [
    { name: 'Sarah', relationship: 'Daughter', phone: '555-0103', is_primary: true },
  ],
  advance_directives: 'Living will on file',
  has_dnr: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** The medication window GET /circles/:id/events answers (Current medications). */
let mockEvents: unknown[] = [];

function mockApi(emergencyInfo: EmergencyInfo | null, canEdit = false): void {
  const detail = {
    ...circleDetailEnvelope,
    data: {
      circle: {
        ...circleDetailEnvelope.data.circle,
        can_edit: canEdit,
        view_only: !canEdit,
        access_level: canEdit ? 'edit' : 'view',
      },
    },
  };
  mockedGet.mockImplementation(async (url: string) => {
    if (url === '/circles') return circlesEnvelope;
    if (url === `/circles/${CIRCLE_ID}`) return detail;
    if (url === `/circles/${CIRCLE_ID}/emergency-info`) {
      return { success: true, data: { emergency_info: emergencyInfo } };
    }
    // Notes by doctor: the visit counts for the Medical Info cards. This file is
    // about the sections, so the answer is "no counts yet" (providers.test covers them).
    if (url === `/circles/${CIRCLE_ID}/providers`) {
      return { success: true, data: { providers: [] } };
    }
    if (url === `/circles/${CIRCLE_ID}/events`) {
      return { success: true, data: { events: mockEvents } };
    }
    throw new Error(`Unexpected GET in test: ${url}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
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
}


// DATE OF BIRTH PROMPT (owner 2026-11-22, 1.4.3): onboarding no longer asks for it, so the Emergency page
// and the care summary offer it to whoever may edit the circle. Positive and negative cases, named.

const mockedPatch = vi.mocked(apiClient.patch);
let detailDob: string | null = null;
let ownerId = 'owner-1';
/** The list's `read_only` (a lapsed, non-selected free-tier circle). */
let listReadOnly = false;
/** The recipient's name on both the list and the detail ('' = not set: the circle name is the fallback). */
let recipientNameValue = 'Rose';

function mockDobApi(canEdit: boolean): void {
  mockApi(fullInfo, canEdit);
  const base = mockedGet.getMockImplementation()!;
  mockedGet.mockImplementation(async (url: string, ...rest: unknown[]) => {
    if (url === '/circles') {
      return {
        success: true,
        data: {
          circles: [
            { ...circlesEnvelope.data.circles[0], recipient_name: recipientNameValue, read_only: listReadOnly },
          ],
        },
      };
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return {
        success: true,
        data: {
          circle: {
            ...circleDetailEnvelope.data.circle,
            owner_id: ownerId,
            recipient_name: recipientNameValue,
            recipient_dob: detailDob,
            can_edit: canEdit,
            view_only: !canEdit,
            access_level: canEdit ? 'edit' : 'view',
          },
        },
      };
    }
    return (base as (u: string, ...r: unknown[]) => Promise<unknown>)(url, ...rest);
  });
}

let promptViewed: ReturnType<typeof vi.spyOn>;
let dobAdded: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockExportPdf.mockReset();
  mockExportPdf.mockResolvedValue(undefined);
  mockIsExporting = false;
  mockEvents = [];
  mockUseEventNotesRange.mockReturnValue({ data: [], isLoading: false, isError: false });
  mockUseCareNotes.mockReturnValue({
    data: { notes: [], today: '2026-06-01', timezone: 'America/New_York' },
    isLoading: false,
    isError: false,
  });
  detailDob = null;
  ownerId = 'owner-1';
  listReadOnly = false;
  recipientNameValue = 'Rose';
  onlineManager.setOnline(true);
  useAuthStore.setState({ user: { id: 'owner-1' } as never, isAuthenticated: true });
  promptViewed = vi.spyOn(Analytics, 'dobPromptViewed').mockImplementation(() => {});
  dobAdded = vi.spyOn(Analytics, 'dobAdded').mockImplementation(() => {});
  vi.spyOn(Analytics, 'emergencyInfoViewed').mockImplementation(() => {});
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

async function addDob(value: string): Promise<void> {
  fireEvent.click(await screen.findByTestId('recipient-add-dob'));
  const dialog = await screen.findByRole('dialog', { name: 'Add date of birth' });
  fireEvent.change(within(dialog).getByLabelText('Date of birth'), { target: { value } });
  mockedPatch.mockImplementation(async () => {
    detailDob = value;
    return { success: true, data: {} };
  });
  fireEvent.click(within(dialog).getByTestId('recipient-dob-save'));
}

describe('Emergency info: Add date of birth', () => {
  it('POSITIVE: no DOB + owner who can edit -> the row shows; dob_prompt_viewed {emergency} once', async () => {
    mockDobApi(true);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Add date of birth' })).toBeInTheDocument();
    await waitFor(() => expect(promptViewed).toHaveBeenCalledWith('emergency'));
    expect(promptViewed).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE: save sends EXACTLY the picked YYYY-MM-DD (1950-06-15), the row goes and the DOB shows; dob_added {emergency_prompt} once', async () => {
    mockDobApi(true);
    renderPage();
    await addDob('1950-06-15');
    await waitFor(() => expect(mockedPatch).toHaveBeenCalledTimes(1));
    expect(mockedPatch).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}`, { recipient_dob: '1950-06-15' });
    expect(await screen.findByText('June 15, 1950')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('recipient-add-dob')).not.toBeInTheDocument());
    expect(dobAdded).toHaveBeenCalledTimes(1);
    expect(dobAdded).toHaveBeenCalledWith('emergency_prompt');
    // Enum only: the date never rides on an event.
    expect(JSON.stringify([dobAdded.mock.calls, promptViewed.mock.calls])).not.toContain('1950');
  });

  it('NEGATIVE: Cancel writes nothing and fires no dob_added', async () => {
    mockDobApi(true);
    renderPage();
    fireEvent.click(await screen.findByTestId('recipient-add-dob'));
    const dialog = await screen.findByRole('dialog', { name: 'Add date of birth' });
    fireEvent.change(within(dialog).getByLabelText('Date of birth'), { target: { value: '1950-06-15' } });
    fireEvent.click(within(dialog.querySelector('[data-modal-footer]') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockedPatch).not.toHaveBeenCalled();
    expect(dobAdded).not.toHaveBeenCalled();
    expect(screen.getByTestId('recipient-add-dob')).toBeInTheDocument();
  });

  it('NEGATIVE: a DOB already on file -> no row, no prompt event', async () => {
    detailDob = '1948-03-12';
    mockDobApi(true);
    renderPage();
    expect(await screen.findByText('March 12, 1948')).toBeInTheDocument();
    expect(screen.queryByTestId('recipient-add-dob')).not.toBeInTheDocument();
    expect(promptViewed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a view-only member never sees the row', async () => {
    mockDobApi(false);
    renderPage();
    await screen.findByText('Rose');
    await screen.findByText('Peanuts');
    expect(screen.queryByTestId('recipient-add-dob')).not.toBeInTheDocument();
    expect(promptViewed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a caregiver who can edit entries but does not own the circle (Edit circle is owner-only) sees no row', async () => {
    ownerId = 'someone-else';
    mockDobApi(true);
    renderPage();
    await screen.findByText('Peanuts');
    expect(screen.queryByTestId('recipient-add-dob')).not.toBeInTheDocument();
  });
});

describe('Emergency info: never on a lapsed circle, never offline (mobile parity)', () => {
  it('NEGATIVE: a LAPSED (read-only, non-selected free-tier) circle shows no row and no export note', async () => {
    listReadOnly = true;
    mockDobApi(true);
    renderPage();
    await screen.findByText('Peanuts');
    // Wait for the list (which carries read_only) to have answered.
    await waitFor(() => expect(mockedGet.mock.calls.some((c) => c[0] === '/circles')).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('recipient-add-dob')).not.toBeInTheDocument();
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    expect(await screen.findByRole('dialog', { name: 'Share care summary' })).toBeInTheDocument();
    expect(promptViewed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: offline (the cached copy) shows no row', async () => {
    mockDobApi(true);
    renderPage();
    await screen.findByTestId('recipient-add-dob');
    act(() => onlineManager.setOnline(false));
    await waitFor(() => expect(screen.queryByTestId('recipient-add-dob')).not.toBeInTheDocument());
  });
});

describe('Care summary: the DOB note body (emergency:dobPrompt.missingBody)', () => {
  async function openNote(): Promise<HTMLElement> {
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    return screen.findByRole('dialog', { name: "Date of birth isn't set." });
  }

  it('POSITIVE: the body names the recipient (no empty band)', async () => {
    mockDobApi(true);
    renderPage();
    await screen.findByTestId('recipient-add-dob');
    const note = await openNote();
    expect(
      within(note).getByText('It helps first responders and doctors confirm who Rose is.')
    ).toBeInTheDocument();
  });

  it('POSITIVE: an empty recipient name falls back to the circle name', async () => {
    recipientNameValue = '';
    mockDobApi(true);
    renderPage();
    await screen.findByTestId('recipient-add-dob');
    const note = await openNote();
    expect(
      within(note).getByText("It helps first responders and doctors confirm who Rose's Care Team is.")
    ).toBeInTheDocument();
  });

  it('NEGATIVE: the body never renders a raw key or an empty name', async () => {
    recipientNameValue = '';
    mockDobApi(true);
    renderPage();
    await screen.findByTestId('recipient-add-dob');
    const note = await openNote();
    expect(within(note).queryByText(/dobPrompt\.missingBody/)).toBeNull();
    expect(within(note).queryByText('It helps first responders and doctors confirm who  is.')).toBeNull();
  });

  it('POSITIVE (es): the body renders in Spanish with the name', async () => {
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('es');
    try {
      mockDobApi(true);
      renderPage();
      await screen.findByTestId('recipient-add-dob');
      const [share] = await screen.findAllByRole('button', { name: 'Compartir' });
      fireEvent.click(share);
      expect(
        await screen.findByText('Ayuda a los paramédicos y médicos a confirmar quién es Rose.')
      ).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('Care summary: the DOB note before exporting', () => {
  it('POSITIVE: DOB missing + editor -> ONE note; Export anyway goes straight to the share sheet and exports', async () => {
    mockDobApi(true);
    renderPage();
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    const note = await screen.findByRole('dialog', { name: "Date of birth isn't set." });
    expect(promptViewed).toHaveBeenCalledWith('export');
    // A real body line with the recipient's name, never an empty band.
    expect(
      within(note).getByText('It helps first responders and doctors confirm who Rose is.')
    ).toBeInTheDocument();
    fireEvent.click(within(note).getAllByRole('button', { name: 'Export anyway' }).slice(-1)[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Share care summary' });
    fireEvent.click(within(sheet.querySelector('[data-modal-footer]') as HTMLElement).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(mockExportPdf).toHaveBeenCalledTimes(1));
    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it('POSITIVE: Add -> the picker -> saved -> continues to the share sheet; dob_added {export_prompt}', async () => {
    mockDobApi(true);
    renderPage();
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    const note = await screen.findByRole('dialog', { name: "Date of birth isn't set." });
    fireEvent.click(within(note).getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add date of birth' });
    mockedPatch.mockImplementation(async () => {
      detailDob = '1950-06-15';
      return { success: true, data: {} };
    });
    fireEvent.change(within(dialog).getByLabelText('Date of birth'), { target: { value: '1950-06-15' } });
    fireEvent.click(within(dialog).getByTestId('recipient-dob-save'));
    expect(await screen.findByRole('dialog', { name: 'Share care summary' })).toBeInTheDocument();
    expect(mockedPatch).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}`, { recipient_dob: '1950-06-15' });
    expect(dobAdded).toHaveBeenCalledWith('export_prompt');
    expect(dobAdded).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: the note is shown once per visit as an event even when Share is pressed twice', async () => {
    mockDobApi(true);
    renderPage();
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    const note = await screen.findByRole('dialog', { name: "Date of birth isn't set." });
    fireEvent.click(within(note).getAllByRole('button', { name: 'Export anyway' }).slice(-1)[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Share care summary' });
    fireEvent.click(within(sheet.querySelector('[data-modal-footer]') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(share);
    await screen.findByRole('dialog', { name: "Date of birth isn't set." });
    expect(promptViewed.mock.calls.filter((call: unknown[]) => call[0] === 'export')).toHaveLength(1);
  });

  it('NEGATIVE: a DOB on file -> no note, straight to the share sheet', async () => {
    detailDob = '1948-03-12';
    mockDobApi(true);
    renderPage();
    await screen.findByText('March 12, 1948');
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    expect(await screen.findByRole('dialog', { name: 'Share care summary' })).toBeInTheDocument();
    expect(screen.queryByText("Date of birth isn't set.")).not.toBeInTheDocument();
    expect(promptViewed).not.toHaveBeenCalledWith('export');
  });

  it('NEGATIVE: view-only goes straight through (no note) even with no DOB', async () => {
    mockDobApi(false);
    renderPage();
    await screen.findByText('Peanuts');
    const [share] = await screen.findAllByRole('button', { name: 'Share' });
    fireEvent.click(share);
    expect(await screen.findByRole('dialog', { name: 'Share care summary' })).toBeInTheDocument();
    expect(promptViewed).not.toHaveBeenCalled();
  });
});
