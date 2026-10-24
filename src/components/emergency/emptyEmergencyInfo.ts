import type { EmergencyInfo } from '@/api/emergencyInfo';

/**
 * A blank record for a circle whose emergency-info GET has SETTLED (not
 * loading, not errored) but resolved `emergency_info: null` — i.e. no row
 * exists yet (backend PGRST116). Passed to the edit modals instead of the raw
 * `null` so their `if (!props.info) return null` self-defense guard (which
 * exists to stop an unhydrated read-modify-write, see the mobile emergency
 * editors' history) doesn't ALSO block the legitimate first-ever add: without
 * this, `info` stays `null` forever for an empty circle, so "Add contact"
 * opened a modal that immediately rendered nothing — a silent no-op with no
 * error, no loading state, nothing to retry (WA1).
 *
 * Shared by the Medical Info page and by the appointment form's "Add a doctor"
 * (which opens the same doctor modal from a screen that never loaded the record).
 */
export function synthesizeEmptyEmergencyInfo(circleId: string): EmergencyInfo {
  return {
    id: '',
    circle_id: circleId,
    insurance_plans: [],
    additional_doctors: [],
    allergies: [],
    medication_allergies: [],
    medical_conditions: [],
    emergency_contacts: [],
    created_at: '',
    updated_at: '',
  };
}
