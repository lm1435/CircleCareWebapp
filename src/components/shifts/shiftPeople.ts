import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { memberShortName } from './shiftUtils';

/** Who is on a shift: the roster first (so the viewer reads "You"), then the embed. */
export function shiftAssignee(
  shift: Pick<CalendarEvent, 'assigned_to' | 'assigned_to_user'>,
  members: readonly CircleMember[],
  viewerId: string | null | undefined
): { id: string; name: string; isYou: boolean } | null {
  const id = shift.assigned_to;
  if (!id) return null;
  const member = members.find((m) => m.id === id);
  const embed = shift.assigned_to_user;
  const name =
    (member ? memberShortName(member) : '') ||
    (embed ? memberShortName({ first_name: embed.first_name, email: embed.email }) : '') ||
    '';
  return { id, name, isYou: !!viewerId && id === viewerId };
}
