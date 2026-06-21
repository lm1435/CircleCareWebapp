import { z } from 'zod';
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

// ============================================================================
// WRITE — PUT /circles/:circleId/emergency-info (plan Task 4.1)
//
// The backend is a SINGLE coarse partial-merge endpoint
// (backend/src/routes/emergencyInfo.ts → requireCircleEditAccess +
// validateBody(updateEmergencyInfoSchema)). Only the keys present in the body
// are updated; arrays are REPLACED wholesale (not merged item-by-item), so the
// arrays (doctors / insurance / contacts) are read-modify-write CLIENT-SIDE
// (see useEmergencyInfo.ts helpers). Last-write-wins — concurrent edits from
// two caregivers can clobber each other (mirror of mobile; documented caveat).
//
// The Zod schemas below mirror backend `updateEmergencyInfoSchema` EXACTLY
// (array `.max(50)`, per-string `.max()` caps) so the client and server agree.
// Validate the assembled partial on submit; never send unvalidated input.
//
// PHI: this payload contains health data. NEVER log it, never attach to
// analytics events.
// ============================================================================

/** Mirror of backend `emergencyContactSchema`. */
export const emergencyContactSchema = z.object({
  name: z.string().max(100),
  relationship: z.string().max(100),
  phone: z.string().max(20),
  country_code: z.string().max(5).optional(),
  is_primary: z.boolean().optional(),
});

/** Mirror of backend `additionalDoctorSchema`. */
export const additionalDoctorSchema = z.object({
  name: z.string().max(100),
  specialty: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  country_code: z.string().max(5).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
});

/** Mirror of backend `insurancePlanSchema`. */
export const insurancePlanSchema = z.object({
  label: z.string().max(100).optional(),
  carrier: z.string().max(100),
  policy_number: z.string().max(100).optional(),
  group_number: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  country_code: z.string().max(5).optional(),
  photo_url: z.string().max(2048).optional(),
  is_primary: z.boolean().optional(),
  // OCR scan fields (extracted from insurance card; web never writes these,
  // but they may round-trip through a read-modify-write of an existing plan).
  rx_bin: z.string().max(100).optional(),
  rx_pcn: z.string().max(100).optional(),
  rx_group: z.string().max(100).optional(),
  scan_data: z
    .object({
      raw_text: z.string().max(5000),
      scanned_at: z.string().max(30),
      source: z.enum(['insurance_card']),
    })
    .optional(),
});

/**
 * Mirror of backend `updateEmergencyInfoSchema`. Every field is optional —
 * this is a partial-merge body; send ONLY the slice(s) the user changed.
 *
 * NOTE: the legacy flat insurance_* fields the backend still accepts are
 * intentionally omitted here — the web only writes the array format.
 */
export const updateEmergencyInfoSchema = z.object({
  insurance_plans: z.array(insurancePlanSchema).max(50).optional(),

  primary_doctor_name: z.string().max(100).nullable().optional(),
  primary_doctor_specialty: z.string().max(100).nullable().optional(),
  primary_doctor_phone: z.string().max(20).nullable().optional(),
  primary_doctor_country_code: z.string().max(5).nullable().optional(),
  primary_doctor_address: z.string().max(1000).nullable().optional(),

  additional_doctors: z.array(additionalDoctorSchema).max(50).optional(),

  allergies: z.array(z.string().max(200)).max(100).optional(),
  medication_allergies: z.array(z.string().max(200)).max(100).optional(),
  medical_conditions: z.array(z.string().max(200)).max(100).optional(),
  blood_type: z.string().max(10).optional(),

  emergency_contacts: z.array(emergencyContactSchema).max(50).optional(),

  advance_directives: z.string().max(5000).optional(),
  has_dnr: z.boolean().optional(),
  dnr_document_url: z.string().max(2048).optional(),
});

/**
 * Partial-merge update body. A subset of `EmergencyInfo` plus nullable clears
 * for the flat primary-doctor / directive fields (send `null` to clear a flat
 * field; send the full replacement array for any of the three array sections).
 * Type-equivalent to the Zod schema above.
 */
export type UpdateEmergencyInfoRequest = z.infer<typeof updateEmergencyInfoSchema>;

/**
 * PUT /circles/:circleId/emergency-info — partial merge. Sends only the keys in
 * `partial`. Arrays are replaced wholesale; assemble them client-side via the
 * read-modify-write helpers in hooks/useEmergencyInfo.ts. Returns the saved
 * row (the backend creates the record on first write).
 */
export async function updateEmergencyInfo(
  circleId: string,
  partial: UpdateEmergencyInfoRequest
): Promise<EmergencyInfo> {
  const response = (await apiClient.put(
    `/circles/${circleId}/emergency-info`,
    partial
  )) as unknown as { success: boolean; data: { emergency_info: EmergencyInfo } };
  return response.data.emergency_info;
}
