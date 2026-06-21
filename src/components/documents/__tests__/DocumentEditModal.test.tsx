import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CircleDocument } from '@/api/documents';
import { DocumentEditModal } from '../DocumentEditModal';

const mutateUpdate = vi.fn();
let isPending = false;
vi.mock('@/hooks/useDocuments', () => ({
  useUpdateDocument: () => ({ mutate: mutateUpdate, isPending }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const CIRCLE_ID = 'circle-1';

function makeDoc(overrides: Partial<CircleDocument> = {}): CircleDocument {
  return {
    id: 'doc-1',
    circle_id: CIRCLE_ID,
    uploaded_by: 'user-1',
    label: 'Insurance Card',
    category: 'insurance',
    note: 'front side',
    file_path: 'p',
    file_type: 'image/jpeg',
    file_size: 1024,
    created_at: '2026-05-02T12:00:00.000Z',
    updated_at: '2026-05-02T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
});

describe('DocumentEditModal', () => {
  it('sends only the changed fields', async () => {
    const user = userEvent.setup();
    render(<DocumentEditModal circleId={CIRCLE_ID} doc={makeDoc()} onClose={vi.fn()} />);

    const labelInput = screen.getByLabelText('Name');
    await user.clear(labelInput);
    await user.type(labelInput, 'Insurance Card (2026)');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const [variables] = mutateUpdate.mock.calls[0];
    expect(variables).toEqual({
      documentId: 'doc-1',
      data: { label: 'Insurance Card (2026)' },
    });
  });

  it('closes without mutating when nothing changed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DocumentEditModal circleId={CIRCLE_ID} doc={makeDoc()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks save and shows an error when the label is cleared', async () => {
    const user = userEvent.setup();
    render(<DocumentEditModal circleId={CIRCLE_ID} doc={makeDoc()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a name for this document.')).toBeInTheDocument();
  });

  it('clears the note when emptied (sends note: null)', async () => {
    const user = userEvent.setup();
    render(<DocumentEditModal circleId={CIRCLE_ID} doc={makeDoc()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Note (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const [variables] = mutateUpdate.mock.calls[0];
    expect(variables.data).toEqual({ note: null });
  });
});
