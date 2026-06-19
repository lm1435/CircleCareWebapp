import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/circles.ts (subset needed by the layout shell +
// circle picker). The apiClient response interceptor already unwraps axios'
// `response.data`, so the value resolves to the `{ success, data }` envelope.

export type CircleAccessLevel = 'full' | 'edit' | 'view';

export interface Circle {
  id: string;
  name: string;
  recipient_name: string;
  recipient_photo_url: string | null;
  // NOTE: GET /circles (list) does NOT return a timezone. The care recipient's
  // timezone lives only on GET /circles/:circleId → care_recipient_timezone.
  // Use useCareRecipientTimezone(circleId) for any date/time math.
  role: 'owner' | 'member';
  is_care_recipient: boolean;
  member_count: number;
  created_at: string;
  // Subscription-aware access level
  access_level: CircleAccessLevel;
  is_premium_circle: boolean;
  can_edit: boolean;
  // Membership-level view-only (set by tier downgrade caregiver cap)
  view_only: boolean;
  is_self_care?: boolean;
  // True when circle is non-selected on free tier (read-only access)
  read_only?: boolean;
}

interface CirclesEnvelope {
  success: boolean;
  data: { circles: Circle[] };
}

export async function getCircles(): Promise<Circle[]> {
  const response = (await apiClient.get('/circles')) as unknown as CirclesEnvelope;
  return response.data.circles;
}
