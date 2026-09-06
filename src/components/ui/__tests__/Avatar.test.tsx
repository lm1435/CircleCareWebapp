import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar, AVATAR_GRADIENTS, avatarGradientFor } from '../Avatar';

describe('Avatar', () => {
  it('renders a single initial from the first name (mobile parity)', () => {
    render(<Avatar name="Rose Meza" />);
    // Decorative initials — surrounding context names the person.
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses a single initial when only one name token is present', () => {
    render(<Avatar name="Rose" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('falls back to a placeholder glyph with no name', () => {
    render(<Avatar />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders the photo with an accessible label when a URL is provided', () => {
    render(<Avatar name="Rose Meza" photoUrl="https://x.supabase.co/p.jpg" />);
    const img = screen.getByRole('img', { name: 'Rose Meza' });
    expect(img).toHaveAttribute('src', 'https://x.supabase.co/p.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Avatar name="Rose Meza" photoUrl="https://x.supabase.co/broken.jpg" />);
    const img = screen.getByRole('img', { name: 'Rose Meza' });
    fireEvent.error(img);
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    ['xs', 'h-7 w-7', 12],
    ['sm', 'h-9 w-9', 14],
    ['md', 'h-12 w-12', 18],
    ['lg', 'h-16 w-16', 24],
    ['xl', 'h-24 w-24', 36],
  ] as const)('size %s is %s with %ipx initials', (size, dims, fontSize) => {
    render(<Avatar name="Rose Meza" size={size} />);
    const el = screen.getByText('R');
    for (const cls of dims.split(' ')) expect(el.className).toContain(cls);
    expect(el.style.fontSize).toBe(`${fontSize}px`);
    // Arbitrary text-[Npx] utilities are banned outside Text/Button (spec §4.2).
    expect(el.className).not.toMatch(/text-\[/);
  });

  it('paints white 600 initials on the name’s 135° gradient', () => {
    render(<Avatar name="Rose Meza" />);
    const el = screen.getByText('R');
    expect(el.className).toContain('text-cream');
    expect(el.className).toContain('font-semibold');
    // 'R' = 82; 82 % 6 = 4 → the moss-mid → moss-dark pair.
    expect(el.style.backgroundImage).toBe(
      'linear-gradient(135deg, var(--color-moss-mid), var(--color-moss-dark))'
    );
  });

  it('adds a 2px cream ring only when `bordered`', () => {
    const { rerender } = render(<Avatar name="Rose Meza" />);
    expect(screen.getByText('R').className).not.toContain('ring-2');
    rerender(<Avatar name="Rose Meza" bordered />);
    expect(screen.getByText('R').className).toContain('ring-2 ring-cream');
  });

  it('maps the same name to the same gradient deterministically', () => {
    const { container: a } = render(<Avatar name="Ana Reyes" />);
    const { container: b } = render(<Avatar name="Ana Reyes" />);
    const styleOf = (c: HTMLElement) => (c.firstElementChild as HTMLElement).style.backgroundImage;
    expect(styleOf(a)).toBe(styleOf(b));
    expect(styleOf(a)).not.toBe('');
  });
});

describe('avatarGradientFor (mobile parity)', () => {
  it('carries mobile’s six pairs in mobile’s order', () => {
    // mobile/src/components/ui/Avatar.tsx:44-51, expressed through the web
    // tokens holding the identical hex.
    expect(AVATAR_GRADIENTS).toEqual([
      ['var(--color-moss)', 'var(--color-moss-deep)'],
      ['var(--color-coral)', 'var(--color-coral-deep)'],
      ['var(--color-dusk)', 'var(--color-dusk-deep)'],
      ['var(--color-clay)', 'var(--color-clay-ramp-deep)'],
      ['var(--color-moss-mid)', 'var(--color-moss-dark)'],
      ['var(--color-clay-light)', 'var(--color-clay)'],
    ]);
  });

  it('hashes on the FIRST character code modulo six, as mobile does', () => {
    // 'A' = 65 → 65 % 6 = 5; 'B' = 66 → 0; 'a' = 97 → 1.
    expect(avatarGradientFor('Ana')).toBe(AVATAR_GRADIENTS[5]);
    expect(avatarGradientFor('Bea')).toBe(AVATAR_GRADIENTS[0]);
    expect(avatarGradientFor('ana')).toBe(AVATAR_GRADIENTS[1]);
    // Only the first character matters — the rest of the name cannot move it.
    expect(avatarGradientFor('Ana Reyes')).toBe(avatarGradientFor('Alfredo Zamora'));
  });

  it('returns the first pair for an empty or missing name', () => {
    expect(avatarGradientFor()).toBe(AVATAR_GRADIENTS[0]);
    expect(avatarGradientFor('')).toBe(AVATAR_GRADIENTS[0]);
  });
});
