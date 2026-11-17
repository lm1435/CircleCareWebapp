import { readDeclineError } from '@/lib/inviteDecline';

// 1.4.3 invite decline: every refusal in docs/plans/invite-decline-1-4-3.md maps to one copy
// key and a refetch decision. Mirrors mobile src/utils/inviteDecline.ts.
describe('readDeclineError', () => {
  it.each([
    ['INVITE_ALREADY_USED', 'declineErrorUsed', true],
    ['INVITE_CANCELLED', 'declineErrorInactive', true],
    ['INVITE_NOT_FOUND', 'declineErrorInactive', true],
    ['INVITE_EXPIRED', 'declineErrorExpired', true],
    ['RATE_LIMIT', 'declineErrorRateLimit', false],
    ['EMAIL_MISMATCH', 'declineErrorGeneric', true],
    ['SERVER_ERROR', 'declineErrorGeneric', false],
  ])('P: %s -> %s (refetch %s)', (code, messageKey, refetch) => {
    expect(readDeclineError({ error: { code } })).toEqual({ code, messageKey, refetch });
  });

  it('N: an unknown code or a network error reports as other, generic copy, keeps the row', () => {
    expect(readDeclineError({ error: { code: 'SOMETHING_NEW' } })).toEqual({
      code: 'other',
      messageKey: 'declineErrorGeneric',
      refetch: false,
    });
    expect(readDeclineError(new Error('Network Error')).code).toBe('other');
    expect(readDeclineError(null).code).toBe('other');
  });

  it('N: never leaks free text into the analytics enum', () => {
    expect(readDeclineError({ error: { code: 'ana@example.com' } }).code).toBe('other');
  });
});
