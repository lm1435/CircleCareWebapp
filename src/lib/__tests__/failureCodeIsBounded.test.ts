/**
 * MIRROR OF `mobile/src/__tests__/utils/failureCodeIsBounded.test.ts`.
 *
 * `circle_creation_failed.error` is grouped ACROSS PLATFORMS by the admin daily
 * digest (backend/src/services/adminDigestService.ts groups on
 * `properties.error`), so web and mobile must emit the same vocabulary with the
 * same semantics or one bucket becomes two. This file asserts the web copy
 * behaves identically, including the exact fallback list — if someone edits one
 * tree's classifier without the other, the vocabulary assertion below fails.
 *
 * The property is also a PRIVACY boundary: upstream error messages have been
 * observed carrying an email address, a callback URL with an auth code, and a
 * raw JWT. The output is a closed set precisely so none of those can reach it —
 * "send `error.message`" would have fixed the diagnostics and widened the leak
 * in the same change.
 */
import { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { classifyFailureCode, FAILURE_FALLBACK_CODES } from '@/lib/apiErrors';
import { sanitizeErrorText } from '@/lib/analytics';

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

/** What `src/lib/api.ts` actually rejects with: the UNWRAPPED envelope. */
const envelope = (error: Record<string, unknown> | null) => ({ success: false, error });

function axiosWithResponse(status: number, data: unknown, code?: string): AxiosError {
  const response = {
    status,
    statusText: '',
    data,
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, code, config, {}, response);
}

describe('the vocabulary is identical to mobile', () => {
  /**
   * Written out literally rather than derived. The two trees are separate npm
   * projects and cannot import each other, so this list IS the contract — copy
   * any change to `mobile/src/utils/apiError.ts` and back.
   */
  it('matches mobile FAILURE_FALLBACK_CODES exactly, in order', () => {
    expect([...FAILURE_FALLBACK_CODES]).toEqual([
      'timeout',
      'network_error',
      'api_error_no_code',
      'non_json_response',
      'client_error',
      'unknown_error',
    ]);
  });
});

describe('1. the backend CODE wins whenever there is one', () => {
  it.each([
    ['SUBSCRIPTION_REQUIRED'],
    ['VALIDATION_ERROR'],
    ['SERVER_ERROR'],
    ['CIRCLE_ARCHIVED'],
    ['CARE_RECIPIENT_EXISTS'],
  ])('%s survives verbatim', (code) => {
    expect(classifyFailureCode(envelope({ code, message: 'anything' }))).toBe(code);
  });

  it('is read off a raw AxiosError that never went through the interceptor', () => {
    expect(
      classifyFailureCode(axiosWithResponse(402, envelope({ code: 'SUBSCRIPTION_REQUIRED' }))),
    ).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('beats the HTTP status — the code is the more specific fact', () => {
    expect(
      classifyFailureCode(axiosWithResponse(500, envelope({ code: 'DATABASE_ERROR' }))),
    ).toBe('DATABASE_ERROR');
  });
});

describe('2. transport failures, from the codes axios really sets', () => {
  it.each([
    ['ECONNABORTED', 'timeout'],
    ['ETIMEDOUT', 'timeout'],
    ['ERR_NETWORK', 'network_error'],
  ])('%s -> %s', (code, expected) => {
    expect(classifyFailureCode(new AxiosError('failed', code, config, {}))).toBe(expected);
  });

  it('an AbortError is a timeout', () => {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    expect(classifyFailureCode(err)).toBe('timeout');
  });

  it('falls back to the message when the adapter set no code', () => {
    expect(classifyFailureCode(new Error('timeout of 30000ms exceeded'))).toBe('timeout');
    expect(classifyFailureCode(new Error('Network Error'))).toBe('network_error');
    expect(classifyFailureCode(new Error('Network request failed'))).toBe('network_error');
  });
});

describe('3. an HTTP status with no envelope is named, not lost', () => {
  it.each([
    [502, 'http_502'],
    [504, 'http_504'],
    [500, 'http_500'],
    [404, 'http_404'],
    [429, 'http_429'],
  ])('%i -> %s', (status, expected) => {
    expect(classifyFailureCode(axiosWithResponse(status as number, ''))).toBe(expected);
  });

  it('separates an edge failure from an API bug', () => {
    expect(classifyFailureCode(axiosWithResponse(502, ''))).toBe('http_502');
    expect(classifyFailureCode(envelope({ message: 'something broke' }))).toBe('api_error_no_code');
  });

  it('never emits a status it cannot vouch for', () => {
    expect(classifyFailureCode({ response: { status: NaN } })).toBe('unknown_error');
    expect(classifyFailureCode({ response: { status: 99 } })).toBe('unknown_error');
    expect(classifyFailureCode({ response: { status: 600 } })).toBe('unknown_error');
    expect(classifyFailureCode({ response: { status: '502' } })).toBe('unknown_error');
  });

  it('a status is never reclassified by a word in its message', () => {
    const err = axiosWithResponse(504, '');
    err.message = 'Gateway Timeout';
    expect(classifyFailureCode(err)).toBe('http_504');
  });
});

describe('4. an envelope that named no usable code', () => {
  it.each([
    ['no error object', { success: false }],
    ['a null error', envelope(null)],
    ['no code field', envelope({ message: 'Invalid request data' })],
    ['an empty code', envelope({ code: '' })],
    ['a whitespace code', envelope({ code: '   ' })],
    ['a non-string code', envelope({ code: 500 })],
  ])('%s -> api_error_no_code', (_label, err) => {
    expect(classifyFailureCode(err)).toBe('api_error_no_code');
  });

  it.each([
    ['prose', 'Something went wrong while creating the circle'],
    ['an email address', 'jane@example.com already has a circle'],
    ['a URL', 'https://api.example.test/circles?token=abc123'],
    ['a JSON blob', '{"msg":"invalid"}'],
    ['an over-long identifier', 'X'.repeat(200)],
  ])('code that is %s -> api_error_no_code', (_label, code) => {
    expect(classifyFailureCode(envelope({ code }))).toBe('api_error_no_code');
  });
});

describe('5. non-API failures', () => {
  it('an Error we threw ourselves is a client_error, not a network failure', () => {
    expect(classifyFailureCode(new Error('sessionStorage write failed'))).toBe('client_error');
    expect(classifyFailureCode(new TypeError("Cannot read properties of undefined"))).toBe(
      'client_error',
    );
  });

  it('a bare string is a non-JSON response body', () => {
    expect(classifyFailureCode('<html><title>502 Bad Gateway</title></html>')).toBe(
      'non_json_response',
    );
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a whitespace string', '   '],
    ['a number', 42],
    ['a boolean', false],
    ['an empty object', {}],
    ['a non-Error object', { foo: 'bar' }],
    ['an array', []],
  ])('%s -> unknown_error', (_label, err) => {
    expect(classifyFailureCode(err)).toBe('unknown_error');
  });

  it('never throws — it is called from an onError handler', () => {
    const hostile = {
      get error() {
        throw new Error('getter exploded');
      },
    };
    expect(() => classifyFailureCode(hostile)).not.toThrow();
    expect(classifyFailureCode(hostile)).toBe('unknown_error');
  });
});

describe('6. the output is a CLOSED set — no input produces free text', () => {
  const VOCABULARY = new Set<string>(FAILURE_FALLBACK_CODES);
  const isBounded = (value: string) =>
    VOCABULARY.has(value) ||
    /^http_\d{3}$/.test(value) ||
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);

  const HOSTILE_INPUTS: unknown[] = [
    envelope({ code: 'VALIDATION_ERROR', message: 'user jane@example.com is invalid' }),
    envelope({ code: 'failed for jane@example.com' }),
    envelope({ message: 'https://api.example.test/cb#access_token=eyJhbGciOi.eyJzdWIi.SflKxwRJ' }),
    new Error('jane@example.com could not be reached'),
    new Error('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P'),
    'Lisinopril 10mg — save failed for jane@example.com',
    axiosWithResponse(500, { success: false, error: { message: 'jane@example.com' } }),
    { code: 'https://auth.example.test/callback?token=abc123' },
    { message: 'timeout contacting jane@example.com' },
    undefined,
    null,
    { toString: () => 'jane@example.com' },
  ];

  it('every hostile input produces a bounded value with no PII shapes', () => {
    for (const input of HOSTILE_INPUTS) {
      const out = classifyFailureCode(input);
      expect(typeof out).toBe('string');
      expect(isBounded(out)).toBe(true);
      expect(out).not.toContain('@');
      expect(out).not.toContain('://');
      expect(out).not.toContain(' ');
      expect(out).not.toContain('.');
    }
  });
});

/**
 * 6b. WHERE THE GATE ACTUALLY STOPS — the honest boundary. Mirrors mobile's
 * `src/__tests__/utils/failureCodeIsBounded.test.ts`.
 *
 * Every input in the corpus above is rejected because it contains whitespace,
 * an `@`, a `.` or a `://`. None of it establishes that the gate cannot forward
 * PHI, because ANALYTICS_CODE_SHAPE bounds the SHAPE of the value, not its
 * CONTENT: a single token of 1-64 word characters starting with a letter is
 * forwarded verbatim, and a first name, a surname, a drug name and a
 * `first_last` handle are all exactly that shape.
 *
 * Pinned rather than fixed. The gate's real job is to stop FREE TEXT — the
 * wrapped upstream message that once carried a user's email address — and it
 * does that. What makes the remaining space safe is the second half of the
 * argument, which lives in the backend: every `code` in the envelope is an
 * app-authored literal, never interpolated from user input.
 */
describe('6b. the gate bounds SHAPE, not CONTENT', () => {
  it.each([
    ['a medication name', 'Lisinopril'],
    ['a first name', 'Margaret'],
    ['a snake_case identifier', 'jane_doe'],
    ['a hyphenated surname', 'Ortiz-Delgado'],
    ['a 64-char single token', 'A'.repeat(64)],
  ])('%s in error.code is forwarded verbatim', (_label, code) => {
    expect(classifyFailureCode(envelope({ code }))).toBe(code);
  });

  it('the gate rejects the multi-token forms only because of the separator', () => {
    expect(classifyFailureCode(envelope({ code: 'Margaret' }))).toBe('Margaret');
    expect(classifyFailureCode(envelope({ code: 'Margaret Ortiz' }))).toBe('api_error_no_code');
  });
});

describe('7. sanitizeErrorText leaves the vocabulary intact', () => {
  it.each([
    ...FAILURE_FALLBACK_CODES,
    'http_502',
    'SUBSCRIPTION_REQUIRED',
    'CARE_RECIPIENT_INVITE_PENDING',
  ])('%s passes through unchanged', (value) => {
    expect(sanitizeErrorText(value)).toBe(value);
  });
});

/**
 * `classifyFailureCode` is also the `code` on every web `error_occurred` row
 * (hooks/useMedConfirmation and the six mutation-onError helpers). That
 * property reaches PostHog UNSANITIZED — exactly like mobile's `context` — so
 * the classifier, not a sanitizer, is what keeps message text out. Mobile's
 * `medicationConfirmErrorCode` (hooks/useMedicationUndo.ts) makes the same
 * promise with a smaller vocabulary ('unknown' where web says
 * 'unknown_error' / 'client_error'); the invariant under test is identical.
 */
describe('8. the error_occurred `code` never carries message text', () => {
  it('an object with only a PHI-bearing message collapses to unknown_error', () => {
    expect(classifyFailureCode({ message: 'user@example.com failed' })).toBe('unknown_error');
  });

  it('an Error whose message names a person is client_error, not the message', () => {
    expect(classifyFailureCode(new Error('Margaret Ortiz: Lisinopril save failed'))).toBe(
      'client_error'
    );
  });

  it('an envelope whose code is prose collapses to api_error_no_code', () => {
    expect(
      classifyFailureCode({
        success: false,
        error: { code: 'failed for user@example.com', message: 'user@example.com failed' },
      })
    ).toBe('api_error_no_code');
  });

  it.each([
    { message: 'user@example.com failed' },
    new Error('pat@example.com'),
    { success: false, error: { message: 'pat@example.com' } },
    { code: 'ERR_NETWORK', message: 'Network Error for pat@example.com' },
    'pat@example.com',
  ])('%o → a bounded value with no email or whitespace', (input) => {
    const code = classifyFailureCode(input);
    expect(code).not.toMatch(/@|\s/);
    expect(code.length).toBeLessThanOrEqual(64);
  });
});
