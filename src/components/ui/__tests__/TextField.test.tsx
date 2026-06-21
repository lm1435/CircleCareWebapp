import { fireEvent, render, screen } from '@testing-library/react';
import { TextField } from '../TextField';

describe('TextField', () => {
  it('renders a label associated with the input', () => {
    render(<TextField id="title" label="Title" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Title');
    expect(input).toBe(screen.getByRole('textbox'));
  });

  it('wires aria-invalid + aria-describedby to the error text', () => {
    render(<TextField id="title" label="Title" error="Title is required" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorText = screen.getByText('Title is required');
    expect(errorText).toHaveAttribute('id', 'title-error');
    expect(input.getAttribute('aria-describedby')).toContain('title-error');
  });

  it('describes the input by the hint when no error', () => {
    render(<TextField id="title" label="Title" hint="Up to 150 characters" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Title');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.getAttribute('aria-describedby')).toContain('title-hint');
  });

  it('reflects the disabled state', () => {
    render(<TextField id="title" label="Title" disabled value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Title')).toBeDisabled();
  });

  it('forwards changes to the controlled handler', () => {
    const onChange = vi.fn();
    render(<TextField id="title" label="Title" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Metformin' } });
    expect(onChange).toHaveBeenCalled();
  });
});
