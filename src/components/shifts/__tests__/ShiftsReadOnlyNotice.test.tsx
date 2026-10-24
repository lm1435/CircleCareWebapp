import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ShiftsReadOnlyNotice } from '../ShiftsReadOnlyNotice';

// Stacked like mobile: icon + copy on one row, the owner's pill BELOW the copy (never beside it).
describe('ShiftsReadOnlyNotice', () => {
  it('owner: the pill is outside the icon+copy row, flush with the copy', async () => {
    const onRenew = vi.fn();
    render(<ShiftsReadOnlyNotice isOwner onRenew={onRenew} />);
    const card = screen.getByTestId('shifts-readonly-notice');
    const pill = screen.getByTestId('shifts-readonly-renew');
    const text = screen.getByTestId('shifts-readonly-notice-text');
    expect(card.className).toContain('flex-col');
    expect(pill.parentElement).toBe(card);
    expect(text.parentElement?.parentElement).toBe(card);
    expect(pill.className).toContain('self-start');
    expect(pill.className).toContain('ml-[52px]');
    await userEvent.click(pill);
    expect(onRenew).toHaveBeenCalledTimes(1);
  });

  it('member: copy only, no action', () => {
    render(<ShiftsReadOnlyNotice isOwner={false} onRenew={vi.fn()} />);
    expect(screen.getByTestId('shifts-readonly-notice-text')).toHaveTextContent(
      'Shifts are read-only right now.'
    );
    expect(screen.queryByTestId('shifts-readonly-renew')).toBeNull();
  });
});
