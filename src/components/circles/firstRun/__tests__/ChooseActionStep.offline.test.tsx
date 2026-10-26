import { act, fireEvent, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import '@/i18n';
import { ChooseActionStep } from '../steps';
import { __resetOfflineWriteForTests, setOfflineWriteExplainer } from '@/lib/offlineWrite';

// OFFLINE = READ-ONLY (owner decision 2026-10-14) — first-run wizard step ①.
// Every choice starts a create: the primary "medication" Button carries
// offlineKind="change", and the three "or start with" rows are aria-disabled and
// explain instead of calling onSelect. "Skip for now" lives in the modal footer
// and stays live (FirstRunWizardModal.test.tsx). Mobile twin:
// FirstRunWizardScreen.handleAction (FirstRunWizardOffline.test.tsx).

const CHOICES = [
  'first-run-primary',
  'first-run-start-with-appointment',
  'first-run-start-with-invite',
  'first-run-start-with-emergency',
];

const explained = vi.fn();

function renderStep() {
  const onSelect = vi.fn();
  render(<ChooseActionStep recipientName="Rosa" isSelfCare={false} onSelect={onSelect} />);
  // The three secondary choices sit behind the "See what else" toggle.
  fireEvent.click(screen.getByTestId('first-run-more-toggle'));
  return { onSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOfflineWriteForTests();
  setOfflineWriteExplainer(explained);
});
afterEach(() => {
  setOfflineWriteExplainer(null);
  act(() => onlineManager.setOnline(true));
});

describe('ChooseActionStep offline', () => {
  it('offline: all four choices are aria-disabled, none calls onSelect, each explains the change sentence', () => {
    const { onSelect } = renderStep();
    act(() => onlineManager.setOnline(false));

    for (const id of CHOICES) {
      const choice = screen.getByTestId(id);
      expect(choice).toHaveAttribute('aria-disabled', 'true');
      __resetOfflineWriteForTests();
      explained.mockClear();
      fireEvent.click(choice);
      expect(explained).toHaveBeenCalledTimes(1);
      expect(explained).toHaveBeenCalledWith("You're offline. Connect to make changes.");
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('control, online: every choice is live and calls onSelect with its action', () => {
    const { onSelect } = renderStep();
    for (const id of CHOICES) {
      expect(screen.getByTestId(id)).not.toHaveAttribute('aria-disabled');
      fireEvent.click(screen.getByTestId(id));
    }
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual([
      'medication',
      'appointment',
      'invite',
      'emergency',
    ]);
    expect(explained).not.toHaveBeenCalled();
  });
});
