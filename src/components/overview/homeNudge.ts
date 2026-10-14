import type { GettingStartedStatus } from '@/components/circles/GettingStartedChecklist';

export type HomeNudge = 'checklist' | 'soloInvite';

/**
 * Home shows at most ONE nudge card. Priority, highest first:
 *
 *   1. the getting-started checklist, while it has unfinished steps and has
 *      not been dismissed;
 *   2. the solo invite card, only once the checklist is finished or dismissed
 *      AND the owner is still alone (no other member, no live invite).
 *
 * Mobile's list has two more entries web cannot show: the notifications
 * warning (above the checklist; web has no push permission) and the voice
 * card (below the invite; voice add is mobile-only).
 *
 * While the checklist's own reads are unsettled (`unknown`) nothing is
 * chosen: picking the invite card then would flash it above a checklist that
 * is about to appear.
 */
export function pickHomeNudge(input: {
  checklist: GettingStartedStatus;
  soloEligible: boolean;
}): HomeNudge | null {
  if (input.checklist === 'active') return 'checklist';
  if (input.checklist === 'inactive' && input.soloEligible) return 'soloInvite';
  return null;
}
