import { render, screen, fireEvent } from '@testing-library/react';
import { UndoBadge } from '../UndoBadge';

describe('UndoBadge', () => {
  it('renders the status label and the undo label', () => {
    render(
      <UndoBadge kind="taken" label="Taken" undoLabel="Undo" onUndo={() => {}} />
    );
    expect(screen.getByText('Taken')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('calls onUndo when the Undo button is clicked', () => {
    const onUndo = vi.fn();
    render(
      <UndoBadge kind="done" label="Done" undoLabel="Undo" onUndo={onUndo} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('announces itself as a polite status region', () => {
    render(
      <UndoBadge kind="taken" label="Taken" undoLabel="Undo" onUndo={() => {}} />
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('drains the progress bar with the cc-countdown animation over the given duration', () => {
    const { container } = render(
      <UndoBadge
        kind="taken"
        label="Taken"
        undoLabel="Undo"
        onUndo={() => {}}
        durationMs={3000}
      />
    );
    const bar = container.querySelector('[aria-hidden]:last-child') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.animation).toContain('cc-countdown');
    expect(bar.style.animation).toContain('3000ms');
  });

  it('defaults the progress duration to 5000ms', () => {
    const { container } = render(
      <UndoBadge kind="taken" label="Taken" undoLabel="Undo" onUndo={() => {}} />
    );
    const bar = container.querySelector('[aria-hidden]:last-child') as HTMLElement;
    expect(bar.style.animation).toContain('5000ms');
  });

  it('uses the moss-soft/moss-deep taken look for kind="taken" and "done"', () => {
    const { container: takenContainer } = render(
      <UndoBadge kind="taken" label="Taken" undoLabel="Undo" onUndo={() => {}} />
    );
    const takenRow = takenContainer.querySelector('[role="status"] > div') as HTMLElement;
    expect(takenRow.className).toContain('bg-moss-soft');
    expect(screen.getByText('Taken').className).toContain('text-moss-deep');
  });

  it('disambiguates the Undo button with itemLabel when several badges are open at once', () => {
    render(
      <UndoBadge
        kind="taken"
        label="Taken"
        undoLabel="Undo"
        itemLabel="Metformin"
        onUndo={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Undo Metformin' })).toBeInTheDocument();
  });

  it('falls back to the plain undoLabel as the accessible name when itemLabel is omitted', () => {
    render(
      <UndoBadge kind="taken" label="Taken" undoLabel="Undo" onUndo={() => {}} />
    );
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).not.toHaveAttribute('aria-label');
  });

  it('uses the muted line-2/ink-2/ink-3 look for kind="skipped"', () => {
    const { container } = render(
      <UndoBadge kind="skipped" label="Skipped" undoLabel="Undo" onUndo={() => {}} />
    );
    const row = container.querySelector('[role="status"] > div') as HTMLElement;
    expect(row.className).toContain('bg-line-2');
    expect(screen.getByText('Skipped').className).toContain('text-ink-2');
    const bar = container.querySelector('[aria-hidden]:last-child') as HTMLElement;
    expect(bar.className).toContain('bg-ink-3');
  });
});
