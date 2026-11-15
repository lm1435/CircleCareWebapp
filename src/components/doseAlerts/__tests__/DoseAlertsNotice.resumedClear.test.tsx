import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { DoseAlertsNotice } from '@/components/doseAlerts/DoseAlertsNotice';
import { useCircle } from '@/hooks/useCircle';
import { useAnswerDoseAlerts, useDoseAlerts } from '@/hooks/useDoseAlerts';
import { useDoseAlertsResumedStore } from '@/store/doseAlertsResumedStore';

// "Alerts are on" (role=status) lasts for ONE visit of whichever surface hosts the notice. It used to be
// cleared only when Today unmounted, so on Meds it re-announced on every later visit.

vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useDoseAlerts', () => ({ useDoseAlerts: vi.fn(), useAnswerDoseAlerts: vi.fn() }));

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

beforeEach(async () => {
  // The previous test's unmount scheduled its (deferred) visit-end clear; let it run first.
  await tick();
  vi.clearAllMocks();
  useDoseAlertsResumedStore.setState({ resumed: {} });
  vi.mocked(useCircle).mockReturnValue({ isOwner: true } as unknown as ReturnType<typeof useCircle>);
  vi.mocked(useDoseAlerts).mockReturnValue({
    state: { paused: false, paused_since: null, answer: null, can_answer: true },
    settled: true,
    isError: false,
    refetch: vi.fn(),
  });
  vi.mocked(useAnswerDoseAlerts).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
});

const host = (strict = false) => {
  const tree = (
    <MemoryRouter>
      <DoseAlertsNotice circleId="c1" surface="meds" />
    </MemoryRouter>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
};

describe('DoseAlertsNotice resumed flag lifetime', () => {
  it('P leaving the Meds surface clears the flag, so the next visit does not re-announce', async () => {
    useDoseAlertsResumedStore.getState().markResumed('c1');
    const first = render(host());
    expect(screen.getByTestId('dose-alerts-resumed-meds')).toHaveAttribute('role', 'status');
    first.unmount();
    await tick();
    expect(useDoseAlertsResumedStore.getState().resumed.c1).toBeUndefined();
    render(host());
    expect(screen.queryByTestId('dose-alerts-resumed-meds')).toBeNull();
  });

  it('N StrictMode mount -> cleanup -> mount does NOT wipe a flag set just before the page mounted', async () => {
    useDoseAlertsResumedStore.getState().markResumed('c1');
    render(host(true));
    await tick();
    expect(useDoseAlertsResumedStore.getState().resumed.c1).toBe(true);
    expect(screen.getByTestId('dose-alerts-resumed-meds')).toBeInTheDocument();
  });

  it('N another circle\'s flag is untouched', async () => {
    useDoseAlertsResumedStore.getState().markResumed('c1');
    useDoseAlertsResumedStore.getState().markResumed('c2');
    render(host()).unmount();
    await tick();
    expect(useDoseAlertsResumedStore.getState().resumed.c2).toBe(true);
  });
});
