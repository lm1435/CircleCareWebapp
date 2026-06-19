import { apiClient } from '@/lib/api';

// VERIFIED against backend/src/routes/emergencyInfo.ts:
// `GET /api/circles/:circleId/emergency-info` — requireAuth, circle membership
// checked server-side.
//
// Success (200): { success: true, data: { emergency_info: EmergencyInfo | null } }
//   `emergency_info` is null when the circle has no record yet (PGRST116).
// Errors: 403 FORBIDDEN (not a member), 500 SERVER_ERROR —
//   all `{ success: false, error: { code, message } }`.
//
// Types are a read-only PORT of mobile/src/api/emergencyInfo.ts. Array/flat
// fields come straight from the DB row, so they are typed as nullable and
// guarded at the call site.
//
// PHI: this payload contains health data (allergies, conditions, insurance).
// NEVER log it, never attach any of it to analytics events.

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  country_code?: string | null; // e.g., "+1", "+44", "+52"
  is_primary?: boolean;
}

export interface AdditionalDoctor {
  name: string;
  specialty?: string | null;
  phone?: string | null;
  country_code?: string | null;
  address?: string | null;
}

export interface InsurancePlan {
  label?: string | null;
  carrier: string;
  policy_number?: string | null;
  group_number?: string | null;
  phone?: string | null;
  country_code?: string | null;
  photo_url?: string | null;
  is_primary?: boolean;

  // OCR scanning fields (extracted from insurance card)
  rx_bin?: string | null;
  rx_pcn?: string | null;
  rx_group?: string | null;
}

export interface EmergencyInfo {
  id: string;
  circle_id: string;

  // Insurance plans
  insurance_plans: InsurancePlan[] | null;

  // Primary doctor (flat fields)
  primary_doctor_name?: string | null;
  primary_doctor_specialty?: string | null;
  primary_doctor_phone?: string | null;
  primary_doctor_country_code?: string | null;
  primary_doctor_address?: string | null;

  // Additional doctors
  additional_doctors: AdditionalDoctor[] | null;

  // Medical info
  allergies: string[] | null;
  medication_allergies: string[] | null;
  medical_conditions: string[] | null;
  blood_type?: string | null;

  // Emergency contacts
  emergency_contacts: EmergencyContact[] | null;

  // Advance directives
  advance_directives?: string | null;
  has_dnr?: boolean | null;
  dnr_document_url?: string | null;

  created_at: string;
  updated_at: string;
}

interface EmergencyInfoEnvelope {
  success: boolean;
  data: { emergency_info: EmergencyInfo | null };
}

/**
 * Fetch the circle's emergency info. Resolves to null when nothing has been
 * added yet (the page renders per-section empty states in that case).
 */
export async function getEmergencyInfo(circleId: string): Promise<EmergencyInfo | null> {
  const response = (await apiClient.get(
    `/circles/${circleId}/emergency-info`
  )) as unknown as EmergencyInfoEnvelope;
  return response.data.emergency_info;
}
