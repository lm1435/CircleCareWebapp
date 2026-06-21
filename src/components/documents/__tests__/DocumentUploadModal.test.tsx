import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { StorageUsage } from '@/api/documents';
import { DocumentUploadModal } from '../DocumentUploadModal';

// ── Hook mocks ──────────────────────────────────────────────────────────────
const mutateUpload = vi.fn();
let isPending = false;
vi.mock('@/hooks/useDocuments', () => ({
  useUploadDocument: () => ({ mutate: mutateUpload, isPending }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const CIRCLE_ID = 'circle-1';
const FULL_STORAGE: StorageUsage = { used: 0, limit: 209715200 }; // 200MB free

function makeFile(name: string, sizeBytes: number, type: string): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
});

describe('DocumentUploadModal', () => {
  it('uploads a valid PDF with the derived extension and trimmed metadata', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DocumentUploadModal
        circleId={CIRCLE_ID}
        storage={FULL_STORAGE}
        canEdit
        onClose={onClose}
      />
    );

    const file = makeFile('Lab Results.pdf', 1024 * 1024, 'application/pdf');
    await user.upload(screen.getByLabelText('File'), file);

    // Label auto-fills from the file name; override it.
    const labelInput = screen.getByLabelText('Name');
    await user.clear(labelInput);
    await user.type(labelInput, '  Blood Panel  ');

    await user.selectOptions(screen.getByLabelText('Category'), 'medical_records');
    await user.type(screen.getByLabelText('Note (optional)'), '  fasting  ');

    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(mutateUpload).toHaveBeenCalledTimes(1));
    const [payload] = mutateUpload.mock.calls[0];
    expect(payload).toMatchObject({
      label: 'Blood Panel',
      category: 'medical_records',
      fileExtension: 'pdf',
      note: 'fasting',
    });
    expect(payload.file).toBe(file);
  });

  it('constrains the file picker to the allowed extensions', () => {
    render(
      <DocumentUploadModal circleId={CIRCLE_ID} storage={FULL_STORAGE} canEdit onClose={vi.fn()} />
    );
    expect(screen.getByLabelText('File')).toHaveAttribute('accept', '.jpg,.jpeg,.png,.heic,.pdf');
  });

  it('rejects an unsupported file type without calling the mutation', async () => {
    render(
      <DocumentUploadModal circleId={CIRCLE_ID} storage={FULL_STORAGE} canEdit onClose={vi.fn()} />
    );

    // Bypass the <input accept> filter (userEvent.upload honors it and silently
    // drops mismatched files) by dispatching a raw change with a .txt file, so
    // the component's own extension guard (deriveFileExtension) is exercised.
    const input = screen.getByLabelText('File') as HTMLInputElement;
    const file = makeFile('notes.txt', 1024, 'text/plain');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(mutateUpload).not.toHaveBeenCalled();
    expect(screen.getByText('Use a JPG, PNG, HEIC, or PDF file.')).toBeInTheDocument();
  });

  it('rejects a file over the 10MB per-file cap', async () => {
    const user = userEvent.setup();
    render(
      <DocumentUploadModal circleId={CIRCLE_ID} storage={FULL_STORAGE} canEdit onClose={vi.fn()} />
    );

    const file = makeFile('huge.pdf', 11 * 1024 * 1024, 'application/pdf');
    await user.upload(screen.getByLabelText('File'), file);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(mutateUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/This file is too large/)).toBeInTheDocument();
  });

  it('rejects a file that would exceed remaining circle storage', async () => {
    const user = userEvent.setup();
    // Only 1KB remaining of the 200MB tier.
    const nearlyFull: StorageUsage = { used: 209715200 - 1024, limit: 209715200 };
    render(
      <DocumentUploadModal circleId={CIRCLE_ID} storage={nearlyFull} canEdit onClose={vi.fn()} />
    );

    const file = makeFile('photo.jpg', 5 * 1024 * 1024, 'image/jpeg');
    await user.upload(screen.getByLabelText('File'), file);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(mutateUpload).not.toHaveBeenCalled();
    expect(
      screen.getByText("This file would exceed the circle's storage limit.")
    ).toBeInTheDocument();
  });

  it('disables the form and shows a notice when storage is full', () => {
    const full: StorageUsage = { used: 209715200, limit: 209715200 };
    render(<DocumentUploadModal circleId={CIRCLE_ID} storage={full} canEdit onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByLabelText('File')).toBeDisabled();
    expect(
      screen.getByText(/This circle has reached its storage limit/)
    ).toBeInTheDocument();
  });

  it('disables the form when the user cannot edit', () => {
    render(
      <DocumentUploadModal
        circleId={CIRCLE_ID}
        storage={FULL_STORAGE}
        canEdit={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByLabelText('File')).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('requires a file before submitting', async () => {
    const user = userEvent.setup();
    render(
      <DocumentUploadModal circleId={CIRCLE_ID} storage={FULL_STORAGE} canEdit onClose={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(mutateUpload).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a file to upload.')).toBeInTheDocument();
  });
});
