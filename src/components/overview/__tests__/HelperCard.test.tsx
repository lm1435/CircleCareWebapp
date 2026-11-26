import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { HelperCard } from '../HelperCard';
import { Analytics } from '@/lib/analytics';

function renderCard(over: Partial<React.ComponentProps<typeof HelperCard>> = {}) {
  const onAction = vi.fn();
  const onDismiss = vi.fn();
  render(<HelperCard recipientName="Mom" action="note" bodyKind="quiet" onAction={onAction} onDismiss={onDismiss} {...over} />);
  return { onAction, onDismiss };
}

describe('HelperCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Analytics, 'helperTodayCardShown').mockImplementation(() => {});
    vi.spyOn(Analytics, 'helperTodayCardAction').mockImplementation(() => {});
    vi.spyOn(Analytics, 'helperTodayCardDismissed').mockImplementation(() => {});
  });

  it('POSITIVE: calm copy about the person cared for, one action, a dismiss; events fire', async () => {
    const { onAction, onDismiss } = renderCard();
    const card = screen.getByRole('region', { name: "You're helping with Mom" });
    expect(card).toHaveTextContent('Nothing needs you right now.');
    expect(card).not.toHaveTextContent('hear from us');
    await userEvent.click(screen.getByRole('button', { name: 'Leave a note' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(Analytics.helperTodayCardAction).toHaveBeenCalledWith('note');
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(Analytics.helperTodayCardDismissed).toHaveBeenCalledTimes(1);
  });

  it('B2 POSITIVE: with things coming up the body is the neutral line, never "Nothing needs you"', () => {
    renderCard({ bodyKind: 'busy' });
    expect(screen.getByText('Here is what is coming up for Mom today.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
  });

  it('B2 POSITIVE: busy without a name never renders an empty "for  today"', () => {
    renderCard({ bodyKind: 'busy', recipientName: '' });
    expect(screen.getByText('Here is what is coming up today.')).toBeInTheDocument();
  });

  it('NEGATIVE: view-only offers the care team, never "Leave a note"', () => {
    renderCard({ action: 'care_team' });
    expect(screen.getByRole('button', { name: 'See the care team' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave a note' })).not.toBeInTheDocument();
  });

  it('NEGATIVE: no name never renders an empty "with "', () => {
    renderCard({ recipientName: '' });
    expect(screen.getByRole('heading', { name: "You're on the care team" })).toBeInTheDocument();
  });
});
