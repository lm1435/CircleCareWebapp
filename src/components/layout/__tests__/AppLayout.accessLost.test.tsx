import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import i18n from '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { useCircle } from '@/hooks/useCircle';
import { Analytics } from '@/lib/analytics';
import { __resetEmailLinkLandingForTests } from '@/lib/emailLinkLanding';

/**
 * ACCESS-REMOVED STATE AT THE CIRCLE LAYOUT (PK14, parity with mobile CircleDetailScreen).
 * When the circle read is FORBIDDEN / NOT_FOUND, EVERY circle page is replaced by one state
 * with the mobile copy verbatim and a Return-to-circles link; anything else renders the page.
 */

// StoreReviewBanner owns its own tests; here it would need a QueryClient.
vi.mock('@/components/StoreReviewBanner', () => ({
  StoreReviewBanner: () => null,
}));

vi.mock('@/hooks/useCircles', () => ({
  useCircles: vi.fn(() => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() })),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/components/NeedsCircleSelectionBanner', () => ({ NeedsCircleSelectionBanner: () => null }));
vi.mock('@/components/ai/AIChatModal', () => ({ AIChatModal: () => null }));
vi.mock('@/components/calendar/AddEventModal', () => ({ AddEventModal: () => null }));
vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

function setCircle(over: Record<string, unknown>): void {
  vi.mocked(useCircle).mockReturnValue({
    circle: undefined,
    circleSummary: undefined,
    timezone: null,
    members: [],
    canEdit: false,
    accessLevel: undefined,
    isPremiumCircle: false,
    viewOnly: false,
    readOnly: false,
    isLoading: false,
    isError: true,
    accessLost: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof useCircle>);
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/circles/:circleId" element={<AppLayout />}>
          <Route path="meds" element={<div>Meds page stub</div>} />
          <Route path="notes" element={<div>Notes page stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('AppLayout — email link to a circle', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    sessionStorage.clear();
    __resetEmailLinkLandingForTests();
    spy = vi.spyOn(Analytics, 'emailLinkOpened').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it('no access: the shared removed state ("See your circles"), event landed=false target_found=false', () => {
    setCircle({ accessLost: 'FORBIDDEN' });
    renderAt('/circles/c1?src=weekly_digest');
    const removed = screen.getByTestId('removed-state');
    expect(within(removed).getByRole('heading', { level: 1, name: 'This was removed' })).toHaveFocus();
    expect(within(removed).getByText('You no longer have access to this circle.')).toBeInTheDocument();
    expect(within(removed).getByTestId('removed-state-context')).toHaveTextContent('From your email');
    expect(within(removed).getByRole('link', { name: 'See your circles' })).toHaveAttribute('href', '/circles');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      type: 'weekly_digest',
      appState: 'signed_in',
      landed: false,
      targetFound: false,
    });
  });

  it('after a login the same link reports signed_out', () => {
    sessionStorage.setItem('cc_email_link_login', '/circles/c1/meds?src=weekly_digest');
    setCircle({ accessLost: 'FORBIDDEN' });
    renderAt('/circles/c1/meds?src=weekly_digest');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ appState: 'signed_out' }));
  });

  it('accessible circle with no item target: landed + found', () => {
    setCircle({ circle: { id: 'c1' }, isError: false });
    renderAt('/circles/c1/meds?src=weekly_digest');
    expect(screen.getByText('Meds page stub')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({
      type: 'weekly_digest',
      appState: 'signed_in',
      landed: true,
      targetFound: true,
    });
  });

  it('an item link leaves the report to the page (the layout stays silent while the circle is fine)', () => {
    setCircle({ circle: { id: 'c1' }, isError: false });
    renderAt('/circles/c1/meds?medication=m-1&src=weekly_digest');
    expect(spy).not.toHaveBeenCalled();
  });

  it('without ?src= the old access-removed copy is unchanged and nothing is reported', () => {
    setCircle({ accessLost: 'FORBIDDEN' });
    renderAt('/circles/c1/meds');
    expect(screen.getByRole('heading', { level: 1, name: 'Access removed' })).toBeInTheDocument();
    expect(screen.queryByTestId('removed-state')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AppLayout access-removed state', () => {
  it('FORBIDDEN: heading, message, focus, link; the page is NOT rendered', () => {
    setCircle({ accessLost: 'FORBIDDEN' });
    renderAt('/circles/c1/meds');
    const h1 = screen.getByRole('heading', { level: 1, name: 'Access removed' });
    expect(h1).toHaveFocus();
    expect(
      screen.getByText(
        'You no longer have access to this circle. The owner may have removed you or deleted the circle.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to circles' })).toHaveAttribute('href', '/circles');
    expect(screen.queryByText('Meds page stub')).not.toBeInTheDocument();
  });

  it('NOT_FOUND: the deleted-circle variant', () => {
    setCircle({ accessLost: 'NOT_FOUND' });
    renderAt('/circles/c1/notes');
    expect(screen.getByRole('heading', { level: 1, name: 'Circle not found' })).toHaveFocus();
    expect(screen.getByText('This circle has been deleted or no longer exists.')).toBeInTheDocument();
    expect(screen.queryByText('Notes page stub')).not.toBeInTheDocument();
  });

  it('Spanish copy matches mobile es.json verbatim', async () => {
    await i18n.changeLanguage('es');
    setCircle({ accessLost: 'FORBIDDEN' });
    renderAt('/circles/c1/meds');
    expect(screen.getByRole('heading', { level: 1, name: 'Acceso eliminado' })).toBeInTheDocument();
    expect(
      screen.getByText('Ya no tienes acceso a este círculo. Es posible que el dueño te haya eliminado de él o que haya eliminado el círculo.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a círculos' })).toBeInTheDocument();
  });

  it('a 5xx / network failure (accessLost null) still renders the page, no access state', () => {
    setCircle({ accessLost: null, isError: true });
    renderAt('/circles/c1/meds');
    expect(screen.getByText('Meds page stub')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /Access removed|Circle not found/ })).toBeNull();
  });
});
