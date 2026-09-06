import { apiClient } from '@/lib/api';
import {
  getAdherenceReport,
  getMedicationConfirmations,
  getWeeklyAdherence,
} from '../medicationConfirmations';

// The backend schemas are .passthrough(): a wrong param name silently returns
// unfiltered/default data, so these tests pin the exact URL and param names.
const get = vi.mocked(apiClient.get);

describe('adherence + history wrappers (mirror mobile)', () => {
  beforeEach(() => get.mockReset());

  it('getWeeklyAdherence hits weekly-adherence and returns the body as-is', async () => {
    const body = { taken: 5, scheduled: 7, adherence_rate: 71, start_date: 'a', end_date: 'b', daily_breakdown: [] };
    get.mockResolvedValue({ data: body });
    await expect(getWeeklyAdherence('c1')).resolves.toEqual(body);
    expect(get).toHaveBeenCalledWith('/circles/c1/medications/weekly-adherence');
  });

  it('getMedicationConfirmations passes event_id/start_date/end_date/limit/offset verbatim', async () => {
    get.mockResolvedValue({ data: { confirmations: [{ id: 'x' }], hasMore: true } });
    const params = { event_id: 'e', start_date: '2026-09-01', end_date: '2026-09-05', limit: 50, offset: 0 };
    const page = await getMedicationConfirmations('c1', params);
    expect(get).toHaveBeenCalledWith('/circles/c1/medications/confirmations', { params });
    expect(page).toEqual({ confirmations: [{ id: 'x' }], hasMore: true });
  });

  it('getMedicationConfirmations defaults hasMore to false', async () => {
    get.mockResolvedValue({ data: { confirmations: [] } });
    await expect(getMedicationConfirmations('c1')).resolves.toEqual({ confirmations: [], hasMore: false });
  });

  it('getAdherenceReport sends period as "30d"-style and unwraps .report', async () => {
    get.mockResolvedValue({ data: { report: { period_days: 30 } } });
    await expect(getAdherenceReport('c1')).resolves.toEqual({ period_days: 30 });
    expect(get).toHaveBeenCalledWith('/circles/c1/medications/adherence-report', { params: { period: '30d' } });
    await getAdherenceReport('c1', '7d');
    expect(get).toHaveBeenLastCalledWith('/circles/c1/medications/adherence-report', { params: { period: '7d' } });
  });
});
