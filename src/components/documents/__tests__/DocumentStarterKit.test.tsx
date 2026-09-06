import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { DocumentStarterKit } from '../DocumentStarterKit';

describe('DocumentStarterKit', () => {
  it('offers the four starter documents and the escape hatch', () => {
    render(<DocumentStarterKit onPick={vi.fn()} onOther={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Start with these four' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Insurance card\./ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Advance directive\./ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Medication list\./ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Recent lab results\./ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload something else' })).toBeInTheDocument();
  });

  it('picks a row with its category and title, so the upload form arrives preset', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<DocumentStarterKit onPick={onPick} onOther={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Advance directive\./ }));
    expect(onPick).toHaveBeenCalledWith('legal', 'Advance directive');

    await user.click(screen.getByRole('button', { name: /^Recent lab results\./ }));
    expect(onPick).toHaveBeenCalledWith('medical_records', 'Recent lab results');
  });

  it('opens a blank upload from the escape hatch', async () => {
    const user = userEvent.setup();
    const onOther = vi.fn();
    render(<DocumentStarterKit onPick={vi.fn()} onOther={onOther} />);

    await user.click(screen.getByRole('button', { name: 'Upload something else' }));
    expect(onOther).toHaveBeenCalledTimes(1);
  });
});
