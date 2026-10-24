// Who gets the Shifts surface, and what it does for them (docs/plans/care-shifts.md,
// User Flow step 1). Same inputs and fail-closed shape as `lib/aiAccess.ts`:
// every input is already on the client from `useCircle(circleId)`.
//
//   view-only seat                     -> hidden
//   premium benefits apply here        -> available   (every role)
//   free circle, viewer is the OWNER   -> teaser      (-> paywall context 'shifts')
//   free circle, manager / member      -> hidden      (never sold a paywall)
//
// `viewOnly` is tested first for the same reason as in aiAccess: the server
// hardcodes `is_premium_circle: false` for a view-only seat.

export type ShiftsEntryState = 'available' | 'teaser' | 'hidden' | 'readonly';

export interface ShiftsEntryInput {
  viewOnly: boolean;
  isPremiumCircle: boolean;
  isOwner: boolean;
  /** `has_shifts` on the circle detail: a free circle that still holds live shift rows. */
  hasShifts?: boolean;
}

export function resolveShiftsEntry({
  viewOnly,
  isPremiumCircle,
  isOwner,
  hasShifts = false,
}: ShiftsEntryInput): ShiftsEntryState {
  if (viewOnly) return 'hidden';
  if (isPremiumCircle) return 'available';
  if (hasShifts) return 'readonly';
  return isOwner ? 'teaser' : 'hidden';
}

/** Where "New > Shift" is offered: shifts can be started (available) or the owner's teaser opens. */
export function showShiftCreateOption(entry: ShiftsEntryState): boolean {
  return entry === 'available' || entry === 'teaser';
}

/**
 * Every shift write (add, take, drop, assign, edit, delete, add-next) needs the
 * feature AVAILABLE (premium) and the usual edit access. 'readonly' never writes,
 * even where `can_edit` is true (a free circle's own editors).
 */
export function canWriteShifts(entry: ShiftsEntryState, canEdit: boolean): boolean {
  return entry === 'available' && canEdit;
}
