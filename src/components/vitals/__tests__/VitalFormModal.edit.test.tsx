import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { VitalFormModal } from '../VitalFormModal';
import type { HealthVital } from '@/api/vitals';

// K13 — EDIT round trip of VitalFormModal (there was no edit test).
//
// The form shows a stored (canonical) reading in the viewer's unit, rounded for
// display (weight/glucose `toFixed(1)`), and on save converts the DISPLAYED text
// back to canonical (`buildUpdateVitalRequest`). recorded_at is rebuilt from a
// minutes-precision wall time. So a note-only edit rewrites value1 and drops the
// seconds of recorded_at. That was PARKED P2; PK8 (approved-recs-2026-09-30) fixed it:
// an edit now sends value1/value2/unit only when the displayed value changed and
// recorded_at only when the date/time changed, so a note-only edit PUTs `{ notes }`.
//
// TIMEZONE: no process TZ is assumed; the assertions are zone-independent
// (`npm run test:timezones` runs this file in every zone).
const CIRCLE_ID = 'circle-1';
const NOW = new Date('2026-09-25T18:00:00.000Z');

const mutateUpdate = vi.fn();
const mutateCreate = vi.fn();
vi.mock('@/hooks/useVitals', () => ({
  useCreateVital: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateVital: () => ({ mutateAsync: mutateUpdate, isPending: false }),
}));

const unitPrefs = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };
vi.mock('@/hooks/useUnitPreferences', () => ({
  useUnitPreferences: () => ({ data: unitPrefs }),
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  unitPrefs.weight_unit = 'lbs';
  unitPrefs.glucose_unit = 'mg/dL';
  mutateUpdate.mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const RECORDED_AT = '2026-09-20T15:04:37.000Z';

function vital(over: Partial<HealthVital>): HealthVital {
  return {
    id: 'v1',
    circle_id: CIRCLE_ID,
    vital_type: 'weight',
    value1: 72.5,
    value2: null,
    unit: 'kg',
    recorded_at: RECORDED_AT,
    recorded_by: 'u1',
    notes: 'a',
    created_at: RECORDED_AT,
    updated_at: RECORDED_AT,
    ...over,
  };
}

/** Render the edit form, change ONLY the note, save, return the mutateAsync data. */
async function saveNoteOnly(v: HealthVital) {
  const user = userEvent.setup();
  render(<VitalFormModal circleId={CIRCLE_ID} vital={v} onClose={vi.fn()} />);
  const notes = screen.getByLabelText(/^Notes/);
  await user.clear(notes);
  await user.type(notes, 'changed note');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  const arg = mutateUpdate.mock.calls[0][0] as { id: string; data: Record<string, unknown> };
  expect(arg.id).toBe('v1');
  expect(arg.data.notes).toBe('changed note');
  return arg.data as { value1?: number; value2?: number; unit?: string; recorded_at?: string };
}

describe('VitalFormModal edit: weight (kg stored, viewer lbs)', () => {
  it('shows the canonical value in the viewer unit, rounded to one decimal', () => {
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Weight')).toHaveValue('159.8');
  });

  // PK8: the display rounding (toFixed(1)) is no longer re-converted on save.
  it('PK8: a note-only edit sends exactly { notes } (no value1, unit or recorded_at)', async () => {
    await saveNoteOnly(vital({}));
    expect(mutateUpdate.mock.calls[0][0].data).toEqual({ notes: 'changed note' });
    expect(Object.keys(mutateUpdate.mock.calls[0][0].data)).toEqual(['notes']);
  });

  it('PK8: a note-only edit leaves value1 to the server (72.5 kg is never rewritten)', async () => {
    const data = await saveNoteOnly(vital({}));
    expect(data.value1).toBeUndefined();
  });

  // Was PARKED P2: recorded_at was rebuilt from a minutes-precision wall time.
  it('PK8: a note-only edit sends no recorded_at (the seconds survive)', async () => {
    const data = await saveNoteOnly(vital({}));
    expect(data.recorded_at).toBeUndefined();
  });

  it('PK8: changing only the time sends recorded_at and nothing else', async () => {
    const user = userEvent.setup();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={vi.fn()} />);
    const time = screen.getByLabelText(/^Time/);
    await user.clear(time);
    await user.type(time, '09:15');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const data = mutateUpdate.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['recorded_at']);
  });

  it('PK8: retyping the same value (159.80) is not a change', async () => {
    const user = userEvent.setup();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={vi.fn()} />);
    const weight = screen.getByLabelText('Weight');
    await user.clear(weight);
    await user.type(weight, '159.80');
    const notes = screen.getByLabelText(/^Notes/);
    await user.clear(notes);
    await user.type(notes, 'n2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(Object.keys(mutateUpdate.mock.calls[0][0].data)).toEqual(['notes']);
  });

  it('PK8: an edit with nothing changed sends no request', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateUpdate).not.toHaveBeenCalled();
  });

  it('PK15: a decimal comma in an edit is read as a decimal (160,5 lb)', async () => {
    const user = userEvent.setup();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={vi.fn()} />);
    const weight = screen.getByLabelText('Weight');
    await user.clear(weight);
    await user.type(weight, '160,5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const data = mutateUpdate.mock.calls[0][0].data;
    expect(data.value1).toBeCloseTo(160.5 * 0.45359237, 10);
    expect(data.unit).toBe('kg');
  });

  it('editing the value (160 lb) sends 160 * 0.45359237 kg with unit kg', async () => {
    const user = userEvent.setup();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={vi.fn()} />);
    const weight = screen.getByLabelText('Weight');
    await user.clear(weight);
    await user.type(weight, '160');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const data = mutateUpdate.mock.calls[0][0].data;
    expect(data.unit).toBe('kg');
    expect(data.value1).toBeCloseTo(160 * 0.45359237, 10);
  });

  it('a kg viewer: a note-only edit does not resend the value', async () => {
    unitPrefs.weight_unit = 'kg';
    const data = await saveNoteOnly(vital({}));
    expect(data.value1).toBeUndefined();
  });

  it('a kg viewer: an edited value (decimal comma) is saved as typed, alone', async () => {
    unitPrefs.weight_unit = 'kg';
    const user = userEvent.setup();
    render(<VitalFormModal circleId={CIRCLE_ID} vital={vital({})} onClose={vi.fn()} />);
    const weight = screen.getByLabelText('Weight');
    await user.clear(weight);
    await user.type(weight, '73,2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data).toEqual({ value1: 73.2, unit: 'kg' });
  });
});

