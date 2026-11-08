// The read view web never had. Two things matter more than layout here:
//
//  1. The PHOTO only exists on the single-event endpoint (the events list omits
//     it), so the modal has to fetch it rather than read it off the event it was
//     handed — the exact bug that made mobile's photo appear only after the edit
//     screen had warmed the cache.
//  2. That URL is a SIGNED Storage URL. It must be fetched on demand and held in
//     component state that dies with the modal, never in the React Query cache —
//     the rule `api/documents.ts` already follows for `file_url`.
//
// Layout = the approved design pass (2026-11-08, mobile parity): eyebrow → name →
// dosage header, then ONE details card with uppercase labels and no per-row icons:
// WHEN ("Daily · 8:00 AM"), REFILL | ASSIGNED TO, INSTRUCTIONS. Every action is a
// visible standard button (no More menu).

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MedicationDetailModal } from '../MedicationDetailModal';
import { TEXT_CLASS } from '@/components/ui';

const getMedicationPhotoUrl = vi.fn();

vi.mock('@/api/calendarEvents', () => ({
  getMedicationPhotoUrl: (...args: unknown[]) => getMedicationPhotoUrl(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
    i18n: { language: 'en' },
  }),
}));

const event = {
  id: 'evt-1',
  circle_id: 'c1',
  title: 'Lisinopril',
  event_type: 'medication',
  description: 'Take with food',
} as never;

const baseProps = {
  circleId: 'c1',
  event,
  name: 'Lisinopril',
  dosage: '10mg',
  times: '8:00 AM',
  repeat: 'Daily',
  inactive: false,
  canEdit: true,
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onToggleStatus: vi.fn(),
  onDelete: vi.fn(),
};

