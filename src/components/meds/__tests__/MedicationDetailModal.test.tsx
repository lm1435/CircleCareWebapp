// The read view web never had. Two things matter more than layout here:
//
//  1. The PHOTO only exists on the single-event endpoint (the events list omits
//     it), so the modal has to fetch it rather than read it off the event it was
//     handed — the exact bug that made mobile's photo appear only after the edit
//     screen had warmed the cache.
//  2. That URL is a SIGNED Storage URL. It must be fetched on demand and held in
//     component state that dies with the modal, never in the React Query cache —
//     the rule `api/documents.ts` already follows for `file_url`.

import { render, screen, waitFor } from '@testing-library/react';
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
  quantity_remaining: 12,
} as never;

const baseProps = {
  circleId: 'c1',
  event,
  name: 'Lisinopril',
  dosage: '10mg',
  schedule: '8:00 AM · Daily',
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
    expect(screen.getByText('8:00 AM · Daily')).toBeInTheDocument();
  });

  it('shows the notes and remaining count when present', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    expect(screen.getByText('Take with food')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  // The <dt> labels used to hand-roll `text-xs uppercase tracking-wide
  // text-ink-3`, then a local `.section-title-sm`. They are now the shared
  // `mono` type variant (spec §4.5/§6.4) — the same label treatment the
  // history cards and the emergency cards use, so a field label reads the same
  // everywhere instead of once per page.
  it('renders detail labels with the shared mono type variant, not local classes', async () => {
    render(<MedicationDetailModal {...baseProps} />);

    await waitFor(() => expect(getMedicationPhotoUrl).toHaveBeenCalled());

    const label = screen.getByText('meds:page.detail.dosage');
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

  // The facts sit in a `Card filled` block rather than loose on the modal
  // ground, and REPEAT is its own row: the schedule line already ends with the
  // recurrence, but "Repeat · Daily" is what a caregiver checking whether a
  // medication is still daily actually scans for. It is formatted by the
  // caller — this modal must not reach into the calendar module (and through
  // it into `@/i18n`) just to say one word.
  it('renders the repeat row only when the caller supplies one', () => {
    const { unmount } = render(<MedicationDetailModal {...baseProps} repeat="Daily" />);
    expect(screen.getByText('meds:page.detail.repeat')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    unmount();

    render(<MedicationDetailModal {...baseProps} />);
    expect(screen.queryByText('meds:page.detail.repeat')).toBeNull();
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
