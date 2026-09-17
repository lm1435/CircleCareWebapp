/**
 * Print a self-contained HTML document from a hidden iframe (plan decision 7).
 *
 * WHY AN IFRAME, NOT A NEW TAB OR `window.print()` ON THE PAGE. The shared PDF
 * templates are complete documents with their own stylesheet; printing the
 * app page would drag its layout and `print.css` into the output, and a popup
 * is blocked by default in every browser. A same-origin `srcdoc` iframe renders
 * the document exactly as mobile's print path does and needs no permission.
 *
 * WHAT CAN AND CANNOT BE OBSERVED. `contentWindow.print()` opens a modal
 * dialog; whether the user saved, printed or cancelled is invisible to the
 * page, so the promise resolves as soon as the dialog has been REQUESTED.
 * Cleanup (iframe removal, title restore) happens on the iframe window's
 * `afterprint` or, for engines that never fire it on a frame, a fallback timer.
 *
 * THE TITLE. Browsers default the "Save as PDF" file name to a document title
 * — some read the printed frame's, some the top page's — so BOTH are set to
 * the mobile file name (`CircleCare_Summary_<Name>` …) for the dialog's
 * lifetime, and the page's is restored afterwards (only if nothing else has
 * changed it in the meantime).
 *
 * ERRORS carry a CODE and nothing else: never a message from the DOM, the
 * document, or the browser — the file name holds the care recipient's name.
 */

export type PrintErrorCode = 'PRINT_FAILED' | 'PRINT_TIMEOUT';

export class PrintError extends Error {
  readonly code: PrintErrorCode;

  constructor(code: PrintErrorCode) {
    super(code);
    this.name = 'PrintError';
    this.code = code;
  }
}

/** How long the iframe may take to fire `load` before the export gives up. */
export const PRINT_LOAD_TIMEOUT_MS = 10_000;

/** Fallback after `print()` for engines that never fire `afterprint` on a frame. */
export const PRINT_CLEANUP_MS = 60_000;

export interface PrintHtmlOptions {
  /** A complete HTML document (the shared template's output). */
  html: string;
  /** The file-name-shaped document title the save dialog should default to. */
  title: string;
}

function createHiddenIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  return iframe;
}

/** Resolve on the iframe's `load`; reject with PRINT_TIMEOUT if it never comes. */
function waitForLoad(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      iframe.removeEventListener('load', onLoad);
      reject(new PrintError('PRINT_TIMEOUT'));
    }, PRINT_LOAD_TIMEOUT_MS);
    const onLoad = () => {
      clearTimeout(timer);
      resolve();
    };
    iframe.addEventListener('load', onLoad, { once: true });
  });
}

export async function printHtml({ html, title }: PrintHtmlOptions): Promise<void> {
  const previousTitle = document.title;
  let iframe: HTMLIFrameElement | null = null;
  let titleApplied = false;

  const restoreTitle = () => {
    // Only undo OUR change: if the app has since navigated and set its own
    // title, leave it alone.
    if (titleApplied && document.title === title) document.title = previousTitle;
    titleApplied = false;
  };

  try {
    iframe = createHiddenIframe();
    // Listen BEFORE the frame is attached: with `srcdoc` already set, an
    // engine may fire `load` synchronously on insertion.
    const loaded = waitForLoad(iframe);
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
    await loaded;

    const frameWindow = iframe.contentWindow;
    if (!frameWindow) throw new PrintError('PRINT_FAILED');

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      frameWindow.removeEventListener('afterprint', finish);
      restoreTitle();
      iframe?.remove();
    };
    const fallback = setTimeout(finish, PRINT_CLEANUP_MS);
    frameWindow.addEventListener('afterprint', finish);

    try {
      frameWindow.document.title = title;
    } catch {
      // A frame document we cannot reach is not fatal — the page title below
      // still steers the dialog in the engines that read it.
    }
    document.title = title;
    titleApplied = true;

    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      finish();
      throw new PrintError('PRINT_FAILED');
    }
    // The dialog is modal and unobservable from here: the export has been
    // handed to the browser. `finish` runs on afterprint or the fallback.
  } catch (err) {
    restoreTitle();
    iframe?.remove();
    if (err instanceof PrintError) throw err;
    throw new PrintError('PRINT_FAILED');
  }
}
