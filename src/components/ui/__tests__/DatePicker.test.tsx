import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { DateField } from '../DateField';
import {
  clampDateValue,
  daysInMonth,
  firstDayOfWeek,
  parseDateValue,
  stepMonths,
  toDateValue,
  weekdayIndex,
} from '../DatePickerPanel';
import * as ts from 'typescript';
import {
  findCalls,
  findDynamicMemberCalls,
  findMemberReferences,
  findNewExpressions,
  findValueReferences,
  locate,
  parseSource,
  readSource,
  staticText,
} from './sourceText';

/**
 * "Today" is a real reading of the device clock (`getDateInTimezone` over the
 * device zone), which is correct in the app and useless in a test that asserts
 * which cell carries `aria-current`. Pinned here rather than with fake timers:
 * `userEvent` drives its own timers, and swapping those out to move the
 * calendar a day is a much bigger lever than the job needs.
 */
vi.mock('@/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timezone')>()),
  getDateInTimezone: () => '2026-09-11',
}));

/**
 * A controlled host, because that is what all five call sites are
 * (`AddEventModal` twice, `VitalFormModal`, `CreateCircleModal`,
 * `EditCirclePage`) — and because a pick has to survive into the next render
 * for the grid to mark it selected.
 */
function Host({
  initial = '',
  onChange,
  min,
  max,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      id="on"
      label="Date"
      value={value}
      min={min}
      max={max}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event.target.value);
      }}
    />
  );
}

// The panel is `React.lazy` (see the import comment in DateField), so opening
// it is asynchronous by one chunk — wait for the panel, not just for the click.
async function openPicker(): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a date' }));
  await screen.findByRole('dialog', { name: 'Date picker' });
}

