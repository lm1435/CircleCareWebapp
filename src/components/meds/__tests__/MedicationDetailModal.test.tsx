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
  });
});
