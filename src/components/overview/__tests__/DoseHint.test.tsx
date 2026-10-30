import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { DoseHint } from '../DoseHint';
import { Analytics } from '@/lib/analytics';

describe('DoseHint (hi-fi HiHint)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Analytics, 'coachingHintShown').mockImplementation(() => {});
    vi.spyOn(Analytics, 'coachingHintDismissed').mockImplementation(() => {});
  });

  it('explains Taken in one sentence, with Taken emphasised', () => {
    render(<DoseHint recipientName="Mom" isSelfCare={false} onGotIt={vi.fn()} />);
    const hint = screen.getByTestId('dose-hint');
    expect(hint).toHaveTextContent('How this works');
    expect(hint).toHaveTextContent(
      'Tap Taken when Mom takes it. Everyone helping sees it right away, so no one gives a second dose.'
    );
    expect(hint.querySelector('strong')).toHaveTextContent('Taken');
  });

  it('self-care wording', () => {
    render(<DoseHint recipientName="Pat" isSelfCare onGotIt={vi.fn()} />);
    expect(screen.getByTestId('dose-hint')).toHaveTextContent('Tap Taken when you take it.');
  });

  it('fires coaching_hint_shown(first_dose) and Got it fires dismissed', async () => {
    const user = userEvent.setup();
    const onGotIt = vi.fn();
    render(<DoseHint recipientName="Mom" isSelfCare={false} onGotIt={onGotIt} />);
    expect(Analytics.coachingHintShown).toHaveBeenCalledWith('first_dose');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(Analytics.coachingHintDismissed).toHaveBeenCalledWith('first_dose');
    expect(onGotIt).toHaveBeenCalledTimes(1);
  });

  it('is a note, never a dialog', () => {
    render(<DoseHint recipientName="Mom" isSelfCare={false} onGotIt={vi.fn()} />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
