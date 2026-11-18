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
  /**
   * The inviter's FIRST NAME, or `null` when they have none.
   *
   * NULLABLE ON PURPOSE — do not "simplify" this to `string`.
   * The backend deliberately sends `null` rather than a fallback here.
   * This endpoint is UNAUTHENTICATED (invite code only) and carries no
   * Accept-Language, so it can emit neither:
   *   - an English word like "Someone" — untranslatable copy shipped as data,
   *     with no way to know the reader's language; nor
   *   - the inviter's email local-part — that is personal data, and
   *     `users.first_name` is NULL for every Apple/Google OAuth signup, so the
   *     fallback would fire routinely and land in publicly cached link-preview
   *     cards (this page feeds the name straight into `og:title`).
   * Absence is neither. The CLIENT renders the localized fallback —
   * see `inviterFallback` in src/i18n/{en,es}/invite.json.
   */
  invited_by_name: string | null;
  expires_at: string;
  /** ADDITIVE (1.4.3): present (true) only on a shared-link invite (no address). */
  link_invite?: boolean;
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
//       body { member_type, email? }. With an email we email the invitee a
//       link to join; WITHOUT one (1.4.3) it is a shared-link invite: no email,
//       the response carries the code + link for the inviter to share. 402 SUBSCRIPTION_REQUIRED when a free-tier circle already
//       has ≥2 active+pending caregivers.
//   - DELETE /invites/:inviteId          (requireAuth, inviter/owner = CANCEL).
//       On a DECLINED row (1.4.3) the same call dismisses it ("Remove").
//   - POST   /invites/:inviteId/decline  (requireAuth, the INVITEE, 1.4.3):
//       see `declineInvite` below and docs/plans/invite-decline-1-4-3.md.
//   - POST   /invites/:inviteId/resend   (requireAuth + inviteRateLimit,
//       inviter/owner). Extends the SAME row by 7 days and re-sends the email;
//       the invite_code is deliberately NOT rotated, so a link the recipient
//       already has keeps working. 402 SUBSCRIPTION_REQUIRED when reviving an
//       EXPIRED caregiver invite would exceed the free-tier cap (a still-live
//       invite already holds its seat, so that case is never re-checked).
//       Also 404 INVITE_NOT_FOUND, 403 FORBIDDEN, 400 INVITE_NOT_PENDING.
//   - POST   /invites/:inviteId/accept   (requireAuth).
//   - GET    /invites/pending            (requireAuth) → { invites: PendingInvite[] }.
// The apiClient response interceptor unwraps axios' response.data, so each value
// resolves to the `{ success, data }` envelope.
// ===========================================================================

export interface CreateInviteRequest {
  /**
   * OMITTED (never null, never '') for a shared-link invite (1.4.3): the body is
   * then `{ member_type }` only.
   */
  email?: string;
  member_type: InviteMemberType;
}

