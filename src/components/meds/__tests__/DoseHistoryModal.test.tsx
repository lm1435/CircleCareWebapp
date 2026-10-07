// The per-medication dose log: day grouping in the RECIPIENT's zone, tombstoned
// rows struck through, remove-a-dose with confirm (any editor), view-only
// sees no Remove.

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { DoseHistoryModal } from '../DoseHistoryModal';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;
const C = 'circle-1';
const E = 'prn-1';
const NOW = new Date('2026-06-12T16:00:00Z');

const dose = (id: string, given_at: string, over: Record<string, unknown> = {}) => ({
  id,
  event_id: E,
  circle_id: C,
  given_at,
  given_by: 'u1',
  note: null,
  client_request_id: `req-${id}`,
  created_at: given_at,
  removed_at: null,
  removed_by: null,
  given_by_user: { id: 'u1', first_name: 'Jennie', last_name: 'Ruiz' },
  removed_by_user: null,
  ...over,
});

function renderModal(opts: { canEdit?: boolean; timezone?: string; doses?: unknown[] } = {}) {
  const doses = opts.doses ?? [
    dose('d1', '2026-06-12T13:15:00Z', { note: 'after lunch' }),
    dose('d2', '2026-06-11T20:00:00Z', {
      removed_at: '2026-06-11T21:00:00Z',
      removed_by: 'u2',
      removed_by_user: { id: 'u2', first_name: 'Luis', last_name: null },
    }),
  ];
  get.mockResolvedValue({ success: true, data: { doses, hasMore: false } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DoseHistoryModal
          circleId={C}
          eventId={E}
          name="Ibuprofen"
          timezone={opts.timezone ?? 'America/New_York'}
          canEdit={opts.canEdit ?? true}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/New_York',
  } as Intl.ResolvedDateTimeFormatOptions);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('DoseHistoryModal', () => {
  it('asks for removed doses too, and lists live and removed rows newest first', async () => {
    renderModal();
    expect(await screen.findAllByTestId('dose-row')).toHaveLength(2);
    expect(get.mock.calls[0][1].params.includeRemoved).toBe('true');
    const [live, removed] = screen.getAllByTestId('dose-row');
    expect(live).toHaveAttribute('data-removed', 'false');
    expect(live).toHaveTextContent('9:15 AM');
    expect(live).toHaveTextContent('Given by Jennie Ruiz');
    expect(live).toHaveTextContent('after lunch');
    expect(removed).toHaveAttribute('data-removed', 'true');
    expect(removed).toHaveTextContent('Removed by Luis');
    // A removed dose offers no second removal.
    expect(within(removed).queryByRole('button')).toBeNull();
  });

  it('groups by the RECIPIENT\'s day: 11:30 PM New York the night before is "Yesterday", not today', async () => {
    renderModal({ doses: [dose('d3', '2026-06-12T03:30:00Z')] });
    expect(await screen.findByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByTestId('dose-row')).toHaveTextContent('11:30 PM');
  });

  it('Auckland recipient, New York viewer: the dose is on THEIR Friday at THEIR clock', async () => {
    // 2026-06-12T03:30Z = 3:30 PM Jun 12 in Auckland (NZST, UTC+12).
    renderModal({ timezone: 'Pacific/Auckland', doses: [dose('d4', '2026-06-12T03:30:00Z')] });
    const row = await screen.findByTestId('dose-row');
    expect(row).toHaveTextContent('3:30 PM (Auckland)');
    // "Now" is already June 13 in Auckland, so their June 12 is "Yesterday" —
    // for a New York reader (still June 12) it would read "Today".
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
  });

  it('remove: confirm names the time and who, then POSTs /remove and toasts', async () => {
    renderModal();
    post.mockResolvedValue({
      success: true,
      data: { dose: dose('d1', '2026-06-12T13:15:00Z'), summary: { last_dose: null } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove this dose, logged at 9:15 AM/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove this dose?' });
    expect(confirm).toHaveTextContent(
      'Remove the dose logged at 9:15 AM by Jennie Ruiz? Everyone will be told it was removed.'
    );
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/circles/${C}/medications/${E}/as-needed-doses/d1/remove`, {})
    );
    expect(await screen.findByText('Dose removed')).toBeInTheDocument();
  });

  it('cancelling the confirm sends nothing and returns to the log', async () => {
    renderModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove this dose, logged at/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove this dose?' });
    await user.click(within(confirm).getAllByRole('button', { name: 'Cancel' })[0]);
    expect(post).not.toHaveBeenCalled();
    expect(await screen.findAllByTestId('dose-row')).toHaveLength(2);
  });

  it('ALREADY_REMOVED by someone else: calm sentence, not "couldn\'t remove"', async () => {
    renderModal();
    post.mockRejectedValue({ success: false, error: { code: 'ALREADY_REMOVED' } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove this dose, logged at/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Remove this dose?' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('This dose was already removed.')).toBeInTheDocument();
  });

  it('FALSIFIER — view-only sees the log and NO Remove', async () => {
    renderModal({ canEdit: false });
    expect(await screen.findAllByTestId('dose-row')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Remove this dose/ })).toBeNull();
  });

  it('empty log: "No doses logged yet"', async () => {
    renderModal({ doses: [] });
    expect(await screen.findByTestId('dose-history-empty')).toHaveTextContent('No doses logged yet');
  });

  it('Spanish: "Dada por", "Quitada por", Remove in Spanish', async () => {
    await i18n.changeLanguage('es');
    renderModal();
    const [live, removed] = await screen.findAllByTestId('dose-row');
    expect(live).toHaveTextContent('Dada por Jennie Ruiz');
    expect(removed).toHaveTextContent('Quitada por Luis');
    expect(within(live).getByRole('button', { name: /Quitar esta dosis, registrada a las 9:15 a\. m\./ })).toBeInTheDocument();
  });
});
