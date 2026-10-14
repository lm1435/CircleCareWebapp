import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import '@/i18n';
import { VitalFormModal } from '../VitalFormModal';
import type { HealthVital } from '@/api/vitals';

// "Discard changes?" on the vitals add/edit form (same shared guard, same words
// as the Emergency editors and mobile VitalFormScreen). Dirty = the values
// against what the form opened with; the type alone is not an edit; a
// successful save never asks.
//
// TIMEZONE: no process TZ is assumed; the date/time fields are compared with
// their own prefill, never with a literal clock.
const CIRCLE_ID = 'circle-1';
const NOW = new Date('2026-09-25T18:00:00.000Z');

const mutateUpdate = vi.fn();
const mutateCreate = vi.fn();
vi.mock('@/hooks/useVitals', () => ({
  useCreateVital: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateVital: () => ({ mutateAsync: mutateUpdate, isPending: false }),
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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  mutateCreate.mockResolvedValue({});
  mutateUpdate.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
});

const RECORDED_AT = '2026-09-20T15:04:37.000Z';
const READING: HealthVital = {
  id: 'v1',
  circle_id: CIRCLE_ID,
  vital_type: 'heart_rate',
  value1: 72,
  value2: null,
  unit: 'bpm',
  recorded_at: RECORDED_AT,
  recorded_by: 'u1',
  notes: 'after lunch',
  created_at: RECORDED_AT,
  updated_at: RECORDED_AT,
};

function formDialog(): HTMLElement {
  return screen.getAllByRole('dialog')[0];
}
function queryPrompt(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Discard changes?' });
}
const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

describe('VitalFormModal (add) — discard changes prompt', () => {
  it('untouched: Cancel, × and Escape close at once', async () => {
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={onClose} />);
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(formDialog(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(queryPrompt()).toBeNull();
  });

  it('changing only the type is not an edit', async () => {
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={onClose} />);
    await userEvent.selectOptions(field('vital_type'), 'weight');
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    expect(queryPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the reading', 'value1', '88'],
    ['the note', 'notes', 'after a walk'],
  ])('typed %s: Cancel asks; Keep editing keeps it; Discard closes', async (_label, id, text) => {
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={onClose} />);
    await userEvent.type(field(id), text);

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    const prompt = queryPrompt();
    expect(prompt).not.toBeNull();
    expect(within(prompt!).getByText("What you typed here won't be saved.")).toBeInTheDocument();
    await userEvent.click(within(prompt!).getByRole('button', { name: 'Keep editing' }));
    expect(queryPrompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(field(id)).toHaveValue(text);

    fireEvent.keyDown(formDialog(), { key: 'Escape' });
    await userEvent.click(within(queryPrompt()!).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('a value typed and erased again is clean', async () => {
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={onClose} />);
    await userEvent.type(field('value1'), '8');
    await userEvent.clear(field('value1'));
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    expect(queryPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a successful save closes without the prompt and disarms beforeunload', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <VitalFormModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={onClose} onSaved={onSaved} />
    );
    const fire = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await userEvent.type(field('value1'), '88');
    expect(fire()).toBe(true);

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Save reading' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mutateCreate).toHaveBeenCalledTimes(1);
    expect(queryPrompt()).toBeNull();
    expect(fire()).toBe(false);
  });
});

describe('VitalFormModal (edit) — discard changes prompt', () => {
  it('untouched: Cancel closes at once (the prefilled reading is not an edit)', async () => {
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={READING} onClose={onClose} />);
    expect(field('value1')).toHaveValue('72');
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    expect(queryPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a changed value asks; a changed time asks', async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <VitalFormModal circleId={CIRCLE_ID} vital={READING} onClose={onClose} />
    );
    await userEvent.type(field('value1'), '1');
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Close' }));
    expect(queryPrompt()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    unmount();

    render(<VitalFormModal circleId={CIRCLE_ID} vital={READING} onClose={onClose} />);
    fireEvent.change(field('recorded_time'), { target: { value: '03:15' } });
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    expect(queryPrompt()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a successful edit save closes without the prompt', async () => {
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={READING} onClose={onClose} />);
    await userEvent.clear(field('notes'));
    await userEvent.type(field('notes'), 'before dinner');
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mutateUpdate).toHaveBeenCalledTimes(1);
    expect(queryPrompt()).toBeNull();
  });
});

describe('VitalFormModal — router navigation blocker', () => {
  function Page(): ReactElement {
    const [open, setOpen] = useState(true);
    return (
      <div>
        <Link to="/circles/c/meds">Medications</Link>
        {open && (
          <VitalFormModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={() => setOpen(false)} />
        )}
      </div>
    );
  }

  it('dirty: a sidebar navigation asks; Discard proceeds', async () => {
    const router = createMemoryRouter(
      [
        { path: '/circles/c/vitals', element: <Page /> },
        { path: '/circles/c/meds', element: <p>Meds page</p> },
      ],
      { initialEntries: ['/circles/c/vitals'] }
    );
    render(<RouterProvider router={router} />);
    await userEvent.type(field('value1'), '88');

    fireEvent.click(screen.getByRole('link', { name: 'Medications' }));
    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(router.state.location.pathname).toBe('/circles/c/vitals');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/circles/c/meds'));
  });
});
