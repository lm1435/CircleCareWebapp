import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// A failed write starts the review-prompt quiet period; the silent "Seen by" POST is not a save.
vi.unmock('@/lib/api');
const noteBlocking = vi.fn();
vi.mock('@/lib/reviewMoments', async (orig) => ({
  ...(await orig<typeof import('@/lib/reviewMoments')>()),
  noteReviewBlockingError: () => noteBlocking(),
}));

import { apiClient, resetRefreshState } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';

type Cfg = InternalAxiosRequestConfig;
function failWith(status: number) {
  apiClient.defaults.adapter = vi.fn(async (config: Cfg) => {
    throw new AxiosError('x', AxiosError.ERR_BAD_REQUEST, config, null, {
      data: { success: false, error: { code: 'X', message: 'x' } },
      status,
      statusText: String(status),
      headers: {},
      config,
    });
  });
}

beforeEach(() => {
  noteBlocking.mockClear();
  resetRefreshState();
  tokenAccessor.clear();
});

describe('review-blocking error on failed writes', () => {
  it('positive: a failed 400 write (vitals POST) notes a review-blocking error', async () => {
    failWith(400);
    await expect(apiClient.post('/circles/c1/vitals', { type: 'weight' })).rejects.toBeTruthy();
    expect(noteBlocking).toHaveBeenCalledTimes(1);
  });

  it('negative: a failed 500 seen POST does not note it either', async () => {
    failWith(500);
    await expect(apiClient.post('/circles/c1/care-notes/seen', { notes: [] })).rejects.toBeTruthy();
    expect(noteBlocking).not.toHaveBeenCalled();
  });

  it('negative: a failed 400 seen POST does not note a review-blocking error', async () => {
    failWith(400);
    await expect(apiClient.post('/circles/c1/care-notes/seen', { notes: [] })).rejects.toBeTruthy();
    expect(noteBlocking).not.toHaveBeenCalled();
  });

  it('positive: a failed POST to another care-notes path still notes it', async () => {
    failWith(400);
    await expect(apiClient.post('/circles/c1/care-notes', { body: 'x' })).rejects.toBeTruthy();
    expect(noteBlocking).toHaveBeenCalledTimes(1);
  });
});
