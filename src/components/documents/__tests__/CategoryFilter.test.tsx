import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { CategoryFilter } from '../CategoryFilter';

describe('CategoryFilter', () => {
  it('renders All plus every document category as a checked-state radio chip', () => {
    render(<CategoryFilter selected="all" onSelect={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'Filter by category' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
    for (const label of ['Medical Records', 'Insurance', 'Legal', 'Prescriptions', 'Other']) {
      expect(screen.getByRole('radio', { name: label })).not.toBeChecked();
    }
  });

  it('reports the clicked category', () => {
    const onSelect = vi.fn();
    render(<CategoryFilter selected="all" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Legal' }));
    expect(onSelect).toHaveBeenCalledWith('legal');
  });

  it('does not deselect (clear the filter) when clicking the already-selected chip', () => {
    const onSelect = vi.fn();
    render(<CategoryFilter selected="legal" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Legal' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
