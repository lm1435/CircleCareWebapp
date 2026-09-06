import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card, type CardVariant } from '../Card';

const surface = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui);
  return container.firstElementChild as HTMLElement;
};

describe('Card (spec §4.5)', () => {
  it('defaults to the elevated surface: white, r20, --shadow-md, no border', () => {
    const cls = surface(<Card>body</Card>).className;
    expect(cls).toContain('bg-cream');
    expect(cls).toContain('rounded-xl');
    expect(cls).toContain('shadow-md');
    expect(cls).not.toMatch(/\bborder\b/);
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  const VARIANTS: Record<CardVariant, string> = {
    elevated: 'bg-cream rounded-xl shadow-md',
    outlined: 'bg-cream rounded-xl border border-line-2',
    filled: 'bg-bg-2 rounded-xl',
    accent: 'bg-clay-soft rounded-xl border border-clay-sand shadow-warm',
    flat: 'bg-bg rounded-lg',
  };

  it.each(Object.keys(VARIANTS) as CardVariant[])('%s renders its exact surface classes', (v) => {
    const cls = surface(<Card variant={v}>x</Card>).className.split(' ');
    for (const c of VARIANTS[v].split(' ')) expect(cls).toContain(c);
  });

  it('uses r20 (rounded-xl), never the old r24, on every card-shaped variant', () => {
    for (const v of ['elevated', 'outlined', 'filled', 'accent'] as CardVariant[]) {
      expect(surface(<Card variant={v}>x</Card>).className).not.toContain('rounded-2xl');
    }
  });

  it('pads 20 by default and honours the padding scale', () => {
    expect(surface(<Card>x</Card>).className).toContain('p-5');
    expect(surface(<Card padding="sm">x</Card>).className).toContain('p-4');
    expect(surface(<Card padding="lg">x</Card>).className).toContain('p-6');
    expect(surface(<Card padding="none">x</Card>).className).not.toMatch(/\bp-\d/);
  });

  it('drops its padding class when the caller supplies one', () => {
    // Not cosmetic: Tailwind emits p-4 BEFORE p-5, so leaving both on the
    // element would silently keep 20px on `<Card className="p-4">`.
    const cls = surface(<Card className="mt-6 p-4">x</Card>).className;
    expect(cls).toContain('p-4');
    expect(cls).not.toContain('p-5');
    expect(cls).toContain('mt-6');
  });

  it.each(['p-6', 'p-8', 'sm:p-10'])('%s in className suppresses the default padding', (p) => {
    expect(surface(<Card className={`mx-auto ${p}`}>x</Card>).className).not.toContain('p-5');
  });

  it('keeps its default padding when the caller only sets directional padding', () => {
    expect(surface(<Card className="px-2 pt-3">x</Card>).className).toContain('p-5');
  });

  it('appends className last', () => {
    expect(surface(<Card className="print-card">x</Card>).className.endsWith('print-card')).toBe(
      true
    );
  });

  it('renders a real button with press affordances when given onPress', async () => {
    const onPress = vi.fn();
    render(<Card onPress={onPress}>Tap me</Card>);
    const button = screen.getByRole('button', { name: 'Tap me' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('active:scale-[0.98]');
    expect(button.className).toContain('duration-fast');
    expect(button.className).toContain('text-left');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('passes aria-label through to the pressable surface', () => {
    render(
      <Card onPress={() => {}} aria-label="Open note">
        <span>note body</span>
      </Card>
    );
    expect(screen.getByRole('button', { name: 'Open note' })).toBeInTheDocument();
  });

  it('is a plain div with no press classes when not pressable', () => {
    const el = surface(<Card>x</Card>);
    expect(el.tagName).toBe('DIV');
    expect(el.className).not.toContain('cursor-pointer');
  });

  it.each(['li', 'section', 'article'] as const)('renders as a %s when asked', (tag) => {
    expect(surface(<Card as={tag}>x</Card>).tagName).toBe(tag.toUpperCase());
  });

  it('forwards arbitrary attributes', () => {
    render(
      <Card data-testid="card" role="alert" id="c1">
        x
      </Card>
    );
    const el = screen.getByTestId('card');
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveAttribute('id', 'c1');
  });
});
