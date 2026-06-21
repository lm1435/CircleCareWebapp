import { apiClient } from '@/lib/api';
import {
  createVital,
  deleteVital,
  getVitals,
  getLatestVitals,
  isManualVital,
  updateVital,
  type CreateVitalRequest,
  type HealthVital,
} from '@/api/vitals';
import {
  buildCreateVitalRequest,
  buildUpdateVitalRequest,
  fromCanonicalGlucose,
  fromCanonicalWeight,
  getDisplayUnit,
  toCanonicalGlucose,
  toCanonicalWeight,
  vitalFormSchema,
  type VitalFormValues,
} from '@/lib/vitals';

// `@/lib/api` is mocked globally in src/test/setup.ts — apiClient.{get,post,put,delete}
// are vi.fn()s. The response interceptor (envelope unwrap) is bypassed, so each
// mock resolves with the already-unwrapped `{ success, data }` shape.
const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);

const CIRCLE_ID = 'circle-1';
const VITAL_ID = 'vital-1';

// Fixed clock so recorded_at "not in the future" assertions never depend on the
// machine wall clock or timezone.
const NOW = new Date('2026-06-20T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeVital(overrides: Partial<HealthVital> = {}): HealthVital {
  return {
    id: VITAL_ID,
    circle_id: CIRCLE_ID,
    vital_type: 'heart_rate',
    value1: 72,
    value2: null,
    unit: 'bpm',
    source: 'manual',
    recorded_at: NOW.toISOString(),
    recorded_by: 'user-1',
    notes: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

const RECORDED_AT = '2026-06-20T10:00:00.000Z';

describe('getVitals', () => {
  it('GETs the vitals list with type/from/to query params and unwraps data.vitals', async () => {
    const vitals = [makeVital()];
    mockGet.mockResolvedValue({ success: true, data: { vitals } } as never);

    const result = await getVitals(CIRCLE_ID, {
      type: 'glucose',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-20T00:00:00.000Z',
    });

    expect(result).toEqual(vitals);
    const url = mockGet.mock.calls[0][0] as string;
    expect(url.startsWith(`/circles/${CIRCLE_ID}/vitals?`)).toBe(true);
    expect(url).toContain('type=glucose');
    expect(url).toContain('from=2026-06-01');
    expect(url).toContain('to=2026-06-20');
  });

  it('omits the type param when not given', async () => {
    mockGet.mockResolvedValue({ success: true, data: { vitals: [] } } as never);
    await getVitals(CIRCLE_ID, { from: 'a', to: 'b' });
    expect(mockGet.mock.calls[0][0]).not.toContain('type=');
  });
});

describe('getLatestVitals', () => {
  it('GETs /vitals/latest and unwraps data.latest', async () => {
    const latest = { blood_pressure: null, heart_rate: makeVital(), glucose: null, weight: null };
    mockGet.mockResolvedValue({ success: true, data: { latest } } as never);

    const result = await getLatestVitals(CIRCLE_ID);

    expect(result).toEqual(latest);
    expect(mockGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/vitals/latest`);
  });
});

describe('createVital', () => {
  it('POSTs the create body and returns data.vital', async () => {
    const vital = makeVital();
    mockPost.mockResolvedValue({ success: true, data: { vital } } as never);

    const body: CreateVitalRequest = {
      vital_type: 'heart_rate',
      value1: 72,
      unit: 'bpm',
      source: 'manual',
      recorded_at: RECORDED_AT,
    };
    const result = await createVital(CIRCLE_ID, body);

    expect(result).toEqual(vital);
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/vitals`, body);
  });
});

describe('updateVital', () => {
  it('PUTs the update body to /vitals/:id and returns data.vital', async () => {
    const vital = makeVital({ value1: 80 });
    mockPut.mockResolvedValue({ success: true, data: { vital } } as never);

    await updateVital(CIRCLE_ID, VITAL_ID, { value1: 80, unit: 'bpm', recorded_at: RECORDED_AT });

    expect(mockPut).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/vitals/${VITAL_ID}`, {
      value1: 80,
      unit: 'bpm',
      recorded_at: RECORDED_AT,
    });
  });
});

describe('deleteVital', () => {
  it('DELETEs /vitals/:id', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);
    await deleteVital(CIRCLE_ID, VITAL_ID);
    expect(mockDelete).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/vitals/${VITAL_ID}`);
  });
});

describe('isManualVital (edit/delete guard)', () => {
  it('is true only for source: manual', () => {
    expect(isManualVital({ source: 'manual' })).toBe(true);
    expect(isManualVital({ source: 'apple_health' })).toBe(false);
    expect(isManualVital({ source: 'google_health_connect' })).toBe(false);
  });
});

// ── Unit conversion (display ↔ canonical) ──────────────────────────────────────

describe('unit conversion', () => {
  it('weight lbs ↔ kg round-trips through the 0.45359237 factor', () => {
    expect(toCanonicalWeight(150, 'lbs')).toBeCloseTo(68.0388555, 5);
    expect(toCanonicalWeight(68, 'kg')).toBe(68);
    expect(fromCanonicalWeight(68.0388555, 'lbs')).toBeCloseTo(150, 5);
    expect(fromCanonicalWeight(68, 'kg')).toBe(68);
  });

  it('glucose mg/dL ↔ mmol/L round-trips through the 18.0182 factor', () => {
    expect(toCanonicalGlucose(100, 'mg/dL')).toBeCloseTo(5.5499, 3);
    expect(toCanonicalGlucose(5.6, 'mmol/L')).toBe(5.6);
    expect(fromCanonicalGlucose(5.5499, 'mg/dL')).toBeCloseTo(100, 2);
    expect(fromCanonicalGlucose(5.6, 'mmol/L')).toBe(5.6);
  });

  it('getDisplayUnit reflects the user preference for weight/glucose; fixed for BP/HR', () => {
    expect(getDisplayUnit('blood_pressure', 'lbs', 'mg/dL')).toBe('mmHg');
    expect(getDisplayUnit('heart_rate', 'lbs', 'mg/dL')).toBe('bpm');
    expect(getDisplayUnit('weight', 'lbs', 'mg/dL')).toBe('lbs');
    expect(getDisplayUnit('weight', 'kg', 'mg/dL')).toBe('kg');
    expect(getDisplayUnit('glucose', 'kg', 'mmol/L')).toBe('mmol/L');
  });
});

// ── buildCreateVitalRequest / buildUpdateVitalRequest (display → canonical) ─────

describe('buildCreateVitalRequest', () => {
  it('converts weight lbs → kg and reports the canonical unit', () => {
    const req = buildCreateVitalRequest({
      vital_type: 'weight',
      value1: 150,
      unit: 'lbs',
      recorded_at: RECORDED_AT,
    });
    expect(req.value1).toBeCloseTo(68.0388555, 5);
    expect(req.unit).toBe('kg');
    expect(req.value2).toBeUndefined();
    expect(req.source).toBe('manual');
  });

  it('converts glucose mg/dL → mmol/L and reports the canonical unit', () => {
    const req = buildCreateVitalRequest({
      vital_type: 'glucose',
      value1: 100,
      unit: 'mg/dL',
      recorded_at: RECORDED_AT,
    });
    expect(req.value1).toBeCloseTo(5.5499, 3);
    expect(req.unit).toBe('mmol/L');
  });

  it('passes BP systolic/diastolic through unchanged in mmHg', () => {
    const req = buildCreateVitalRequest({
      vital_type: 'blood_pressure',
      value1: 120,
      value2: 80,
      unit: 'mmHg',
      recorded_at: RECORDED_AT,
    });
    expect(req.value1).toBe(120);
    expect(req.value2).toBe(80);
    expect(req.unit).toBe('mmHg');
  });

  it('drops empty/whitespace notes and trims real ones', () => {
    const blank = buildCreateVitalRequest({
      vital_type: 'heart_rate',
      value1: 72,
      unit: 'bpm',
      recorded_at: RECORDED_AT,
      notes: '   ',
    });
    expect(blank.notes).toBeUndefined();

    const real = buildCreateVitalRequest({
      vital_type: 'heart_rate',
      value1: 72,
      unit: 'bpm',
      recorded_at: RECORDED_AT,
      notes: '  resting  ',
    });
    expect(real.notes).toBe('resting');
  });
});

describe('buildUpdateVitalRequest', () => {
  it('converts to canonical for the fixed vital type and sends null for cleared notes', () => {
    const req = buildUpdateVitalRequest('weight', {
      value1: 150,
      unit: 'lbs',
      recorded_at: RECORDED_AT,
    });
    expect(req.value1).toBeCloseTo(68.0388555, 5);
    expect(req.unit).toBe('kg');
    expect(req.notes).toBeNull();
  });

  it('keeps BP diastolic and mmHg', () => {
    const req = buildUpdateVitalRequest('blood_pressure', {
      value1: 130,
      value2: 85,
      unit: 'mmHg',
      recorded_at: RECORDED_AT,
    });
    expect(req.value1).toBe(130);
    expect(req.value2).toBe(85);
    expect(req.unit).toBe('mmHg');
  });
});

// ── vitalFormSchema (per-type validation) ──────────────────────────────────────

describe('vitalFormSchema', () => {
  const ok = (v: Partial<VitalFormValues>): boolean =>
    vitalFormSchema.safeParse({ recorded_at: RECORDED_AT, ...v }).success;

  describe('blood pressure (two values)', () => {
    it('accepts valid systolic + diastolic in mmHg', () => {
      expect(ok({ vital_type: 'blood_pressure', value1: 120, value2: 80, unit: 'mmHg' })).toBe(true);
    });

    it('requires diastolic (value2)', () => {
      expect(ok({ vital_type: 'blood_pressure', value1: 120, unit: 'mmHg' })).toBe(false);
    });

    it('rejects out-of-range systolic and diastolic', () => {
      expect(ok({ vital_type: 'blood_pressure', value1: 400, value2: 80, unit: 'mmHg' })).toBe(
        false
      );
      expect(ok({ vital_type: 'blood_pressure', value1: 120, value2: 5, unit: 'mmHg' })).toBe(false);
    });

    it('rejects a non-mmHg unit', () => {
      expect(ok({ vital_type: 'blood_pressure', value1: 120, value2: 80, unit: 'kPa' })).toBe(false);
    });
  });

  describe('heart rate', () => {
    it('accepts a valid bpm reading', () => {
      expect(ok({ vital_type: 'heart_rate', value1: 72, unit: 'bpm' })).toBe(true);
    });
    it('rejects out-of-range and a stray value2', () => {
      expect(ok({ vital_type: 'heart_rate', value1: 5, unit: 'bpm' })).toBe(false);
      expect(ok({ vital_type: 'heart_rate', value1: 72, value2: 50, unit: 'bpm' })).toBe(false);
    });
  });

  describe('glucose (unit-dependent range)', () => {
    it('accepts mg/dL and mmol/L within their own ranges', () => {
      expect(ok({ vital_type: 'glucose', value1: 100, unit: 'mg/dL' })).toBe(true);
      expect(ok({ vital_type: 'glucose', value1: 5.6, unit: 'mmol/L' })).toBe(true);
    });
    it('rejects a mmol/L value that is only valid as mg/dL', () => {
      // 100 is in the mg/dL range but way above the mmol/L max (33.3).
      expect(ok({ vital_type: 'glucose', value1: 100, unit: 'mmol/L' })).toBe(false);
    });
    it('rejects an unsupported unit', () => {
      expect(ok({ vital_type: 'glucose', value1: 100, unit: 'g/L' })).toBe(false);
    });
  });

  describe('weight (unit-dependent range)', () => {
    it('accepts lbs and kg within range', () => {
      expect(ok({ vital_type: 'weight', value1: 150, unit: 'lbs' })).toBe(true);
      expect(ok({ vital_type: 'weight', value1: 68, unit: 'kg' })).toBe(true);
    });
    it('rejects out-of-range and an unsupported unit', () => {
      expect(ok({ vital_type: 'weight', value1: 0.1, unit: 'kg' })).toBe(false);
      expect(ok({ vital_type: 'weight', value1: 68, unit: 'stone' })).toBe(false);
    });
  });

  describe('recorded_at + notes', () => {
    it('rejects a recorded_at more than 5 minutes in the future', () => {
      const future = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();
      expect(ok({ vital_type: 'heart_rate', value1: 72, unit: 'bpm', recorded_at: future })).toBe(
        false
      );
    });
    it('accepts a recorded_at within the 5-minute future skew', () => {
      const soon = new Date(NOW.getTime() + 4 * 60 * 1000).toISOString();
      expect(ok({ vital_type: 'heart_rate', value1: 72, unit: 'bpm', recorded_at: soon })).toBe(
        true
      );
    });
    it('rejects notes over 500 chars', () => {
      expect(
        ok({ vital_type: 'heart_rate', value1: 72, unit: 'bpm', notes: 'a'.repeat(501) })
      ).toBe(false);
      expect(
        ok({ vital_type: 'heart_rate', value1: 72, unit: 'bpm', notes: 'a'.repeat(500) })
      ).toBe(true);
    });
  });
});
