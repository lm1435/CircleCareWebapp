// Invitee welcome (onboarding 1.3.1, spec section 4) — the "pending welcome".
//
// Every web accept path (invite landing incl. the post-OTP and post-OAuth
// auto-accept, pending-invites list, join-by-code modal) converges on a
// successful accept. Each records ONE pending welcome here, keyed per user +
// circle, and navigates to `/circles/:id/welcome`. The welcome page consumes it,
// so it shows once; a reload (or a second visit) finds nothing and goes to Today.
//
// A record is written ONLY on a successful accept (ALREADY_MEMBER rejects, the
// owner never accepts), so owners and existing members never see the screen.
//
// sessionStorage (tab-scoped, gone with the tab): the record carries a first
// name, so it must not outlive the session or survive into another account's
// browser profile. Every read/write tolerates storage being unavailable.

export type InviteeWelcomeRole = 'caregiver' | 'view_only';

export interface InviteeWelcome {
  /** Inviter's first name, or null when the invite carries none. */
  inviter: string | null;
  /** The care recipient's name as the invite names it. */
  recipient: string;
  role: InviteeWelcomeRole;
  /** The joiner IS the care recipient (a care_recipient invite): self-care wording. */
  self: boolean;
}

export interface InviteeWelcomeInput {
  inviterName?: string | null;
  recipientName?: string | null;
  /** The accept response said the joiner landed read-only. */
  viewOnly?: boolean;
  memberType?: 'caregiver' | 'care_recipient' | string | null;
}

const PREFIX = 'cc:inviteeWelcome:';

function key(userId: string, circleId: string): string {
  return `${PREFIX}${userId}:${circleId}`;
}

export function inviteeWelcomePath(circleId: string): string {
  return `/circles/${circleId}/welcome`;
}

/** Normalise whatever an accept path knows about the invite into a record. */
export function toInviteeWelcome(input: InviteeWelcomeInput): InviteeWelcome {
  const inviter = input.inviterName?.trim() || null;
  return {
    inviter,
    recipient: input.recipientName?.trim() ?? '',
    role: input.viewOnly ? 'view_only' : 'caregiver',
    self: input.memberType === 'care_recipient',
  };
}

/** Park a welcome for this user + circle. Returns false when nothing was stored. */
export function recordPendingInviteeWelcome(
  userId: string | null | undefined,
  circleId: string | null | undefined,
  input: InviteeWelcomeInput
): boolean {
  if (!userId || !circleId) return false;
  try {
    sessionStorage.setItem(key(userId, circleId), JSON.stringify(toInviteeWelcome(input)));
    return true;
  } catch {
    return false;
  }
}

/** Read the pending welcome WITHOUT clearing it (render-safe). */
export function peekPendingInviteeWelcome(
  userId: string | null | undefined,
  circleId: string | null | undefined
): InviteeWelcome | null {
  if (!userId || !circleId) return null;
  try {
    const raw = sessionStorage.getItem(key(userId, circleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InviteeWelcome> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      inviter: typeof parsed.inviter === 'string' && parsed.inviter ? parsed.inviter : null,
      recipient: typeof parsed.recipient === 'string' ? parsed.recipient : '',
      role: parsed.role === 'view_only' ? 'view_only' : 'caregiver',
      self: parsed.self === true,
    };
  } catch {
    return null;
  }
}

/** Drop the pending welcome (called once it has been shown). */
export function clearPendingInviteeWelcome(
  userId: string | null | undefined,
  circleId: string | null | undefined
): void {
  if (!userId || !circleId) return;
  try {
    sessionStorage.removeItem(key(userId, circleId));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
