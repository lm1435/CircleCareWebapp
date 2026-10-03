import type { EmergencyInfo } from '@/api/emergencyInfo';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { emergencyInfoUpdated: vi.fn(), emergencyInfoConflict: vi.fn(), errorOccurred: vi.fn() },
}));

import { buildEmergencyDelete, type EmergencyDeleteTarget } from '@/hooks/useEmergencyInfo';

// The page-level delete targets an ENTRY: it is built from the snapshot the list
// was rendered from when the user picked Delete (array and versions together),
// so the entry removed is the one the user chose and the version precondition is
// the one of what they saw. A refetch under an open confirm must not be able to
// move either (EmergencyInfoPage.deleteShift.test.tsx drives the page).

const ana = { name: 'Ana', relationship: 'Daughter', phone: '1', country_code: null };
const ben = { name: 'Ben', relationship: 'Son', phone: '2', country_code: '+1' };
const cara = { name: 'Cara', relationship: 'Niece', phone: '3', country_code: '+1' };
const docA = { name: 'Dr A', specialty: 'Cardiology' };
const docB = { name: 'Dr B', specialty: 'Neurology' };
const docC = { name: 'Dr C', specialty: 'Oncology' };
const planA = { carrier: 'Aetna', policy_number: 'P1', phone: null, country_code: null };
const planB = { carrier: 'Blue', policy_number: 'P2', phone: null, country_code: null };
const planC = { carrier: 'Cigna', policy_number: 'P3', phone: null, country_code: null };

const snapshot = (over: Partial<EmergencyInfo> = {}): EmergencyInfo => ({
  id: 'ei-1',
  circle_id: 'c-1',
  emergency_contacts: [ana, ben, cara],
  additional_doctors: [docA, docB, docC],
  insurance_plans: [planA, planB, planC],
  primary_doctor_name: 'Dr Prim',
  primary_doctor_specialty: 'Family',
  primary_doctor_phone: '9',
  primary_doctor_country_code: '+1',
  primary_doctor_address: '1 Main',
  allergies: [],
  medication_allergies: [],
  medical_conditions: [],
  created_at: '',
  updated_at: '',
  versions: {
    emergency_contacts: 'vc1',
    additional_doctors: 'vd1',
    insurance_plans: 'vi1',
    primary_doctor_name: 'vp-n1',
    primary_doctor_specialty: 'vp-s1',
    primary_doctor_phone: 'vp-p1',
    primary_doctor_country_code: 'vp-cc1',
    primary_doctor_address: 'vp-a1',
  },
  ...over,
});

describe('buildEmergencyDelete', () => {
  it.each([
    ['contact', 'emergency_contacts', 'vc1', [ana, cara]],
    ['doctor', 'additional_doctors', 'vd1', [docA, docC]],
    ['insurance', 'insurance_plans', 'vi1', [planA, planC]],
  ] as const)(
    '%s: removes exactly the chosen entry from the snapshot, with the snapshot version, and nothing else',
    (kind, field, version, expected) => {
      const body = buildEmergencyDelete(snapshot(), { kind, index: 1 } as EmergencyDeleteTarget);
      expect(Object.keys(body).sort()).toEqual([field, 'if_match'].sort());
      const label = (e: { name?: string; carrier?: string }): string | undefined => e.name ?? e.carrier;
      expect((body as Record<string, { name?: string; carrier?: string }[]>)[field].map(label)).toEqual(
        expected.map(label)
      );
      expect(body.if_match).toEqual({ [field]: version });
    }
  );

  it('the entry removed is the one at the position IN THE SNAPSHOT it is given, not in any later list', () => {
    // What the user saw: [Ana, Ben, Cara]; they chose Ben (position 1).
    const seen = snapshot();
    // What a refetch under the open confirm brings: another member removed Ana.
    const fresh = snapshot({
      emergency_contacts: [ben, cara],
      versions: { ...seen.versions, emergency_contacts: 'vc2' },
    });
    const fromSeen = buildEmergencyDelete(seen, { kind: 'contact', index: 1 });
    expect(fromSeen.emergency_contacts?.map((c) => c.name)).toEqual(['Ana', 'Cara']);
    expect(fromSeen.if_match).toEqual({ emergency_contacts: 'vc1' });
    // The old behaviour, for contrast: position 1 of the FRESH list is Cara, with the
    // fresh version, so it would have gone through as a valid-looking delete of Cara.
    const naive = buildEmergencyDelete(fresh, { kind: 'contact', index: 1 });
    expect(naive.emergency_contacts?.map((c) => c.name)).toEqual(['Ben']);
    expect(naive.if_match).toEqual({ emergency_contacts: 'vc2' });
  });

  it('primary doctor: clears the four flat fields and guards exactly those four', () => {
    const body = buildEmergencyDelete(snapshot(), { kind: 'doctor-primary' });
    expect(body).toEqual({
      primary_doctor_name: null,
      primary_doctor_specialty: null,
      primary_doctor_phone: null,
      primary_doctor_address: null,
      if_match: {
        primary_doctor_name: 'vp-n1',
        primary_doctor_specialty: 'vp-s1',
        primary_doctor_phone: 'vp-p1',
        primary_doctor_address: 'vp-a1',
      },
    });
  });

  it('strips null country codes / optional nulls so the body matches the PUT schema', () => {
    const body = buildEmergencyDelete(snapshot(), { kind: 'contact', index: 1 });
    expect(body.emergency_contacts?.[0]).toEqual({ ...ana, country_code: undefined });
    const plans = buildEmergencyDelete(snapshot(), { kind: 'insurance', index: 1 });
    expect(plans.insurance_plans?.[0]).toMatchObject({ carrier: 'Aetna', phone: undefined, country_code: undefined });
  });

  it('sends no if_match against a snapshot without versions (older backend)', () => {
    const body = buildEmergencyDelete(snapshot({ versions: undefined }), { kind: 'contact', index: 0 });
    expect('if_match' in body).toBe(false);
    expect(body.emergency_contacts?.map((c) => c.name)).toEqual(['Ben', 'Cara']);
  });

  it('an out-of-range position removes nothing; a null snapshot yields empty arrays without throwing', () => {
    expect(buildEmergencyDelete(snapshot(), { kind: 'doctor', index: 9 }).additional_doctors).toEqual([docA, docB, docC]);
    expect(buildEmergencyDelete(null, { kind: 'contact', index: 0 })).toEqual({ emergency_contacts: [] });
    expect(buildEmergencyDelete(undefined, { kind: 'insurance', index: 0 })).toEqual({ insurance_plans: [] });
  });
});