/** The day button for an ISO day, or null when that day is not on screen. */
function cell(iso: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-day="${iso}"]`);
  if (!node) throw new Error(`${iso} is not in the grid`);
  return node;
}

function onScreen(iso: string): boolean {
  return document.querySelector(`[data-day="${iso}"]`) !== null;
}

describe('date value arithmetic', () => {
  it('reads a YYYY-MM-DD and rejects everything that is not one', () => {
    expect(parseDateValue('2026-09-11')).toEqual({ year: 2026, month: 9, day: 11 });
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue(undefined)).toBeNull();
    expect(parseDateValue('2026-13-01')).toBeNull();
    // A day the month does not have is junk from somewhere, not 2 March.
    expect(parseDateValue('2026-02-30')).toBeNull();
    expect(parseDateValue('2026-9-1')).toBeNull();
    // Two-digit years are refused at the door so nothing downstream can hand
    // one to a `Date` constructor, where 43 silently means 1943.
    expect(parseDateValue('0043-01-01')).toBeNull();
  });

  it('always emits a zero-padded string', () => {
    expect(toDateValue(2026, 9, 5)).toBe('2026-09-05');
    expect(toDateValue(1943, 12, 31)).toBe('1943-12-31');
  });

  // The four cases a hand-rolled month length gets wrong.
  it('knows how long every month is, leap years included', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('reads the weekday in UTC, so no local midnight can move it', () => {
    expect(weekdayIndex(2026, 9, 11)).toBe(5);
    expect(weekdayIndex(2026, 9, 13)).toBe(0);
    expect(weekdayIndex(1943, 2, 19)).toBe(5);
  });

  it('pulls a month step back to the shorter month rather than rolling past it', () => {
    expect(stepMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(stepMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(stepMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(stepMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(stepMonths('2026-09-11', -12)).toBe('2025-09-11');
  });

  it('clamps by string comparison, which is exact for this format', () => {
    expect(clampDateValue('2026-09-01', '2026-09-05', '2026-09-20')).toBe('2026-09-05');
    expect(clampDateValue('2026-09-25', '2026-09-05', '2026-09-20')).toBe('2026-09-20');
    expect(clampDateValue('2026-09-11', '2026-09-05', '2026-09-20')).toBe('2026-09-11');
    expect(clampDateValue('1900-01-01')).toBe('1900-01-01');
  });

  /**
   * Spanish weeks start Monday and English (US) weeks start Sunday, which is
   * the whole reason this is a lookup and not a constant.
   *
   * `es-MX` is the case that proves it is CLDR being read and not a rule being
   * invented: Mexico starts its weeks on SUNDAY, so a "Spanish means Monday"
   * shortcut would be wrong for the very audience this app writes Latin
   * American Spanish for. The app sets the bare `es`, which is Monday-first —
   * but if it ever narrows the tag, the calendar follows the region instead of
   * arguing with it.
   */
  it('takes the first day of the week from the locale, region and all', () => {
    expect(firstDayOfWeek('en')).toBe(0);
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('es')).toBe(1);
    expect(firstDayOfWeek('es-MX')).toBe(0);
    // An unparseable tag must not blank the calendar.
    expect(firstDayOfWeek('not a locale')).toBe(1);
  });
});

/**
 * THE RULE THIS FILE EXISTS TO ENFORCE, read off the source rather than off
 * behaviour: a `YYYY-MM-DD` in this codebase is a NAIVE CALENDAR DAY, and
 * `new Date('2026-09-11')` parses it as UTC midnight — the previous day
 * everywhere west of Greenwich. A picker that is one day out only near a DST
 * boundary is exactly the kind of bug the behavioural tests below would pass
 * through, so the ban is asserted structurally.
 */
/**
 * Local-time readers and writers, and the two ways a `Date` becomes an ISO
 * STRING that something then slices. Banned as MEMBER NAMES rather than as
 * call spellings: `d.getDate()`, `d?.getDate()`, `d['getDate']()`,
 * `const { getDate } = d` and `const g = d.getDate` are all the same read.
 */
const LOCAL_OR_STRING_DATE_MEMBERS = [
  'getDate',
  'getDay',
  'getMonth',
  'getFullYear',
  'getYear',
  'getHours',
  'getMinutes',
  'getSeconds',
  'getMilliseconds',
  'getTimezoneOffset',
  'setDate',
  'setMonth',
  'setFullYear',
  'setYear',
  'setHours',
  'setMinutes',
  'setSeconds',
  'setMilliseconds',
  'toISOString',
  'toJSON',
  'toDateString',
  'toTimeString',
  'toUTCString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleString',
];

/** `new Date(Date.UTC(…))`, and nothing else that builds a `Date`. */
function isUtcConstruction(node: ts.Node): boolean {
  if (!ts.isNewExpression(node) || node.arguments?.length !== 1) return false;
  const [arg] = node.arguments;
  return (
    ts.isCallExpression(arg) &&
    ts.isPropertyAccessExpression(arg.expression) &&
    ts.isIdentifier(arg.expression.expression) &&
    arg.expression.expression.text === 'Date' &&
    arg.expression.name.text === 'UTC'
  );
}

/**
 * Every way a file can read a naive `YYYY-MM-DD` as an instant, or read an
 * instant back in local time, that a SYNTAX tree can see. Returns the offending
 * nodes located, so a failure names the line instead of just "false".
 */
function instantViolations(sf: ts.SourceFile): string[] {
  const found: string[] = [];
  const flag = (why: string, node: ts.Node): void => {
    found.push(`${why}: ${locate(node)}`);
  };

  // 1. `Date` itself, used as a value, only ever as `new Date(Date.UTC(…))` or
  //    `Date.UTC(…)`. This is the rule that catches an ALIAS: `const D = Date;
  //    new D(iso)` never spells `new Date`, but its `= Date` is a reference
  //    that is neither of those shapes. `Date.parse`, `Date.now` and
  //    `new Date(iso)` fall out of the same rule.
  for (const ref of findValueReferences(sf, 'Date')) {
    const parent = ref.parent;
    const utcCall =
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === ref &&
      parent.name.text === 'UTC' &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent;
    const utcConstructor =
      ts.isNewExpression(parent) && parent.expression === ref && isUtcConstruction(parent);
    if (!utcCall && !utcConstructor) flag('Date used other than new Date(Date.UTC(…))', parent);
  }
  // …including through a namespace: `globalThis.Date`, `window['Date']`.
  for (const node of findMemberReferences(sf, 'Date')) flag('Date reached as a member', node);

  // 2. Local-time accessors and ISO-string producers, however they are spelled.
  for (const node of findMemberReferences(sf, LOCAL_OR_STRING_DATE_MEMBERS)) {
    flag('local-time or ISO-string Date member', node);
  }

  // 3. A method name built at run time is one this ban cannot read, so it is
  //    refused outright rather than assumed innocent.
  for (const call of findDynamicMemberCalls(sf)) flag('computed method name', call);

  // 4. Cutting the day off an ISO timestamp string, whatever produced it.
  for (const call of findCalls(sf, 'split')) {
    const [separator] = call.arguments;
    const text = staticText(separator);
    if ((text !== null && text.includes('T')) || (separator && ts.isRegularExpressionLiteral(separator))) {
      flag("split on 'T'", call);
    }
  }
  for (const call of findCalls(sf, ['slice', 'substring', 'substr'])) {
    const [start, end] = call.arguments.map((arg) =>
      arg && ts.isNumericLiteral(arg) ? Number(arg.text) : null
    );
    if (start === 0 && end === 10) flag('ISO-day prefix slice (0, 10)', call);
  }

  return found;
}

