import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import i18n from '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { useCircle } from '@/hooks/useCircle';

/**
 * ACCESS-REMOVED STATE AT THE CIRCLE LAYOUT (PK14, parity with mobile CircleDetailScreen).
 * When the circle read is FORBIDDEN / NOT_FOUND, EVERY circle page is replaced by one state
 * with the mobile copy verbatim and a Return-to-circles link; anything else renders the page.
 */

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
