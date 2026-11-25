import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { RecipientDobDialog } from '../RecipientDobDialog';
import { ToastProvider } from '@/components/ui';

// The dialog closes after a successful PATCH even when the circle refetch never settles (offline).
let patch: () => Promise<unknown> = () => Promise.resolve({});
const calls = { n: 0 };
const mutateAsync = (): Promise<unknown> => {
  calls.n += 1;
  return patch();
};
vi.mock('@/hooks/useCircleAdmin', () => ({
  useUpdateCircle: () => ({ mutateAsync, isPending: false }),
}));

function setup(): { onSaved: ReturnType<typeof vi.fn>; qc: QueryClient } {
  const qc = new QueryClient();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RecipientDobDialog circleId="c1" surface="emergency_prompt" onSaved={onSaved} onCancel={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>
  );
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1950-06-15' } });
  return { onSaved, qc };
}

describe('RecipientDobDialog save', () => {
  beforeEach(() => {
    calls.n = 0;
    patch = () => Promise.resolve({});
  });

  it('POSITIVE: closes (onSaved) after the PATCH even when the refetch never settles', async () => {
    const { onSaved, qc } = setup();
    const inv = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByTestId('recipient-dob-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(inv).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: a failed PATCH never closes the dialog nor refetches', async () => {
    patch = () => Promise.reject({ status: 500 });
    const { onSaved, qc } = setup();
    const inv = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    fireEvent.submit(document.getElementById('recipient-dob-form') as HTMLFormElement);
    await waitFor(() => expect(calls.n).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(onSaved).not.toHaveBeenCalled();
    expect(inv).not.toHaveBeenCalled();
  });
});
