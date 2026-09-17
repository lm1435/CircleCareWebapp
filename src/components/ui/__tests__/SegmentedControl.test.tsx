import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SegmentedControl } from '../SegmentedControl';
import { parseSource, readSource, staticTexts } from './sourceText';

/**
 * EVERY CONTAINER-QUERY CLASS THE CONTROL RENDERS HAS TO BE SPELLED OUT IN ITS
 * SOURCE, whole, inside one string.
 *
 * Tailwind's scanner reads SOURCE TEXT, not the DOM. `'@max-[320px]:flex-col'`
 * compiles; `` `@max-[${count * 80}px]:flex-col` `` renders the identical class
 * string into the DOM and compiles to NOTHING — so every rendered-class
 * assertion in this file is blind to the one refactor the static maps exist to
 * forbid. This reads the file's string literals (quoted strings and template
 * static runs, comments excluded) and requires each rendered `@max-`/`@min-`
 * token to appear as a whole token in one of them. An interpolated class is
 * split across two static runs and appears whole in neither.
 */
const SEGMENTED_CONTROL = 'src/components/ui/SegmentedControl.tsx';
const LITERAL_CLASS_TOKENS = new Set(
  staticTexts(parseSource(readSource(SEGMENTED_CONTROL), SEGMENTED_CONTROL)).flatMap((text) =>
    text.split(/\s+/).filter(Boolean)
  )
);