describe('DatePickerPanel never parses a date string as an instant', () => {
  // WHAT THIS READS: the TypeScript parse tree of `DatePickerPanel.tsx` — every
  // expression in the file, wherever it sits (a template's `${…}`, a JSX
  // `{…}`, the rest of a line after a regex literal), and none of its comments,
  // which talk ABOUT the banned forms at length and are not on trial.
  //
  // WHAT IT DOES NOT READ, so nothing here overclaims: the helpers the file
  // imports (`addDaysToIsoDay` lives in `utils/recipientEventDate` and has its
  // own tests), and anything decided by data flow rather than syntax. It used
  // to say it read "every line that can run", which was false twice over — its
  // regex lexer lost whole lines after a regex literal and inside JSX text.
  const PANEL = 'src/components/ui/DatePickerPanel.tsx';
  const panel = parseSource(readSource(PANEL), PANEL);

  it('constructs a Date only from Date.UTC', () => {
    // Not vacuous: the file really does build Dates, so rule 1 has something to
    // hold to its one permitted shape.
    const constructions = findNewExpressions(panel, 'Date');
    expect(constructions.length).toBeGreaterThan(0);
    expect(constructions.filter((node) => !isUtcConstruction(node)).map(locate)).toEqual([]);
  });

  it('uses no local date accessors, no Date aliasing and no ISO-string slicing', () => {
    expect(instantViolations(panel)).toEqual([]);
  });

  /**
   * THE BAN, ON THE SPELLINGS AN AUDIT GOT PAST IT — each was green against
   * the old exact-spelling regexes. Each probe is a line that would compile in
   * `DatePickerPanel.tsx`; a later "simplification" of any rule above fails
   * here by name.
   */
  it.each([
    ['toISOString().slice(0, 10)', 'const day = utcDay(2026, 9, 11).toISOString().slice(0, 10);'],
    ['element access with a literal key', "const n = utcDay(2026, 9, 11)['getDate']();"],
    ['an aliased constructor', 'const D = Date; const d = new D(iso);'],
    ['a split on a template-literal T', 'const day = stamp.split(`T`)[0];'],
    [
      'a banned call on a line after a regex literal',
      'function f(u: string) { return /https?:\\/\\//.test(u) ? new Date(u).getDate() : 0; }',
    ],
    ['a local accessor inside a template expression', 'const a = <b>{`day ${new Date(iso).getDate()} of`}</b>;'],
    ['a local accessor after JSX text with a URL', 'const a = <p>see https://x.org {d.getDate()}</p>;'],
    ['Date.parse', 'const t = Date.parse(iso);'],
    ['destructuring an accessor', 'const { getDay } = utcDay(2026, 9, 11);'],
    ['a computed method name', "const n = utcDay(2026, 9, 11)['get' + 'Date']();"],
    ['Date through globalThis', 'const d = new globalThis.Date(iso);'],
    ['a regex split on T', 'const day = stamp.split(/T/)[0];'],
  ])('refuses %s', (_label, probe) => {
    expect(instantViolations(parseSource(probe))).not.toEqual([]);
  });

  it('passes the shapes the panel legitimately uses', () => {
    const legit = parseSource(
      [
        'function utcDay(y: number, m: number, d: number): Date { return new Date(Date.UTC(y, m - 1, d)); }',
        'const w = utcDay(2026, 9, 11).getUTCDay();',
        'const row = cells.slice(r * 7, r * 7 + 7);',
        "const label = <p>Don't {w}</p>;",
      ].join('\n')
    );
    expect(instantViolations(legit)).toEqual([]);
  });
});

