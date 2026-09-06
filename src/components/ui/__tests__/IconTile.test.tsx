import { render, screen } from '@testing-library/react';
import { IconTile, type IconTileSize, type IconTileTone } from '../IconTile';

const tile = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui);
  return container.firstElementChild as HTMLElement;
};

/** The inner <span> the Icon renders carries the pixel box as an inline style. */
const glyphSize = (el: HTMLElement): string =>
  (el.firstElementChild as HTMLElement).style.width;

describe('IconTile (spec §4.5)', () => {
  it('is a 36×36 r10 tile by default', () => {
    const cls = tile(<IconTile tone="clay" name="medkit-outline" />).className.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining([
        'inline-flex',
        'items-center',
        'justify-center',
        'shrink-0',
        'rounded-[10px]',
        'w-9',
        'h-9',
      ])
    );
  });

  const TONES: Record<IconTileTone, [string, string]> = {
    moss: ['bg-moss/15', 'text-moss'],
    clay: ['bg-clay/15', 'text-clay'],
    dusk: ['bg-dusk/15', 'text-dusk'],
    terracotta: ['bg-terracotta/15', 'text-terracotta'],
    coral: ['bg-coral/15', 'text-coral'],
    neutral: ['bg-bg-2', 'text-ink-2'],
  };

  it.each(Object.keys(TONES) as IconTileTone[])('%s tints at 15%% with a full-strength glyph', (t) => {
    const cls = tile(<IconTile tone={t} name="heart-outline" />).className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(TONES[t]));
  });

  const FILLED: Record<IconTileTone, string> = {
    moss: 'bg-moss',
    clay: 'bg-clay',
    dusk: 'bg-dusk',
    terracotta: 'bg-terracotta',
    coral: 'bg-coral',
    neutral: 'bg-ink-2',
  };

  it.each(Object.keys(FILLED) as IconTileTone[])('%s inverts to a cream glyph when filled', (t) => {
    const cls = tile(<IconTile tone={t} name="heart-outline" filled />).className.split(' ');
    expect(cls).toContain(FILLED[t]);
    expect(cls).toContain('text-cream');
    expect(cls).not.toContain(`${FILLED[t]}/15`);
  });

  const SIZES: Record<IconTileSize, [string, string]> = {
    32: ['w-8 h-8', '16px'],
    36: ['w-9 h-9', '20px'],
    40: ['w-10 h-10', '20px'],
    44: ['w-11 h-11', '24px'],
  };

  it.each([32, 36, 40, 44] as IconTileSize[])('%i sizes the box and the glyph tier', (size) => {
    const el = tile(<IconTile tone="dusk" name="calendar-outline" size={size} />);
    const [box, px] = SIZES[size];
    for (const c of box.split(' ')) expect(el.className.split(' ')).toContain(c);
    expect(glyphSize(el)).toBe(px);
  });

  it('renders the glyph decoratively by default', () => {
    const el = tile(<IconTile tone="moss" name="checkbox-outline" />);
    expect(el.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('announces the glyph when given a label', () => {
    render(<IconTile tone="moss" name="checkbox-outline" label="Task" />);
    expect(screen.getByRole('img', { name: 'Task' })).toBeInTheDocument();
  });

  it('appends className last and forwards attributes', () => {
    render(<IconTile tone="clay" name="medkit-outline" className="mr-3" data-testid="tile" />);
    expect(screen.getByTestId('tile').className.endsWith('mr-3')).toBe(true);
  });
});
