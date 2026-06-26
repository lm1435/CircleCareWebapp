import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/vitals.ts. Verified against backend/src/routes/vitals.ts:
//   GET    /api/circles/:circleId/vitals?type=&from=&to=
//            → { success, data: { vitals: HealthVital[] } }
//   GET    /api/circles/:circleId/vitals/latest
//            → { success, data: { latest: LatestVitals } }
//   POST   /api/circles/:circleId/vitals            (requireCircleEditAccess + rate limit)
//            body: { vital_type, value1, value2?, unit, recorded_at, notes? }
//            → 201 { success, data: { vital } }
//   PUT    /api/circles/:circleId/vitals/:id        (requireCircleEditAccess + rate limit)
//            body: { value1?, value2?, unit?, recorded_at?, notes? }
//            → { success, data: { vital } }
//   DELETE /api/circles/:circleId/vitals/:id        (requireCircleEditAccess + rate limit)
//            → 204
//
// CANONICAL UNITS (what the DB stores): blood_pressure=mmHg, heart_rate=bpm,
// glucose=mmol/L, weight=kg. The backend converts the SUBMITTED display unit to
// canonical (lbs→kg, mg/dL→mmol/L) on write, so callers send the value in the
// user's preferred display unit together with that unit string. BP and HR have
// no conversion (already canonical).
//
// recorded_at is a UTC ISO timestamp. The backend rejects values more than 5
// minutes in the future. Every reading is manual and freely editable/deletable.
//
// NOTE: the web apiClient's response interceptor unwraps axios' response.data,
// so the resolved value IS the `{ success, data }` envelope.

export type VitalType = 'blood_pressure' | 'heart_rate' | 'glucose' | 'weight';

export interface HealthVital {
  id: string;
  circle_id: string;
  vital_type: VitalType;
  value1: number;
  value2: number | null;
  unit: string;
  recorded_at: string; // UTC ISO timestamp
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  users?: { first_name: string; last_name: string } | null;
}

export interface LatestVitals {
  blood_pressure: HealthVital | null;
  heart_rate: HealthVital | null;
  glucose: HealthVital | null;
  weight: HealthVital | null;
}

export interface CreateVitalRequest {
  vital_type: VitalType;
  value1: number;
  value2?: number;
  unit: string;
  recorded_at: string;
  notes?: string;
}

export interface UpdateVitalRequest {
  value1?: number;
  value2?: number;
  unit?: string;
  recorded_at?: string;
  notes?: string | null;
}

export interface GetVitalsParams {
  type?: VitalType;
  from: string; // UTC ISO timestamp
  to: string; // UTC ISO timestamp
}

interface VitalsListEnvelope {
  success: boolean;
  data: { vitals: HealthVital[] };
}

interface LatestVitalsEnvelope {
  success: boolean;
  data: { latest: LatestVitals };
}

interface VitalEnvelope {
  success: boolean;
  data: { vital: HealthVital };
}

export async function getVitals(circleId: string, params: GetVitalsParams): Promise<HealthVital[]> {
  const searchParams = new URLSearchParams();
  if (params.type) searchParams.set('type', params.type);
  searchParams.set('from', params.from);
  searchParams.set('to', params.to);

  const response = (await apiClient.get(
    `/circles/${circleId}/vitals?${searchParams.toString()}`
  )) as unknown as VitalsListEnvelope;
  return response.data.vitals;
}

export async function getLatestVitals(circleId: string): Promise<LatestVitals> {
  const response = (await apiClient.get(
    `/circles/${circleId}/vitals/latest`
  )) as unknown as LatestVitalsEnvelope;
  return response.data.latest;
}

export async function createVital(
  circleId: string,
  data: CreateVitalRequest
): Promise<HealthVital> {
  const response = (await apiClient.post(
    `/circles/${circleId}/vitals`,
    data
  )) as unknown as VitalEnvelope;
  return response.data.vital;
}

export async function updateVital(
  circleId: string,
  id: string,
  data: UpdateVitalRequest
): Promise<HealthVital> {
  const response = (await apiClient.put(
    `/circles/${circleId}/vitals/${id}`,
    data
  )) as unknown as VitalEnvelope;
  return response.data.vital;
}

export async function deleteVital(circleId: string, id: string): Promise<void> {
  await apiClient.delete(`/circles/${circleId}/vitals/${id}`);
}
