import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Sheet, SheetRow, SheetRowPressable } from '../Sheet';

const surface = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui);
  return container.firstElementChild as HTMLElement;
};

describe('Sheet (spec §4.5)', () => {
  it('renders white, r20, the STRONG hairline and --shadow-sm', () => {
    const cls = surface(<Sheet>rows</Sheet>).className.split(' ');
    expect(cls).toContain('bg-cream');
    expect(cls).toContain('rounded-xl');
    expect(cls).toContain('border-line');
    expect(cls).toContain('shadow-sm');
    // The weaker hair belongs to the row dividers, not the sheet edge.
    expect(cls).not.toContain('border-line-2');
  });

  it('has no padding by default — rows own their inset', () => {
    expect(surface(<Sheet>x</Sheet>).className).not.toMatch(/\bp-\d/);
    expect(surface(<Sheet padding="md">x</Sheet>).className).toContain('p-5');
  });

  it('renders as a list when asked, and appends className', () => {
    const el = surface(<Sheet as="ul" className="mt-4" />);
    expect(el.tagName).toBe('UL');
    expect(el.className.endsWith('mt-4')).toBe(true);
  });

  it('forwards arbitrary attributes', () => {
    render(<Sheet data-testid="sheet" aria-label="Quick access" />);
    expect(screen.getByTestId('sheet')).toHaveAttribute('aria-label', 'Quick access');
  });
});

describe('SheetRow', () => {
  it('is a 44px row with the divider suppressed on the first child', () => {
    const cls = surface(<SheetRow>row</SheetRow>).className.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining([
        'flex',
        'items-center',
        'gap-2.5',
        'px-4',
        'py-3',
        'min-h-[44px]',
        'border-t',
        'border-line-2',
        'first:border-t-0',
      ])
    );
  });

  it('renders as an li inside a list sheet', () => {
    const { container } = render(
      <Sheet as="ul">
        <SheetRow as="li">one</SheetRow>
      </Sheet>
    );
    expect(container.querySelector('ul > li')).not.toBeNull();
  });

  it('is not interactive', () => {
    render(<SheetRow>row</SheetRow>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SheetRowPressable', () => {
  it('is a real button by default and keeps the row metrics', async () => {
    const onClick = vi.fn();
    render(<SheetRowPressable onClick={onClick}>Settings</SheetRowPressable>);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveAttribute('type', 'button');
    const cls = button.className.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining([
        'min-h-[44px]',
        'w-full',
        'text-left',
        'hover:bg-bg-2',
        'active:opacity-60',
        'transition-colors',
        'duration-fast',
      ])
    );
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('becomes a router link when given a destination', () => {
    render(
      <MemoryRouter>
        <SheetRowPressable to="/circles/1/members">Care team</SheetRowPressable>
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'Care team' });
    expect(link).toHaveAttribute('href', '/circles/1/members');
    expect(link).not.toHaveAttribute('type');
    expect(link.className).toContain('min-h-[44px]');
  });

  it('accepts an explicit as={Link}', () => {
    render(
      <MemoryRouter>
        <SheetRowPressable as={Link} to="/help">
          Help
        </SheetRowPressable>
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
  });
});
