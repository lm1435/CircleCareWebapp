import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { DoseDemoCard } from '@/components/auth/DoseDemoCard';

const welcomeDemoInteracted = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    welcomeDemoInteracted: (...args: unknown[]) => welcomeDemoInteracted(...args),
  },
}));

describe('DoseDemoCard', () => {
  beforeEach(() => welcomeDemoInteracted.mockReset());

  it('starts with the sample dose and Skip / Taken, and no result line', () => {
    render(<DoseDemoCard />);
    expect(screen.getByText('Today · Margaret')).toBeInTheDocument();
    expect(screen.getByText('Metformin')).toBeInTheDocument();
    expect(screen.getByText('8:00 AM · 500 mg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taken' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(welcomeDemoInteracted).not.toHaveBeenCalled();
  });

  it('Taken shows "Taken · You, time", the circle note and Undo, and fires taken/signup', async () => {
    const user = userEvent.setup();
    render(<DoseDemoCard />);
    await user.click(screen.getByRole('button', { name: 'Taken' }));

    expect(screen.getByText(/^Taken · You, .+/)).toBeInTheDocument();
    expect(screen.getByText('Everyone in the circle sees it right away.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(welcomeDemoInteracted).toHaveBeenCalledWith('taken', 'signup');
  });

  it('Skip shows the skipped state, never "Taken at", and fires skip/signup', async () => {
    const user = userEvent.setup();
    render(<DoseDemoCard />);
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.getByText('Skipped · You')).toBeInTheDocument();
    expect(screen.queryByText(/Taken/)).toBeNull();
    expect(screen.queryByText(/Taken at/i)).toBeNull();
    expect(welcomeDemoInteracted).toHaveBeenCalledWith('skip', 'signup');
  });

  it('Undo restores the buttons and fires undo/signup', async () => {
    const user = userEvent.setup();
    render(<DoseDemoCard />);
    await user.click(screen.getByRole('button', { name: 'Taken' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByRole('button', { name: 'Taken' })).toBeInTheDocument();
    expect(screen.queryByText(/^Taken · You/)).toBeNull();
    expect(welcomeDemoInteracted).toHaveBeenLastCalledWith('undo', 'signup');
    expect(welcomeDemoInteracted).toHaveBeenCalledTimes(2);
  });
});