describe('DateField picker trigger', () => {
  it('names the trigger, wires aria-haspopup, and only points at a panel that exists', async () => {
    render(<Host initial="2026-09-11" />);
    const trigger = screen.getByRole('button', { name: 'Choose a date' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    await openPicker();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls');
  });

  it('opens the popover from Alt+ArrowDown, the keyboard way into the calendar', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    await user.click(screen.getByLabelText('Date'));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await screen.findByRole('dialog', { name: 'Date picker' })).toBeInTheDocument();
  });

  /**
   * …AND GIVES THE INPUT ITS FOCUS BACK. Every exit path used to focus the
   * trailing icon button, which is right when the button is what opened the
   * popover and wrong when Alt+ArrowDown was: a keyboard user who tabbed into
   * the field and changed their mind landed one Shift+Tab past the date segment
   * they were editing. Native `<input type="date">` returns focus to the input
   * in this flow.
   */
  it('returns focus to the input when Alt+ArrowDown is what opened it', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    const input = screen.getByLabelText('Date');
    await user.click(input);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await screen.findByRole('dialog', { name: 'Date picker' });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
    });
    expect(input).toHaveFocus();
  });
});

describe('DatePickerPanel emission', () => {
  it('emits YYYY-MM-DD through the caller onChange and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="2026-09-11" onChange={onChange} />);
    await openPicker();

    await user.click(cell('2026-09-24'));
    expect(onChange).toHaveBeenLastCalledWith('2026-09-24');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-24');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
    });
  });

  it('marks the current value selected, and today without relying on colour', async () => {
    render(<Host initial="2026-09-24" />);
    await openPicker();

    expect(cell('2026-09-24')).toHaveAttribute('aria-selected', 'true');
    expect(cell('2026-09-11')).toHaveAttribute('aria-selected', 'false');
    // `aria-current` is the half of the today marker a screen reader hears; the
    // dot beside it is the half a colour-blind reader sees.
    expect(cell('2026-09-11')).toHaveAttribute('aria-current', 'date');
    expect(cell('2026-09-24')).not.toHaveAttribute('aria-current');
  });

  it('names each day in full, not by its number alone', async () => {
    render(<Host initial="2026-09-11" />);
    await openPicker();
    expect(screen.getByRole('gridcell', { name: 'September 11, 2026' })).toBe(cell('2026-09-11'));
  });

  // The leading and trailing days are real dates, not padding.
  it('shows the adjacent months at the edges and emits their real dates', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="2026-09-11" onChange={onChange} />);
    await openPicker();

    // September 2026 starts on a Tuesday, so an en (Sunday-first) grid leads
    // with 30 August.
    expect(onScreen('2026-08-30')).toBe(true);
    expect(onScreen('2026-10-10')).toBe(true);

    await user.click(cell('2026-08-30'));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-30');
  });

  it('has a 29 February in 2024 and none in 2026', async () => {
    render(<Host initial="2024-02-29" />);
    await openPicker();
    expect(screen.getByRole('grid', { name: 'February 2024' })).toBeInTheDocument();
    expect(cell('2024-02-29')).toHaveAttribute('aria-selected', 'true');
    // The 29th of a non-leap February cannot be reached at all: 1 March takes
    // that cell, as a trailing day of the next month.
    expect(onScreen('2026-02-29')).toBe(false);
  });

  it('clears through the Clear action and jumps to today through Today', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="2026-09-24" onChange={onChange} />);

    await openPicker();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-09-11');

    await openPicker();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByLabelText('Date')).toHaveValue('');
  });
});

