import { render, screen } from '@testing-library/react';
import { Eyebrow, type EyebrowColor } from '../Eyebrow';
import { TEXT_CLASS } from '../Text';

describe('Eyebrow (spec §4.5)', () => {
  it('is the eyebrow type variant on a span by default', () => {
    render(<Eyebrow>Medications</Eyebrow>);
    const el = screen.getByText('Medications');
    expect(el.tagName).toBe('SPAN');
    for (const c of TEXT_CLASS.eyebrow.split(' ')) expect(el.className.split(' ')).toContain(c);
  });

  it('renders as another element when asked', () => {
    render(<Eyebrow as="p">Today</Eyebrow>);
    expect(screen.getByText('Today').tagName).toBe('P');
  });

  it('leaves ink-3 to the variant so a caller className can still beat it', () => {
    render(<Eyebrow>Default</Eyebrow>);
    const cls = screen.getByText('Default').className;
    expect(cls).toContain('text-ink-3');
    expect(cls).not.toContain('!');
  });

  const COLORS: Record<Exclude<EyebrowColor, 'ink-3'>, string> = {
    'ink-2': 'text-ink-2!',
    clay: 'text-clay!',
    moss: 'text-moss!',
    dusk: 'text-dusk!',
    terracotta: 'text-terracotta!',
    coral: 'text-coral!',
  };

  it.each(Object.keys(COLORS) as (keyof typeof COLORS)[])(
    '%s wins over the variant colour deterministically',
    (color) => {
      render(<Eyebrow color={color}>Tinted</Eyebrow>);
      // Plain `text-clay` would LOSE: stylesheet order decides, and Tailwind
      // emits the palette in name order, putting text-ink-3 after text-clay.
      expect(screen.getByText('Tinted').className.split(' ')).toContain(COLORS[color]);
    }
  );

  it('renders no dot by default', () => {
    const { container } = render(<Eyebrow>Plain</Eyebrow>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('prepends a 5×5 disc in the same colour when dot is set', () => {
    const { container } = render(
      <Eyebrow color="dusk" dot>
        Appointment
      </Eyebrow>
    );
    const dot = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className.split(' ')).toEqual(
      expect.arrayContaining([
        'inline-block',
        'w-[5px]',
        'h-[5px]',
        'rounded-full',
        'bg-dusk',
        'mr-1.5',
        'align-middle',
      ])
    );
    // The dot leads the label.
    expect(dot.parentElement?.firstElementChild).toBe(dot);
  });

  it('uses ink-3 for the dot at the default colour', () => {
    const { container } = render(<Eyebrow dot>Plain</Eyebrow>);
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).className).toContain(
      'bg-ink-3'
    );
  });

  const DEEP_COLORS: Record<Exclude<EyebrowColor, 'ink-3' | 'ink-2'>, string> = {
    clay: 'text-clay-deep!',
    moss: 'text-moss-deep!',
    dusk: 'text-dusk-deep!',
    terracotta: 'text-terracotta-deep!',
    coral: 'text-coral-deep!',
  };

  it.each(Object.keys(DEEP_COLORS) as (keyof typeof DEEP_COLORS)[])(
    'deep renders the -deep shade for %s',
    (color) => {
      render(
        <Eyebrow color={color} deep>
          Tinted
        </Eyebrow>
      );
      const cls = screen.getByText('Tinted').className.split(' ');
      expect(cls).toContain(DEEP_COLORS[color]);
      expect(cls).not.toContain(`text-${color}!`);
    }
  );

  // ink-3/ink-2 have no `-deep` token — ink is already the "deep" neutral —
  // so `deep` is a no-op for both rather than reaching for a token that
  // doesn't exist.
  it('deep is a no-op for ink-3 and ink-2 (no -deep token exists)', () => {
    render(
      <Eyebrow color="ink-2" deep>
        Neutral
      </Eyebrow>
    );
    expect(screen.getByText('Neutral').className).toContain('text-ink-2!');

    render(
      <Eyebrow deep>Default</Eyebrow>
    );
    const cls = screen.getByText('Default').className;
    expect(cls).toContain('text-ink-3');
    expect(cls).not.toContain('!');
  });

  it('appends className last and forwards attributes', () => {
    render(
      <Eyebrow color="clay" className="mb-1" id="eb">
        Meds
      </Eyebrow>
    );
    const el = screen.getByText('Meds');
    expect(el.className.endsWith('mb-1')).toBe(true);
    expect(el).toHaveAttribute('id', 'eb');
  });
});
