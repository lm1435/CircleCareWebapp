import { render, screen } from '@testing-library/react';
import { Text, TEXT_CLASS, type TextVariant } from '../Text';

const EXPECTED_TAG: Record<TextVariant, string> = {
  pageTitle: 'H1',
  sheetTitle: 'H2',
  pageSubtitle: 'P',
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
  sectionLabel: 'H2',
};

const VARIANTS = Object.keys(TEXT_CLASS) as TextVariant[];

// Audit 2026-11-07 #16: headings wrap balanced (no one-word last line).
describe('Text heading balance', () => {
  const HEADINGS: TextVariant[] = ['pageTitle', 'sheetTitle', 'h2', 'sectionTitle', 'h3', 'h4'];
  for (const variant of HEADINGS) {
    it(`${variant} wraps balanced`, () => {
      expect(TEXT_CLASS[variant].split(' ')).toContain('text-balance');
    });
  }
  it('body text is not balanced', () => {
    expect(TEXT_CLASS.body.split(' ')).not.toContain('text-balance');
  });
});

describe('Text', () => {
  it('covers every variant in the scale (spec §4.2)', () => {
    expect(VARIANTS).toHaveLength(18);
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

  it('pageTitle is the ONE 32/600/38 title with -0.6px tracking, wrapping not truncating', () => {
    const cls = TEXT_CLASS.pageTitle.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining(['text-xl', 'font-semibold', 'leading-[38px]', 'tracking-[-0.6px]', 'text-ink', 'break-words'])
    );
    expect(TEXT_CLASS.pageTitle).not.toMatch(/truncate|line-clamp|overflow-hidden/);
  });

  it('sheetTitle is the 24/600/30 second level', () => {
    const cls = TEXT_CLASS.sheetTitle.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining(['text-lg', 'font-semibold', 'leading-[30px]', 'tracking-[-0.3px]', 'break-words'])
    );
  });

  it('pageSubtitle is 16/500/22 in secondary ink', () => {
    const cls = TEXT_CLASS.pageSubtitle.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['text-md', 'font-medium', 'leading-[22px]', 'text-ink-2']));
  });

  it('the retired title variants are gone', () => {
    for (const name of ['editorialTitle', 'editorialTitleCompact', 'display', 'h1', 'heroName', 'authTitle']) {
      expect(Object.keys(TEXT_CLASS)).not.toContain(name);
    }
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
