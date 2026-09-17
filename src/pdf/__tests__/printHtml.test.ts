/**
 * `printHtml` under jsdom: the iframe lifecycle, the title dance, and the
 * error contract (a CODE, never DOM content).
 *
 * jsdom does not implement `srcdoc` navigation or `print()`, so the frame's
 * `load` is dispatched by hand and `contentWindow.print` is stubbed on the
 * real frame window after it is attached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRINT_CLEANUP_MS,
  PRINT_LOAD_TIMEOUT_MS,
  PrintError,
  printHtml,
} from '../printHtml';

const HTML = '<!DOCTYPE html><html><head></head><body><p>hello</p></body></html>';

function currentIframe(): HTMLIFrameElement {
  const iframe = document.body.querySelector('iframe');
  if (!iframe) throw new Error('no iframe appended');
  return iframe;
}

/**
 * Stub `print`/`focus` on the frame window, then fire `load`. Returns the
 * stubs so a test can assert on them. Runs on the next macrotask so that
 * `printHtml` has attached the frame first.
 */
function loadFrame(opts: { printImpl?: () => void } = {}) {
  const print = vi.fn(opts.printImpl);
  const focus = vi.fn();
  const iframe = currentIframe();
  const win = iframe.contentWindow as Window & typeof globalThis;
  Object.defineProperty(win, 'print', { value: print, configurable: true });
  Object.defineProperty(win, 'focus', { value: focus, configurable: true });
  iframe.dispatchEvent(new Event('load'));
  return { print, focus, iframe, win };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.title = 'CircleCare';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('printHtml', () => {
  it('appends a hidden, aria-hidden iframe with the document as srcdoc', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Summary_Ada' });
    const iframe = currentIframe();
    expect(iframe.srcdoc).toBe(HTML);
    expect(iframe.getAttribute('aria-hidden')).toBe('true');
    expect(iframe.tabIndex).toBe(-1);
    expect(iframe.style.position).toBe('fixed');
    expect(iframe.style.width).toBe('0px');
    expect(iframe.style.height).toBe('0px');
    expect(iframe.style.border).toBe('0px');
    loadFrame();
    await pending;
  });

  it('calls focus() then print() on the frame window only after load, and resolves', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Summary_Ada' });
    // Not yet loaded: nothing printed.
    const iframe = currentIframe();
    const win = iframe.contentWindow as Window & typeof globalThis;
    const earlyPrint = vi.fn();
    Object.defineProperty(win, 'print', { value: earlyPrint, configurable: true });
    await Promise.resolve();
    expect(earlyPrint).not.toHaveBeenCalled();

    const { print, focus } = loadFrame();
    await expect(pending).resolves.toBeUndefined();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(print.mock.invocationCallOrder[0]);
  });

  it('sets the page title (and the frame title) for the dialog, restoring it on afterprint', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Summary_Ada' });
    let titleDuringPrint = '';
    const { win } = loadFrame({
      printImpl: () => {
        titleDuringPrint = document.title;
      },
    });
    await pending;
    expect(titleDuringPrint).toBe('CircleCare_Summary_Ada');
    expect(win.document.title).toBe('CircleCare_Summary_Ada');
    // Dialog still open (no afterprint yet): title stays for the dialog.
    expect(document.title).toBe('CircleCare_Summary_Ada');

    win.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('CircleCare');
    expect(document.body.querySelector('iframe')).toBeNull();
  });

  it('removes the iframe on the fallback timer when afterprint never fires', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Adherence_Ada_30d' });
    loadFrame();
    await pending;
    expect(document.body.querySelector('iframe')).not.toBeNull();

    vi.advanceTimersByTime(PRINT_CLEANUP_MS - 1);
    expect(document.body.querySelector('iframe')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.body.querySelector('iframe')).toBeNull();
    expect(document.title).toBe('CircleCare');
  });

  it('does not clobber a title the app changed while the dialog was open', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Summary_Ada' });
    const { win } = loadFrame();
    await pending;
    document.title = 'Calendar — CircleCare';
    win.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Calendar — CircleCare');
  });

  it('rejects with PRINT_TIMEOUT (and removes the frame) when load never fires', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Summary_Ada' });
    const rejection = expect(pending).rejects.toMatchObject({ code: 'PRINT_TIMEOUT' });
    vi.advanceTimersByTime(PRINT_LOAD_TIMEOUT_MS);
    await rejection;
    expect(document.body.querySelector('iframe')).toBeNull();
    expect(document.title).toBe('CircleCare');
  });

  it('rejects with PRINT_FAILED when print() throws, carrying no DOM/message content', async () => {
    const pending = printHtml({ html: HTML, title: 'CircleCare_Summary_Ada' });
    loadFrame({
      printImpl: () => {
        throw new Error('Ada Lovelace secret-medication.pdf could not be printed');
      },
    });
    let caught: unknown;
    try {
      await pending;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrintError);
    const error = caught as PrintError;
    expect(error.code).toBe('PRINT_FAILED');
    expect(error.message).toBe('PRINT_FAILED');
    expect(error.message).not.toContain('Ada');
    expect(document.body.querySelector('iframe')).toBeNull();
    expect(document.title).toBe('CircleCare');
  });

  it('exposes the two timing constants the hooks and tests rely on', () => {
    expect(PRINT_LOAD_TIMEOUT_MS).toBe(10_000);
    expect(PRINT_CLEANUP_MS).toBe(60_000);
  });
});
