import fs from 'fs';
import path from 'path';
import {
  classifyFailure,
  failureContext,
  isPaywallRefusal,
  markPaywallRefusal,
  type FailureKind,
} from '@/lib/apiErrors';

// SHIFT REFUSALS IN THE ERROR EVENT (1.4.3, a real report). A shift-task save refused with a SHIFT_*
// code reached analytics as error_kind 'unknown'. Every SHIFT_* code now has its HTTP status's
// category (same table as mobile `classifyFailure`), and `failureContext` can carry `handled`.
// Mobile twin: mobile/src/__tests__/utils/shiftFailureReporting.test.tsx.

const body = (code: string) => ({
  success: false,
  error: { code, message: 'Margaret Lisinopril shift at 5 Elm St' },
});

describe('classifyFailure: every shift code has its HTTP status category', () => {
  it.each<[string, FailureKind]>([
    ['SHIFT_ALREADY_TAKEN', 'conflict'],
    ['SHIFT_ASSIGN_FORBIDDEN', 'forbidden'],
    ['SHIFT_DROP_FORBIDDEN', 'forbidden'],
    ['SHIFT_NOT_ASSIGNED', 'conflict'],
    ['SHIFT_NOT_FOUND', 'not_found'],
    ['SHIFT_INVALID_DATE', 'validation'],
    ['SHIFT_ENDED', 'conflict'],
    ['SHIFT_TASK_OUTSIDE_SHIFT', 'validation'],
    ['SHIFT_TASK_TIME_UNSUPPORTED', 'validation'],
    ['RESCHEDULE_REQUIRED', 'conflict'],
    ['INVALID_START', 'validation'],
    ['INVALID_ASSIGNEE', 'validation'],
    ['SERVICE_UNAVAILABLE', 'server'],
    ['VIEW_ONLY', 'forbidden'],
  ])('%s -> %s', (code, kind) => {
    expect(classifyFailure(body(code))).toBe(kind);
  });

  const FILE = path.resolve(__dirname, '../../../../backend/src/constants/shiftErrorCodes.ts');
  it.skipIf(!fs.existsSync(FILE))('every code in backend SHIFT_ERROR_CODES is classified', () => {
    const src = fs.readFileSync(FILE, 'utf8');
    const block = src.slice(src.indexOf('SHIFT_ERROR_CODES = {'), src.indexOf('} as const'));
    const codes = [...block.matchAll(/:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(11);
    for (const code of codes) expect([code, classifyFailure(body(code))]).not.toEqual([code, 'unknown']);
  });

  it('negative: an unknown code is still unknown', () => {
    expect(classifyFailure(body('SOMETHING_NEW'))).toBe('unknown');
    expect(classifyFailure(body('SHIFTY'))).toBe('unknown');
  });

  it('negative: a network failure is still network', () => {
    expect(classifyFailure({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe('network');
  });
});

describe('failureContext carries handled only when assessed', () => {
  it('handled: true with the bounded code, no message', () => {
    const ctx = failureContext('shifts', 'create', body('SHIFT_ENDED'), { handled: true });
    expect(ctx).toEqual({
      source: 'shifts',
      action: 'create',
      error_kind: 'conflict',
      code: 'SHIFT_ENDED',
      fatal: false,
      handled: true,
    });
    expect(JSON.stringify(ctx)).not.toMatch(/Margaret|Lisinopril|Elm/);
  });

  it('negative: omitted when the caller does not assess it (old shape)', () => {
    expect(failureContext('vitals', 'delete', body('FORBIDDEN'))).not.toHaveProperty('handled');
  });

  it('negative: a prose code is not forwarded', () => {
    expect(
      failureContext('shifts', 'create', { success: false, error: { code: 'shift for Margaret ended' } }, { handled: false })
    ).toMatchObject({ code: 'api_error_no_code', error_kind: 'unknown', handled: false });
  });

  it('negative: a 402 paywall refusal is still a paywall moment (callers skip the event)', () => {
    const paywall = body('SUBSCRIPTION_REQUIRED');
    markPaywallRefusal(paywall);
    expect(isPaywallRefusal(paywall)).toBe(true);
  });
});
