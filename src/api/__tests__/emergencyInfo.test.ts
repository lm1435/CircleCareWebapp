import { apiClient } from '@/lib/api';
import {
  updateEmergencyInfo,
  updateEmergencyInfoSchema,
  type UpdateEmergencyInfoRequest,
} from '@/api/emergencyInfo';

// `@/lib/api` is mocked globally in src/test/setup.ts — apiClient.put is a
// vi.fn(). The response interceptor (envelope unwrap) is bypassed, so we
// resolve the mock with the already-unwrapped `{ success, data }` shape.
const mockPut = vi.mocked(apiClient.put);

const CIRCLE_ID = 'circle-1';
const savedRow = { id: 'ei-1', circle_id: CIRCLE_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateEmergencyInfo', () => {
  it('PUTs the partial body verbatim and returns the saved row', async () => {
    mockPut.mockResolvedValue({ success: true, data: { emergency_info: savedRow } } as never);

    const partial: UpdateEmergencyInfoRequest = { blood_type: 'O+' };
    const result = await updateEmergencyInfo(CIRCLE_ID, partial);

    expect(result).toEqual(savedRow);
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [url, body] = mockPut.mock.calls[0];
    expect(url).toBe(`/circles/${CIRCLE_ID}/emergency-info`);
    // Partial-merge: ONLY the changed slice is sent, nothing else.
    expect(body).toEqual({ blood_type: 'O+' });
  });

  it('sends a single array section as the partial (read-modify-write result)', async () => {
    mockPut.mockResolvedValue({ success: true, data: { emergency_info: savedRow } } as never);

    const partial: UpdateEmergencyInfoRequest = {
      additional_doctors: [{ name: 'Dr. House', specialty: 'Diagnostics' }],
    };
    await updateEmergencyInfo(CIRCLE_ID, partial);

    const [, body] = mockPut.mock.calls[0];
    expect(body).toEqual(partial);
    expect(body).not.toHaveProperty('emergency_contacts');
    expect(body).not.toHaveProperty('insurance_plans');
  });
});

describe('updateEmergencyInfoSchema (mirrors backend updateEmergencyInfoSchema)', () => {
  it('accepts an empty partial and a valid full-section partial', () => {
    expect(updateEmergencyInfoSchema.safeParse({}).success).toBe(true);
    expect(
      updateEmergencyInfoSchema.safeParse({
        emergency_contacts: [
          { name: 'A', relationship: 'Son', phone: '5551234', is_primary: true },
        ],
        blood_type: 'AB-',
        primary_doctor_name: null,
      }).success
    ).toBe(true);
  });

  it('enforces array .max(50) on each section', () => {
    const tooMany = Array.from({ length: 51 }, () => ({ name: 'x' }));
    expect(updateEmergencyInfoSchema.safeParse({ additional_doctors: tooMany }).success).toBe(false);
  });

  it('enforces the .max(100) string cap on contact name', () => {
    const longName = 'x'.repeat(101);
    expect(
      updateEmergencyInfoSchema.safeParse({
        emergency_contacts: [{ name: longName, relationship: 'r', phone: '5' }],
      }).success
    ).toBe(false);
  });

  it('enforces .max(200) on medical-info array entries and .max(100) entry count', () => {
    expect(
      updateEmergencyInfoSchema.safeParse({ allergies: ['x'.repeat(201)] }).success
    ).toBe(false);
    expect(
      updateEmergencyInfoSchema.safeParse({
        allergies: Array.from({ length: 101 }, () => 'peanuts'),
      }).success
    ).toBe(false);
  });
});
