import { focusIsLost, focusMainHeading, handOffFocusSoon } from '@/lib/focusHandoff';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusHandoff', () => {
  it('focusMainHeading focuses <main>\'s h1 without making it a Tab stop', () => {
    document.body.innerHTML = '<h1>Outside</h1><main id="main"><h1>Today</h1></main>';
    expect(focusMainHeading()).toBe(true);
    const h1 = document.querySelector('main h1') as HTMLElement;
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to <main> itself, and reports false with neither', () => {
    document.body.innerHTML = '<main id="main" tabindex="-1"><p>x</p></main>';
    expect(focusMainHeading()).toBe(true);
    expect(document.activeElement?.id).toBe('main');
    document.body.innerHTML = '<div></div>';
    expect(focusMainHeading()).toBe(false);
  });

  it('handOffFocusSoon only acts when focus fell to <body>', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main id="main"><h1>Today</h1><button>Keep</button></main>';
    const keep = document.querySelector('button') as HTMLButtonElement;
    keep.focus();
    handOffFocusSoon();
    vi.runAllTimers();
    expect(document.activeElement).toBe(keep);

    keep.remove();
    expect(focusIsLost()).toBe(true);
    handOffFocusSoon();
    vi.runAllTimers();
    expect(document.activeElement?.tagName).toBe('H1');
    vi.useRealTimers();
  });
});
