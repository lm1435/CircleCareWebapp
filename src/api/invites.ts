import { apiClient } from '@/lib/api';

// VERIFIED against backend/src/routes/invites.ts:
// `POST /api/invites/code/:code/preview` — NO AUTH, rate-limited
// (invitePreviewRateLimit). With an empty body the backend returns the
// "limited preview" used by this public landing page.
//
// Success (200): { success: true, data: { invite: {
//   member_type, circle: { name, recipient_name }, invited_by_name, expires_at
// } } }
// Errors: 404 INVALID_CODE, 400 INVITE_ALREADY_USED, 400 INVITE_EXPIRED,
//         500 SERVER_ERROR — all `{ success: false, error: { code, message } }`.

export type InviteMemberType = 'caregiver' | 'care_recipient';

export interface InvitePreview {
  member_type: InviteMemberType;
  circle: {
    name: string;
    recipient_name: string;
  };
  invited_by_name: string;
  expires_at: string;
}

interface InvitePreviewEnvelope {
  success: boolean;
  data: { invite: InvitePreview };
}

/**
 * Public (unauthenticated) limited invite preview for the landing page.
 * Backend normalizes the code (uppercase + trim) itself.
 *
 * PRIVACY: never log or send the raw code to analytics — possession of the
 * code grants the ability to join the circle.
 */
export async function previewInviteByCode(code: string): Promise<InvitePreview> {
  const response = (await apiClient.post(
    `/invites/code/${encodeURIComponent(code)}/preview`,
    {}
  )) as unknown as InvitePreviewEnvelope;
  return response.data.invite;
}