describe('MedicationDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMedicationPhotoUrl.mockResolvedValue(null);
  });

  // entry_source (1.2.3): a medication dictated on the phone says so here too.
  // (`t` is the key-echo mock in this file; the copy itself is pinned in
  // calendar/__tests__/EntrySourceNote.test.tsx.)
  it('shows "Added by voice" for a medication saved by voice, and nothing otherwise', () => {
    const voice = { ...(event as object), entry_source: 'voice' } as never;
    const { unmount } = render(<MedicationDetailModal {...baseProps} event={voice} />);
    expect(screen.getByTestId('entry-source-note')).toHaveTextContent('calendar:entrySource.addedByVoice');
    unmount();

    for (const value of ['form', 'scan', null, undefined]) {
      const other = { ...(event as object), entry_source: value } as never;
      const view = render(<MedicationDetailModal {...baseProps} event={other} />);
      expect(screen.queryByTestId('entry-source-note')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('shows the note to a member who cannot edit too', () => {
    const voice = { ...(event as object), entry_source: 'voice' } as never;
    render(<MedicationDetailModal {...baseProps} canEdit={false} event={voice} />);
    expect(screen.getByTestId('entry-source-note')).toBeInTheDocument();
  });

  it('fetches the photo for the event it is showing', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() =>
      expect(getMedicationPhotoUrl).toHaveBeenCalledWith('c1', 'evt-1'),
    );
  });

  it('renders the photo once the signed url arrives', async () => {
    getMedicationPhotoUrl.mockResolvedValue('https://signed.example/photo.jpg');

    render(<MedicationDetailModal {...baseProps} />);

    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'https://signed.example/photo.jpg');
  });

  // A medication without a photo, or a failed fetch, must still show its
  // details — the photo is never allowed to gate the read view.
  it('still renders the details when there is no photo', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('10mg')).toBeInTheDocument();
    expect(screen.getByTestId('med-detail-when')).toHaveTextContent('Daily · 8:00 AM');
  });

  // WHEN carries the repeat and the times in ONE line, the recurrence exactly once (it used to
  // end the schedule line, "8:00 PM · Daily", right above a Repeat row saying "Daily" again).
  it('shows WHEN as repeat · times, the recurrence exactly once', () => {
    render(<MedicationDetailModal {...baseProps} times="8:00 AM · 8:00 PM" repeat="Daily" />);

    expect(screen.getByText('calendar:eventDetail.when').tagName).toBe('DT');
    expect(screen.getByTestId('med-detail-when')).toHaveTextContent(/^Daily · 8:00 AM · 8:00 PM$/);
    expect(screen.getAllByText(/Daily/)).toHaveLength(1);
    // The old separate rows are gone.
    expect(screen.queryByText('meds:page.detail.repeat')).toBeNull();
    expect(screen.queryByText('meds:page.detail.time')).toBeNull();
  });

  it('a one-off medication shows its times alone in WHEN', () => {
    render(<MedicationDetailModal {...baseProps} repeat={null} />);
    expect(screen.getByTestId('med-detail-when')).toHaveTextContent(/^8:00 AM$/);
  });

  it('pairs REFILL | ASSIGNED TO in one two-column row, Assigned only when the roster row names someone', () => {
    const assigned = {
      ...(event as object),
      assigned_to: 'u-2',
      assigned_to_user: { id: 'u-2', first_name: 'Jennie', last_name: 'Ruiz', email: 'j@x.com' },
    } as never;
    const { unmount } = render(
      <MedicationDetailModal {...baseProps} event={assigned} daysLeft={18} />
    );
    const grid = screen.getByTestId('med-detail-refill').closest('dl') as HTMLElement;
    expect(grid.className).toContain('grid-cols-2');
    expect(within(grid).getByText('calendar:eventDetail.assignedTo')).toBeInTheDocument();
    expect(screen.getByTestId('med-detail-assigned')).toHaveTextContent(/^Jennie$/);
    unmount();

    render(<MedicationDetailModal {...baseProps} daysLeft={18} />);
    expect(screen.queryByText('calendar:eventDetail.assignedTo')).toBeNull();
  });

  // Mobile's header: eyebrow → name → dosage. The dialog keeps exactly one
  // heading (the Modal's sr-only title); the visible name is not a second one.
  it('renders the mobile header and keeps the dialog named by a single heading', () => {
    render(<MedicationDetailModal {...baseProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Lisinopril');
    expect(within(dialog).getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByText('calendar:eventTypes.medication')).toBeInTheDocument();
    expect(screen.getAllByText('Lisinopril').some((el) => el.tagName === 'P')).toBe(true);
    expect(screen.getByText('10mg').tagName).toBe('P');
  });

  it('shows the notes in the info card', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    expect(screen.getByText('meds:page.detail.instructions')).toBeInTheDocument();
    expect(screen.getByText('Take with food')).toBeInTheDocument();
  });

  it('shows days of supply left as a Refill row only when refill tracking yields one', () => {
    const { unmount } = render(<MedicationDetailModal {...baseProps} daysLeft={null} />);
    expect(screen.queryByText('meds:page.detail.refill')).toBeNull();
    unmount();

    render(<MedicationDetailModal {...baseProps} daysLeft={20} />);
    const value = screen.getByText('meds:page.stock.daysLeft');
    expect(value.className).toContain('text-ink');
    expect(value.className).not.toContain('text-terracotta');
  });

  it('flags low stock in the deep terracotta shade', () => {
    render(<MedicationDetailModal {...baseProps} daysLeft={5} lowStock />);
    const value = screen.getByText('meds:page.stock.lowStock · meds:page.stock.daysLeft');
    expect(value.className).toContain('text-terracotta-deep');
  });

  it('marks an inactive medication with the badge and the reference note', () => {
    render(<MedicationDetailModal {...baseProps} inactive />);
    expect(screen.getByText('calendar:discontinueMed.inactiveBadge')).toBeInTheDocument();
    expect(screen.getByText('meds:page.inactiveHint')).toBeInTheDocument();
  });

  // Valid definition-list structure (axe `definition-list` / `dlitem`, both
  // serious): each group holds a <dt> then a <dd> and nothing else, and no row
  // carries an icon any more (owner: no per-row icons).
  it('builds each fact as a bare dt + dd group with no icons', () => {
    const { container } = render(<MedicationDetailModal {...baseProps} daysLeft={20} />);
    const rows = container.ownerDocument.querySelectorAll('dl > div');
    // WHEN, REFILL, INSTRUCTIONS.
    expect(rows.length).toBe(3);
    rows.forEach((row) => {
      expect(Array.from(row.children).map((c) => c.tagName)).toEqual(['DT', 'DD']);
    });
    expect(screen.getByTestId('med-detail-card').querySelector('svg, ion-icon')).toBeNull();
  });

  // The <dt> labels use the shared uppercase Eyebrow label (the shift detail's), not local classes.
  it('renders detail labels with the shared eyebrow label', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    const label = screen.getByText('calendar:eventDetail.when');
    expect(label.tagName).toBe('DT');
    expect(label.className).toContain(TEXT_CLASS.eyebrow);
  });

  // Each action closes the sheet before opening its dialog, so the app never
  // stacks a modal on a modal.
  it('closes itself before handing off to an action', async () => {
    const onEdit = vi.fn();
    render(<MedicationDetailModal {...baseProps} onEdit={onEdit} />);

    await userEvent.click(screen.getByRole('button', { name: 'meds:page.actions.edit' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('offers no actions to a view-only member', async () => {
    render(<MedicationDetailModal {...baseProps} canEdit={false} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    expect(
      screen.queryByRole('button', { name: 'meds:page.actions.edit' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'meds:page.actions.delete' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'meds:page.actions.discontinue' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
  });

  // Owner design pass 2026-11-08: Edit, Discontinue/Reactivate and Delete are visible
  // standard buttons, in that order. No More menu.
  it('offers Edit, Discontinue and Delete as visible buttons, with no More menu', async () => {
    const onToggleStatus = vi.fn();
    const onDelete = vi.fn();
    render(
      <MedicationDetailModal
        {...baseProps}
        onToggleStatus={onToggleStatus}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
    const footer = screen.getByTestId('med-detail-actions');
    expect(within(footer).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'meds:page.actions.edit',
      'meds:page.actions.discontinue',
      'meds:page.actions.delete',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'meds:page.actions.discontinue' }));
    expect(onToggleStatus).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'meds:page.actions.delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('an ENDED series keeps Edit and Delete but offers no Discontinue / Reactivate', () => {
    render(<MedicationDetailModal {...baseProps} inactive endedLabel="Ended Nov 1" />);
    expect(screen.getByText('Ended Nov 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'meds:page.actions.edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'meds:page.actions.delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'meds:page.actions.reactivate' })).toBeNull();
  });

  it('shows Reactivate instead of Discontinue for an inactive medication', async () => {
    render(<MedicationDetailModal {...baseProps} inactive />);

    expect(
      screen.getByRole('button', { name: 'meds:page.actions.reactivate' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'meds:page.actions.discontinue' }),
    ).toBeNull();
  });

  // A scheduled medication's roster detail logs no dose, so NOTHING in it is filled: Edit and
  // Discontinue are secondary, Delete the soft danger button (never a filled one).
  it('fills no button on a scheduled medication', () => {
    render(<MedicationDetailModal {...baseProps} />);
    const footer = screen.getByTestId('med-detail-actions');
    const buttons = within(footer).getAllByRole('button');
    expect(buttons.filter((b) => b.className.split(/\s+/).includes('bg-primary-fill'))).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'meds:page.actions.edit' }).className).toContain('bg-cream');
    expect(screen.getByRole('button', { name: 'meds:page.actions.delete' }).className).toContain(
      'bg-terracotta-soft'
    );
  });

  describe('as needed', () => {
    const asNeeded = {
      reason: 'Headache',
      lastGiven: <span>Last given 3:00 PM by Rosa</span>,
      onGive: vi.fn(),
      onHistory: vi.fn(),
    };

    it('keeps Last given, What it is for and Reminders in the same card, with no WHEN', () => {
      render(<MedicationDetailModal {...baseProps} asNeeded={asNeeded} daysLeft={9} />);
      const card = screen.getByTestId('med-detail-card');
      expect(within(card).getByText('meds:asNeeded.detail.lastGiven')).toBeInTheDocument();
      expect(within(card).getByText('Last given 3:00 PM by Rosa')).toBeInTheDocument();
      expect(within(card).getByText('meds:asNeeded.detail.reason')).toBeInTheDocument();
      expect(within(card).getByText('Headache')).toBeInTheDocument();
      expect(within(card).getByText('meds:asNeeded.detail.remindersNone')).toBeInTheDocument();
      expect(within(card).getByText('meds:page.detail.instructions')).toBeInTheDocument();
      expect(screen.queryByTestId('med-detail-when')).toBeNull();
    });

    it('Gave a dose is the one filled button, last, after History', () => {
      render(<MedicationDetailModal {...baseProps} asNeeded={asNeeded} />);
      const buttons = within(screen.getByTestId('med-detail-actions')).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual([
        'meds:page.actions.edit',
        'meds:page.actions.discontinue',
        'meds:page.actions.delete',
        'meds:asNeeded.card.history',
        'meds:asNeeded.card.give',
      ]);
      const filled = buttons.filter((b) => b.className.split(/\s+/).includes('bg-primary-fill'));
      expect(filled.map((b) => b.textContent)).toEqual(['meds:asNeeded.card.give']);
    });

    it('an inactive as-needed medication offers no Gave a dose', () => {
      render(<MedicationDetailModal {...baseProps} asNeeded={asNeeded} inactive />);
      expect(screen.queryByRole('button', { name: 'meds:asNeeded.card.give' })).toBeNull();
      expect(screen.getByRole('button', { name: 'meds:asNeeded.card.history' })).toBeInTheDocument();
    });
  });
});
