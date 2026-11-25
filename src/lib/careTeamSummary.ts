/**
 * The Care team row on Today: who is on the team, as one names line plus a stack of avatars.
 * Pure (no React, no i18n instance) so every rule is unit-testable. Mirrors the behaviour of
 * mobile's `utils/careTeamSummary.ts` (navigation fixes 1.4.4).
 *
 * Names line:
 *   - the viewer reads "You" and comes first, the others follow in the order given;
 *   - 4 people or fewer: every name ("A", "A and B", "A, B and C", "A, B, C and D");
 *   - 5 or more: the first three names, then "and N more";
 *   - a member with no first name falls back to their email.
 * Avatars: at most `MAX_AVATARS` (4); the rest collapse into "+N".
 */

export const MAX_AVATARS = 4;
/** From this many people on, names are cut to three plus "and N more". */
export const NAMED_LIMIT = 4;
const NAMES_SHOWN_WHEN_CUT = 3;

export interface CareTeamPerson {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_color?: string | null;
}

export interface CareTeamLabels {
  /** "You" */
  you: string;
  /** "{{names}} and {{last}}" */
  and: (names: string, last: string) => string;
  /** "{{names}} and {{count}} more" */
  more: (names: string, count: number) => string;
}

export interface CareTeamAvatar {
  id: string;
  /** Name that drives the initials and colour: first + last, else email. */
  name: string;
  avatarColor: string | null;
}

export interface CareTeamSummary {
  namesLine: string;
  avatars: CareTeamAvatar[];
  /** People past the avatar cap: rendered "+N" when above zero. */
  extraAvatars: number;
  total: number;
}

/** First name, else email: the short name used in the names line. */
export function shortName(person: CareTeamPerson): string {
  const first = person.first_name?.trim();
  return first ? first : person.email;
}

function fullName(person: CareTeamPerson): string {
  const name = [person.first_name, person.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return name || person.email;
}

export function summarizeCareTeam(
  people: readonly CareTeamPerson[],
  viewerId: string | null | undefined,
  labels: CareTeamLabels
): CareTeamSummary {
  // The viewer first, everyone else in their given order.
  const ordered = [
    ...people.filter((p) => viewerId != null && p.id === viewerId),
    ...people.filter((p) => viewerId == null || p.id !== viewerId),
  ];
  const names = ordered.map((p) => (viewerId != null && p.id === viewerId ? labels.you : shortName(p)));

  let namesLine = '';
  if (names.length === 0) {
    namesLine = '';
  } else if (names.length === 1) {
    namesLine = names[0];
  } else if (names.length <= NAMED_LIMIT) {
    namesLine = labels.and(names.slice(0, -1).join(', '), names[names.length - 1]);
  } else {
    namesLine = labels.more(
      names.slice(0, NAMES_SHOWN_WHEN_CUT).join(', '),
      names.length - NAMES_SHOWN_WHEN_CUT
    );
  }

  return {
    namesLine,
    avatars: ordered.slice(0, MAX_AVATARS).map((p) => ({
      id: p.id,
      name: fullName(p),
      avatarColor: p.avatar_color ?? null,
    })),
    extraAvatars: Math.max(0, ordered.length - MAX_AVATARS),
    total: ordered.length,
  };
}
