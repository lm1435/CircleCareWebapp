// @vitest-environment node
//
// Node, not the suite-wide jsdom: this drives a real build script through a
// child process and has no DOM. jsdom also rewrites `import.meta.url` to an
// http:// URL, which makes `fileURLToPath` throw.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * scripts/build-locale-html.mjs derives dist/index.es.html from the built
 * dist/index.html so a Spanish sender's invite link previews in Spanish.
 *
 * THE ASSERTIONS ARE THE PRODUCT. A blind `.replace()` fails silently: a
 * future copy edit to index.html stops matching, the rewrite no-ops, and we
 * ship an English card to Spanish users with no error anywhere — nobody reads
 * their own invite preview, so that bug would live forever. These tests exist
 * to prove the script FAILS THE BUILD instead.
 *
 * Run as a real subprocess rather than by importing the module: the exit code
 * is half of the contract (`vite build && node scripts/...` only breaks if the
 * process exits non-zero), and `process.exit` cannot be observed in-process.
 */

const scriptPath = fileURLToPath(new URL('../build-locale-html.mjs', import.meta.url));

const EN_TITLE = 'CircleCare — Care for them together';
const EN_DESCRIPTION =
  "CircleCare brings families together to coordinate care — a shared calendar, medications everyone can confirm, and who's doing what. So no one carries it alone.";

/**
 * A minimal stand-in for the built index.html, carrying every string the
 * script asserts on, at the exact multiplicity the real file has (title x3,
 * description x3, invite image x2).
 */
function fixtureHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    `    <title>${EN_TITLE}</title>`,
    `    <meta name="description" content="${EN_DESCRIPTION}" />`,
    `    <meta property="og:title" content="${EN_TITLE}" />`,
    `    <meta property="og:description" content="${EN_DESCRIPTION}" />`,
    '    <meta property="og:image" content="https://my.circlecare.app/og-invite-en.jpg" />',
    '    <meta property="og:image:alt" content="CircleCare — the family caregiver app, shown on a phone" />',
    '    <meta property="og:locale" content="en_US" />',
    '    <meta property="og:locale:alternate" content="es_419" />',
    `    <meta name="twitter:title" content="${EN_TITLE}" />`,
    `    <meta name="twitter:description" content="${EN_DESCRIPTION}" />`,
    '    <meta name="twitter:image" content="https://my.circlecare.app/og-invite-en.jpg" />',
    '    <script type="module" crossorigin src="/assets/index-DEADBEEF.js"></script>',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
    '',
  ].join('\n');
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'build-locale-html-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function run(html: string) {
  const source = join(workDir, 'index.html');
  const output = join(workDir, 'index.es.html');
  writeFileSync(source, html, 'utf8');
  const result = spawnSync(process.execPath, [scriptPath, source, output], { encoding: 'utf8' });
  return { ...result, output };
}

describe('build-locale-html — the happy path', () => {
  it('exits 0 and writes the Spanish document', () => {
    const { status, output } = run(fixtureHtml());

    expect(status).toBe(0);
    const es = readFileSync(output, 'utf8');

    expect(es).toContain('<html lang="es">');
    expect(es).toContain('CircleCare — Cuídenlos juntos');
    expect(es).toContain('CircleCare reúne a la familia para coordinar el cuidado');
    expect(es).toContain('https://my.circlecare.app/og-invite-es.jpg');
    expect(es).toContain('CircleCare — la app para cuidadores familiares, en un teléfono');
    expect(es).toContain('<meta property="og:locale" content="es_419" />');
    expect(es).toContain('<meta property="og:locale:alternate" content="en_US" />');

    // Not one word of English copy survives.
    expect(es).not.toContain(EN_TITLE);
    expect(es).not.toContain(EN_DESCRIPTION);
    expect(es).not.toContain('og-invite-en.jpg');
  });

  /**
   * The reason this is a copy of the BUILT file and not a second Vite input:
   * the ES page must reference the exact same hashed chunks, or it is a second
   * bundle that can drift from the first.
   */
  it('keeps the hashed asset references byte-identical', () => {
    const { output } = run(fixtureHtml());
    expect(readFileSync(output, 'utf8')).toContain('/assets/index-DEADBEEF.js');
  });
});

describe('build-locale-html — a copy edit breaks the build', () => {
  it('exits non-zero and names the string when the title no longer matches', () => {
    const { status, stderr } = run(fixtureHtml().replaceAll(EN_TITLE, 'CircleCare — Something New'));

    expect(status).not.toBe(0);
    expect(stderr).toContain('page title');
    expect(stderr).toContain('found 0');
  });

  it('exits non-zero when only SOME occurrences of a string were edited', () => {
    // The nastiest real-world case: og:title gets reworded, <title> does not.
    // A count-blind script would rewrite two of three and ship a card whose
    // headline and browser title disagree.
    const html = fixtureHtml().replace(
      `<meta property="og:title" content="${EN_TITLE}" />`,
      '<meta property="og:title" content="CircleCare — Reworded" />'
    );
    const { status, stderr } = run(html);

    expect(status).not.toBe(0);
    expect(stderr).toContain('expected 3 occurrence(s)');
    expect(stderr).toContain('found 2');
  });

  it('exits non-zero when the description was reworded', () => {
    const { status, stderr } = run(fixtureHtml().replaceAll(EN_DESCRIPTION, 'New description.'));

    expect(status).not.toBe(0);
    expect(stderr).toContain('description');
  });

  it('exits non-zero when the og:locale tag was reformatted', () => {
    const { status, stderr } = run(
      fixtureHtml().replace('<meta property="og:locale" content="en_US" />', '<meta property="og:locale" content="en_US">')
    );

    expect(status).not.toBe(0);
    expect(stderr).toContain('og:locale');
  });

  it('writes NO output file when an assertion fails', () => {
    const { output } = run(fixtureHtml().replaceAll(EN_TITLE, 'Something else'));
    expect(() => readFileSync(output, 'utf8')).toThrow();
  });

  it('exits non-zero when the source file does not exist at all', () => {
    const missing = join(workDir, 'nope.html');
    const result = spawnSync(process.execPath, [scriptPath, missing, join(workDir, 'out.html')], {
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cannot read');
  });
});

/**
 * THE BUILD MUST ACTUALLY RUN THE SCRIPT.
 *
 * Every other test in this file proves the script does the right thing and
 * exits non-zero when it cannot. None of them prove anything RUNS it. The
 * doc-comment at the top of this file already describes the contract as
 * `vite build && node scripts/...`, and `public/.htaccess` states outright that
 * "`npm run build` derives dist/index.es.html" — but the build script did not,
 * so `dist/index.es.html` was never produced.
 *
 * The consequence is not a missing nicety. `.htaccess` rewrites any non-file
 * route carrying `?lang=es` to `index.es.html`, and the invite modal stamps
 * that param onto every link a Spanish sender copies or shares. With no such
 * file in `dist/`, the crawler and the invitee both get a 404 — Spanish invites
 * broken, English ones fine, and nothing anywhere errors.
 */
describe('the production build wires in the locale step', () => {
  it('runs build-locale-html.mjs as part of `npm run build`', () => {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.build).toContain('build-locale-html.mjs');
  });
});
