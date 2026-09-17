import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_PRESETS,
  addMinutesToTimeStr,
  assignedToForSave,
  defaultReminder15mFor,
  hydratedReminder15m,
  matchingDurationIndex,
  minutesBetween,
  reminderFlagsForSave,
  remindersApply,
  supportsAssignee,
  type ReminderSelection,
} from '../eventForm';

const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/**
 * Every place inside `hydratedReminder15m` where the stored value (second
 * parameter, or a local alias of it) is used in a way that is not a `??`
 * operand, a null/undefined comparison, `typeof`, or a pass-through ending in
 * `return` / alias assignment. Empty means clean. See the ban test below.
 */
function storedValueViolations(source: string): string[] {
  const sf = ts.createSourceFile('eventForm.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let fn: ts.FunctionDeclaration | undefined;
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'hydratedReminder15m') fn = node;
  });
  if (!fn?.body) return ['hydratedReminder15m is not a function declaration with a body'];
  const storedParam = fn.parameters[1];
  if (!storedParam || !ts.isIdentifier(storedParam.name)) return ['second (stored) parameter not found'];

  const aliases = new Set<string>([storedParam.name.text]);
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
  const isNullish = (e: ts.Expression): boolean => {
    const inner = unwrap(e);
    return (
      inner.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(inner) && inner.text === 'undefined') ||
      ts.isVoidExpression(inner)
    );
  };
  const COMPARISONS = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
  ]);

  /** Climb wrappers that carry the value through unchanged. */
  const valuePosition = (node: ts.Node): ts.Node => {
    let current = node;
    for (;;) {
      const parent = current.parent;
      const passThrough =
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        (ts.isConditionalExpression(parent) && parent.condition !== current) ||
        (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);
      if (!passThrough) return current;
      current = parent;
    }
  };

  const isReference = (id: ts.Identifier): boolean => {
    const parent = id.parent;
    if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === id) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
    if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
    return aliases.has(id.text);
  };

  const scan = (): string[] => {
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isReference(node)) {
        const position = valuePosition(node);
        const parent = position.parent;
        if (ts.isReturnStatement(parent)) {
          // the value is the function's result
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === position && ts.isIdentifier(parent.name)) {
          aliases.add(parent.name.text);
        } else if (
          ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          parent.right === position &&
          ts.isIdentifier(parent.left)
        ) {
          aliases.add(parent.left.text);
        } else if (
          ts.isBinaryExpression(parent) &&
          COMPARISONS.has(parent.operatorToken.kind) &&
          isNullish(parent.left === position ? parent.right : parent.left)
        ) {
          // explicit null/undefined check
        } else if (ts.isTypeOfExpression(parent)) {
          // typeof inspects, never coerces
        } else {
          found.push(`${ts.SyntaxKind[parent.kind]}: ${parent.getText(sf)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn!.body!);
    return found;
  };

  // Fixpoint: an alias discovered late may have been used before this pass saw it.
  let size = -1;
  let violations: string[] = [];
  while (size !== aliases.size) {
    size = aliases.size;
    violations = scan();
  }
  let referenced = false;
  const countRefs = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReference(node)) referenced = true;
    ts.forEachChild(node, countRefs);
  };
  countRefs(fn.body);
  if (!referenced) violations.push('the stored value is never read — the ban would be vacuous');
  return violations;
}

describe('supportsAssignee', () => {
  it.each(['task', 'appointment'] as const)('%s carries an assignee', (type) => {
    expect(supportsAssignee(type)).toBe(true);
  });

  it('medications do not', () => {
    expect(supportsAssignee('medication')).toBe(false);
  });
});

describe('assignedToForSave', () => {
  it.each(['task', 'appointment'] as const)('sends the assignee for a %s', (type) => {
    expect(assignedToForSave(type, USER)).toBe(USER);
  });

  it.each(['task', 'appointment'] as const)(
    'sends an explicit null when a %s is set back to Anyone',
    (type) => {
      // The regression: this used to be omitted, and updates are partial
      // patches, so the previous assignee survived the save.
      expect(assignedToForSave(type, null)).toBeNull();
    }
  );

  it('distinguishes "unassigned" from "not applicable"', () => {
    expect(assignedToForSave('task', null)).not.toBeUndefined();
    expect(assignedToForSave('medication', null)).toBeUndefined();
  });

  it('omits the key entirely for medications', () => {
    expect(assignedToForSave('medication', USER)).toBeUndefined();
  });

  it('treats an empty string as unassigned rather than sending it', () => {
    // An empty id would fail the backend's uuid() check with a 400.
    expect(assignedToForSave('task', '')).toBeNull();
    expect(assignedToForSave('task', '   ')).toBeNull();
  });
});

describe('remindersApply', () => {
  it('always applies to medications — the form requires a time', () => {
    expect(remindersApply('medication', '')).toBe(true);
    expect(remindersApply('medication', '08:00')).toBe(true);
  });

  it.each(['appointment', 'task'] as const)('applies to a %s once a time is set', (type) => {
    expect(remindersApply(type, '14:00')).toBe(true);
  });

  it.each(['appointment', 'task'] as const)('does not apply to a timeless %s', (type) => {
    expect(remindersApply(type, '')).toBe(false);
    expect(remindersApply(type, '   ')).toBe(false);
  });
});

describe('reminderFlagsForSave', () => {
  /** Everything on — the anchor alert AND all four earlier reminders. */
  const allOn: ReminderSelection = {
    reminder_at_due: true,
    reminder_24h: true,
    reminder_1h: true,
    reminder_30m: true,
    reminder_15m: true,
  };
  /**
   * Everything off, `reminder_at_due` included — the ONLY genuinely silent
   * state, and what the helper must produce for "notifications off" / "no time".
   */
  const allOff: ReminderSelection = {
    reminder_at_due: false,
    reminder_24h: false,
    reminder_1h: false,
    reminder_30m: false,
    reminder_15m: false,
  };
  /**
   * The anchor alone. This is NOT silence: the alert still fires at the
   * scheduled time. Before `reminder_at_due` existed, "all four earlier flags
   * off" WAS the silent state, and this shape is what that assertion has to
   * become.
   */
  const anchorOnly: ReminderSelection = { ...allOff, reminder_at_due: true };

  it('persists the selection when notifications are on and a time exists', () => {
    expect(reminderFlagsForSave(allOn, true, true)).toEqual(allOn);
  });

  it('keeps the at-due anchor when every earlier reminder is off — not a silent event', () => {
    // The four `reminder_*` flags are opt-IN extras now. Zeroing the anchor
    // because none of them are checked would delete the primary alert on the
    // most common save there is: a plain event nobody asked for extras on.
    expect(reminderFlagsForSave(anchorOnly, true, true)).toEqual(anchorOnly);
    expect(reminderFlagsForSave(anchorOnly, true, true).reminder_at_due).toBe(true);
  });

  it('persists an explicit at-due opt-out — the one state that really is silent', () => {
    // Companion to the case above: the user deliberately turned the anchor off
    // with notifications still on and a time set. Re-arming it "helpfully"
    // would overrule the only way to make an event silent.
    expect(reminderFlagsForSave(allOff, true, true)).toEqual(allOff);
    expect(reminderFlagsForSave(allOff, true, true).reminder_at_due).toBe(false);
  });

  // ── The master toggle mutes; it does not erase ────────────────────────────
  //
  // It used to erase, and that was defensible exactly as long as
  // process_task_reminders() honoured no mute at all — blanking the columns was
  // then the only thing that could silence a task. Migration 20260823120000
  // added `notifications_enabled = true` to its four pre-reminder blocks and
  // 20260901120000 added the fifth (at-due) block carrying the same guard, so
  // every selector on the platform now skips a muted row: both process_*
  // functions, tiers 1/2/3, and the manual POST /task-reminders sweep.

  it('does NOT zero anything when notifications are off', () => {
    expect(reminderFlagsForSave(allOn, false, true)).toEqual(allOn);
  });

  it('keeps the at-due anchor across a master off → on cycle', () => {
    // The whole point of the contract. `reminder_at_due` is NOT NULL DEFAULT
    // TRUE, so the old zeroing stored a plain `false` indistinguishable from a
    // deliberate opt-out — the anchor could never be restored, and a muted-then-
    // unmuted medication only ever spoke through the missed-dose escalation.
    const savedWhileMuted = reminderFlagsForSave(anchorOnly, false, true);
    expect(savedWhileMuted.reminder_at_due).toBe(true);
    // Hydration reads those columns back verbatim; unmuting saves them again.
    expect(reminderFlagsForSave(savedWhileMuted, true, true)).toEqual(anchorOnly);
  });

  it('does NOT zero anything when there is no time to fire against', () => {
    // Every reminder function filters `scheduled_time IS NOT NULL`, so the flags
    // are INERT without a time. Zeroing them wrote the anchor off, and adding a
    // time later then produced a silent event with nothing on screen to explain
    // it — the same defect one step removed.
    expect(reminderFlagsForSave(allOn, true, false)).toEqual(allOn);
  });

  it('keeps both column-default-TRUE flags on a timeless entry', () => {
    // `reminder_15m` and `reminder_at_due` are the two whose DB default is TRUE,
    // so an omitted key comes back ON for either. A fresh task now selects only
    // the anchor, but a row can hold both — from the old task default, or from a
    // user who ticked 15m — and neither may be zeroed on the way out.
    const defaults: ReminderSelection = { ...allOff, reminder_at_due: true, reminder_15m: true };
    const saved = reminderFlagsForSave(defaults, true, false);
    expect(saved.reminder_15m).toBe(true);
    expect(saved.reminder_at_due).toBe(true);
  });

  it('leaves the selection alone when notifications are off AND there is no time', () => {
    expect(reminderFlagsForSave(allOn, false, false)).toEqual(allOn);
  });

  it('sends all five flags, never a subset', () => {
    // A dropped key is a partial patch server-side: the stored value survives.
    const keys = Object.keys(reminderFlagsForSave(allOn, false, false)).sort();
    expect(keys).toEqual([
      'reminder_15m',
      'reminder_1h',
      'reminder_24h',
      'reminder_30m',
      'reminder_at_due',
    ]);
  });

  it('does not mutate the caller selection', () => {
    const selection = { ...allOn };
    reminderFlagsForSave(selection, false, false);
    expect(selection).toEqual(allOn);
  });
});

describe('duration presets', () => {
  it('offers 30 min, 1 hr and 2 hrs, defaulting to the shortest', () => {
    expect(DURATION_PRESETS).toEqual([30, 60, 120]);
    expect(DEFAULT_DURATION_MINUTES).toBe(30);
  });
});

describe('addMinutesToTimeStr', () => {
  it.each([
    ['14:00', 30, '14:30'],
    ['14:00', 60, '15:00'],
    ['14:00', 120, '16:00'],
    ['09:45', 30, '10:15'],
    ['00:00', 30, '00:30'],
  ])('%s + %i min = %s', (start, mins, expected) => {
    expect(addMinutesToTimeStr(start, mins)).toBe(expected);
  });

  it('clamps at end of day rather than rolling into the next', () => {
    // The event carries a single scheduled_date, so a rolled-over end time
    // would silently describe a span the calendar cannot render.
    expect(addMinutesToTimeStr('23:50', 120)).toBe('23:59');
  });

  it('returns empty for a malformed time', () => {
    expect(addMinutesToTimeStr('', 30)).toBe('');
    expect(addMinutesToTimeStr('not-a-time', 30)).toBe('');
  });
});

describe('minutesBetween', () => {
  it('measures the span', () => {
    expect(minutesBetween('14:00', '14:30')).toBe(30);
    expect(minutesBetween('14:00', '16:00')).toBe(120);
  });

  it('returns null when either end is missing or malformed', () => {
    expect(minutesBetween('', '14:30')).toBeNull();
    expect(minutesBetween('14:00', '')).toBeNull();
    expect(minutesBetween('bad', '14:30')).toBeNull();
  });
});

describe('matchingDurationIndex', () => {
  it.each([
    ['14:30', 0],
    ['15:00', 1],
    ['16:00', 2],
  ])('selects the chip matching an end of %s', (end, expectedIndex) => {
    expect(matchingDurationIndex('14:00', end)).toBe(expectedIndex);
  });

  it('leaves every chip unselected for a custom span', () => {
    // 45 minutes came from the end-time field, not a chip — rounding it to the
    // nearest preset would silently change the event.
    expect(matchingDurationIndex('14:00', '14:45')).toBe(-1);
  });

  it('leaves every chip unselected when there is no time yet', () => {
    expect(matchingDurationIndex('', '')).toBe(-1);
    expect(matchingDurationIndex('14:00', '')).toBe(-1);
  });

  it('does not select a chip for a negative span', () => {
    expect(matchingDurationIndex('14:00', '13:00')).toBe(-1);
  });

  it('round-trips with addMinutesToTimeStr', () => {
    DURATION_PRESETS.forEach((preset, index) => {
      expect(matchingDurationIndex('10:00', addMinutesToTimeStr('10:00', preset))).toBe(index);
    });
  });
});

/**
 * The "15 minutes before" default — the rule both AddEventModal call sites (the
 * initializer and the type switcher) now read instead of deriving inline. They
 * disagreed once, which is how a task ended up arriving with an early push the
 * user never chose; the helper exists so that cannot recur.
 */
describe('defaultReminder15mFor', () => {
  it.each(['medication', 'task', 'appointment'] as const)('is OFF for a new %s', (type) => {
    // Not medication-asymmetric any more. Migration 20260901120000 gave
    // task/appointment a real at-due alert (`process_task_reminders()` reads
    // `reminder_at_due` for both), so "all four earlier boxes off" stopped
    // meaning "silent" and the last reason to pre-tick one went with it.
    expect(defaultReminder15mFor(type)).toBe(false);
  });

  it('matches mobile, which returns false for every type', () => {
    // One column, one cron, two clients: mobile/src/utils/reminderNotices.ts's
    // `defaultReminder15mFor` is this same rule under the same name. A task
    // created on the phone and the same task created on the web must arrive
    // with the same flags.
    expect(defaultReminder15mFor(undefined)).toBe(false);
    expect(defaultReminder15mFor(null)).toBe(false);
  });
});

describe('hydratedReminder15m', () => {
  it('keeps a stored TRUE — the task written under the old default', () => {
    // `reminder_15m = true` is real data the cron acts on. Rewriting it to the
    // new default on open would mutate a notification the user never touched,
    // and `reminderFlagsForSave` would persist that mutation on the next save.
    expect(hydratedReminder15m('task', true)).toBe(true);
    expect(hydratedReminder15m('medication', true)).toBe(true);
  });

  it('keeps a stored FALSE — `??`, never `||`', () => {
    // Coalescing on falsiness would re-derive the default over every explicit
    // opt-out. It happens to agree today (both false) and would stop agreeing
    // the moment any type defaults ON again.
    //
    // INERT TODAY, AND KNOWN TO BE: `defaultReminder15mFor` is false for every
    // type, so `stored || default` returns false here too and this assertion
    // cannot tell the operators apart. The AST ban below is what goes red
    // under `||`; this one starts biting the day any type defaults ON.
    expect(hydratedReminder15m('appointment', false)).toBe(false);
  });

  /**
   * TYPESCRIPT AST BAN, NOT A BEHAVIOUR TEST — and it says so on purpose.
   *
   * No behavioural seam exists without a product change: every type's default
   * is false, and `hydratedReminder15m` calls `defaultReminder15mFor` through a
   * same-module binding that `vi.mock` cannot intercept. A substring ban
   * (`??` present, `||` absent) was bypassable by `const s = stored ?? null;
   * return s ? s : default` or by a `||` helper declared above the function.
   *
   * The rule, on the parsed AST of lib/eventForm.ts: inside
   * `hydratedReminder15m`, the stored value (the second parameter, and any
   * local alias assigned from it) may only
   *   - be an operand of `??`,
   *   - be compared against `null`/`undefined` (`===`, `!==`, `==`, `!=`) or
   *     inspected with `typeof`,
   *   - pass through parentheses / type assertions / a `?:` BRANCH / `??`,
   *     ending in a `return` or an alias declaration or assignment.
   * Anything else is rejected: `||`, `&&`, `!x`, `if (x)`, a `?:` CONDITION,
   * `Boolean(x)`, passing it to any function, or capturing it in a
   * literal/closure.
   */
  it('hydratedReminder15m source (TypeScript AST): the stored value is never truthiness-tested, aliased into a test, or handed to a helper', () => {
    const source = readFileSync(join(__dirname, '..', 'eventForm.ts'), 'utf8');
    expect(storedValueViolations(source)).toEqual([]);
  });

  it('the AST ban itself rejects every known bypass and accepts honest null checks', () => {
    const fn = (body: string, prelude = '') =>
      `${prelude}\nexport function hydratedReminder15m(eventType: EventType, stored: boolean | null | undefined): boolean {\n${body}\n}\n`;
    const d = 'defaultReminder15mFor(eventType)';

    // Honest implementations: no violations.
    expect(storedValueViolations(fn(`return stored ?? ${d};`))).toEqual([]);
    expect(
      storedValueViolations(fn(`if (stored === undefined || stored === null) return ${d};\nreturn stored;`))
    ).toEqual([]);
    expect(storedValueViolations(fn(`return stored == null ? ${d} : stored;`))).toEqual([]);

    // Bypasses: each must be flagged.
    const bypasses = [
      fn(`return stored || ${d};`),
      fn(`const s = stored ?? null;\nreturn s ? s : ${d};`),
      fn(`let s: boolean | null | undefined;\ns = stored;\nreturn s || ${d};`),
      fn(`return pick(stored, ${d});`, 'function pick(a: boolean | null | undefined, b: boolean) { return a || b; }'),
      fn(`if (stored) return stored;\nreturn ${d};`),
      fn(`return Boolean(stored) || ${d};`),
      fn(`return !stored ? ${d} : true;`),
      fn(`return (stored ?? null) || ${d};`),
      fn(`return stored && true ? true : ${d};`),
      fn(`const read = () => stored;\nreturn read() ?? ${d};`),
    ];
    for (const bypass of bypasses) {
      expect(storedValueViolations(bypass), bypass).not.toEqual([]);
    }
    expect(storedValueViolations('export const unrelated = 1;')).not.toEqual([]);
  });

  it('falls back to the default only when the key is absent', () => {
    // A row written before the column existed, or a response from a build that
    // does not serialise it.
    expect(hydratedReminder15m('task', undefined)).toBe(false);
    expect(hydratedReminder15m('task', null)).toBe(false);
  });
});