function containerQueryTokens(...elements: (Element | null | undefined)[]): string[] {
  return elements
    .flatMap((el) => (el?.className ?? '').split(/\s+/))
    .filter((token) => /^@(?:max|min)-\[/.test(token));
}

/**
 * A container-query class broken open by interpolation or concatenation leaves a
 * FRAGMENT in the source's static text — `@max-[` before a `${…}`, or
 * `@max-[320px]:` before one. "Every rendered class is a literal somewhere" is
 * not enough on its own: the static maps can stay in the file, still spelling
 * each class out whole, while the element is fed an interpolated copy instead.
 * No fragment anywhere is what makes the rendered class the literal one.
 */
const WHOLE_CONTAINER_QUERY_CLASS = /^@(?:max|min)-\[\d+px\]:[^\s:]+$/;

function expectLiteralInSource(tokens: string[]): void {
  // Non-vacuous: a render that carried no container-query classes at all would
  // otherwise pass by having nothing to look up.
  expect(tokens.length).toBeGreaterThan(0);
  for (const token of tokens) {
    expect(LITERAL_CLASS_TOKENS.has(token), `"${token}" is not a literal in SegmentedControl.tsx`).toBe(
      true
    );
  }
  const fragments = [...LITERAL_CLASS_TOKENS].filter(
    (token) => /@(?:max|min)-\[/.test(token) && !WHOLE_CONTAINER_QUERY_CLASS.test(token)
  );
  expect(fragments, 'container-query class built by interpolation in SegmentedControl.tsx').toEqual(
    []
  );
}

const TWO = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const FOUR = [
  { value: 'meds', label: 'Meds' },
  { value: 'appts', label: 'Appointments' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'notes', label: 'Notes' },
];

function Host({
  options = TWO,
  initial = options[0]!.value,
  onChangeSpy,
}: {
  options?: { value: string; label: string }[];
  initial?: string;
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      label="Calendar view"
      options={options}
      value={value}
      onChange={(v) => {
        onChangeSpy?.(v);
        setValue(v);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('renders a labelled tablist with one tab per option', () => {
    render(<Host />);
    const tablist = screen.getByRole('tablist', { name: 'Calendar view' });
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Week', 'Month']);
  });

  it('marks only the selected option aria-selected and keeps it the sole tab stop', () => {
    render(<Host initial="month" />);
    const [week, month] = screen.getAllByRole('tab');
    expect(week).toHaveAttribute('aria-selected', 'false');
    expect(month).toHaveAttribute('aria-selected', 'true');
    expect(week).toHaveAttribute('tabindex', '-1');
    expect(month).toHaveAttribute('tabindex', '0');
  });

  it('places the thumb at index × 100% and sizes it 1/n of the padded track', () => {
    const { rerender } = render(
      <SegmentedControl label="v" options={FOUR} value="meds" onChange={() => {}} />
    );
    const thumb = screen.getByTestId('segmented-thumb');
    expect(thumb.style.transform).toBe('translateX(0%)');
    // jsdom's CSS serializer rewrites `(100% - 8px) / 4` as `0.25 * (100% - 8px)`;
    // accept either spelling of that ONE value rather than pinning its version.
    expect(['calc((100%-8px)/4)', 'calc(0.25*(100%-8px))']).toContain(
      thumb.style.width.replace(/\s+/g, '')
    );

    rerender(<SegmentedControl label="v" options={FOUR} value="tasks" onChange={() => {}} />);
    expect(thumb.style.transform).toBe('translateX(200%)');

    rerender(<SegmentedControl label="v" options={FOUR} value="notes" onChange={() => {}} />);
    expect(thumb.style.transform).toBe('translateX(300%)');
  });

  it('clicking a segment reports its value', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Host onChangeSpy={spy} />);
    await user.click(screen.getByRole('tab', { name: 'Month' }));
    expect(spy).toHaveBeenCalledWith('month');
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowRight / ArrowLeft move the selection and the focus, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<Host options={FOUR} />);
    const tabs = () => screen.getAllByRole('tab');

    tabs()[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[1]).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[0]).toHaveFocus();

    // Wraps backwards off the first segment to the last.
    await user.keyboard('{ArrowLeft}');
    expect(tabs()[3]).toHaveAttribute('aria-selected', 'true');

    // ...and forwards off the last back to the first.
    await user.keyboard('{ArrowRight}');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Home and End jump to the first and last segment', async () => {
    const user = userEvent.setup();
    render(<Host options={FOUR} initial="appts" />);
    const tabs = () => screen.getAllByRole('tab');

    tabs()[1]!.focus();
    await user.keyboard('{End}');
    expect(tabs()[3]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[3]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[0]).toHaveFocus();
  });

  it('carries the STATIC n=4 container-query stacking classes (Tailwind cannot see interpolated ones)', () => {
    render(<SegmentedControl label="v" options={FOUR} value="meds" onChange={() => {}} />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.parentElement?.className).toContain('[container-type:inline-size]');
    expect(tablist.className).toContain('@max-[320px]:flex-col');
    expect(screen.getByTestId('segmented-thumb').className).toContain('@max-[320px]:hidden');
    // Stacked, the hidden thumb can't paint the selection — the active segment does.
    expect(screen.getByRole('tab', { name: 'Meds' }).className).toContain('@max-[320px]:bg-moss');
    expect(screen.getByRole('tab', { name: 'Tasks' }).className).not.toContain('bg-moss');
    // …and each of those is a LITERAL in the source, which is the half of the
    // title the DOM cannot see.
    expectLiteralInSource(
      containerQueryTokens(
        tablist,
        screen.getByTestId('segmented-thumb'),
        ...screen.getAllByRole('tab')
      )
    );
  });

  /**
   * Any container-query padding override, at ANY breakpoint — `@max-[416px]:px-2`,
   * `@max-[320px]:px-1`, or a min-width variant at some other width. Matching the SHAPE
   * rather than the two literal strings is what makes the n=2 leg below able to
   * see a MIS-KEYED entry and not just a missing one.
   */
  const SQUEEZE_VARIANT = /@(?:max|min)-\[\d+px\]:px-[\d.]+/g;

  it('squeezes the n=4 segment padding before it stacks, and only at n=4', () => {
    // The step that keeps `flex-1` honest: a segment cannot shrink below its
    // own longest word + padding, so without these the widest label steals
    // width from its siblings and the fixed-width thumb stops lining up.
    const { rerender } = render(
      <SegmentedControl label="v" options={FOUR} value="meds" onChange={() => {}} />
    );
    const four = screen.getByRole('tab', { name: 'Meds' }).className;
    expect(four).toContain('@max-[416px]:px-2');
    expect(four).toContain('@max-[384px]:px-1');
    // Pinned as an exact, ordered list — not just "contains both". Tailwind
    // orders `@max-*` variants narrowest-LAST so the two entries cascade
    // (416 then 384) instead of fighting; a third entry slipped in, or the pair
    // written the other way round, makes the wider rule win at the narrower
    // width and the squeeze stops happening where it is actually needed.
    expect(four.match(SQUEEZE_VARIANT)).toEqual(['@max-[416px]:px-2', '@max-[384px]:px-1']);

    rerender(<SegmentedControl label="v" options={TWO} value="week" onChange={() => {}} />);
    // Two segments have >30px of slack at every phone width — nothing to squeeze.
    //
    // THE SHAPE MATTERS MORE THAN THE STRING. The old form here asked only that
    // the n=2 class not contain `:px-1`, which is satisfied by every WRONG
    // version of `SQUEEZE_PADDING` that is not literally the n=4 pair: an entry
    // mis-keyed as `2: '@max-[416px]:px-2'` (the plausible typo — the map is
    // keyed by SEGMENT COUNT while its values are keyed by container WIDTH, and
    // 2/3/4 sit right next to 160/240/320/384/416 in the neighbouring maps) sails
    // straight through, and a two-segment control then squeezes its padding to
    // 8px on any phone — for labels that had 30px of room. Asserting the whole
    // SET of container-query padding variants is empty catches the mis-key, the
    // wrong-breakpoint value and the extra entry alike.
    //
    // The regex is proved non-vacuous by the n=4 leg above, which matches two.
    expect(screen.getByRole('tab', { name: 'Week' }).className.match(SQUEEZE_VARIANT)).toBeNull();
    // …and the base padding every segment starts from is untouched, so "no
    // override" cannot be satisfied by there being no padding at all.
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveClass('px-3');
  });

  it('uses the n=2 and n=3 breakpoints for two and three segments', () => {
    const { rerender } = render(
      <SegmentedControl label="v" options={TWO} value="week" onChange={() => {}} />
    );
    expect(screen.getByRole('tablist').className).toContain('@max-[160px]:flex-col');
    const rendered = (): string[] =>
      containerQueryTokens(
        screen.getByRole('tablist'),
        screen.getByTestId('segmented-thumb'),
        ...screen.getAllByRole('tab')
      );
    expectLiteralInSource(rendered());

    rerender(
      <SegmentedControl label="v" options={FOUR.slice(0, 3)} value="meds" onChange={() => {}} />
    );
    expect(screen.getByRole('tablist').className).toContain('@max-[240px]:flex-col');
    expectLiteralInSource(rendered());
  });

  it('falls back to the first segment when `value` matches no option', () => {
    render(<SegmentedControl label="v" options={TWO} value="day" onChange={() => {}} />);
    const [week, month] = screen.getAllByRole('tab');
    expect(week).toHaveAttribute('aria-selected', 'true');
    expect(month).toHaveAttribute('aria-selected', 'false');
    // Never leaves the control out of the tab order entirely.
    expect(week).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('segmented-thumb').style.transform).toBe('translateX(0%)');
  });

  it('carries the moss thumb and the active/inactive label colors', () => {
    render(<Host />);
    const thumb = screen.getByTestId('segmented-thumb');
    expect(thumb.className).toContain('bg-moss');
    expect(thumb.className).toContain('duration-normal');
    expect(thumb.className).toContain('ease-spring');
    expect(screen.getByRole('tab', { name: 'Week' }).className).toContain('text-cream');
    expect(screen.getByRole('tab', { name: 'Month' }).className).toContain('text-ink-2');
  });
});