export interface CreatedInvite {
  id: string;
  /** null for a shared-link invite (1.4.3). */
  invited_email: string | null;
  member_type: InviteMemberType;
  invite_code: string;
  /**
   * Shareable link to the web landing page for this code, so the inviter can
   * send it by text or WhatsApp instead of relying on our email arriving.
   *
   * OPTIONAL on purpose: a backend older than the release that added it returns
   * nothing, and the UI must then fall back to building the URL from
   * `invite_code` rather than offering a link to `undefined`.
   */
  invite_url?: string;
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
 * DELETE /invites/:inviteId — CANCEL a pending invite (inviter/owner only), or
 * dismiss a declined one. The invitee's "no" is `declineInvite`.
 */
export async function cancelInvite(inviteId: string): Promise<void> {
  await apiClient.delete(`/invites/${inviteId}`);
}

export interface DeclineInviteResult {
  invite: { id: string; status: 'declined' };
  /** A repeat decline (double click, retry after a timeout). Treat it as success. */
  already_declined: boolean;
}

interface DeclineInviteEnvelope {
  success: boolean;
  data: DeclineInviteResult;
}

/**
 * POST /invites/:inviteId/decline (1.4.3) — the INVITEE declines. Email-matched
 * like accept-by-id; idempotent. Mirrors mobile/src/api/invites.ts.
 */
export async function declineInvite(inviteId: string): Promise<DeclineInviteResult> {
  const response = (await apiClient.post(
    `/invites/${inviteId}/decline`,
    {}
  )) as unknown as DeclineInviteEnvelope;
  return response.data;
}

/** The refreshed invite returned by the resend endpoint. */
export interface ResendInviteResult {
  invite: {
    id: string;
    /** null for a shared-link invite (1.4.3): nothing was emailed, the same link renewed. */
    invited_email: string | null;
    /** Present for a shared-link invite (1.4.3). */
    invite_code?: string;
    invite_url?: string;
    member_type: InviteMemberType;
    expires_at: string;
    /** Always false — the row was just extended by another 7 days. */
    is_expired: boolean;
  };
  /** False when the email provider rejected the send; the invite is valid regardless. */
  email_sent: boolean;
}

interface ResendInviteEnvelope {
  success: boolean;
  data: ResendInviteResult;
}

/**
 * POST /invites/:inviteId/resend — extend a lapsed (or still-pending) invite by
 * another 7 days and re-send the email (inviter/owner only).
 *
 * Rejects with a 402 `SUBSCRIPTION_REQUIRED` envelope when reviving an expired
 * caregiver invite would push a free-tier circle past the cap — callers classify
 * via `isSubscriptionRequiredError`, exactly like the create path.
 */
export async function resendInvite(inviteId: string): Promise<ResendInviteResult> {
  const response = (await apiClient.post(
    `/invites/${inviteId}/resend`
  )) as unknown as ResendInviteEnvelope;
  return response.data;
}

/**
 * The `care_circles` columns a client reads off an accept. The backend selects
 * `*` from care_circles (backend/src/routes/invites.ts, both accept routes), so
 * the row carries more — these are the ones the client relies on.
 */
export interface JoinedCircle {
  id: string;
  name: string;
  recipient_name: string | null;
  owner_id: string;
}

/**
 * `data` of a successful accept — by id (POST /invites/:inviteId/accept) and by
 * code (POST /invites/code/:code/accept) answer identically:
 *   { success: true, data: { circle, view_only, message } }
 * Mirrors mobile/src/api/invites.ts `AcceptInviteResponse`.
 */
export interface AcceptInviteResponse {
  /**
   * The circle the user joined. `null` only if the backend's post-join read of
   * the circle failed (its `.single()` result is not checked) — the join itself
   * still happened, so callers must still report success.
   */
  circle: JoinedCircle | null;
  /** The joiner landed on a capped free circle and joined read-only. */
  view_only: boolean;
  message: string;
}

interface AcceptInviteEnvelope {
  success: boolean;
  data: AcceptInviteResponse;
}

/**
 * POST /invites/:inviteId/accept — accept an invite addressed to the user.
 * `apiClient` already resolves to the `{ success, data }` envelope (its response
 * interceptor unwraps axios' `response.data`), so `.data` here is the backend's
 * `data` — one unwrap, not two.
 */
export async function acceptInvite(inviteId: string): Promise<AcceptInviteResponse> {
  const response = (await apiClient.post(
    `/invites/${inviteId}/accept`
  )) as unknown as AcceptInviteEnvelope;
  return response.data;
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

// ===========================================================================
// JOIN-BY-CODE functions — web parity with mobile's JoinCircleModal.
// ---------------------------------------------------------------------------
// Mirrors mobile/src/api/invites.ts (lookupInviteByCode + acceptInviteByCode).
// Backend contracts verified against backend/src/routes/invites.ts:
//   - GET  /invites/code/:code        (requireAuth) →
//       { success, data: { invite: InviteByCode } }
//       errors: 404 INVITE_NOT_FOUND, 400 INVITE_ALREADY_USED, 400 INVITE_EXPIRED.
//   - POST /invites/code/:code/accept (requireAuth) →
//       { success, data: AcceptInviteResponse }
//       errors: 404 INVITE_NOT_FOUND/USER_NOT_FOUND, 400 INVITE_ALREADY_USED,
//               400 INVITE_EXPIRED, 400 ALREADY_MEMBER.
// The backend uses a code-possession trust model (no email match), matching
// mobile — so a logged-in user can join from any account.
//
// PRIVACY: never log or send the raw code to analytics/error reporting — the
// code grants the ability to join the circle.
// ===========================================================================

/** Full invite details resolved from a code (authenticated lookup). */
export interface InviteByCode {
  id: string;
  invite_code: string;
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
  expires_at: string;
  /**
   * ADDITIVE (backend 2026-10-17): who the signed-in caller is to this invite.
   * 'inviter' = they sent it; 'member' = already in the circle. Either way
   * there is nothing to join, so the page shows a calm note instead of Accept.
   * Absent on an older backend → treat as 'none'.
   */
  viewer_relationship?: InviteViewerRelationship;
  /** ADDITIVE (1.4.3): present (true) only on a shared-link invite (no address). */
  link_invite?: boolean;
}

export type InviteViewerRelationship = 'inviter' | 'member' | 'none';

/** True when the caller has nothing to join: they sent it, or are already in. */
export function isOwnOrMemberInvite(
  invite: { viewer_relationship?: InviteViewerRelationship } | null | undefined
): boolean {
  return invite?.viewer_relationship === 'inviter' || invite?.viewer_relationship === 'member';
}

interface InviteByCodeEnvelope {
  success: boolean;
  data: { invite: InviteByCode };
}

/** Normalize a code the way the backend does (uppercase + trim) before sending. */
function normalizeCode(code: string): string {
  return encodeURIComponent(code.trim().toUpperCase());
}

/** GET /invites/code/:code — look up an invite by code (authenticated). */
export async function lookupInviteByCode(code: string): Promise<InviteByCode> {
  const response = (await apiClient.get(
    `/invites/code/${normalizeCode(code)}`
  )) as unknown as InviteByCodeEnvelope;
  return response.data.invite;
}

/**
 * POST /invites/code/:code/accept — join a circle by code (authenticated).
 * Resolves to the backend's `data` (see `AcceptInviteResponse`); same single
 * unwrap as `acceptInvite`.
 */
export async function acceptInviteByCode(code: string): Promise<AcceptInviteResponse> {
  const response = (await apiClient.post(
    `/invites/code/${normalizeCode(code)}/accept`
  )) as unknown as AcceptInviteEnvelope;
  return response.data;
}

/**
 * POST /invites/code/:code/decline (1.4.3) — decline BY CODE (authenticated).
 * The way a shared-link invite (no address) is declined; holding the code is
 * the access, as for accept-by-code. Same result shape as `declineInvite`.
 * 403 NOT_INVITEE for the inviter or an existing member (the page never offers
 * it to them). Mirrors mobile/src/api/invites.ts.
 */
export async function declineInviteByCode(code: string): Promise<DeclineInviteResult> {
  const response = (await apiClient.post(
    `/invites/code/${normalizeCode(code)}/decline`,
    {}
  )) as unknown as DeclineInviteEnvelope;
  return response.data;
}
