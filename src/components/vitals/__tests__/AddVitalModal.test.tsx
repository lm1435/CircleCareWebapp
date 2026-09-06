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
  circle: undefined as { recipient_name?: string } | undefined,
  timezone: RECIPIENT_TZ,
  canEdit: true,
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => useCircleResult,
}));

// The dual-timezone hint renders a real clock now.
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
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
  useCircleResult.timezone = RECIPIENT_TZ;
  useCircleResult.canEdit = true;
  unitPrefs.weight_unit = 'lbs';
  unitPrefs.glucose_unit = 'mg/dL';
  mutateCreate.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

async function setRecordedTo(user: ReturnType<typeof userEvent.setup>, date: string, time: string) {
  const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
  await user.clear(dateInput);
  await user.type(dateInput, date);
  const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
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
    // 09:00 on the CAREGIVER's clock (Denver, MDT -6h) === 15:00 UTC.
    expect(payload.recorded_at).toBe('2026-06-15T15:00:00.000Z');
  });

  // ── THE LOAD RACE ─────────────────────────────────────────────────────────
  //
  // `useCircle` reports its 'America/New_York' fallback until the circle detail
  // query lands. The prefilled wall clock is a useMemo keyed on that zone, but
  // the useState calls that seed the date/time fields read it ONCE — and hooks
  // run even on the renders where the modal returns null for !canEdit.
  //
  // This half is the dangerous one: the SAVE converts those digits back with
  // the RESOLVED zone. Prefill in one frame + save in another files a real
  // reading at a time it was never taken, silently, with nothing on screen to
  // suggest it.
  describe('the circle query resolving AFTER mount', () => {
    it('prefills the VIEWER clock, unaffected by which recipient zone resolves', async () => {
      // The stronger property that replaced the old resync test.
      //
      // The prefill used to be computed in the RECIPIENT's zone, so a modal
      // mounted while the circle query was in flight prefilled through the
      // 'America/New_York' fallback and then saved with the resolved zone — a
      // mixed-frame round trip that filed a real reading at a time it was never
      // taken. Now the prefill is the viewer's own clock and does not consult
      // the recipient zone at all, so that failure mode cannot occur.
      //
      // NOW is 2026-06-15T16:00Z = 10:00 in Denver, the pinned device zone.
      // Mounted mid-flight: the fallback zone is in play and the modal renders
      // null because canEdit defaults false. The hooks still run, which is what
      // used to bake the wrong frame in.
      useCircleResult.timezone = 'America/New_York';
      useCircleResult.canEdit = false;
      const { rerender } = render(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

      // A wildly different recipient zone resolves.
      useCircleResult.timezone = 'Pacific/Kiritimati';
      useCircleResult.canEdit = true;
      rerender(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

      // Still the viewer's own clock, in both cases — neither the fallback nor
      // the resolved recipient zone can move it.
      await waitFor(() => {
        expect((screen.getByLabelText(/^Time/) as HTMLInputElement).value).toBe('10:00');
      });

      useCircleResult.timezone = 'Asia/Tokyo';
      rerender(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);
      expect((screen.getByLabelText(/^Time/) as HTMLInputElement).value).toBe('10:00');
    });

    it('saves the SAME instant it prefilled (no mixed-frame round trip)', async () => {
      const user = userEvent.setup();
      useCircleResult.timezone = 'America/New_York';
      useCircleResult.canEdit = false;
      const { rerender } = render(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

      useCircleResult.timezone = 'America/Los_Angeles';
      useCircleResult.canEdit = true;
      rerender(<AddVitalModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

      await user.type(await screen.findByLabelText('Systolic'), '120');
      await user.type(screen.getByLabelText('Diastolic'), '80');
      await user.click(screen.getByRole('button', { name: 'Save reading' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      // The reading was taken NOW, so it must be filed at NOW — not at NOW
      // shifted by the gap between the fallback zone and the real one. Without
      // the resync the fields still hold New York's 12:00, which the save
      // reinterprets as 12:00 LOS ANGELES = 19:00Z: three hours in the future,
      // for a reading being taken as the user watches.
      expect(mutateCreate.mock.calls[0][0].recorded_at).toBe(NOW.toISOString());
    });
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
