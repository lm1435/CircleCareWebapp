import { z } from 'zod';
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

// ===========================================================================
// Circle edit / delete WRITE functions (plan Stage 8, Task 8.1)
// ---------------------------------------------------------------------------
// Mirrors mobile/src/api/circles.ts (updateCircle, deleteCircle). Backend
// contracts verified against backend/src/routes/circles.ts:
//   - PATCH  /circles/:circleId  (requireAuth + owner; validateBody(updateCircleSchema))
//       body { recipient_name?, recipient_dob?, recipient_conditions? }
//       (recipient_photo_url is also accepted but photo upload is out of scope)
//   - DELETE /circles/:circleId  (requireAuth + owner; soft-delete via archived_at)
// Both return the `{ success, data }` envelope (unwrapped by the interceptor).
// ===========================================================================

/**
 * Web mirror of the backend `updateCircleSchema` (backend/src/routes/circles.ts).
 * Field rules kept in lock-step with the server so client + server agree:
 *   - recipient_name: non-empty, ≤100 chars
 *   - recipient_dob: YYYY-MM-DD format + a valid calendar date
 *   - recipient_conditions: array of strings
 * All fields optional (partial update); `.strict()` rejects unknown keys.
 */
const recipientDobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'recipient_dob must be in YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'recipient_dob is not a valid calendar date');

export const updateCircleSchema = z
  .object({
    recipient_name: z.string().min(1).max(100).optional(),
    recipient_dob: recipientDobSchema.optional(),
    recipient_conditions: z.array(z.string()).optional(),
  })
  .strict();

export type UpdateCircleRequest = z.infer<typeof updateCircleSchema>;

/** PATCH /circles/:circleId — owner edits recipient name / DOB / conditions. */
export async function updateCircle(
  circleId: string,
  data: UpdateCircleRequest
): Promise<void> {
  await apiClient.patch(`/circles/${circleId}`, data);
}

/** DELETE /circles/:circleId — owner deletes (soft-archives) the circle. */
export async function deleteCircle(circleId: string): Promise<void> {
  await apiClient.delete(`/circles/${circleId}`);
}

// ===========================================================================
// Circle CREATE WRITE function (plan Stage 8, Task 8.6a)
// ---------------------------------------------------------------------------
// Mirrors mobile/src/api/circles.ts (circlesApi.create) + the backend contract
// in backend/src/routes/circles.ts:
//   - POST /circles  (requireAuth; validateBody(createCircleSchema))
//       body { recipient_name?, recipient_dob?, recipient_conditions?, is_self_care? }
//       (recipient_photo_url is also accepted but photo upload is out of scope)
//   - Returns 201 { success, data: { circle } } (envelope unwrapped by interceptor).
//   - Freemium: free tier owning ≥1 circle → 402 SUBSCRIPTION_REQUIRED;
//     any tier owning ≥5 circles → 403 CIRCLE_LIMIT_REACHED.
// ===========================================================================

/**
 * Web mirror of the backend `createCircleSchema` (backend/src/routes/circles.ts).
 * Field rules kept in lock-step with the server so client + server agree:
 *   - recipient_name: non-empty, ≤100 chars (required by the form — self-care
 *     resolves a name on the client before submit, see CreateCircleModal)
 *   - recipient_dob: YYYY-MM-DD format + a valid calendar date (reuses the
 *     shared `recipientDobSchema` above)
 *   - recipient_conditions: array of strings
 *   - is_self_care: boolean
 * `.strict()` rejects unknown keys.
 */
export const createCircleSchema = z
  .object({
    recipient_name: z.string().min(1).max(100),
    recipient_dob: recipientDobSchema.optional(),
    recipient_conditions: z.array(z.string()).optional(),
    is_self_care: z.boolean().optional(),
  })
  .strict();

export type CreateCircleRequest = z.infer<typeof createCircleSchema>;

/**
 * POST /circles — create a new care circle. Returns the created `Circle` so the
 * caller can navigate straight to its calendar. The backend wraps the new row
 * in `{ success, data: { circle } }`; the apiClient interceptor unwraps axios'
 * `response.data` to that envelope.
 */
export async function createCircle(data: CreateCircleRequest): Promise<Circle> {
  const response = (await apiClient.post('/circles', data)) as unknown as {
    success: boolean;
    data: { circle: Circle };
  };
  return response.data.circle;
}
