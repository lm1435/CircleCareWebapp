import { describe, expect, it, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { apiClient } from '@/lib/api';
import {
  asNeededRecentlyLogged,
  getAsNeededDoses,
  getAsNeededSummaries,
  isAsNeededImmutableError,
  isAsNeededUnscheduledError,
  logAsNeededDose,
  removeAsNeededDose,
} from '../medicationAsNeeded';

// The exact wire contract (docs/plans/prn-api-contract.md): a misspelled URL or
// param is silently ignored by the backend's passthrough schemas, so every
// assertion here is on the literal request.

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;
const C = 'circle-1';
const E = 'med-1';
const REQUEST_ID = '5b1c8c0e-3e1f-4a43-9f43-0d2c1f3d9a11';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('medicationAsNeeded API', () => {
  it('summary: GET /medications/as-needed/summary, unwrapped to the eventId map', async () => {
    get.mockResolvedValue({
      success: true,
      data: { summaries: { [E]: { last_dose: null } } },
    });
    expect(await getAsNeededSummaries(C)).toEqual({ [E]: { last_dose: null } });
    expect(get).toHaveBeenCalledWith(`/circles/${C}/medications/as-needed/summary`);
  });

  it('log: POSTs the body VERBATIM to the medication, client_request_id included', async () => {
    const dose = { id: 'd1', event_id: E };
    post.mockResolvedValue({ success: true, data: { dose, summary: { last_dose: null } } });
    const body = {
      client_request_id: REQUEST_ID,
      note: 'after dinner',
      known_last_dose_id: null,
    };
    const result = await logAsNeededDose(C, E, body);
    expect(post).toHaveBeenCalledWith(`/circles/${C}/medications/${E}/as-needed-doses`, body);
    expect(result.dose).toBe(dose);
    expect(result.replayed).toBe(false);
  });

  it('log: surfaces replayed:true so a re-sent request is recognised, not double-reported', async () => {
    post.mockResolvedValue({
      success: true,
      data: { dose: { id: 'd1' }, summary: { last_dose: null }, replayed: true },
    });
    expect((await logAsNeededDose(C, E, { client_request_id: REQUEST_ID })).replayed).toBe(true);
  });

  it('list: sends includeRemoved as the literal "true" and local-day bounds, never a bare false', async () => {
    get.mockResolvedValue({ success: true, data: { doses: [], hasMore: true } });
    const page = await getAsNeededDoses(C, E, {
      start_date: '2026-06-01',
      end_date: '2026-06-12',
      limit: 30,
      offset: 30,
      includeRemoved: true,
    });
    expect(get).toHaveBeenCalledWith(`/circles/${C}/medications/${E}/as-needed-doses`, {
      params: {
        start_date: '2026-06-01',
        end_date: '2026-06-12',
        limit: 30,
        offset: 30,
        includeRemoved: 'true',
      },
    });
    expect(page.hasMore).toBe(true);

    get.mockClear();
    await getAsNeededDoses(C, E, { includeRemoved: false });
    expect(get.mock.calls[0][1]).toEqual({ params: {} });
  });

  it('remove: POSTs an empty body to /remove', async () => {
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd1' }, summary: { last_dose: null } } });
    await removeAsNeededDose(C, E, 'd1');
    expect(post).toHaveBeenCalledWith(
      `/circles/${C}/medications/${E}/as-needed-doses/d1/remove`,
      {}
    );
  });

  describe('error classification (reads err.error.code)', () => {
    it('409 AS_NEEDED_DOSE_RECENTLY_LOGGED -> who and when', () => {
      const conflict = asNeededRecentlyLogged({
        success: false,
        error: {
          code: 'AS_NEEDED_DOSE_RECENTLY_LOGGED',
          latest_dose: {
            id: 'd9',
            given_at: '2026-06-12T15:59:00Z',
            given_by: { first_name: 'Jennie' },
          },
        },
      });
      expect(conflict).toEqual({
        firstName: 'Jennie',
        givenAt: '2026-06-12T15:59:00Z',
        doseId: 'd9',
      });
    });

    it('a different code is not a coordination prompt', () => {
      expect(asNeededRecentlyLogged({ error: { code: 'VIEW_ONLY' } })).toBeNull();
      expect(asNeededRecentlyLogged(new Error('boom'))).toBeNull();
      expect(asNeededRecentlyLogged(null)).toBeNull();
    });

    it('a conflict with no usable latest_dose still prompts (nameless)', () => {
      expect(asNeededRecentlyLogged({ error: { code: 'AS_NEEDED_DOSE_RECENTLY_LOGGED' } })).toEqual({
        firstName: null,
        givenAt: null,
        doseId: null,
      });
    });

    it('AS_NEEDED_IMMUTABLE / AS_NEEDED_UNSCHEDULED are recognised', () => {
      expect(isAsNeededImmutableError({ error: { code: 'AS_NEEDED_IMMUTABLE' } })).toBe(true);
      expect(isAsNeededUnscheduledError({ error: { code: 'AS_NEEDED_UNSCHEDULED' } })).toBe(true);
      expect(isAsNeededImmutableError({ error: { code: 'AS_NEEDED_UNSCHEDULED' } })).toBe(false);
    });
  });
});

