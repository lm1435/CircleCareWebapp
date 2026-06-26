import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { AddVitalModal } from '../AddVitalModal';

// Task 6.7 — AddVitalModal tests: per-type validation, BP two-value, unit
// conversion in the built CreateVitalRequest, and recorded_at not-future.
//
// TIMEZONE: recorded_at is a single UTC ISO timestamp built by converting the
// recipient-local wall time (DateField + TimeField) to UTC. To keep that
// deterministic we pin both the process TZ (America/Denver) and the wall clock
// via fake timers, and set the recipient TZ to America/New_York so the
// conversion exercises a non-zero offset.
const ORIGINAL_TZ = process.env.TZ;
const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';
// 2026-06-15 12:00:00 in New York === 16:00 UTC (EDT, -4h).
const NOW = new Date('2026-06-15T16:00:00.000Z');

beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// ── Hook mocks ──────────────────────────────────────────────────────────────
const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();

vi.mock('@/hooks/useVitals', () => ({
  useCreateVital: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateVital: () => ({ mutateAsync: mutateUpdate, isPending: false }),
}));

const unitPrefs = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };
vi.mock('@/hooks/useUnitPreferences', () => ({
  useUnitPreferences: () => ({ data: unitPrefs }),
}));

const useCircleResult = {
  timezone: RECIPIENT_TZ,
  canEdit: true,
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => useCircleResult,
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  useCircleResult.canEdit = true;
  unitPrefs.weight_unit = 'lbs';
  unitPrefs.glucose_unit = 'mg/dL';
  mutateCreate.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

async function setRecordedTo(user: ReturnType<typeof userEvent.setup>, date: string, time: string) {
  const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
  await user.clear(dateInput);
  await user.type(dateInput, date);
  const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
  await user.clear(timeInput);
  await user.type(timeInput, time);
}

describe('AddVitalModal', () => {
  it('defaults to blood pressure and requires both systolic and diastolic', async () => {
    const user = userEvent.setup();
    render(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

    // BP shows two value fields.
    expect(screen.getByLabelText('Systolic')).toBeInTheDocument();
    expect(screen.getByLabelText('Diastolic')).toBeInTheDocument();

    await setRecordedTo(user, '2026-06-15', '09:00');
    await user.click(screen.getByRole('button', { name: 'Save reading' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Systolic')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Diastolic')).toHaveAttribute('aria-invalid', 'true');
  });

  it('builds a BP payload with two values (no conversion, canonical mmHg)', async () => {
    const user = userEvent.setup();
    render(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Systolic'), '120');
    await user.type(screen.getByLabelText('Diastolic'), '80');
    await setRecordedTo(user, '2026-06-15', '09:00');

    await user.click(screen.getByRole('button', { name: 'Save reading' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    expect(payload.vital_type).toBe('blood_pressure');
    expect(payload.value1).toBe(120);
    expect(payload.value2).toBe(80);
    expect(payload.unit).toBe('mmHg');
    // 09:00 in New York (EDT -4h) === 13:00 UTC.
    expect(payload.recorded_at).toBe('2026-06-15T13:00:00.000Z');
  });

  it('converts weight from lbs to canonical kg in the payload', async () => {
    const user = userEvent.setup();
    render(<AddVitalModal circleId={CIRCLE_ID} initialType="weight" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Weight'), '150');
    await setRecordedTo(user, '2026-06-15', '09:00');

    await user.click(screen.getByRole('button', { name: 'Save reading' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    expect(payload.vital_type).toBe('weight');
    expect(payload.unit).toBe('kg');
    // 150 lbs * 0.45359237 ≈ 68.04 kg.
    expect(payload.value1).toBeCloseTo(68.0388, 3);
    expect(payload.value2).toBeUndefined();
  });

  it('converts glucose from mg/dL to canonical mmol/L in the payload', async () => {
    unitPrefs.glucose_unit = 'mg/dL';
    const user = userEvent.setup();
    render(<AddVitalModal circleId={CIRCLE_ID} initialType="glucose" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Glucose'), '100');
    await setRecordedTo(user, '2026-06-15', '09:00');

    await user.click(screen.getByRole('button', { name: 'Save reading' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    expect(payload.unit).toBe('mmol/L');
    // 100 / 18.0182 ≈ 5.55.
    expect(payload.value1).toBeCloseTo(5.5499, 3);
  });

  it('rejects a recorded_at more than 5 minutes in the future', async () => {
    const user = userEvent.setup();
    render(<AddVitalModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Heart rate'), '72');
    // NOW (recipient) is 2026-06-15 12:00 NY; pick a clearly future time.
    await setRecordedTo(user, '2026-06-16', '09:00');

    await user.click(screen.getByRole('button', { name: 'Save reading' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    expect(
      screen.getByText("The reading time can't be in the future.")
    ).toBeInTheDocument();
  });

  it('rejects a heart rate outside the valid range', async () => {
    const user = userEvent.setup();
    render(<AddVitalModal circleId={CIRCLE_ID} initialType="heart_rate" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Heart rate'), '5');
    await setRecordedTo(user, '2026-06-15', '09:00');

    await user.click(screen.getByRole('button', { name: 'Save reading' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Heart rate')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders nothing when the user cannot edit', () => {
    useCircleResult.canEdit = false;
    const { container } = render(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
