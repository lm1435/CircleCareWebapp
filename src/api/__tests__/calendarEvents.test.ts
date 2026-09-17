import { apiClient } from '@/lib/api';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  completeEvent,
  eventFormSchema,
  type CreateEventRequest,
} from '@/api/calendarEvents';

// `@/lib/api` is mocked globally in src/test/setup.ts — apiClient.{post,patch,delete}
// are vi.fn()s. The response interceptor (unwrapping the envelope) is bypassed,
// so we resolve each mock with the already-unwrapped `{ success, data }` shape.
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

const CIRCLE_ID = 'circle-1';
const EVENT_ID = 'event-1';
const event = { id: EVENT_ID, circle_id: CIRCLE_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createEvent', () => {
  it('POSTs to /circles/:cid/events with the body and returns the event', async () => {
    mockPost.mockResolvedValue({ success: true, data: { event } } as never);
    const body: CreateEventRequest = {
      event_type: 'medication',
      title: 'Aspirin',
      scheduled_date: '2026-07-01',
      scheduled_time: '08:00',
    };
    const result = await createEvent(CIRCLE_ID, body);
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events`, body);
    expect(result).toEqual(event);
  });
});

describe('updateEvent', () => {
  it('PATCHes /circles/:cid/events/:eid with a partial body', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { event } } as never);
    await updateEvent(CIRCLE_ID, 'parent-1', { title: 'Renamed' });
    expect(mockPatch).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events/parent-1`, {
      title: 'Renamed',
    });
  });
});

describe('deleteEvent', () => {
  it('DELETEs with no query params when no scope is given', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);
    await deleteEvent(CIRCLE_ID, EVENT_ID);
    expect(mockDelete).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events/${EVENT_ID}`);
  });

  it('DELETEs with deleteScope + scheduledDate query params for scoped deletes', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);
    await deleteEvent(CIRCLE_ID, 'parent-1', {
      deleteScope: 'single',
      scheduledDate: '2026-07-05',
    });
    expect(mockDelete).toHaveBeenCalledWith(
      `/circles/${CIRCLE_ID}/events/parent-1?deleteScope=single&scheduledDate=2026-07-05`
    );
  });

  it('includes only the provided scope param', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);
    await deleteEvent(CIRCLE_ID, 'parent-1', { deleteScope: 'future' });
    expect(mockDelete).toHaveBeenCalledWith(
      `/circles/${CIRCLE_ID}/events/parent-1?deleteScope=future`
    );
  });
});

describe('completeEvent', () => {
  // WHICH OCCURRENCE. `completed_at` lives on a ROW, and a recurring series is
  // addressed by its ROOT, so without a date the server can only stamp the
  // series' FIRST day. The wire shape has to match mobile's exactly — one
  // backend answers both.
  it('POSTs to the /complete endpoint with NO BODY when there is no date', async () => {
    mockPost.mockResolvedValue({ success: true, data: { event } } as never);
    await completeEvent(CIRCLE_ID, EVENT_ID);
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events/${EVENT_ID}/complete`);
    // ONE ARGUMENT, not an explicit `undefined` and not `{}`: the shipped web
    // app sends a body-less POST and the OLD server must keep answering it
    // through the deploy window. `toHaveBeenCalledWith` alone would pass for
    // `post(path, undefined)` too, so the arity is asserted directly.
    expect(mockPost.mock.calls[0]).toHaveLength(1);
  });

  it('sends { scheduled_date } when an occurrence date is given', async () => {
    mockPost.mockResolvedValue({ success: true, data: { event } } as never);
    await completeEvent(CIRCLE_ID, 'parent-1', '2026-08-06');
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events/parent-1/complete`, {
      // snake_case — the key the backend's completeEventSchema reads.
      scheduled_date: '2026-08-06',
    });
  });
});

describe('eventFormSchema (mirrors backend eventSchema)', () => {
  const base = { event_type: 'appointment' as const, title: 'Visit', scheduled_date: '2026-07-01' };

  it('accepts a minimal valid event', () => {
    expect(eventFormSchema.safeParse(base).success).toBe(true);
  });

  it('rejects title over 150 chars and empty title', () => {
    expect(eventFormSchema.safeParse({ ...base, title: 'a'.repeat(151) }).success).toBe(false);
    expect(eventFormSchema.safeParse({ ...base, title: '' }).success).toBe(false);
  });

  it('rejects description over 850 chars', () => {
    expect(eventFormSchema.safeParse({ ...base, description: 'a'.repeat(851) }).success).toBe(false);
  });

  it('rejects an invalid event_type', () => {
    expect(eventFormSchema.safeParse({ ...base, event_type: 'reminder' }).success).toBe(false);
  });

  it('enforces alert_days_before between 1 and 90', () => {
    expect(eventFormSchema.safeParse({ ...base, alert_days_before: 0 }).success).toBe(false);
    expect(eventFormSchema.safeParse({ ...base, alert_days_before: 91 }).success).toBe(false);
    expect(eventFormSchema.safeParse({ ...base, alert_days_before: 30 }).success).toBe(true);
  });

  it('accepts the recurrence presets and cycle:N:M, rejects junk', () => {
    for (const rule of ['daily', 'every_other_day', 'weekly', 'monthly', 'yearly', 'cycle:7:7']) {
      expect(eventFormSchema.safeParse({ ...base, recurrence_rule: rule }).success).toBe(true);
    }
    expect(eventFormSchema.safeParse({ ...base, recurrence_rule: 'fortnightly' }).success).toBe(
      false
    );
    expect(eventFormSchema.safeParse({ ...base, recurrence_rule: 'cycle:x:y' }).success).toBe(false);
  });

  it('rejects assigned_to that is not a uuid (but allows null)', () => {
    expect(eventFormSchema.safeParse({ ...base, assigned_to: 'not-a-uuid' }).success).toBe(false);
    expect(eventFormSchema.safeParse({ ...base, assigned_to: null }).success).toBe(true);
  });
});
