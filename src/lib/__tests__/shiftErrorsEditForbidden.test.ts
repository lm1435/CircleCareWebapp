import fs from 'fs';
import path from 'path';
import { isShiftEditForbiddenError } from '@/api/shifts';
import { classifyShiftFailure, describeShiftFailure } from '@/lib/shiftErrors';
import i18n from '@/i18n';

// 1.4.4 build 6: the backend answers 403 SHIFT_EDIT_FORBIDDEN when someone other than the person on a
// shift, the owner or a manager changes its date / time / duration / repeat or deletes it. Same copy as
// mobile (utils/shiftErrors); it closes the dialog and toasts.
const refusal = (code: string) => ({ success: false, error: { code, message: 'x' } });
const MESSAGE = 'Only the person on a shift, the owner or a manager can change its time or delete it.';

describe('SHIFT_EDIT_FORBIDDEN', () => {
  it('POSITIVE: classified as edit_forbidden and worded the same for an edit, a save and a delete', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.getFixedT('en', 'shifts');
    const err = refusal('SHIFT_EDIT_FORBIDDEN');
    expect(isShiftEditForbiddenError(err)).toBe(true);
    expect(classifyShiftFailure(err)).toBe('edit_forbidden');
    for (const verb of ['edit', 'save', 'delete'] as const) {
      expect(describeShiftFailure(t, err, verb)).toEqual({ kind: 'edit_forbidden', specific: true, message: MESSAGE });
    }
  });

  it.each(['es', 'de', 'fr', 'it', 'pt'])('POSITIVE: %s has its own sentence (not the English, not the key)', (lng) => {
    const message = describeShiftFailure(i18n.getFixedT(lng, 'shifts'), refusal('SHIFT_EDIT_FORBIDDEN'), 'delete').message;
    expect(message).not.toBe(MESSAGE);
    expect(message).not.toContain('editForbidden');
    expect(message.length).toBeGreaterThan(20);
  });

  it('NEGATIVE: the other refusals keep their own kind and words', () => {
    const t = i18n.getFixedT('en', 'shifts');
    expect(isShiftEditForbiddenError(refusal('SHIFT_DROP_FORBIDDEN'))).toBe(false);
    expect(isShiftEditForbiddenError(refusal('FORBIDDEN'))).toBe(false);
    expect(isShiftEditForbiddenError(null)).toBe(false);
    expect(isShiftEditForbiddenError(new Error('Network Error'))).toBe(false);
    expect(classifyShiftFailure(refusal('SHIFT_DROP_FORBIDDEN'))).toBe('drop_forbidden');
    expect(classifyShiftFailure(refusal('SHIFT_ASSIGN_FORBIDDEN'))).toBe('assign_forbidden');
    expect(describeShiftFailure(t, refusal('SHIFT_DROP_FORBIDDEN'), 'drop').message).not.toBe(MESSAGE);
    // A network failure stays retryable (inline, not specific).
    expect(describeShiftFailure(t, new Error('Network Error'), 'delete')).toEqual({
      kind: 'other',
      specific: false,
      message: "We couldn't delete the shift. Try again.",
    });
  });

  const FILE = path.resolve(__dirname, '../../../../backend/src/constants/shiftErrorCodes.ts');
  it.skipIf(!fs.existsSync(FILE))('the code is the one the backend declares (EDIT_FORBIDDEN)', () => {
    expect(fs.readFileSync(FILE, 'utf8')).toMatch(/EDIT_FORBIDDEN:\s*'SHIFT_EDIT_FORBIDDEN'/);
  });
});
