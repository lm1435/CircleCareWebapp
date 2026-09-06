import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router-dom';
import { CircleButton } from '../CircleButton';

describe('CircleButton (spec §4.5, mobile Shell.circleBtn)', () => {
  it('is a 44×44 white circle with the hairline, --shadow-btn and ink glyph', () => {
    render(<CircleButton name="arrow-back" label="Back" />);
    const button = screen.getByRole('button', { name: 'Back' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className.split(' ')).toEqual(
      expect.arrayContaining([
        'w-11',
        'h-11',
        'rounded-full',
        'bg-cream',
        'border',
        'border-line',
        'shadow-btn',
        'inline-flex',
        'items-center',
        'justify-center',
        'text-ink',
        'shrink-0',
        'active:scale-[0.97]',
        'duration-fast',
        'ease-spring',
      ])
    );
  });

  it('names itself for screen readers — the glyph stays decorative', () => {
    render(<CircleButton name="close-outline" label="Close" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('aria-label', 'Close');
    expect(button.querySelector('svg')).not.toBeNull();
    // No nested img role competing with the button's own name.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('drops the elevation and takes the weaker hair when shadow={false}', () => {
    render(<CircleButton name="arrow-back" label="Back" shadow={false} />);
    const cls = screen.getByRole('button', { name: 'Back' }).className.split(' ');
    expect(cls).not.toContain('shadow-btn');
    expect(cls).toContain('border-line-2');
    expect(cls).not.toContain('border-line');
  });

  it('renders the glyph at the row tier (20) by default', () => {
    render(<CircleButton name="arrow-back" label="Back" />);
    const glyph = screen.getByRole('button').firstElementChild as HTMLElement;
    expect(glyph.style.width).toBe('20px');
  });

  it('accepts a larger glyph tier', () => {
    render(<CircleButton name="ellipsis-horizontal" label="More" size="chrome" />);
    const glyph = screen.getByRole('button').firstElementChild as HTMLElement;
    expect(glyph.style.width).toBe('24px');
  });

  it('fires onClick', async () => {
    const onClick = vi.fn();
    render(<CircleButton name="add-outline" label="New" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('becomes a router link when given a destination', () => {
    render(
      <MemoryRouter>
        <CircleButton name="arrow-back" label="Back to circles" to="/circles" />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'Back to circles' });
    expect(link).toHaveAttribute('href', '/circles');
    expect(link).not.toHaveAttribute('type');
    expect(link.className).toContain('rounded-full');
  });

  it('accepts an explicit as={Link}', () => {
    render(
      <MemoryRouter>
        <CircleButton as={Link} to="/help" name="help-circle-outline" label="Help" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
  });
});
