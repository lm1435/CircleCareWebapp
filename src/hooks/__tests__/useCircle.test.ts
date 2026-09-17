import { renderHook } from '@testing-library/react';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';
import type { Circle } from '@/api/circles';

// useCircle composes the two existing fetchers — mock them rather than React
// Query so the test asserts the COMBINED shape, not the wiring of either hook.
const useCircleMembers = vi.fn();
const useCircles = vi.fn();

vi.mock('@/hooks/useCircleMembers', () => ({
  useCircleMembers: (id: string) => useCircleMembers(id),
}));
vi.mock('@/hooks/useCircles', () => ({
  useCircles: () => useCircles(),
}));

import { useCircle } from '@/hooks/useCircle';

const CIRCLE_ID = 'circle-1';

const member: CircleMember = {
  id: 'u1',
  email: 'a@b.com',
  first_name: 'A',
  last_name: 'B',
  role: 'owner',
  is_care_recipient: false,
  is_medication_responsible: false,
  joined_at: '2026-01-01T00:00:00Z',
  timezone: 'America/Denver',
};

function detail(overrides: Partial<CircleDetail> = {}): CircleDetail {
  return {
    id: CIRCLE_ID,
    name: 'Mom',
    recipient_name: 'Mom',
    recipient_photo_url: null,
    recipient_dob: null,
    recipient_conditions: null,
    owner_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: 'America/Chicago',
    members: [member],
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...overrides,
  };
}

function summary(overrides: Partial<Circle> = {}): Circle {
  return {
    id: CIRCLE_ID,
    name: 'Mom',
    recipient_name: 'Mom',
    recipient_photo_url: null,
    role: 'owner',
    is_care_recipient: false,
    member_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    read_only: false,
    ...overrides,
  };
}

function mockMembers(over: Record<string, unknown> = {}) {
  useCircleMembers.mockReturnValue({
    data: detail(),
    members: [member],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  });
}

function mockCircles(over: Record<string, unknown> = {}) {
  useCircles.mockReturnValue({
    data: [summary()],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  });
}

describe('useCircle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembers();
    mockCircles();
  });

  it('returns the combined shape: circle, timezone, members, gating', () => {
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.circle?.id).toBe(CIRCLE_ID);
    expect(result.current.timezone).toBe('America/Chicago');
    expect(result.current.members).toEqual([member]);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.accessLevel).toBe('full');
    expect(result.current.viewOnly).toBe(false);
    expect(result.current.readOnly).toBe(false);
    expect(result.current.circleSummary?.id).toBe(CIRCLE_ID);
  });

  // ── timezone: LOADING and "no zone set" are different answers ────────────
  //
  // `timezone` used to be `circle?.care_recipient_timezone || 'America/New_York'`,
  // which collapsed the two: a consumer that computed a DATE from it before the
  // detail query resolved got a New-York-anchored answer and then a different
  // one, firing whatever request that date keyed TWICE (see
  // GettingStartedChecklist.timezoneGate.test.tsx and the e2e spec
  // e2e/unhappy/writes/home-events-requests.spec.ts).
  it('reports null — NOT the New York fallback — while the circle detail is loading', () => {
    mockMembers({ data: undefined, members: [], isLoading: true });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.timezone).toBeNull();
  });

  it('reports null when the circle detail ERRORED (still not an answer)', () => {
    mockMembers({ data: undefined, members: [], isLoading: false, isError: true });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.timezone).toBeNull();
  });

  it('reports the resolved care_recipient_timezone once the detail settles', () => {
    mockMembers({ data: detail({ care_recipient_timezone: 'Asia/Tokyo' }) });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.timezone).toBe('Asia/Tokyo');
  });

  // The ONE case where 'America/New_York' is the correct answer: the circle HAS
  // loaded and genuinely carries no zone. That is a real answer, not a
  // placeholder for an unknown one, so it is a string and not null.
  it('falls back to America/New_York when the LOADED detail has no TZ', () => {
    mockMembers({ data: detail({ care_recipient_timezone: '' }) });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.timezone).toBe('America/New_York');
  });

  it('falls back to America/New_York when the LOADED detail TZ is null', () => {
    mockMembers({ data: detail({ care_recipient_timezone: null as unknown as string }) });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.timezone).toBe('America/New_York');
  });

  it('surfaces read_only from the list response (absent on detail)', () => {
    mockCircles({ data: [summary({ read_only: true })] });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.readOnly).toBe(true);
  });

  it('defaults gating to non-editable while the detail is still loading', () => {
    mockMembers({ data: undefined, members: [], isLoading: true });
    mockCircles({ data: undefined, isLoading: true });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.circle).toBeUndefined();
    expect(result.current.canEdit).toBe(false);
    expect(result.current.viewOnly).toBe(false);
    expect(result.current.readOnly).toBe(false);
    // Was `toBe('America/New_York')` — this test ASSERTED THE BUG. A loading
    // circle has no timezone, and saying it does is what fired a second,
    // differently-anchored request once the real zone arrived.
    expect(result.current.timezone).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('reflects detail loading/error state, not the supplementary list', () => {
    mockMembers({ isError: true, isLoading: false });
    mockCircles({ isError: false, isLoading: true });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.isError).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not match a circleSummary when the id is not in the list', () => {
    mockCircles({ data: [summary({ id: 'other' })] });
    const { result } = renderHook(() => useCircle(CIRCLE_ID));
    expect(result.current.circleSummary).toBeUndefined();
    expect(result.current.readOnly).toBe(false);
  });
});
