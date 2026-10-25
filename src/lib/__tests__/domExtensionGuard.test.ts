import { createElement, Component, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomExtensionGuard, __resetDomExtensionGuardForTests } from '../domExtensionGuard';

// The guard patches Node.prototype GLOBALLY, so every test snapshots the native
// methods in beforeEach and restores them (and re-arms the one-shot flag) in
// afterEach. That also lets the "without the guard" falsification test run
// against genuinely native jsdom behaviour regardless of test order.

const nativeRemoveChild = Node.prototype.removeChild;
const nativeInsertBefore = Node.prototype.insertBefore;

beforeEach(() => {
  Node.prototype.removeChild = nativeRemoveChild;
  Node.prototype.insertBefore = nativeInsertBefore;
  __resetDomExtensionGuardForTests();
});

afterEach(() => {
  Node.prototype.removeChild = nativeRemoveChild;
  Node.prototype.insertBefore = nativeInsertBefore;
  __resetDomExtensionGuardForTests();
});

/** What Chrome Translate does to a text node: move it into a <font> that takes its place. */
function simulateTranslate(el: Element): HTMLElement {
  const text = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE) as Text;
  const font = document.createElement('font');
  el.insertBefore(font, text);
  font.appendChild(text);
  return font;
}

describe('installDomExtensionGuard', () => {
  it('removeChild on a re-parented child returns it without throwing', () => {
    installDomExtensionGuard();
    const a = document.createElement('div');
    const b = document.createElement('div');
    const child = document.createElement('span');
    a.appendChild(child);
    b.appendChild(child); // moved elsewhere, as translate does

    let result: Node | undefined;
    expect(() => {
      result = a.removeChild(child);
    }).not.toThrow();
    expect(result).toBe(child);
    expect(child.parentNode).toBe(b);
  });

  it('removeChild on a normal child still removes it', () => {
    installDomExtensionGuard();
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    expect(parent.removeChild(child)).toBe(child);
    expect(parent.childNodes.length).toBe(0);
    expect(child.parentNode).toBeNull();
  });

  it('insertBefore with a foreign reference appends instead of throwing', () => {
    installDomExtensionGuard();
    const parent = document.createElement('div');
    const existing = document.createElement('i');
    parent.appendChild(existing);
    const elsewhere = document.createElement('div');
    const stale = document.createElement('b');
    elsewhere.appendChild(stale);
    const added = document.createElement('span');

    expect(() => parent.insertBefore(added, stale)).not.toThrow();
    expect(Array.from(parent.childNodes)).toEqual([existing, added]);
  });

  it('insertBefore with a real reference (or null) keeps native positioning', () => {
    installDomExtensionGuard();
    const parent = document.createElement('div');
    const first = document.createElement('i');
    const last = document.createElement('u');
    parent.append(first, last);
    const mid = document.createElement('b');
    const tail = document.createElement('s');

    expect(parent.insertBefore(mid, last)).toBe(mid);
    parent.insertBefore(tail, null);
    expect(Array.from(parent.childNodes)).toEqual([first, mid, last, tail]);
  });

  it('is idempotent: a second install does not re-wrap', () => {
    installDomExtensionGuard();
    const patchedRemove = Node.prototype.removeChild;
    const patchedInsert = Node.prototype.insertBefore;
    expect(patchedRemove).not.toBe(nativeRemoveChild);
    installDomExtensionGuard();
    expect(Node.prototype.removeChild).toBe(patchedRemove);
    expect(Node.prototype.insertBefore).toBe(patchedInsert);

    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    parent.removeChild(child);
    expect(parent.childNodes.length).toBe(0);
  });

  it('warns in dev on a skipped removeChild', () => {
    installDomExtensionGuard();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = document.createElement('div');
    a.removeChild(document.createElement('span'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('React integration (simulated Chrome Translate)', () => {
  // Bare text node inside a <button>; toggling `show` makes React removeChild() it.
  // The sibling <span> matters: a lone string child is set via textContent (no
  // separate text node, no removeChild), so the text must share the parent.
  function Toggle({ show }: { show: boolean }) {
    return createElement('button', { type: 'button' }, createElement('span'), show ? 'Save entry' : null);
  }

  class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    render() {
      return this.state.error
        ? createElement('p', { 'data-testid': 'fallback' }, this.state.error.name)
        : this.props.children;
    }
  }

  it('WITHOUT the guard, removing a translated text node crashes (falsification)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender, getByTestId } = render(
      createElement(Boundary, null, createElement(Toggle, { show: true }))
    );
    simulateTranslate(container.querySelector('button')!);

    rerender(createElement(Boundary, null, createElement(Toggle, { show: false })));
    // React's commit threw NotFoundError and the boundary caught it.
    expect(getByTestId('fallback').textContent).toBe('NotFoundError');
    errSpy.mockRestore();
  });

  it('WITH the guard, the same scenario re-renders without error', () => {
    installDomExtensionGuard();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, rerender, queryByTestId } = render(
      createElement(Boundary, null, createElement(Toggle, { show: true }))
    );
    const button = container.querySelector('button')!;
    const font = simulateTranslate(button);

    expect(() =>
      rerender(createElement(Boundary, null, createElement(Toggle, { show: false })))
    ).not.toThrow();
    expect(queryByTestId('fallback')).toBeNull();
    // The app is intact and the button survived; the translate wrapper is left
    // for React to dispose of with the button itself.
    expect(container.querySelector('button')).toBe(button);
    expect(button.contains(font)).toBe(true);

    // And React keeps working afterwards: show the text again, then unmount.
    expect(() =>
      rerender(createElement(Boundary, null, createElement(Toggle, { show: true })))
    ).not.toThrow();
    expect(queryByTestId('fallback')).toBeNull();
    expect(button.textContent).toContain('Save entry');
    expect(() => rerender(createElement('div'))).not.toThrow();
    expect(container.querySelector('button')).toBeNull();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
