import { describeShiftFailure } from '@/lib/shiftErrors';
import i18n from '@/i18n';

// The backend answers 409 SHIFT_ENDED to a take / drop / assign of a shift that has already ended
// (owner report, 1.4.0 build 9). Same copy as mobile, closes the dialog and toasts.
describe('SHIFT_ENDED', () => {
  it('maps to "This shift has already ended." for take, drop and assign (en) and es', async () => {
    const err = { error: { code: 'SHIFT_ENDED', message: 'This shift has already ended' } };
    await i18n.changeLanguage('en');
    const t = i18n.getFixedT('en', 'shifts');
    for (const verb of ['take', 'drop', 'assign'] as const) {
      expect(describeShiftFailure(t, err, verb)).toEqual({
        kind: 'ended',
        specific: true,
        message: 'This shift has already ended.',
      });
    }
    expect(describeShiftFailure(i18n.getFixedT('es', 'shifts'), err, 'take').message).toBe('Este turno ya terminó.');
  });
});