/**
 * THE REASON THIS PANEL EXISTS RATHER THAN A PAIR OF ARROWS. Two of the five
 * call sites are a care recipient's date of birth, and month arrows alone put
 * a 1943 birthday roughly a thousand clicks away.
 */
describe('DatePickerPanel month and year jump', () => {
  it('reaches a 1943 birthday in two selections', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await openPicker();

    await user.selectOptions(screen.getByLabelText('Year'), '1943');
    await user.selectOptions(screen.getByLabelText('Month'), '2');
    expect(screen.getByRole('grid', { name: 'February 1943' })).toBeInTheDocument();

    await user.click(cell('1943-02-19'));
    expect(onChange).toHaveBeenLastCalledWith('1943-02-19');
  });

  it('reaches at least 120 years back and a decade forward', async () => {
    render(<Host />);
    await openPicker();
    const years = Array.from(
      screen.getByLabelText('Year').querySelectorAll('option'),
      (option) => option.value
    );
    expect(years).toContain('1906');
    expect(years).toContain('2036');
  });

  it('steps a month at a time with the arrows', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    await openPicker();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
  });

  // 31 August + 1 month is 30 September, not 1 October.
  it('keeps the day inside the shorter month when stepping', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-08-31" />);
    await openPicker();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
    expect(cell('2026-09-30')).toHaveAttribute('tabindex', '0');
  });
});

