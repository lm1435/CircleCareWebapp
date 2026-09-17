import {
  findCalls,
  findDynamicMemberCalls,
  findMemberReferences,
  findNewExpressions,
  findValueReferences,
  parseSource,
  staticText,
  staticTexts,
} from './sourceText';

/**
 * THE HELPER THE SOURCE BANS STAND ON, held to the probes that broke the lexer
 * it replaced. Every case below was a confirmed miss or a confirmed throw in
 * that lexer, so each one is a way a ban could go quietly green again.
 *
 * Probes are `.tsx` (the default file name) because JSX is where most of them
 * live; the strings are escaped for a TS string, so `\\/` below is `\/` in the
 * parsed source.
 */
const names = (nodes: { getText: () => string }[]): string[] => nodes.map((node) => node.getText());

describe('sourceText: template literals', () => {
  it('keeps the static text of a template argument, so split(`T`) is still a split on T', () => {
    const sf = parseSource('const day = iso.split(`T`)[0];');
    const [call] = findCalls(sf, 'split');
    expect(call).toBeDefined();
    expect(staticText(call!.arguments[0])).toBe('T');
  });

  it('reads code inside a ${…} and keeps the static runs around it as text', () => {
    const sf = parseSource('const a = <b>{`day ${new Date(iso).getDate()} of`}</b>;');
    expect(names(findCalls(sf, 'getDate'))).toEqual(['new Date(iso).getDate()']);
    expect(findNewExpressions(sf, 'Date')).toHaveLength(1);
    expect(staticTexts(sf)).toEqual(expect.arrayContaining(['day ', ' of']));
    // Code is not static text.
    expect(staticTexts(sf).join('\n')).not.toContain('getDate');
  });
});

describe('sourceText: regex literals', () => {
  it('sees the rest of the line after a regex that follows `return`', () => {
    const sf = parseSource(
      'function f(u: string) { return /https?:\\/\\//.test(u) ? new Date(u).getDate() : 0; }'
    );
    expect(findCalls(sf, 'getDate')).toHaveLength(1);
    expect(findNewExpressions(sf, 'Date')).toHaveLength(1);
  });

  it('sees the rest of the line after a regex that follows `typeof`', () => {
    const sf = parseSource("declare const d: Date; if (typeof /\\/\\// === 'object') d.getDate();");
    expect(findCalls(sf, 'getDate')).toHaveLength(1);
  });

  it('does not throw on a quote inside a regex, and finds nothing that is not there', () => {
    const sf = parseSource("function g(s: string) { return /'/.test(s); }");
    expect(findCalls(sf, 'test')).toHaveLength(1);
    expect(findCalls(sf, 'getDate')).toEqual([]);
    expect(staticTexts(sf)).toEqual([]);
  });
});

describe('sourceText: JSX text', () => {
  it('does not treat https:// in JSX text as a comment', () => {
    const sf = parseSource('const a = <p>see https://example.org {d.getDate()} today</p>;');
    expect(findCalls(sf, 'getDate')).toHaveLength(1);
    expect(staticTexts(sf)).toEqual(expect.arrayContaining(['see https://example.org ']));
  });

  it('does not treat /* in JSX text as the start of a block comment', () => {
    const sf = parseSource('const a = <p>/* {d.getDate()} */</p>;');
    expect(findCalls(sf, 'getDate')).toHaveLength(1);
  });

  it('does not treat backticks in JSX text as a template', () => {
    const sf = parseSource('const a = <p>`{d.getDate()}`</p>;');
    expect(findCalls(sf, 'getDate')).toHaveLength(1);
  });

  it("does not throw on an apostrophe in JSX text, and keeps it as text", () => {
    const sf = parseSource("const a = <p>Don't</p>;");
    expect(staticTexts(sf)).toEqual(["Don't"]);
    expect(findCalls(sf, 'getDate')).toEqual([]);
  });
});

describe('sourceText: comments', () => {
  it('never reports code that only appears in a comment', () => {
    const sf = parseSource(
      [
        '// d.getDate() and new Date(iso)',
        '/* iso.split("T") */',
        '/** `Date.parse(iso)` */',
        'const a = <p>{/* d.getDay() */}</p>;',
        'export const x = 1;',
      ].join('\n')
    );
    expect(findCalls(sf, ['getDate', 'getDay', 'split', 'parse'])).toEqual([]);
    expect(findNewExpressions(sf, 'Date')).toEqual([]);
    expect(findValueReferences(sf, 'Date')).toEqual([]);
  });
});

describe('sourceText: member reads however they are spelled', () => {
  it('finds a method called through element access with a literal key', () => {
    const sf = parseSource("const n = d['getDate'](); const m = d[`getDay`]();");
    expect(findCalls(sf, ['getDate', 'getDay'])).toHaveLength(2);
  });

  it('finds optional, parenthesised and uncalled reads, and destructuring', () => {
    const sf = parseSource(
      [
        'const a = d?.getDate();',
        'const b = (d.getDate)();',
        'const c = d.getDate;',
        'const { getDate } = d;',
        "const { 'getDate': renamed } = d;",
      ].join('\n')
    );
    expect(findCalls(sf, 'getDate')).toHaveLength(2);
    expect(findMemberReferences(sf, 'getDate')).toHaveLength(5);
  });

  it('flags a call through a computed key it cannot read, and not a literal one', () => {
    const sf = parseSource("const a = d[key](); const b = d['get' + 'Date'](); const c = d['getDate']();");
    expect(names(findDynamicMemberCalls(sf))).toEqual(['d[key]()', "d['get' + 'Date']()"]);
  });
});

describe('sourceText: identifiers used as values', () => {
  it('sees an alias of Date, and the new through the alias', () => {
    const sf = parseSource('const D = Date; const d = new D(iso);');
    expect(findValueReferences(sf, 'Date')).toHaveLength(1);
    expect(findNewExpressions(sf, 'D')).toHaveLength(1);
    expect(findNewExpressions(sf, 'Date')).toEqual([]);
  });

  it('ignores Date in types, member names and keys, and sees class extends', () => {
    const sf = parseSource(
      [
        'function f(x: Date): Date { return x as Date; }',
        'interface I { Date: Date }',
        'const o = { Date: 1 };',
        'const p = o.Date;',
        'class Mine extends Date {}',
      ].join('\n')
    );
    expect(names(findValueReferences(sf, 'Date'))).toEqual(['Date']);
    expect(findValueReferences(sf, 'Date')[0]!.parent.parent.getText()).toBe('extends Date');
  });
});

describe('sourceText: a file it cannot parse', () => {
  it('throws with the file name rather than scanning a recovered tree', () => {
    expect(() => parseSource('const x = (;', 'Broken.tsx')).toThrow(/Broken\.tsx does not parse/);
  });

  it('parses .ts as TypeScript, so an angle-bracket cast is not JSX', () => {
    expect(() => parseSource('const n = <number>value;', 'cast.ts')).not.toThrow();
  });
});
