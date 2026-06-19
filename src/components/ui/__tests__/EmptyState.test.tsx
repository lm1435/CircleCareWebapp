import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the icon tile, title, and description', () => {
    render(
      <EmptyState
        icon={<svg data-testid="glyph" />}
        title="No documents yet"
        description="They will appear here."
      />
    );
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByText('They will appear here.')).toBeInTheDocument();
  });

  it('omits the description when not provided', () => {
    render(<EmptyState icon={<svg />} title="Empty" />);
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.queryByText('They will appear here.')).not.toBeInTheDocument();
  });

  it('does not render the title as a heading element', () => {
    render(<EmptyState icon={<svg />} title="Empty" />);
    // Pages such as Emergency Info rely on the empty state introducing no extra
    // headings into the document outline.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders the action slot children', () => {
    render(
      <EmptyState icon={<svg />} title="Empty">
        <button>Download the app</button>
      </EmptyState>
    );
    expect(screen.getByRole('button', { name: 'Download the app' })).toBeInTheDocument();
  });
});
