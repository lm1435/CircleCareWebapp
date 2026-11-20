import { seenByNames } from '../careNoteSeenBy';
import type { CareNote } from '@/api/careNotes';

const r = (id: string, first: string | null) => ({ user_id: id, first_name: first });
const note = (seen_by: unknown) =>
  ({ author_id: 'author', seen_by }) as Pick<CareNote, 'author_id' | 'seen_by'>;

describe('seenByNames', () => {
  it('positive: names in server order, viewer and author excluded, nameless gets the fallback', () => {
    expect(
      seenByNames(note([r('a', 'Ana'), r('me', 'Me'), r('author', 'Sam'), r('b', null)]), 'me', 'Someone')
    ).toEqual(['Ana', 'Someone']);
  });

  it('positive: a null and an undefined entry are skipped without throwing', () => {
    expect(seenByNames(note([null, r('a', 'Ana'), undefined, r('b', 'Bo')]), 'me', 'x')).toEqual([
      'Ana',
      'Bo',
    ]);
  });

  it('positive: duplicate user_id counts once, first occurrence wins', () => {
    expect(
      seenByNames(note([r('a', 'Ana'), r('b', 'Bo'), r('a', 'Anna'), r('a', null)]), 'me', 'x')
    ).toEqual(['Ana', 'Bo']);
  });

  it('negative: a duplicate does not inflate the count', () => {
    expect(seenByNames(note([r('a', 'Ana'), r('a', 'Ana')]), 'me', 'x')).toHaveLength(1);
  });

  it('negative: absent or non-array seen_by gives nothing', () => {
    expect(seenByNames(note(undefined), 'me', 'x')).toEqual([]);
    expect(seenByNames(note('nope'), 'me', 'x')).toEqual([]);
  });
});
