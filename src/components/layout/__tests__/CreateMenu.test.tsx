import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { CreateMenu } from '@/components/layout/CreateMenu';

describe('CreateMenu', () => {
  it('renders nothing when the viewer can neither create nor invite', () => {
    const { container } = render(
      <CreateMenu canCreate={false} canInvite={false} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });

  it('shows the five create options (no invite) when canCreate but not canInvite', async () => {
    const user = userEvent.setup();
    render(<CreateMenu canCreate canInvite={false} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByRole('menuitem', { name: 'Appointment' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Medication' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Task' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Vitals' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Document' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Invite member' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
  });

  it('shows the invite option when canInvite', async () => {
    const user = userEvent.setup();
    render(<CreateMenu canCreate canInvite onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByRole('menuitem', { name: 'Invite member' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  it('shows only the invite option when canInvite but not canCreate', async () => {
    const user = userEvent.setup();
    render(<CreateMenu canCreate={false} canInvite onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Invite member' })).toBeInTheDocument();
  });

  it('calls onSelect with the chosen kind', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CreateMenu canCreate canInvite onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Medication' }));
    expect(onSelect).toHaveBeenCalledWith('medication');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Invite member' }));
    expect(onSelect).toHaveBeenCalledWith('invite');
  });
});