describe('VitalFormModal edit: glucose (mmol/L stored, viewer mg/dL)', () => {
  const g = () => vital({ vital_type: 'glucose', value1: 5.5, unit: 'mmol/L' });

  // Was PARKED P2: 5.5 mmol/L shows as 99.1 mg/dL and came back as 5.4995.
  it('PK8: a note-only edit sends no value1/unit (5.5 mmol/L is never rewritten)', async () => {
    const data = await saveNoteOnly(g());
    expect(data.value1).toBeUndefined();
    expect(data.unit).toBeUndefined();
  });

  it('PK8: a note-only edit sends no recorded_at', async () => {
    const data = await saveNoteOnly(g());
    expect(data.recorded_at).toBeUndefined();
  });
});

describe('VitalFormModal edit: integer-valued types are exact', () => {
  it('blood pressure 120/80: a note-only edit sends no values', async () => {
    const data = await saveNoteOnly(
      vital({ vital_type: 'blood_pressure', value1: 120, value2: 80, unit: 'mmHg' })
    );
    expect(data.value1).toBeUndefined();
    expect(data.value2).toBeUndefined();
  });

  it('blood pressure: editing only the diastolic sends BOTH values (value1 + value2)', async () => {
    const user = userEvent.setup();
    render(
      <VitalFormModal
        circleId={CIRCLE_ID}
        vital={vital({ vital_type: 'blood_pressure', value1: 120, value2: 80, unit: 'mmHg' })}
        onClose={vi.fn()}
      />
    );
    const dia = screen.getByLabelText(/Diastolic/);
    await user.clear(dia);
    await user.type(dia, '85');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data).toEqual({ value1: 120, value2: 85, unit: 'mmHg' });
  });

  it('heart rate 72: an edited value is sent with its unit', async () => {
    const user = userEvent.setup();
    render(
      <VitalFormModal
        circleId={CIRCLE_ID}
        vital={vital({ vital_type: 'heart_rate', value1: 72, unit: 'bpm' })}
        onClose={vi.fn()}
      />
    );
    const hr = screen.getByLabelText(/Heart rate/i);
    await user.clear(hr);
    await user.type(hr, '75');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data).toEqual({ value1: 75, unit: 'bpm' });
  });
});
