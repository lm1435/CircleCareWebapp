import { classifyFailure, failureContext } from '@/lib/apiErrors';

describe('classifyFailure (mirrors mobile classifyFailure)', () => {
  it.each([
    [{ code: 'ERR_NETWORK' }, 'network'],
    [{ code: 'ECONNABORTED' }, 'timeout'],
    [{ response: { status: 404 } }, 'not_found'],
    [{ response: { status: 409 } }, 'conflict'],
    [{ response: { status: 403 } }, 'forbidden'],
    [{ response: { status: 422 } }, 'validation'],
    [{ response: { status: 503 } }, 'server'],
    [{ success: false, error: { code: 'VALIDATION_ERROR' } }, 'validation'],
    [{ success: false, error: { code: 'ALREADY_MEMBER' } }, 'conflict'],
    [{ success: false, error: { code: 'SUBSCRIPTION_REQUIRED' } }, 'forbidden'],
    [{ success: false, error: { code: 'SOMETHING_NOT_FOUND' } }, 'not_found'],
    [{ success: false, error: { code: 'WEIRD' } }, 'unknown'],
    ['<html>', 'unknown'],
    [null, 'unknown'],
  ])('%j -> %s', (err, kind) => {
    expect(classifyFailure(err)).toBe(kind);
  });
});

describe('failureContext', () => {
  it('carries source, action, error_kind, code and fatal:false only', () => {
    expect(
      failureContext('vitals', 'delete', { success: false, error: { code: 'FORBIDDEN' } })
    ).toEqual({
      source: 'vitals',
      action: 'delete',
      error_kind: 'forbidden',
      code: 'FORBIDDEN',
      fatal: false,
    });
  });
});
