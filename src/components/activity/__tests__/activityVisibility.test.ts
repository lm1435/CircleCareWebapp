import { describe, expect, it } from 'vitest';
import { isNoteMissing, lastPageAllHidden, visibleActivities } from '@/components/activity/activityVisibility';

// Twin of mobile/src/__tests__/utils/activityVisibility.test.ts.
describe('activityVisibility', () => {
  it('isNoteMissing is true only for an explicit note_missing: true', () => {
    expect(isNoteMissing({ note_missing: true })).toBe(true);
    expect(isNoteMissing({ note_missing: false })).toBe(false);
    expect(isNoteMissing({})).toBe(false);
  });

  it('visibleActivities drops flagged rows and keeps order', () => {
    const rows = [{ id: 'a' }, { id: 'b', note_missing: true }, { id: 'c', note_missing: false }];
    expect(visibleActivities(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('lastPageAllHidden: only when the newest page is non-empty and entirely flagged', () => {
    expect(lastPageAllHidden(undefined)).toBe(false);
    expect(lastPageAllHidden([])).toBe(false);
    expect(lastPageAllHidden([{ activities: [] }])).toBe(false);
    expect(lastPageAllHidden([{ activities: [{ note_missing: true }] }])).toBe(true);
    expect(
      lastPageAllHidden([{ activities: [{ note_missing: true }, { note_missing: false }] }])
    ).toBe(false);
    expect(
      lastPageAllHidden([{ activities: [{}] }, { activities: [{ note_missing: true }] }])
    ).toBe(true);
  });
});
