import { render, screen } from '@testing-library/react';
import { Text, TEXT_CLASS, type TextVariant } from '../Text';

const EXPECTED_TAG: Record<TextVariant, string> = {
  editorialTitle: 'H1',
  editorialTitleCompact: 'H1',
  display: 'H1',
  h1: 'H1',
  heroName: 'H1',
  authTitle: 'H1',
  h2: 'H2',
  sectionTitle: 'H2',
  h3: 'H3',
  h4: 'H4',
  body: 'P',
  bodyMedium: 'P',
  bodySemiBold: 'P',
  bodyBold: 'P',
  bodyDense: 'P',
  caption: 'P',
  label: 'SPAN',
  button: 'SPAN',
  mono: 'SPAN',
  eyebrow: 'SPAN',
};

const VARIANTS = Object.keys(TEXT_CLASS) as TextVariant[];

describe('Text', () => {
  it('covers every variant in the scale (spec §4.2)', () => {
    expect(VARIANTS).toHaveLength(20);
    expect(Object.keys(EXPECTED_TAG).sort()).toEqual([...VARIANTS].sort());
  });

  it.each(VARIANTS)('%s renders its default semantic tag', (variant) => {
    render(<Text variant={variant}>Hello {variant}</Text>);
    const el = screen.getByText(`Hello ${variant}`);
    expect(el.tagName).toBe(EXPECTED_TAG[variant]);
  });

  it.each(VARIANTS)('%s renders its variant classes and always includes m-0', (variant) => {
    render(<Text variant={variant}>Body {variant}</Text>);
    const el = screen.getByText(`Body ${variant}`);
    for (const token of TEXT_CLASS[variant].split(' ')) {
      expect(el.className.split(' ')).toContain(token);
    }
    expect(el.className.split(' ')).toContain('m-0');
  });

  it('`as` overrides the default tag', () => {
    render(
      <Text variant="h2" as="span">
        Section
      </Text>
    );
    expect(screen.getByText('Section').tagName).toBe('SPAN');
  });

  it('`as` can render a heading for a variant whose default is a span', () => {
    render(
      <Text variant="label" as="h3">
        Field
      </Text>
    );
    expect(screen.getByText('Field').tagName).toBe('H3');
  });

  it('appends className AFTER the variant classes so callers win', () => {
    render(
      <Text variant="caption" className="text-coral-deep">
        Overridden
      </Text>
    );
    const el = screen.getByText('Overridden');
    expect(el.className).toBe(`${TEXT_CLASS.caption} m-0 text-coral-deep`);
    expect(el.className.indexOf('text-coral-deep')).toBeGreaterThan(
      el.className.indexOf('text-ink-2')
    );
  });

  it('forwards arbitrary HTML attributes', () => {
    render(
      <Text variant="body" id="lede" data-testid="lede" aria-label="Lede">
        Paragraph
      </Text>
    );
    const el = screen.getByTestId('lede');
    expect(el.id).toBe('lede');
    expect(el.getAttribute('aria-label')).toBe('Lede');
  });

  it('eyebrow is uppercase, 12px and ink-3', () => {
    expect(TEXT_CLASS.eyebrow).toContain('uppercase');
    expect(TEXT_CLASS.eyebrow).toContain('text-xs');
    expect(TEXT_CLASS.eyebrow).toContain('text-ink-3');
    expect(TEXT_CLASS.eyebrow).toContain('tracking-[1.2px]');
  });

  it('editorialTitle is the 42px / -1.2px editorial head', () => {
    expect(TEXT_CLASS.editorialTitle).toContain('text-[42px]');
    expect(TEXT_CLASS.editorialTitle).toContain('leading-[46px]');
    expect(TEXT_CLASS.editorialTitle).toContain('tracking-[-1.2px]');
    expect(TEXT_CLASS.editorialTitle).toContain('font-semibold');
  });

  // L3: `PageMasthead`'s `compact` prop selects this variant instead of
  // layering an override className onto `editorialTitle` — the override
  // approach silently lost to the base variant's own classes in the compiled
  // stylesheet's cascade order.
  it('editorialTitleCompact is the 32px / -1.2px compact editorial head, distinct from editorialTitle', () => {
    expect(TEXT_CLASS.editorialTitleCompact).toContain('text-[32px]');
    expect(TEXT_CLASS.editorialTitleCompact).toContain('leading-[35px]');
    expect(TEXT_CLASS.editorialTitleCompact).toContain('tracking-[-1.2px]');
    expect(TEXT_CLASS.editorialTitleCompact).toContain('font-semibold');
    expect(TEXT_CLASS.editorialTitleCompact).not.toContain('text-[42px]');
    expect(TEXT_CLASS.editorialTitleCompact).not.toContain('leading-[46px]');
  });

  it('carries no serif face on any variant', () => {
    for (const cls of Object.values(TEXT_CLASS)) {
      expect(cls).not.toContain('font-serif');
      expect(cls).not.toMatch(/\bserif\b/);
    }
  });

  it('button carries no color so the Button variant supplies it', () => {
    expect(TEXT_CLASS.button).not.toMatch(/\btext-ink/);
  });
});
