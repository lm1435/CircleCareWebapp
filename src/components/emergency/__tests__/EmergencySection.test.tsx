import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { EmergencyListSection } from '../EmergencySection';

// Generic list section shared by the doctors/contacts/insurance sections
// (EmergencyInfoPage). ALWAYS OPEN, as on mobile (1.4.3: the web-only accordions
// are gone). Exercised with a trivial string-item type.

function Host({
  items,
  canEdit,
  onAdd,
}: {
  items: string[];
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <EmergencyListSection
      id="doctors"
      title="Doctors"
      items={items}
      renderItem={(item: string, index: number) => <p key={index}>{item}</p>}
      canEdit={canEdit}
      onAdd={onAdd}
      addLabel="Add doctor"
      emptyMessage="No doctors added yet"
    />
  );
}

describe('EmergencyListSection', () => {
  it('POSITIVE: a heading section (anchor id) whose items are always visible', () => {
    render(<Host items={['Dr. Chen', 'Dr. Patel']} canEdit={false} onAdd={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Doctors' })).toBeInTheDocument();
    expect(document.getElementById('doctors')).not.toBeNull();
    expect(screen.getByText('Dr. Chen')).toBeVisible();
    expect(screen.getByText('Dr. Patel')).toBeVisible();
  });

  it('NEGATIVE: no collapse control (no expandable header), as on mobile', () => {
    render(<Host items={['Dr. Chen']} canEdit={false} onAdd={vi.fn()} />);
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Doctors/ })).toBeNull();
  });

  it('NEGATIVE: no Add button for a viewer, and no empty state when there are items', () => {
    render(<Host items={['Dr. Chen']} canEdit={false} onAdd={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add doctor' })).not.toBeInTheDocument();
    expect(screen.queryByText('No doctors added yet')).not.toBeInTheDocument();
  });

  it('POSITIVE: a trailing Add button after the items when canEdit is true', () => {
    const onAdd = vi.fn();
    render(<Host items={['Dr. Chen']} canEdit onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add doctor' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('empty + viewer: the empty message and the download link, in the normal link style', () => {
    render(<Host items={[]} canEdit={false} onAdd={vi.fn()} />);
    expect(screen.getByText('No doctors added yet')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Download the app' });
    expect(link.className).toContain('text-moss-deep');
    expect(link.className).not.toMatch(/terracotta/);
  });

  it('empty + editor: an Add button replaces the download link', () => {
    const onAdd = vi.fn();
    render(<Host items={[]} canEdit onAdd={onAdd} />);
    expect(screen.queryByText('Download the app')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add doctor' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