describe('DatePickerPanel min/max', () => {
  it('disables out-of-range days and refuses to emit them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="2026-09-11" min="2026-09-05" max="2026-09-20" onChange={onChange} />);
    await openPicker();

    expect(cell('2026-09-04')).toBeDisabled();
    expect(cell('2026-09-21')).toBeDisabled();
    expect(cell('2026-09-05')).toBeEnabled();
    expect(cell('2026-09-20')).toBeEnabled();

    await user.click(cell('2026-09-04'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('will not navigate the month or year jump past the range', async () => {
    render(<Host initial="2026-09-11" min="2026-09-05" max="2026-09-20" />);
    await openPicker();

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByLabelText('Year').querySelectorAll('option')).toHaveLength(1);
    // Every month but September is out of range, so none of them is reachable.
    const months = Array.from(screen.getByLabelText('Month').querySelectorAll('option'));
    expect(months.filter((option) => !option.disabled)).toHaveLength(1);
  });

  it('clamps the keyboard at the range edge instead of walking off it', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-05" min="2026-09-05" max="2026-09-20" />);
    await openPicker();

    expect(cell('2026-09-05')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(cell('2026-09-05')).toHaveFocus();
  });

  it('disables Today when today itself is out of range', async () => {
    render(<Host initial="2026-09-11" max="2026-09-01" />);
    await openPicker();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  /**
   * A BOUND THAT IS NOT A DAY MUST NOT REACH THE PANEL AT ALL.
   *
   * `min`/`max` arrive through `DateField`'s props spread, typed the way
   * `<input>` types them for every input type it has (`string | number |
   * readonly string[]`), and `isoDayProp` is the only thing standing between
   * that and the panel. Nothing downstream re-checks them: `clampDateValue` is
   * a STRING comparison — correct and parse-free for `YYYY-MM-DD`, which is
   * the whole reason the wire format is what it is — so a bound of the right
   * SHAPE but no calendar meaning is compared happily, wins the clamp, and
   * becomes the anchor the grid opens on. `parseDateValue` then rejects it and
   * the panel falls back to its epoch default, so a field asking for a
   * September 2026 date opens on JANUARY 1970.
   *
   * `2026-13-45` is the shape the old regex let through: four digits, two,
   * two, and not a month or a day.
   */
  it('drops a bound that is shaped like a day but is not one', async () => {
    render(<Host initial="2026-09-11" min="2026-13-45" />);
    await openPicker();
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
  });
});

describe('DatePickerPanel keyboard', () => {
  it('opens on the current value and moves by day and by week', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    await openPicker();

    expect(cell('2026-09-11')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cell('2026-09-12')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(cell('2026-09-11')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(cell('2026-09-18')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(cell('2026-09-11')).toHaveFocus();
  });

  it('moves to the start and end of the week with Home and End', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    await openPicker();

    // 11 September 2026 is a Friday; an en week runs Sunday (6th) to Saturday.
    await user.keyboard('{Home}');
    expect(cell('2026-09-06')).toHaveFocus();
    await user.keyboard('{End}');
    expect(cell('2026-09-12')).toHaveFocus();
  });

  it('pages by month, and by year with Shift', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    await openPicker();

    await user.keyboard('{PageUp}');
    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeInTheDocument();
    expect(cell('2026-08-11')).toHaveFocus();
    await user.keyboard('{PageDown}{PageDown}');
    expect(cell('2026-10-11')).toHaveFocus();
    await user.keyboard('{Shift>}{PageUp}{/Shift}');
    expect(screen.getByRole('grid', { name: 'October 2025' })).toBeInTheDocument();
  });

  // Selection does NOT follow focus here (unlike the time picker): thirty
  // `onChange` calls on the way across a month would mark two of the five call
  // sites' forms dirty thirty times.
  it('commits only on Enter, not on every arrow key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="2026-09-11" onChange={onChange} />);
    await openPicker();

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('2026-09-13');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Host initial="2026-09-11" />);
    await openPicker();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Choose a date' })).toHaveFocus();
  });
});

describe('DatePickerPanel locale', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('starts the week on Sunday in English', async () => {
    render(<Host initial="2026-09-11" />);
    await openPicker();
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveAccessibleName('Sunday');
    expect(headers[6]).toHaveAccessibleName('Saturday');
  });

  // THE ONE THING A HARDCODED CALENDAR ALWAYS GETS WRONG.
  it('starts the week on Monday in Spanish, and names the month the CLDR way', async () => {
    await i18n.changeLanguage('es');
    render(<Host initial="2026-09-11" />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Elegir una fecha' }));
    await screen.findByRole('dialog', { name: 'Selector de fecha' });

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveAccessibleName('lunes');
    expect(headers[6]).toHaveAccessibleName('domingo');
    // Lower case, as CLDR has it — the same judgment as the RAE `p. m.` the
    // time picker reads off `formatTimeOfDay` rather than out of a locale file.
    expect(screen.getByRole('grid', { name: 'septiembre de 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Borrar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
  });

  // The DISPLAY order is the browser's business; the VALUE never moves.
  it('still emits YYYY-MM-DD in Spanish', async () => {
    await i18n.changeLanguage('es');
    const onChange = vi.fn();
    render(<Host initial="2026-09-11" onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Elegir una fecha' }));
    await screen.findByRole('dialog', { name: 'Selector de fecha' });
    await user.click(cell('2026-09-24'));

    expect(onChange).toHaveBeenLastCalledWith('2026-09-24');
  });
});
