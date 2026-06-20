import { apiClient } from '@/lib/api';

// GET /circles/:circleId — circle detail including the members array.
// Members are NOT included in the GET /circles list response, so this module
// exists per plan Task 36. Shape verified against backend/src/routes/circles.ts
// (GET /:circleId handler). The apiClient response interceptor unwraps axios'
// `response.data`, so the value resolves to the `{ success, data }` envelope.

export interface CircleMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'member';
  is_care_recipient: boolean;
  is_medication_responsible: boolean;
  /** ISO timestamp (timestamptz) or date-only string — format defensively. */
  joined_at: string;
  timezone: string | null;
  /**
   * Membership-level view-only flag (freemium caregiver cap).
   * NOTE: the backend currently does NOT return this per member on
   * GET /circles/:circleId (only the requester's own `view_only` at the
   * circle level). Optional so the UI indicator lights up if/when the
   * backend adds it to the members select.
   */
  view_only?: boolean;
}

export interface CircleDetail {
  id: string;
  name: string;
  recipient_name: string;
  recipient_photo_url: string | null;
  recipient_dob: string | null;
  // Backend stores this as an array of condition strings (circles route:
  // recipient_conditions = z.array(z.string())), NOT a free-text string.
  recipient_conditions: string[] | null;
  owner_id: string;
  created_at: string;
  is_self_care: boolean;
  care_recipient_timezone: string;
  members: CircleMember[];
  // Subscription-aware access info (requester's perspective)
  access_level: 'full' | 'edit' | 'view';
  is_premium_circle: boolean;
  can_edit: boolean;
  view_only: boolean;
}

interface CircleDetailEnvelope {
  success: boolean;
  data: { circle: CircleDetail };
}

export async function getCircleDetail(circleId: string): Promise<CircleDetail> {
  const response = (await apiClient.get(
    `/circles/${circleId}`
  )) as unknown as CircleDetailEnvelope;
  return response.data.circle;
}
