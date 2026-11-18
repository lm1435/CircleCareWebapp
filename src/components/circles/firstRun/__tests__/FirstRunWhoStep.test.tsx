import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { clearFirstRun, peekFirstRunDraft } from '@/lib/firstRunDraft';
import { resetFirstRunFunnelForTests } from '@/lib/firstRunFunnel';
import { FirstRunWhoStep } from '../FirstRunWhoStep';

// First run v2, screen 2: "Who are you caring for?". Positive and negative cases.

let submitted: ReturnType<typeof vi.spyOn>;
let viewed: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clearFirstRun();
  resetFirstRunFunnelForTests();
  submitted = vi.spyOn(Analytics, 'firstRunRecipientSubmitted').mockImplementation(() => {});
  viewed = vi.spyOn(Analytics, 'firstRunRecipientViewed').mockImplementation(() => {});
  vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
  vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function renderStep() {
  const onDone = vi.fn();
  render(<FirstRunWhoStep entry="web" onDone={onDone} />);
  return { onDone };
}

describe('FirstRunWhoStep', () => {
  it('POSITIVE: shows the question, the field and both answers; reports viewed with entry web', () => {
    renderStep();
    expect(screen.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Their name or what you call them/)).toHaveAttribute('placeholder', 'e.g., Mom, Dad');
    expect(screen.getByRole('button', { name: "It's for me" })).toBeEnabled();
    expect(viewed).toHaveBeenCalledWith('web');
  });

  it('POSITIVE: a name previews the circle, continues and is kept in memory; the event carries only is_self_care', async () => {
    const { onDone } = renderStep();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^Their name/), 'Rosa');
    expect(screen.getByTestId('first-run-who-preview')).toHaveTextContent("Rosa's circle");
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onDone).toHaveBeenCalledWith({ isSelfCare: false });
    expect(peekFirstRunDraft()).toMatchObject({ recipientName: 'Rosa', isSelfCare: false });
    expect(submitted).toHaveBeenCalledWith(false);
  });

  it('POSITIVE: "It\'s for me" continues as self-care with no name', async () => {
    const { onDone } = renderStep();
    await userEvent.setup().click(screen.getByRole('button', { name: "It's for me" }));
    expect(onDone).toHaveBeenCalledWith({ isSelfCare: true });
    expect(peekFirstRunDraft()).toMatchObject({ recipientName: null, isSelfCare: true });
    expect(submitted).toHaveBeenCalledWith(true);
  });

  it('NEGATIVE: an empty name blocks (Continue disabled, Enter does nothing)', () => {
    const { onDone } = renderStep();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.submit(screen.getByTestId('first-run-who'));
    expect(onDone).not.toHaveBeenCalled();
    expect(peekFirstRunDraft()).toBeNull();
  });

  it('NEGATIVE: a whitespace-only name blocks too, and shows no preview', async () => {
    const { onDone } = renderStep();
    await userEvent.setup().type(screen.getByLabelText(/^Their name/), '   ');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.queryByTestId('first-run-who-preview')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByTestId('first-run-who'));
    expect(onDone).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('NEGATIVE: the name never reaches analytics', async () => {
    renderStep();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^Their name/), 'Rosa');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    const all = JSON.stringify([...submitted.mock.calls, ...viewed.mock.calls]);
    expect(all).not.toContain('Rosa');
  });
});
