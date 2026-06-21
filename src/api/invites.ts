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

// ===========================================================================
// AUTHENTICATED invite WRITE/READ functions (plan Stage 5, Task 5.1)
// ---------------------------------------------------------------------------
// Mirrors mobile/src/api/invites.ts. Backend contracts verified against
// backend/src/routes/invites.ts (mounted at /api/invites + /api/circles via the
// shared router):
//   - POST   /circles/:circleId/invites  (requireAuth + inviteRateLimit + owner)
//       body { email, member_type } → 402 SUBSCRIPTION_REQUIRED when a free-tier
//       circle already has ≥2 active+pending caregivers.
//   - DELETE /invites/:inviteId          (requireAuth, inviter/owner = CANCEL).
//       NOTE: there is NO "decline invite" endpoint for the invitee — mobile's
//       Decline is a client-only dismiss. We deliberately do NOT add one here.
//   - POST   /invites/:inviteId/accept   (requireAuth).
//   - GET    /invites/pending            (requireAuth) → { invites: PendingInvite[] }.
// The apiClient response interceptor unwraps axios' response.data, so each value
// resolves to the `{ success, data }` envelope.
// ===========================================================================

export interface CreateInviteRequest {
  email: string;
  member_type: InviteMemberType;
}

export interface CreatedInvite {
  id: string;
  invited_email: string;
  member_type: InviteMemberType;
  invite_code: string;
  expires_at: string;
}

export interface CreateInviteResponse {
  invite: CreatedInvite;
  message: string;
}

interface CreateInviteEnvelope {
  success: boolean;
  data: CreateInviteResponse;
}

/**
 * POST /circles/:circleId/invites — send an invite (owner only).
 * Rejects with a 402 `SUBSCRIPTION_REQUIRED` envelope when the free-tier
 * caregiver cap (≥2 active+pending caregivers) is hit — callers classify via
 * `isSubscriptionRequiredError`.
 */
export async function createInvite(
  circleId: string,
  data: CreateInviteRequest
): Promise<CreateInviteResponse> {
  const response = (await apiClient.post(
    `/circles/${circleId}/invites`,
    data
  )) as unknown as CreateInviteEnvelope;
  return response.data;
}

/**
 * DELETE /invites/:inviteId — CANCEL a pending invite (inviter/owner only).
 * This is the inviter-side cancel, NOT an invitee decline (no such endpoint).
 */
export async function cancelInvite(inviteId: string): Promise<void> {
  await apiClient.delete(`/invites/${inviteId}`);
}

/** POST /invites/:inviteId/accept — accept an invite addressed to the user. */
export async function acceptInvite(inviteId: string): Promise<void> {
  await apiClient.post(`/invites/${inviteId}/accept`);
}

/** A pending invite addressed to the current user (GET /invites/pending). */
export interface PendingInvite {
  id: string;
  member_type: InviteMemberType;
  circle: {
    id: string;
    name: string;
    recipient_name: string;
  };
  invited_by: {
    email: string;
    first_name: string | null;
    last_name: string | null;
  };
  created_at: string;
  expires_at: string;
}

interface PendingInvitesEnvelope {
  success: boolean;
  data: { invites: PendingInvite[] };
}

/** GET /invites/pending — invites addressed to the current user. */
export async function getPendingInvites(): Promise<PendingInvite[]> {
  const response = (await apiClient.get(
    '/invites/pending'
  )) as unknown as PendingInvitesEnvelope;
  return response.data.invites;
}
