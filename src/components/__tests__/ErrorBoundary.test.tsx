import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@/i18n'; // side-effect: initialize i18next so fallback strings resolve
import { ErrorBoundary } from '@/components/ErrorBoundary';
import * as analytics from '@/lib/posthog';

// A child that throws on demand so we can drive the boundary into and out of its
// error state.
let shouldThrow = true;
function Child(): JSX.Element {
  if (shouldThrow) throw new Error('boom');
  return <div>recovered content</div>;
}

describe('ErrorBoundary', () => {
  it('renders the fallback, captures the error, and recovers on retry', () => {
    shouldThrow = true;
    const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
    // React logs the caught error to console.error; silence it for a clean run.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary boundary="test">
        <Child />
      </ErrorBoundary>
    );

    // Fallback shown instead of a blank tree.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my circles' })).toHaveAttribute(
      'href',
      '/circles'
    );

    // Error forwarded to PostHog with the boundary label (PHI-safe).
    expect(capture).toHaveBeenCalledWith(expect.any(Error), 'test');

    // Retry after the underlying issue is resolved → children render again.
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    capture.mockRestore();
    consoleError.mockRestore();
  });
});
