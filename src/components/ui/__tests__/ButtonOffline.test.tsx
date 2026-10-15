import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import '@/i18n';
import { Button, ToastProvider } from '@/components/ui';
import { __resetOfflineWriteForTests } from '@/lib/offlineWrite';

// `Button offlineKind`: the one switch every write button wears. Offline it is
// aria-disabled (still focusable), a press explains once instead of writing,
// and a submit button never submits its form — so the input stays as typed.

beforeEach(() => __resetOfflineWriteForTests());
afterEach(() => onlineManager.setOnline(true));

function Form({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(name);
    setName('');
  };
  return (
    <form id="f" onSubmit={submit}>
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" form="f" offlineKind="save">
        Save
      </Button>
    </form>
  );
}

describe('Button offlineKind', () => {
  it('online: an ordinary button', async () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <Button offlineKind="mark" onClick={onClick}>
          Done
        </Button>
      </ToastProvider>
    );
    const button = screen.getByRole('button', { name: 'Done' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('offline: aria-disabled, focusable, and a press explains instead of running', async () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <Button offlineKind="mark" onClick={onClick}>
          Done
        </Button>
      </ToastProvider>
    );
    act(() => onlineManager.setOnline(false));
    const button = screen.getByRole('button', { name: 'Done' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled(); // native disabled would swallow the press
    button.focus();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(await screen.findByText("You're offline. Connect to mark this.")).toBeInTheDocument();

    // Reconnect: live again.
    act(() => onlineManager.setOnline(true));
    expect(button).not.toHaveAttribute('aria-disabled');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('offline: Save never submits — click or Enter — and the typed input stays', async () => {
    const onSave = vi.fn();
    render(
      <ToastProvider>
        <Form onSave={onSave} />
      </ToastProvider>
    );
    const input = screen.getByLabelText('Name');
    await userEvent.type(input, 'Ana');

    act(() => onlineManager.setOnline(false));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(input).toHaveValue('Ana');
    expect(await screen.findByText("You're offline. Connect to save this.")).toBeInTheDocument();

    // Enter in the field: implicit submission clicks the default button.
    await userEvent.type(input, '{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(input).toHaveValue('Ana');

    act(() => onlineManager.setOnline(true));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('Ana');
  });

  it('a natively disabled button stays plainly disabled offline (nothing to explain)', () => {
    render(
      <ToastProvider>
        <Button offlineKind="save" disabled>
          Save
        </Button>
      </ToastProvider>
    );
    act(() => onlineManager.setOnline(false));
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('data-offline-disabled');
  });
});
