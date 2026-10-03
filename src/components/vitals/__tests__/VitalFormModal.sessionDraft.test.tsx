import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { VitalFormModal } from '../VitalFormModal';
import { onSessionEnded, saveDraftsForForcedSignOut } from '@/lib/sessionDraft';
import { useAuthStore } from '@/store/authStore';
import type { HealthVital } from '@/api/vitals';

// PK9 (B12): a NEW reading typed into VitalFormModal survives a forced sign-out
// (sessionStorage, same user) and is put back on the next open; an EDIT of a
// saved reading is never kept; another user gets nothing.
vi.mock('@/hooks/useVitals', () => ({
  useCreateVital: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateVital: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useUnitPreferences', () => ({
  useUnitPreferences: () => ({ data: { weight_unit: 'lbs', glucose_unit: 'mg/dL' } }),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({ circle: { recipient_name: 'Mom' }, timezone: 'America/New_York', canEdit: true }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const setUser = (id: string): void =>
  useAuthStore.setState({ user: { id, email: `${id}@x.y`, first_name: null, last_name: null } });

beforeEach(() => {
  sessionStorage.clear();
  showToast.mockClear();
  setUser('u1');
});

async function typeNoteAndForceSignOut(): Promise<void> {
  const user = userEvent.setup();
  const first = render(<VitalFormModal circleId="c1" onClose={vi.fn()} />);
  const notes = screen.getByRole('textbox', { name: /note/i });
  await user.type(notes, 'felt dizzy after lunch');
  saveDraftsForForcedSignOut('u1');
  onSessionEnded();
  first.unmount();
}

it('restores the typed note into a new reading after a forced sign-out, with the notice', async () => {
  await typeNoteAndForceSignOut();
  render(<VitalFormModal circleId="c1" onClose={vi.fn()} />);
  expect(screen.getByDisplayValue('felt dizzy after lunch')).toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith('We restored your unsaved draft.', 'info');
  expect(sessionStorage.length).toBe(0);
});

it('a different user gets nothing and the entry is removed', async () => {
  await typeNoteAndForceSignOut();
  setUser('u2');
  render(<VitalFormModal circleId="c1" onClose={vi.fn()} />);
  expect(screen.queryByDisplayValue('felt dizzy after lunch')).toBeNull();
  expect(showToast).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});

it('editing a saved reading is never kept as a draft', async () => {
  const user = userEvent.setup();
  const v: HealthVital = {
    id: 'v1',
    circle_id: 'c1',
    vital_type: 'weight',
    value1: 72.5,
    value2: null,
    unit: 'kg',
    recorded_at: '2026-09-20T15:04:37.000Z',
    recorded_by: 'u1',
    notes: 'a',
    created_at: '2026-09-20T15:04:37.000Z',
    updated_at: '2026-09-20T15:04:37.000Z',
  };
  render(<VitalFormModal circleId="c1" vital={v} onClose={vi.fn()} />);
  await user.type(screen.getByRole('textbox', { name: /note/i }), ' more');
  saveDraftsForForcedSignOut('u1');
  onSessionEnded();
  expect(sessionStorage.length).toBe(0);
});
