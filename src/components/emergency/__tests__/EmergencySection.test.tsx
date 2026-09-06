import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import '@/i18n';
import { EmergencyAccordionSection } from '../EmergencySection';

// Generic accordion shell shared by the doctors/contacts/insurance sections
// (EmergencyInfoPage). Exercised here with a trivial string-item type — the
// real callers supply Doctor/Contact/InsurancePlan and a card-rendering
// `renderItem`, but the shell itself doesn't care about the item shape.

function Host({
  items,
  canEdit,
  onAdd,
}: {
  items: string[];
  canEdit: boolean;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <EmergencyAccordionSection
      id="doctors"
      title="Doctors"
      open={open}
      onToggle={() => setOpen((o) => !o)}
      count={items.length}
      items={items}
      renderItem={(item, index) => <p key={index}>{item}</p>}
      canEdit={canEdit}
      onAdd={onAdd}
      addLabel="Add doctor"
      emptyMessage="No doctors added yet"
    />
  );
}

describe('EmergencyAccordionSection', () => {
  it('renders the Accordion header with the item count as meta', () => {
    render(<Host items={['Dr. Chen', 'Dr. Patel']} canEdit={false} onAdd={vi.fn()} />);

    const header = screen.getByRole('button', { name: /Doctors/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(header).toHaveTextContent('2');

    const region = screen.getByRole('region', { name: 'Doctors' });
    expect(region).toBeInTheDocument();
  });

  it('maps items through renderItem inside the panel', () => {
    render(<Host items={['Dr. Chen', 'Dr. Patel']} canEdit={false} onAdd={vi.fn()} />);

    expect(screen.getByText('Dr. Chen')).toBeInTheDocument();
    expect(screen.getByText('Dr. Patel')).toBeInTheDocument();
    // No count -> no add button, no empty state, when there ARE items and
    // canEdit is false.
    expect(screen.queryByRole('button', { name: 'Add doctor' })).not.toBeInTheDocument();
    expect(screen.queryByText('No doctors added yet')).not.toBeInTheDocument();
  });

  it('shows a trailing Add button after the items when canEdit is true', () => {
    const onAdd = vi.fn();
    render(<Host items={['Dr. Chen']} canEdit onAdd={onAdd} />);

    const addButton = screen.getByRole('button', { name: 'Add doctor' });
    fireEvent.click(addButton);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders EmptySection (no meta count) when there are no items', () => {
    render(<Host items={[]} canEdit={false} onAdd={vi.fn()} />);

    const header = screen.getByRole('button', { name: 'Doctors' });
    expect(header).not.toHaveTextContent(/\d/);
    expect(screen.getByText('No doctors added yet')).toBeInTheDocument();
    // Not editable -> the download-app CTA, not an Add button.
    expect(screen.queryByRole('button', { name: 'Add doctor' })).not.toBeInTheDocument();
    expect(screen.getByText('Download the app')).toBeInTheDocument();
  });

  it('replaces the download CTA with an Add button in the empty state when canEdit is true', () => {
    const onAdd = vi.fn();
    render(<Host items={[]} canEdit onAdd={onAdd} />);

    expect(screen.queryByText('Download the app')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add doctor' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('collapses via onToggle while keeping panel content mounted', () => {
    render(<Host items={['Dr. Chen']} canEdit={false} onAdd={vi.fn()} />);

    const header = screen.getByRole('button', { name: /Doctors/ });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Dr. Chen')).toBeInTheDocument();
  });
});
