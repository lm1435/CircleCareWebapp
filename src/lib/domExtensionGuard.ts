/**
 * Global DOM tolerance shim for browser translation and extensions.
 *
 * THE BUG THIS PREVENTS. Chrome/Edge auto-translate (Google Translate) and a
 * long tail of extensions (Grammarly, dark-mode, password managers) rewrite the
 * live DOM behind React's back. Translate wraps every text node in a
 * `<font>` element: the text node is MOVED into the `<font>`, and the `<font>`
 * takes its place. React still holds a reference to the original text node and
 * believes its parent is the original element. When React later unmounts or
 * replaces that text, it calls `parent.removeChild(textNode)` and the browser
 * throws `NotFoundError: Failed to execute 'removeChild' on 'Node': The node to
 * be removed is not a child of this node`. The same drift breaks
 * `insertBefore` when the reference sibling was re-parented. Because the throw
 * happens inside React's commit phase, it escapes to the nearest ErrorBoundary
 * and the whole screen is replaced by the fallback.
 *
 * Real-world impact: PostHog error-tracking issue
 * 01a1558c-b7c9-70d3-9ec2-137df68bad6e (fatal removeChild NotFoundError,
 * boundary `circle-page`) — 39 occurrences / 5 users since 2026-10-19, all
 * Chrome on Windows with an es-US browser locale. Signed-in users are forced to
 * their account language (en), so Spanish-locale browsers saw English and
 * reached for Translate. Upstream: https://github.com/facebook/react/issues/11538
 * (open since 2017; React 18 has no fix).
 *
 * THE FIX is the industry-standard shim: make `removeChild` and `insertBefore`
 * tolerant of a parent mismatch.
 *   - removeChild: the child is no longer ours (translate moved it), so there is
 *     nothing for React to remove here. Return it and carry on. The `<font>`
 *     wrapper that now holds the text is disposed of with its own subtree when
 *     React removes the surrounding element.
 *   - insertBefore: the reference sibling is no longer our child, so the
 *     position is unknowable. Append instead — the node lands in the right
 *     parent, which beats crashing the page.
 * When the relationship is intact both methods delegate to the native
 * implementation untouched, so behaviour for everyone else is identical.
 *
 * Why it is dependency-free and installed first (see main.tsx): React must
 * never see the unpatched methods, and this runs before PostHog, i18n or
 * anything else could throw. It deliberately carries no analytics for the same
 * reason; translate visibility comes from the language banner's events.
 *
 * Idempotent: a second call (HMR, tests) is a no-op, so the originals are never
 * wrapped twice and the patched functions keep a stable identity.
 *
 * SCOPE: the patch covers THIS document's realm — every route, lazy chunk and
 * boundary of the SPA, present and future. An iframe or popup window has its
 * own Node.prototype: if one ever renders React (today's only iframe is the
 * native PDF viewer in DocumentPreviewModal, no React inside), it needs its
 * own install.
 */

let installed = false;

export function installDomExtensionGuard(): void {
  if (installed) return;
  // SSR / Node without a DOM: nothing to patch.
  if (typeof Node !== 'function' || !Node.prototype) return;
  installed = true;

  const originalRemoveChild = Node.prototype.removeChild;
  const originalInsertBefore = Node.prototype.insertBefore;

  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (import.meta.env.DEV) {
        console.warn(
          'Skipped removeChild: node is no longer a child of this parent ' +
            '(browser translation or an extension changed the DOM).'
        );
      }
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  Node.prototype.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    newNode: T,
    reference: Node | null
  ): T {
    if (reference && reference.parentNode !== this) {
      if (import.meta.env.DEV) {
        console.warn(
          'insertBefore reference is no longer a child of this parent ' +
            '(browser translation or an extension changed the DOM); appending instead.'
        );
      }
      return this.appendChild(newNode);
    }
    return originalInsertBefore.call(this, newNode, reference) as T;
  };
}

/** Test-only: lets a suite re-arm the one-shot flag after restoring the native methods. */
export function __resetDomExtensionGuardForTests(): void {
  installed = false;
}
