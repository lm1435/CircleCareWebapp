import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';

// @/lib/api is mocked globally in src/test/setup.ts. The real apiClient's
// response interceptor unwraps to the `{ success, data }` envelope, so the
// mock resolves with the envelope directly.
const mockedGet = vi.mocked(apiClient.get);
const mockedPut = vi.mocked(apiClient.put);

/** Typed view of the last PUT body for assertions. */
function lastPutBody(): {
  additional_doctors?: { name: string }[];
  emergency_contacts?: { name: string }[];
  insurance_plans?: { carrier: string }[];
} {
  const call = mockedPut.mock.calls[0];
  return (call?.[1] ?? {}) as ReturnType<typeof lastPutBody>;
}

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

describe('EmergencyInfoPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPut.mockReset();
  });

  it('renders all five sections with data', async () => {
    mockApi(fullInfo);
    renderPage();

    // Collapsible accordion headers carry a count in their meta slot, so the
    // h2 accessible name includes the number (e.g. "Doctors 2"). Match loosely.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Medical Information' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Doctors/ })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Emergency Contacts/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Insurance/ })).toBeInTheDocument();
    // Code Status stays always-visible (a plain section, not an accordion).
    expect(screen.getByRole('heading', { level: 2, name: 'Code Status' })).toBeInTheDocument();

    // Section contents. Blood type and the primary contact name also appear in
    // the at-a-glance tiles, so scope these to their sections to stay precise.
    const medicalSection = screen.getByRole('region', { name: 'Medical Information' });
    expect(within(medicalSection).getByText('O+')).toBeInTheDocument();
    expect(within(medicalSection).getByText('Penicillin')).toBeInTheDocument();
    const contactsSection = screen.getByRole('region', { name: 'Emergency Contacts' });
    expect(within(contactsSection).getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Dr. Chen')).toBeInTheDocument();
    expect(screen.getByText('Dr. Patel')).toBeInTheDocument();
    expect(screen.getByText('Blue Cross')).toBeInTheDocument();
    expect(screen.getByText('POL-123')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument(); // DNR status
    expect(screen.getByText('Living will on file')).toBeInTheDocument();

    // Print header identifies the care recipient
    expect(screen.getByText('Emergency information for Rose')).toBeInTheDocument();
  });

  it('renders phone numbers as tel: links', async () => {
    mockApi(fullInfo);
    renderPage();

    const doctorLink = await screen.findByRole('link', { name: 'Call Dr. Chen' });
    expect(doctorLink).toHaveAttribute('href', 'tel:+15550101');

    const contactLink = screen.getByRole('link', { name: 'Call Sarah' });
    expect(contactLink).toHaveAttribute('href', 'tel:5550103');

    const insuranceLink = screen.getByRole('link', { name: 'Call Blue Cross' });
    expect(insuranceLink).toHaveAttribute('href', 'tel:5550100');

    // The call affordance carries a decorative glyph; the tel href and the
    // accessible name (label) must remain intact alongside it.
    expect(doctorLink.querySelector('svg')).toBeTruthy();
    expect(doctorLink).toHaveTextContent('+1 555-0101');
    expect(doctorLink.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the care recipient header from circle detail', async () => {
    mockApi(fullInfo);
    renderPage();

    // Name as an h2, DOB label + formatted value, and conditions string.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Rose' })
    ).toBeInTheDocument();
    expect(screen.getByText('Date of birth')).toBeInTheDocument();
    expect(screen.getByText('March 12, 1948')).toBeInTheDocument();
    expect(screen.getByText('Hypertension, Type 2 diabetes')).toBeInTheDocument();
  });

  it('renders at-a-glance tiles for the highest-priority facts', async () => {
    mockApi(fullInfo);
    renderPage();

    const glance = await screen.findByRole('region', { name: 'At a glance' });
    expect(glance).toBeInTheDocument();
    // Blood type, allergies, conditions, and primary contact tiles all present.
    expect(within(glance).getByText('Blood Type')).toBeInTheDocument();
    expect(within(glance).getByText('O+')).toBeInTheDocument();
    expect(within(glance).getByText('Allergies')).toBeInTheDocument();
    // Medication + other allergies are merged in the allergies tile.
    expect(within(glance).getByText('Penicillin, Peanuts')).toBeInTheDocument();
    expect(within(glance).getByText('Emergency Contact')).toBeInTheDocument();
    expect(within(glance).getByText('Sarah')).toBeInTheDocument();
  });

  it('omits at-a-glance tiles whose data is absent', async () => {
    mockApi({
      ...fullInfo,
      blood_type: null,
      allergies: null,
      medication_allergies: null,
      medical_conditions: [],
      // Keep a primary contact so the glance region still renders.
    });
    renderPage();

    const glance = await screen.findByRole('region', { name: 'At a glance' });
    // Only the contact tile remains; the absent facts produce no tiles.
    expect(within(glance).getByText('Emergency Contact')).toBeInTheDocument();
    expect(within(glance).queryByText('Blood Type')).not.toBeInTheDocument();
    expect(within(glance).queryByText('Allergies')).not.toBeInTheDocument();
  });

  it('shows per-section empty states when only some sections have data', async () => {
    mockApi({
      ...fullInfo,
      insurance_plans: [],
      allergies: null,
      medication_allergies: null,
      medical_conditions: [],
      blood_type: null,
      emergency_contacts: null,
      advance_directives: null,
      has_dnr: null,
    });
    renderPage();

    // Doctors section still has data
    expect(await screen.findByText('Dr. Chen')).toBeInTheDocument();

    // The other four sections show their (purpose-driven) empty states
    expect(
      screen.getByText(
        'Add blood type, allergies, and conditions so first responders know your loved one in seconds.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Add the people to call first in an emergency so no one is left guessing.')
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add insurance details so coverage is ready when care can't wait.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Record your loved one's code status so their wishes are clear in a crisis.")
    ).toBeInTheDocument();
  });

  it('shows the fully-empty state when there is no emergency info record', async () => {
    mockApi(null);
    renderPage();

    expect(await screen.findByText('No emergency information yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep the details first responders need — allergies, doctors, insurance, and who to call — ready in one place for your loved one. Add them in the CircleCare app and they'll appear here."
      )
    ).toBeInTheDocument();
    // No sections or print button in the fully-empty state
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('calls window.print when the Print button is clicked', async () => {
    const printSpy = vi.fn();
    window.print = printSpy;

    mockApi(fullInfo);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the in-page navigation with anchors to every section', async () => {
    mockApi(fullInfo);
    renderPage();

    const nav = await screen.findByRole('navigation', { name: 'On this page' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Medical Information' })).toHaveAttribute(
      'href',
      '#medical-info'
    );
    expect(screen.getByRole('link', { name: 'Code Status' })).toHaveAttribute(
      'href',
      '#directives'
    );
  });

  it('shows the error state with a retry button when the request fails', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/circles') return circlesEnvelope;
      throw { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } };
    });
    renderPage();

    expect(
      await screen.findByText("We couldn't load the emergency information.")
    ).toBeInTheDocument();

    // Retry refetches and renders the data
    mockApi(fullInfo);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Dr. Chen')).toBeInTheDocument();
  });

  // ── Edit affordances (canEdit gating + delete flow) ──────────────────────

  it('hides Add / Edit / Delete affordances when the requester cannot edit', async () => {
    mockApi(fullInfo, false);
    renderPage();

    await screen.findByText('Dr. Chen');
    expect(screen.queryByRole('button', { name: 'Add doctor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add insurance' })).not.toBeInTheDocument();
    // Read-only notice present instead.
    expect(screen.getByText('This page is read-only.')).toBeInTheDocument();
  });

  it('shows Add buttons and no read-only notice when the requester can edit', async () => {
    mockApi(fullInfo, true);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Add doctor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add insurance' })).toBeInTheDocument();
    expect(screen.queryByText('This page is read-only.')).not.toBeInTheDocument();
  });

  it('adds a doctor via the modal, sending a partial additional_doctors PUT', async () => {
    mockApi(fullInfo, true);
    mockedPut.mockResolvedValue({ success: true, data: { emergency_info: fullInfo } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add doctor' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'Dr. Lee' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut.mock.calls[0][0]).toBe(`/circles/${CIRCLE_ID}/emergency-info`);
    const body = lastPutBody();
    expect(Object.keys(body)).toEqual(['additional_doctors']);
    // Existing Dr. Patel preserved, Dr. Lee appended.
    expect(body.additional_doctors).toHaveLength(2);
    expect(body.additional_doctors?.[1].name).toBe('Dr. Lee');
  });

  it('deletes an additional doctor via confirm, sending the filtered array', async () => {
    mockApi(fullInfo, true);
    mockedPut.mockResolvedValue({ success: true, data: { emergency_info: fullInfo } });
    renderPage();

    // Per-item delete button is labelled with the doctor name.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete doctor Dr. Patel' }));

    // Confirm dialog → Delete.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    // fullInfo had exactly one additional doctor → filtered to empty.
    expect(lastPutBody().additional_doctors).toEqual([]);
  });

  // ── Collapsible accordion sections ──────────────────────────────────────

  it('collapses a section but keeps its content in the DOM (for print/SR)', async () => {
    mockApi(fullInfo);
    renderPage();

    const doctorsHeader = await screen.findByRole('button', { name: /Doctors/ });
    expect(doctorsHeader).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(doctorsHeader);
    expect(doctorsHeader).toHaveAttribute('aria-expanded', 'false');

    // Collapsed = visually hidden, but the panel + its content stay mounted so
    // window.print() (panels are print:block) still reveals everything.
    const panel = document.getElementById('doctors-accordion-panel');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('hidden');
    expect(panel?.className).toContain('print:block');
    expect(within(panel as HTMLElement).getByText('Dr. Chen')).toBeInTheDocument();
  });

  it('Expand all / Collapse all flips every collapsible section', async () => {
    mockApi(fullInfo);
    renderPage();

    // Default: all open → control reads "Collapse all".
    const control = await screen.findByRole('button', { name: 'Collapse all' });
    fireEvent.click(control);

    // Now all four collapsible headers are collapsed; control reads "Expand all".
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Doctors/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: /Insurance/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: /Doctors/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('scopes print styles to this page via a body class', async () => {
    mockApi(fullInfo);
    const { unmount } = renderPage();

    await screen.findByText('Dr. Chen');
    expect(document.body.classList.contains('emergency-print-scope')).toBe(true);

    unmount();
    await waitFor(() =>
      expect(document.body.classList.contains('emergency-print-scope')).toBe(false)
    );
  });
});
