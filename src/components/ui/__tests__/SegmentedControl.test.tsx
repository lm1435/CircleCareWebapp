import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SegmentedControl } from '../SegmentedControl';

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
  });

  it('uses the n=2 and n=3 breakpoints for two and three segments', () => {
    const { rerender } = render(
      <SegmentedControl label="v" options={TWO} value="week" onChange={() => {}} />
    );
    expect(screen.getByRole('tablist').className).toContain('@max-[160px]:flex-col');

    rerender(
      <SegmentedControl label="v" options={FOUR.slice(0, 3)} value="meds" onChange={() => {}} />
    );
    expect(screen.getByRole('tablist').className).toContain('@max-[240px]:flex-col');
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
