import { getActivityIcon, getActivityIconName } from '../ActivityIcon';

describe('getActivityIconName', () => {
  it('maps the calendar route\'s templated medication verbs to the medication glyph', () => {
    for (const type of [
      'medication_created',
      'medication_updated',
      'medication_deleted',
      'medication_skipped',
      'medication_not_taken',
    ]) {
      expect(getActivityIconName(type)).toBe('medication');
      expect(getActivityIcon(type)).toBe('medkit-outline');
    }
  });

  it('maps member churn to the circle glyph', () => {
    for (const type of ['member_invited', 'member_left', 'member_removed']) {
      expect(getActivityIconName(type)).toBe('circle');
    }
  });

  it('falls back on the subject prefix for an unlisted verb', () => {
    expect(getActivityIconName('appointment_rescheduled')).toBe('appointment');
    expect(getActivityIconName('task_reassigned')).toBe('task');
    expect(getActivityIconName('note_deleted')).toBe('note');
  });

  it('keeps the placeholder dot for an unknown subject', () => {
    expect(getActivityIconName('signup')).toBe('generic');
    expect(getActivityIcon('magic_link')).toBe('ellipse-outline');
  });
});
