import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { type ReactElement } from 'react';

// PageviewTracker — fires a sanitized $pageview on initial load and on every
// route change, and NEVER captures hash/search (the OAuth callback token
// fragment is the whole reason auto-capture stays off). We mock posthog-js and
// force VITE_POSTHOG_KEY on so the real trackPageview/sanitizePath chain runs.

// vi.hoisted: the static PageviewTracker import below evaluates the mocked
// modules during hoisting, before ordinary `const` initializers would run.
const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture,
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon',
    VITE_API_URL: 'http://localhost:3000',
    VITE_POSTHOG_KEY: 'phc_test_key',
  },
}));

import { PageviewTracker } from '@/components/PageviewTracker';

const CIRCLE_ID = '0bc0bd9e-1234-4abc-9def-1234567890ab';

function Harness(): ReactElement {
  const navigate = useNavigate();
  return (
    <>
      <PageviewTracker />
      <button onClick={() => navigate(`/circles/${CIRCLE_ID}/calendar`)}>go</button>
    </>
  );
}

function renderAt(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Harness />
    </MemoryRouter>
  );
}

beforeEach(() => {
  capture.mockClear();
});

describe('PageviewTracker', () => {
  it('fires a $pageview on initial load', () => {
    renderAt('/login');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.location.origin}/login`,
      $pathname: '/login',
    });
  });

  it('fires again on every route change, with dynamic segments masked', () => {
    renderAt('/circles');
    expect(capture).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenLastCalledWith('$pageview', {
      $current_url: `${window.location.origin}/circles/[id]/calendar`,
      $pathname: '/circles/[id]/calendar',
    });
  });

  it('never captures hash or search even when the location has them', () => {
    // The OAuth callback lands with a token fragment + query state — the
    // captured properties must contain neither.
    renderAt('/auth/callback?state=abc#access_token=super-secret');

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0] as [string, Record<string, string>];
    expect(event).toBe('$pageview');
    expect(props.$pathname).toBe('/auth/callback');
    for (const value of Object.values(props)) {
      expect(value).not.toContain('?');
      expect(value).not.toContain('#');
      expect(value).not.toContain('secret');
      expect(value).not.toContain('state=');
    }
  });
});
