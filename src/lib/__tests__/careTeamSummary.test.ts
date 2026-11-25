import { describe, expect, it } from 'vitest';
import { MAX_AVATARS, summarizeCareTeam, type CareTeamPerson } from '../careTeamSummary';

// Names line + avatar stack for the Today Care team row (plan N4, N5). Mirrors mobile's
// utils/careTeamSummary.ts behaviour.

const labels = {
  you: 'You',
  and: (names: string, last: string) => `${names} and ${last}`,
  more: (names: string, count: number) => `${names} and ${count} more`,
};

const person = (id: string, first: string | null, email = `${id}@x.com`): CareTeamPerson => ({
  id,
  first_name: first,
  last_name: null,
  email,
});

const team = (n: number): CareTeamPerson[] =>
  ['Ana', 'Ben', 'Cy', 'Di', 'Ed', 'Flo', 'Gus'].slice(0, n).map((f, i) => person(`u${i}`, f));

describe('summarizeCareTeam names line', () => {
  it('N4: one person reads that name only; the viewer alone reads "You"', () => {
    expect(summarizeCareTeam([person('a', 'Ana')], 'zzz', labels).namesLine).toBe('Ana');
    expect(summarizeCareTeam([person('a', 'Ana')], 'a', labels).namesLine).toBe('You');
  });

  it('P3: the viewer reads "You" and comes first: "You, Margaret and Lisa"', () => {
    const people = [person('m', 'Margaret'), person('v', 'Vic'), person('l', 'Lisa')];
    expect(summarizeCareTeam(people, 'v', labels).namesLine).toBe('You, Margaret and Lisa');
  });

  it('N4: two people read "A and B"', () => {
    expect(summarizeCareTeam(team(2), null, labels).namesLine).toBe('Ana and Ben');
  });

  it('N4: four people name all four, no "more"', () => {
    const line = summarizeCareTeam(team(4), null, labels).namesLine;
    expect(line).toBe('Ana, Ben, Cy and Di');
    expect(line).not.toMatch(/more/);
  });

  it('N4: five or more name three, then "and N more"', () => {
    expect(summarizeCareTeam(team(5), null, labels).namesLine).toBe('Ana, Ben, Cy and 2 more');
    expect(summarizeCareTeam(team(7), null, labels).namesLine).toBe('Ana, Ben, Cy and 4 more');
  });

  it('N4: five people with the viewer among them still names "You" and three names total', () => {
    expect(summarizeCareTeam(team(5), 'u3', labels).namesLine).toBe('You, Ana, Ben and 2 more');
  });

  it('N4: a member with no first name falls back to the email', () => {
    const people = [person('a', null, 'ana@x.com'), person('b', 'Ben')];
    expect(summarizeCareTeam(people, null, labels).namesLine).toBe('ana@x.com and Ben');
    expect(summarizeCareTeam([person('a', '   ', 'blank@x.com')], null, labels).namesLine).toBe('blank@x.com');
  });

  it('an empty team is an empty line', () => {
    const s = summarizeCareTeam([], 'v', labels);
    expect(s.namesLine).toBe('');
    expect(s.avatars).toEqual([]);
    expect(s.extraAvatars).toBe(0);
  });
});

describe('summarizeCareTeam avatars', () => {
  it('N5: never more than four avatars; "+N" only from five', () => {
    for (let n = 1; n <= 7; n++) {
      const s = summarizeCareTeam(team(n), null, labels);
      expect(s.avatars.length).toBe(Math.min(n, MAX_AVATARS));
      expect(s.extraAvatars).toBe(Math.max(0, n - MAX_AVATARS));
    }
    expect(summarizeCareTeam(team(4), null, labels).extraAvatars).toBe(0);
    expect(summarizeCareTeam(team(5), null, labels).extraAvatars).toBe(1);
  });

  it('avatars carry the full name (or email) and the member colour', () => {
    const s = summarizeCareTeam(
      [{ id: 'a', email: 'a@x.com', first_name: 'Ana', last_name: 'Reyes', avatar_color: 'moss' }, person('b', null, 'b@x.com')],
      null,
      labels
    );
    expect(s.avatars).toEqual([
      { id: 'a', name: 'Ana Reyes', avatarColor: 'moss' },
      { id: 'b', name: 'b@x.com', avatarColor: null },
    ]);
  });
});
