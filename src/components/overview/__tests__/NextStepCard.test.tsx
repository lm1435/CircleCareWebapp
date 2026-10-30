import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { NextStepCard } from '../NextStepCard';
import { Analytics } from '@/lib/analytics';

function renderCard(over: Partial<React.ComponentProps<typeof NextStepCard>> = {}) {
  const onAction = vi.fn();
  const onNotNow = vi.fn();
  render(
    <NextStepCard
      step="first_med"
      position={1}
      total={3}
      recipientName="Mom"
      isSelfCare={false}
      onAction={onAction}
      onNotNow={onNotNow}
      {...over}
    />
  );
  return { onAction, onNotNow };
}

describe('NextStepCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Analytics, 'nextStepShown').mockImplementation(() => {});
    vi.spyOn(Analytics, 'nextStepTapped').mockImplementation(() => {});
    vi.spyOn(Analytics, 'nextStepDismissed').mockImplementation(() => {});
  });

  it('step 1: eyebrow, title, body and one button (hi-fi HiTodayNew)', () => {
    renderCard();
    const card = screen.getByRole('region', { name: "Add Mom's first medication" });
    expect(card).toHaveTextContent(/next step · 1 of 3/i);
    expect(card).toHaveTextContent('Everyone helping sees it here, with a reminder when it\'s time.');
    expect(screen.getByRole('button', { name: 'Add medication' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('step 2: copy never assumes relatives', () => {
    renderCard({ step: 'invite', position: 2 });
    expect(screen.getByRole('heading', { name: 'Invite someone to help' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Family, a friend or a paid caregiver. They see Mom's meds and get a reminder if a dose isn't marked as taken."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
    expect(screen.getByText(/2 of 3/i)).toBeInTheDocument();
  });

  it('step 3: reminders', () => {
    renderCard({ step: 'reminders', position: 3 });
    expect(screen.getByRole('heading', { name: 'Turn on reminders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on reminders' })).toBeInTheDocument();
  });

  it('self-care wording has no name', () => {
    renderCard({ isSelfCare: true, recipientName: 'Pat' });
    expect(screen.getByRole('heading', { name: 'Add your first medication' })).toBeInTheDocument();
    expect(screen.queryByText(/Pat/)).not.toBeInTheDocument();
  });

  it('the action fires next_step_tapped then runs the host action', async () => {
    const user = userEvent.setup();
    const { onAction } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    expect(Analytics.nextStepTapped).toHaveBeenCalledWith('first_med');
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('Not now fires next_step_dismissed and the host snooze, NOT tapped', async () => {
    const user = userEvent.setup();
    const { onNotNow, onAction } = renderCard({ step: 'invite' });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(Analytics.nextStepDismissed).toHaveBeenCalledWith('invite');
    expect(onNotNow).toHaveBeenCalledTimes(1);
    expect(Analytics.nextStepTapped).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('fires next_step_shown once per step it shows', () => {
    const { rerender } = render(
      <NextStepCard step="first_med" position={1} total={3} recipientName="Mom" isSelfCare={false} onAction={vi.fn()} onNotNow={vi.fn()} />
    );
    expect(Analytics.nextStepShown).toHaveBeenCalledWith('first_med');
    rerender(
      <NextStepCard step="first_med" position={1} total={3} recipientName="Mom" isSelfCare={false} onAction={vi.fn()} onNotNow={vi.fn()} />
    );
    expect(Analytics.nextStepShown).toHaveBeenCalledTimes(1);
    rerender(
      <NextStepCard step="invite" position={2} total={3} recipientName="Mom" isSelfCare={false} onAction={vi.fn()} onNotNow={vi.fn()} />
    );
    expect(Analytics.nextStepShown).toHaveBeenLastCalledWith('invite');
    expect(Analytics.nextStepShown).toHaveBeenCalledTimes(2);
  });

  it('both actions are real buttons, at least 44px tall', () => {
    renderCard();
    for (const b of screen.getAllByRole('button')) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.className).toMatch(/min-h-11|min-h-\[44px\]|h-11/);
    }
  });
});
