import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { TimeChips } from '../TimeChips';
import { PickerTile } from '@/components/ui/PickerTile';
import {
  CHOICE_TILE_BOX,
  CHOICE_TILE_LABEL,
  choiceTileClass,
  choiceTileSubClass,
} from '@/components/ui/inputStyles';
import { ChipSelect } from '@/components/ui/ChipSelect';

// The lazy TimePickerPanel reads the hour cycle through React Query (useHourCycle -> useQuery). This suite renders
// without a QueryClientProvider, so under full-suite load the panel's late mount threw "No QueryClient set" as an
// unhandled error (exit 1 with every test green). The real app always has a client; pin the cycle here.
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// The medication form's "What time?" row (owner 2026-11-10, build 11 "A2"; layout owner 1.4.0, mobile
// StackedChoice parity): TIME-FIRST chips ("8:00 AM / Morning"), a custom time as its own chip ("2:30 PM /
// Other"), then "Other…" drawn as the same tile, in ONE content-sized wrapping row, whatever is selected.
// Multi-select (checkboxes) on a new medication, one answer (radios) on an edit. jsdom has no layout (memory:
// jsdom geometry blind), so this pins the STRUCTURE and the shared classes; the Playwright specs measure the
// real row at phone width.

/** The "Other…" control exactly as AddEventModal draws it (a PickerTile in the chip's tile box). */
function OtherTile({ disabled = false }: { disabled?: boolean }) {
  return (
    <PickerTile
      kind="time"
      inputId="scheduled_time"
      inputLabel="Other time"
      testId="time-chip-other"
      value=""
      disabled={disabled}
      onChange={vi.fn()}
      className={`${choiceTileClass(false)}${disabled ? ' cursor-default opacity-50' : ' cursor-pointer'}`}
    >
      <span className={CHOICE_TILE_LABEL}>Other…</span>
      <span aria-hidden="true" className={`${choiceTileSubClass(false)} invisible`} data-testid="other-spacer">
        {' '}
      </span>
    </PickerTile>
  );
}

function renderChips(
  values: string[] = [],
  opts: { multiple?: boolean; full?: boolean; withOther?: boolean } = {}
) {
  const onToggle = vi.fn();
  const onChangeCustom = vi.fn();
  const onRemoveCustom = vi.fn();
  const { multiple = true, full = false, withOther = true } = opts;
  const el = (v: string[]) => (
    <TimeChips
      id="time-chips"
      values={v}
      hourCycle="12h"
      multiple={multiple}
      full={full}
      onToggle={onToggle}
      onChangeCustom={onChangeCustom}
      onRemoveCustom={onRemoveCustom}
      other={withOther ? <OtherTile disabled={full} /> : undefined}
    />
  );
  const r = render(el(values));
  return { onToggle, onChangeCustom, onRemoveCustom, rerender: (v: string[]) => r.rerender(el(v)) };
}

const chipRole = (multiple: boolean) => (multiple ? 'checkbox' : 'radio');

/** The arrangement: every class and inline style on the row, the group and each tile's box. */
function arrangement(multiple = true) {
  const row = screen.getByTestId('time-chip-row');
  const group = document.getElementById('time-chips') as HTMLElement;
  const tiles = [...within(row).getAllByRole(chipRole(multiple)), screen.getByTestId('time-chip-other')];
  return {
    row: [row.className, row.getAttribute('style')],
    group: [group.className, group.getAttribute('style')],
    tiles: tiles.map((t) => [
      t.className.replace(/bg-ink text-cream border-ink|border-line-strong text-ink hover:bg-bg-2/, ''),
      t.getAttribute('style'),
    ]),
  };
}

