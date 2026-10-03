import { render, screen, fireEvent } from '@testing-library/react';
import {
  Avatar,
  AVATAR_COLOR_KEYS,
  AVATAR_GRADIENTS,
  avatarGradientFor,
  avatarGradientForKey,
} from '../Avatar';

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
    const [from, to] = avatarGradientFor('Rose Meza');
    expect(el.style.backgroundImage).toBe(`linear-gradient(135deg, ${from}, ${to})`);
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

describe('avatarGradientFor (web-only whole-name hash, approved 2026-10-02)', () => {
  it('hashes the whole trimmed name (djb2-xor, mod six)', () => {
    // Pinned indices: Ana 5, Bea 1, Maria 3, Margaret 0, Sarah 4.
    expect(avatarGradientFor('Ana')).toBe(AVATAR_GRADIENTS[5]);
    expect(avatarGradientFor('Bea')).toBe(AVATAR_GRADIENTS[1]);
    expect(avatarGradientFor('Maria')).toBe(AVATAR_GRADIENTS[3]);
    expect(avatarGradientFor('  Ana  ')).toBe(avatarGradientFor('Ana'));
  });

  it('separates Margaret Mitchell and Sarah Mitchell (the real regression case)', () => {
    expect(avatarGradientFor('Margaret Mitchell')).toBe(AVATAR_GRADIENTS[0]);
    expect(avatarGradientFor('Sarah Mitchell')).toBe(AVATAR_GRADIENTS[2]);
    expect(avatarGradientFor('Margaret Mitchell')).not.toBe(avatarGradientFor('Sarah Mitchell'));
    expect(avatarGradientFor('Margaret')).toBe(AVATAR_GRADIENTS[0]);
    expect(avatarGradientFor('Sarah')).toBe(AVATAR_GRADIENTS[4]);
  });

  it('a valid colorKey beats the hash', () => {
    expect(avatarGradientFor('Ana', 'dusk')).toBe(avatarGradientForKey('dusk'));
  });

  it('returns the first pair for an empty, blank or missing name', () => {
    expect(avatarGradientFor()).toBe(AVATAR_GRADIENTS[0]);
    expect(avatarGradientFor('')).toBe(AVATAR_GRADIENTS[0]);
    expect(avatarGradientFor('   ')).toBe(AVATAR_GRADIENTS[0]);
  });
});

describe('Avatar colorKey (member colour)', () => {
  it('a chosen palette key wins over the name hash', () => {
    // 'Maria' hashes to gradient 3; the member chose dusk.
    expect(avatarGradientFor('Maria')).not.toEqual(avatarGradientForKey('dusk'));
    expect(avatarGradientFor('Maria', 'dusk')).toEqual(avatarGradientForKey('dusk'));
    render(<Avatar name="Maria" colorKey="dusk" />);
    const [from, to] = avatarGradientForKey('dusk');
    expect(screen.getByText('M').style.backgroundImage).toBe(
      `linear-gradient(135deg, ${from}, ${to})`
    );
  });

  it.each([[null], [undefined], ['#ff0000'], ['teal'], ['']])(
    'falls back to the name hash for colorKey %j',
    (key) => {
      render(<Avatar name="Maria" colorKey={key as string | null | undefined} />);
      const [from, to] = avatarGradientFor('Maria');
      expect(screen.getByText('M').style.backgroundImage).toBe(
        `linear-gradient(135deg, ${from}, ${to})`
      );
    }
  );

  it('keeps the palette index order: key i is gradient i', () => {
    AVATAR_COLOR_KEYS.forEach((key, i) => {
      expect(avatarGradientForKey(key)).toEqual(AVATAR_GRADIENTS[i]);
    });
  });
});
