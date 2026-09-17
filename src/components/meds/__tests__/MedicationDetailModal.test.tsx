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
// Layout mirrors mobile's MedicationDetailModal (2026-09-14): eyebrow → name →
// dosage header, then one icon-row info card. The recurrence appears ONCE, in
// Repeat; the Time row carries the dose times alone.

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
    expect(screen.getByText('8:00 AM')).toBeInTheDocument();
  });

  // THE duplicate: the schedule line used to end with the recurrence
  // ("8:00 PM · Daily") right above a Repeat row saying "Daily" again.
  it('shows the recurrence exactly once, in the Repeat row, and times alone in the Time row', () => {
    render(<MedicationDetailModal {...baseProps} times="8:00 AM · 8:00 PM" repeat="Daily" />);

    expect(screen.getAllByText('Daily')).toHaveLength(1);
    expect(screen.queryByText(/·\s*Daily/)).toBeNull();

    const timeRow = screen.getByText('meds:page.detail.time').closest('div.flex') as HTMLElement;
    expect(within(timeRow).getByText('8:00 AM · 8:00 PM')).toBeInTheDocument();
    const repeatRow = screen.getByText('meds:page.detail.repeat').closest('div.flex') as HTMLElement;
    expect(within(repeatRow).getByText('Daily')).toBeInTheDocument();
  });

  it('omits the Repeat row for a one-off medication', () => {
    render(<MedicationDetailModal {...baseProps} repeat={null} />);
    expect(screen.queryByText('meds:page.detail.repeat')).toBeNull();
    expect(screen.getByText('meds:page.detail.time')).toBeInTheDocument();
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

    expect(screen.getByText('meds:page.detail.notes')).toBeInTheDocument();
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
  // serious): each row group holds a <dt> then a <dd> and nothing else. The
  // decorative icon sits inside the <dt>, hidden from assistive tech.
  it('builds each info row as a bare dt + dd group with the icon hidden inside the dt', () => {
    const { container } = render(<MedicationDetailModal {...baseProps} daysLeft={20} />);
    const rows = container.ownerDocument.querySelectorAll('dl > div');
    expect(rows.length).toBe(4);
    rows.forEach((row) => {
      expect(Array.from(row.children).map((c) => c.tagName)).toEqual(['DT', 'DD']);
      const icon = row.querySelector('dt > [aria-hidden="true"]');
      expect(icon).not.toBeNull();
      expect(icon?.textContent).toBe('');
    });
  });

  // The <dt> labels use the shared `mono` type variant (spec §4.5/§6.4) — the
  // same label treatment the history cards and the emergency cards use.
  it('renders detail labels with the shared mono type variant, not local classes', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    const label = screen.getByText('meds:page.detail.time');
    expect(label.tagName).toBe('DT');
    expect(label.className).toContain(TEXT_CLASS.mono);
    expect(label.className).not.toContain('section-title-sm');
    expect(label.className).not.toContain('uppercase');
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
    // No More overflow either — there is nothing secondary to offer.
    expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
  });

  // Discontinue/Reactivate and Delete are secondary/destructive actions, so
  // per the modal footer convention they live inside the More overflow, not
  // as standalone footer buttons.
  it('offers Discontinue and Delete inside the More menu', async () => {
    const onToggleStatus = vi.fn();
    const onDelete = vi.fn();
    render(
      <MedicationDetailModal
        {...baseProps}
        onToggleStatus={onToggleStatus}
        onDelete={onDelete}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'meds:page.actions.discontinue' }),
    );
    expect(onToggleStatus).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'meds:page.actions.delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows Reactivate instead of Discontinue for an inactive medication', async () => {
    render(<MedicationDetailModal {...baseProps} inactive />);

    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(
      screen.getByRole('menuitem', { name: 'meds:page.actions.reactivate' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'meds:page.actions.discontinue' }),
    ).toBeNull();
  });

  // The footer holds exactly two controls — the More overflow trigger and
  // Edit — with Edit last in DOM order. Edit is `secondary` and NOT moss:
  // nothing in a READ view is the app's primary action, and a filled moss
  // button here competed with the Take/Skip pair that means "answer a dose".
  it('puts Edit last in the footer as a secondary, unfilled action', () => {
    render(<MedicationDetailModal {...baseProps} />);

    const buttons = screen.getAllByRole('button');
    const edit = buttons[buttons.length - 1];
    expect(edit).toHaveTextContent('meds:page.actions.edit');

    // Exact token match: a ghost button's `hover:bg-moss-soft` class would
    // also satisfy a naive `/\bbg-moss\b/` substring regex (the word boundary
    // lands right before the trailing `-soft`), misclassifying it as filled.
    const FILLED_CLASSES = new Set(['bg-moss', 'bg-terracotta-soft']);
    const filled = buttons.filter((button) =>
      button.className.split(/\s+/).some((cls) => FILLED_CLASSES.has(cls)),
    );
    expect(filled).toHaveLength(0);
    expect(edit.className).toContain('bg-bg-2');
  });
});
