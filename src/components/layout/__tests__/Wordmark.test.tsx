import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { Wordmark } from '@/components/layout/Wordmark';

function renderWordmark(props: Parameters<typeof Wordmark>[0] = {}): void {
  render(
    <MemoryRouter>
      <Wordmark {...props} />
    </MemoryRouter>
  );
}

describe('Wordmark (spec §5.1)', () => {
  it('links to the circle picker by default', () => {
    renderWordmark();
    expect(screen.getByRole('link', { name: 'CircleCare' })).toHaveAttribute('href', '/circles');
  });

  it('links to the given target when `to` is supplied', () => {
    renderWordmark({ to: '/circles/c1' });
    expect(screen.getByRole('link', { name: 'CircleCare' })).toHaveAttribute('href', '/circles/c1');
  });

  it('renders the transparent 32x32 brand mark (matches the account avatar) (light + dark) as decorative, never the app-icon tile', () => {
    renderWordmark();
    const imgs = screen.getByRole('link', { name: 'CircleCare' }).querySelectorAll('img');
    expect(Array.from(imgs).map((i) => i.getAttribute('src'))).toEqual([
      '/logo-mark.png',
      '/logo-mark-dark.png',
    ]);
    imgs.forEach((img) => {
      // alt="" — the mark repeats the link's own accessible name.
      expect(img).toHaveAttribute('alt', '');
      expect(img).toHaveClass('h-8', 'w-8');
    });
    // The opaque app icon draws its own dark square on the dark header (owner 2026-11-10).
    expect(screen.getByRole('link', { name: 'CircleCare' }).innerHTML).not.toContain('icon.png');
    expect(screen.getByTestId('wordmark-mark-light')).toHaveClass('cc-logo-mark-light');
    expect(screen.getByTestId('wordmark-mark-dark')).toHaveClass('cc-logo-mark-dark');
  });

  it('globals.css shows exactly one mark per theme', () => {
    const css = readFileSync(join(__dirname, '../../../styles/globals.css'), 'utf8');
    expect(css).toMatch(/\.cc-logo-mark-dark\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/:root\[data-theme='dark'\] \.cc-logo-mark-light\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/:root\[data-theme='dark'\] \.cc-logo-mark-dark\s*\{\s*display:\s*block;/);
  });

  it('hides the word below the sm breakpoint but keeps the accessible name', () => {
    renderWordmark();
    const link = screen.getByRole('link', { name: 'CircleCare' });
    const word = screen.getByText('CircleCare', { selector: 'span' });
    expect(word).toHaveClass('hidden');
    expect(word).toHaveClass('sm:inline');
    // Hidden visually only — the link is still announced at every width.
    expect(link).toHaveAttribute('aria-label', 'CircleCare');
  });

  it('keeps the 44px touch target and never wraps', () => {
    renderWordmark();
    const link = screen.getByRole('link', { name: 'CircleCare' });
    expect(link).toHaveClass('min-h-[44px]', 'items-center', 'no-underline');
  });

  // 2.5.5 Target Size (minor, live-repro'd): below `sm` the word is hidden and
  // only the 28px icon shows, so the link's own `min-w-0` let it shrink to a
  // 36px-wide target — short of the 44px minimum. A floor holds it at 44
  // there; the icon is centered in the extra width rather than left-hugging
  // the box. `sm:min-w-0` lifts the floor once the word is showing again,
  // where the icon+word content already exceeds 44px.
  it('holds a 44px minimum width below `sm`, centering the lone icon in it', () => {
    renderWordmark();
    const link = screen.getByRole('link', { name: 'CircleCare' });
    expect(link).toHaveClass('min-w-[44px]', 'sm:min-w-0');
    expect(link).toHaveClass('justify-center', 'sm:justify-start');
  });

  it('appends caller classes rather than replacing the base ones', () => {
    renderWordmark({ className: 'shrink-0' });
    const link = screen.getByRole('link', { name: 'CircleCare' });
    expect(link).toHaveClass('shrink-0');
    expect(link).toHaveClass('min-h-[44px]');
  });

  // The product name is a proper noun. Translating it would rename the app in
  // Spanish; it is a literal in the JSX, and only the aria-label is i18n'd.
  it('renders the brand name as a literal, not a translation call', () => {
    const src = readFileSync(join(__dirname, '..', 'Wordmark.tsx'), 'utf8');
    expect(src).toMatch(/>\s*CircleCare\s*</);
    expect(src).not.toMatch(/t\('appName'\)\s*}?\s*<\/Text>/);
  });

  it('draws no SVG by hand (spec §4.3: glyphs come from <Icon>)', () => {
    const src = readFileSync(join(__dirname, '..', 'Wordmark.tsx'), 'utf8');
    expect(src).not.toMatch(/<svg/);
  });
});