describe('TimeChips row', () => {
  it('one wrapping flex row: the group is display:contents so its chips and Other… share it; no grid', () => {
    renderChips();
    const row = screen.getByTestId('time-chip-row');
    expect(row).toHaveClass('flex', 'flex-wrap', 'gap-2');
    expect(row).not.toHaveClass('grid');
    expect(row).not.toHaveAttribute('data-columns');
    const group = screen.getByRole('group', { name: 'Common dose times' });
    expect(group).toHaveClass('contents');
    const other = screen.getByTestId('time-chip-other');
    // Outside the group in the DOM: the group owns the chips only.
    expect(group).not.toContainElement(other);
    expect(row).toContainElement(other);
  });

  it('time first: the time is the large line (tabular numerals), the day part small under it', () => {
    renderChips();
    // The two lines are separated in the name ("8:00 AM Morning"), never run together.
    const morning = screen.getByRole('checkbox', { name: '8:00 AM Morning' });
    const [time, label] = Array.from(morning.querySelectorAll('span'));
    expect([time.textContent, label.textContent]).toEqual(['8:00 AM', 'Morning']);
    expect(time).toHaveClass(...CHOICE_TILE_LABEL.split(' '), 'tabular-nums');
    expect(label.className).toBe(choiceTileSubClass(false));
    expect(
      within(screen.getByRole('group')).getAllByRole('checkbox').map((c) => c.textContent)
    ).toEqual(['8:00 AM Morning', '12:00 PM Midday', '6:00 PM Evening', '9:00 PM Bedtime']);
  });

  it('a custom time is its own chip after the four ("2:30 PM / Other"), lit, OUTSIDE the preset group, before Other…', () => {
    renderChips(['08:00', '14:30']);
    const group = screen.getByRole('group', { name: 'Common dose times' });
    // The group holds the four presets only (a custom chip is not a toggle: Fix13).
    expect(within(group).getAllByRole('checkbox')).toHaveLength(4);
    const custom = screen.getByTestId('time-chip-custom');
    const box = screen.getByTestId('time-chip-custom-box');
    expect(group).not.toContainElement(custom);
    expect(box).toContainElement(custom);
    expect(custom).not.toHaveAttribute('role');
    expect(custom).toHaveAccessibleName(/^2:30 PM\s*Other$/);
    // Row order: the presets (inside the contents group), then the custom box, then Other….
    const row = screen.getByTestId('time-chip-row');
    // (Other…'s hidden native input sits beside its tile: it is not a tile.)
    expect(Array.from(row.children).filter((el) => el.tagName !== 'INPUT')).toEqual([
      group,
      box,
      screen.getByTestId('time-chip-other'),
    ]);
    // Lit like a chosen chip: the dark fill on the box, the same rounded tile edge; the lines are a chip's.
    expect(box).toHaveClass('rounded-2xl', 'border', 'bg-ink', 'text-cream', 'border-ink', 'max-w-full');
    expect(custom).toHaveClass('min-h-[48px]', 'min-w-[44px]', 'flex-col', 'justify-center');
    const [time, label] = Array.from(custom.querySelectorAll('span'));
    expect(time).toHaveClass(...CHOICE_TILE_LABEL.split(' '), 'tabular-nums');
    expect(label.className).toBe(choiceTileSubClass(true));
    // Several customs in time order; a repeated value is one chip.
    renderChips(['22:15', '06:05', '22:15']);
    const customs = screen.getAllByTestId('time-chip-custom').slice(1);
    expect(customs.map((c) => c.textContent)).toEqual(['6:05 AM Other', '10:15 PM Other']);
  });

  it('a custom chip is ITS dose\'s time picker: a pick reports (slot, next); its "×" reports (slot, time)', async () => {
    const { onChangeCustom, onRemoveCustom, onToggle } = renderChips(['08:00', '14:30', '', '19:05']);
    const user = userEvent.setup();
    const [first, second] = screen.getAllByTestId('time-chip-custom');
    // The body opens the picker (it is not a toggle).
    expect(first).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(onToggle).not.toHaveBeenCalled();
    await user.click(first);
    // Each custom chip's hidden input carries ITS time and names it; a change reports that slot.
    const input = screen.getByLabelText('Change 2:30 PM dose time', { selector: 'input' });
    expect(input).toHaveValue('14:30');
    expect(input).toHaveAttribute('id', 'time-chips-custom-1');
    fireEvent.change(input, { target: { value: '15:00' } });
    expect(onChangeCustom).toHaveBeenLastCalledWith(1, '15:00');
    fireEvent.change(screen.getByLabelText('Change 7:05 PM dose time', { selector: 'input' }), {
      target: { value: '19:20' },
    });
    expect(onChangeCustom).toHaveBeenLastCalledWith(3, '19:20');
    expect(second).toHaveAccessibleName(/^7:05 PM\s*Other$/);
    // The "×": its own 44px button, named for the dose; it reports the slot and the time.
    const remove = screen.getByRole('button', { name: 'Remove 7:05 PM dose' });
    expect(remove).toHaveClass('h-11', 'w-11');
    expect(screen.getAllByTestId('time-chip-custom-box')[1]).toContainElement(remove);
    await user.click(remove);
    expect(onRemoveCustom).toHaveBeenLastCalledWith(3, '19:05');
    await user.click(screen.getByRole('button', { name: 'Remove 2:30 PM dose' }));
    expect(onRemoveCustom).toHaveBeenLastCalledWith(1, '14:30');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('presets still toggle (no "×" on them)', async () => {
    const { onToggle } = renderChips(['08:00']);
    expect(screen.queryByRole('button', { name: /^Remove .* dose$/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /Morning$/ }));
    expect(onToggle).toHaveBeenLastCalledWith('08:00', 'morning', true);
  });

  it('content-sized tiles that can never be wider than the row (no equal columns, no one-line clipping)', () => {
    renderChips(['07:15']);
    for (const tile of [
      screen.getByRole('checkbox', { name: /Morning$/ }),
      screen.getByTestId('time-chip-custom-box'),
      screen.getByTestId('time-chip-other'),
    ]) {
      expect(tile).toHaveClass('max-w-full');
      expect(tile).not.toHaveClass('overflow-hidden');
      expect(tile.style.gridRow).toBe('');
      tile.querySelectorAll('span').forEach((span) => expect(span).not.toHaveClass('whitespace-nowrap'));
    }
  });

  it('Other… is the SAME tile as the time chips (radius, min height, border, padding, centring)', () => {
    renderChips();
    const other = screen.getByTestId('time-chip-other');
    const chip = screen.getByRole('checkbox', { name: /Morning$/ });
    for (const cls of CHOICE_TILE_BOX.split(' ')) {
      expect(other).toHaveClass(cls);
      expect(chip).toHaveClass(cls);
    }
    expect(other).toHaveClass('rounded-2xl', 'min-h-[48px]', 'border', 'px-3.5', 'py-2', 'justify-center');
    expect(other).not.toHaveClass('rounded-full');
    // An invisible, unnamed second line keeps it as tall as the two-line chips.
    const spacer = screen.getByTestId('other-spacer');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).toHaveClass('invisible');
    expect(other).toHaveAccessibleName('Other…');
  });

  it('DETERMINISTIC: one chosen == another chosen == a custom chosen (same boxes, only the fill moves)', () => {
    const { rerender } = renderChips(['21:00']);
    const first = arrangement();
    rerender(['08:00']);
    expect(screen.getByRole('checkbox', { name: /Morning$/ })).toBeChecked();
    expect(arrangement()).toEqual(first);
    rerender(['12:00', '18:00']);
    expect(arrangement()).toEqual(first);
  });

  it('multi-select: checkboxes, every chip a tab stop; a tap reports the time, the preset and whether it was on', async () => {
    const { onToggle } = renderChips(['08:00', '15:45']);
    const user = userEvent.setup();
    const boxes = within(screen.getByRole('group')).getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    expect(boxes.every((b) => b.tabIndex === 0)).toBe(true);
    // The custom 3:45 PM is its own box outside the checkboxes (Fix13).
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^3:45 PM\s*Other$/);
    await user.click(screen.getByRole('checkbox', { name: /Evening$/ }));
    expect(onToggle).toHaveBeenLastCalledWith('18:00', 'evening', false);
    await user.click(screen.getByRole('checkbox', { name: /Morning$/ }));
    expect(onToggle).toHaveBeenLastCalledWith('08:00', 'morning', true);
    // Tapping the custom chip opens its picker; it never toggles.
    onToggle.mockClear();
    await user.click(screen.getByTestId('time-chip-custom'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('one answer (an edit): a radiogroup of radios with ONE roving tab stop; arrows move the answer', async () => {
    const { onToggle } = renderChips(['12:00'], { multiple: false });
    const group = screen.getByRole('radiogroup', { name: 'Common dose times' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(radios[1]).toBeChecked();
    expect(screen.queryByRole('checkbox')).toBeNull();
    radios[1].focus();
    await userEvent.setup().keyboard('{ArrowRight}');
    expect(onToggle).toHaveBeenLastCalledWith('18:00', 'evening', false);
  });

  it('no time yet (radio mode): the first chip is the tab stop', () => {
    renderChips([], { multiple: false });
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.tabIndex)).toEqual([
      0, -1, -1, -1,
    ]);
  });

  it('full (the dose limit): the unchosen chips and Other… are shown, not offered; the chosen stay tappable', () => {
    renderChips(['08:00', '12:00', '18:00', '21:00'], { full: true });
    for (const name of [/Morning$/, /Midday$/, /Evening$/, /Bedtime$/]) {
      expect(screen.getByRole('checkbox', { name })).toBeEnabled();
    }
    screen.getAllByRole('checkbox').forEach((c) => expect(c).toBeChecked());
    expect(screen.getByTestId('time-chip-other')).toBeDisabled();
  });

  it('full with three presets and a custom: the fourth preset is disabled and dimmed', () => {
    renderChips(['08:00', '12:00', '18:00', '06:30'], { full: true });
    const bedtime = screen.getByRole('checkbox', { name: /Bedtime$/ });
    expect(bedtime).toBeDisabled();
    expect(bedtime).toHaveClass('opacity-50');
    expect(screen.getByRole('checkbox', { name: /Morning$/ })).toBeEnabled();
  });

  it('selected is lit like a chosen tile (dark fill); unselected is not', () => {
    renderChips(['08:00', '07:10']);
    expect(screen.getByRole('checkbox', { name: /Morning$/ })).toHaveClass('bg-ink');
    expect(screen.getByTestId('time-chip-custom-box')).toHaveClass('bg-ink');
    expect(screen.getByRole('checkbox', { name: /Midday$/ })).not.toHaveClass('bg-ink');
  });

  it('without an Other… the group is its own wrapping row', () => {
    renderChips([], { withOther: false });
    expect(screen.queryByTestId('time-chip-row')).toBeNull();
    expect(screen.getByRole('group')).toHaveClass('flex', 'flex-wrap', 'gap-2');
  });

  it('large text (24px root): still the same wrapping row, never a one-column list', () => {
    document.documentElement.style.fontSize = '24px';
    try {
      renderChips();
      expect(screen.getByTestId('time-chip-row')).toHaveClass('flex', 'flex-wrap');
      expect(screen.getByTestId('time-chip-other')).not.toHaveClass('w-full');
    } finally {
      document.documentElement.style.fontSize = '';
    }
  });
});

describe('"How often?" uses the same tile (ChipSelect variant="tile")', () => {
  it('same box as the time chips, label in the tile font; the pill stays the default', () => {
    const { rerender } = render(
      <ChipSelect label="How often?" variant="tile" options={['Every day', 'Some days']} value="Every day" onChange={vi.fn()} />
    );
    const tile = screen.getByRole('radio', { name: 'Every day' });
    for (const cls of CHOICE_TILE_BOX.split(' ')) expect(tile).toHaveClass(cls);
    expect(tile).not.toHaveClass('rounded-full');
    expect(tile.querySelector('span')).toHaveClass('text-base', 'font-medium');
    rerender(<ChipSelect label="How often?" options={['Every day', 'Some days']} value="Every day" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Every day' })).toHaveClass('rounded-full');
  });
});
