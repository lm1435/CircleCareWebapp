import { useId, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_FILE_BYTES,
  documentFormSchema,
  validateDocumentFile,
  type DocumentCategory,
  type DocumentFileExtension,
  type StorageUsage,
} from '@/api/documents';
import { useUploadDocument } from '@/hooks/useDocuments';
import { Button, Modal, Select, TextArea, TextField, useToast } from '@/components/ui';
import { formatFileSize } from './formatFileSize';

// Plan Task 3.4 — multipart document upload form built on Stage 0 primitives.
// Mirrors mobile/src/screens/* upload flow + backend createDocumentSchema:
//   label 1-200, category enum, fileExtension enum (jpg|jpeg|png|heic|pdf),
//   note ≤500, file ≤10MB AND ≤ remaining circle storage.
// The browser <input type=file> yields a real `File`; we derive `fileExtension`
// from the file name (the backend keys validation off this field, not the MIME).
// Gating: disabled when storage is full OR the requester cannot edit. Backend
// enforces 402 (free 200MB) / 413 (premium 1GB) regardless — the hook's onError
// surfaces those distinctly.

const ACCEPT = '.jpg,.jpeg,.png,.heic,.pdf';

/** Map a browser File's name/MIME to one of the backend's allowed extensions. */
function deriveFileExtension(file: File): DocumentFileExtension | null {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName === 'jpg' || fromName === 'jpeg') return fromName;
  if (fromName === 'png' || fromName === 'heic' || fromName === 'pdf') return fromName;
  // Fall back to MIME when the name lacks a usable extension.
  switch (file.type) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/heic':
      return 'heic';
    case 'application/pdf':
      return 'pdf';
    default:
      return null;
  }
}

export interface DocumentUploadModalProps {
  circleId: string;
  storage: StorageUsage;
  /** Requester may write to this circle (false → form is disabled). */
  canEdit: boolean;
  onClose: () => void;
}

interface FieldErrors {
  file?: string;
  label?: string;
  category?: string;
  note?: string;
}

export function DocumentUploadModal({
  circleId,
  storage,
  canEdit,
  onClose,
}: DocumentUploadModalProps): ReactElement {
  const { t } = useTranslation(['documents', 'common']);
  const { showToast } = useToast();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDocument(circleId);

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('medical_records');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const remainingBytes = Math.max(0, storage.limit - storage.used);
  const storageFull = remainingBytes <= 0;
  const disabled = !canEdit || storageFull;

  const categoryOptions = useMemo(
    () =>
      DOCUMENT_CATEGORIES.map((value) => ({
        value,
        label: t(`documents:categories.${value}`),
      })),
    [t]
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setErrors((prev) => ({ ...prev, file: undefined }));
    // Pre-fill the label from the file name (sans extension) when empty.
    if (selected && !label) {
      const base = selected.name.replace(/\.[^.]+$/, '').slice(0, 200);
      if (base) setLabel(base);
    }
  };

  const validate = (): {
    ok: boolean;
    fileExtension?: DocumentFileExtension;
    trimmedLabel?: string;
    trimmedNote?: string;
  } => {
    const next: FieldErrors = {};

    if (!file) {
      next.file = t('documents:upload.errors.fileRequired');
      setErrors(next);
      return { ok: false };
    }

    const fileExtension = deriveFileExtension(file);
    if (!fileExtension) {
      next.file = t('documents:upload.errors.fileType');
    } else {
      const fileCheck = validateDocumentFile(file, storage);
      if (!fileCheck.ok) {
        next.file =
          fileCheck.reason === 'too_large'
            ? t('documents:upload.errors.fileTooLarge', {
                max: formatFileSize(MAX_DOCUMENT_FILE_BYTES),
              })
            : t('documents:upload.errors.storageFull');
      }
    }

    const trimmedLabel = label.trim();
    const trimmedNote = note.trim();
    const parsed = documentFormSchema.safeParse({
      label: trimmedLabel,
      category,
      fileExtension: fileExtension ?? 'pdf',
      note: trimmedNote || undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'label' && !next.label) {
          next.label = t('documents:upload.errors.labelRequired');
        } else if (field === 'note' && !next.note) {
          next.note = t('documents:upload.errors.noteTooLong');
        }
      }
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return { ok: false };
    return { ok: true, fileExtension: fileExtension ?? undefined, trimmedLabel, trimmedNote };
  };

  const handleSubmit = (): void => {
    if (disabled || upload.isPending) return;
    const result = validate();
    if (!result.ok || !file || !result.fileExtension) return;

    upload.mutate(
      {
        file,
        label: result.trimmedLabel ?? '',
        category,
        fileExtension: result.fileExtension,
        note: result.trimmedNote || undefined,
      },
      {
        onSuccess: () => {
          showToast(t('documents:upload.success'), 'success');
          onClose();
        },
        // onError is handled by the hook (distinct 402 / 413 / permission toasts).
        // Keep the modal open so the user can retry or pick a smaller file.
      }
    );
  };

  return (
    <Modal
      title={t('documents:upload.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={disabled || upload.isPending}>
            {upload.isPending ? t('documents:upload.uploading') : t('documents:upload.submit')}
          </Button>
        </div>
      }
    >
      {storageFull && (
        <p role="alert" className="m-0 rounded-xl border border-line bg-bg-2 p-3 text-sm text-ink-2">
          {t('documents:upload.storageFull')}
        </p>
      )}

      {/* File picker */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileInputId} className="text-sm font-medium text-ink-2">
          {t('documents:upload.fileLabel')}
        </label>
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          onChange={handleFileChange}
          aria-invalid={errors.file ? true : undefined}
          aria-describedby={
            [errors.file ? `${fileInputId}-error` : null, `${fileInputId}-hint`]
              .filter(Boolean)
              .join(' ') || undefined
          }
          className="min-h-[44px] w-full rounded-xl border border-line bg-cream px-4 py-2.5 text-base text-ink file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:text-cream disabled:cursor-not-allowed disabled:opacity-60"
        />
        {errors.file ? (
          <p id={`${fileInputId}-error`} className="m-0 text-sm text-terracotta-deep">
            {errors.file}
          </p>
        ) : null}
        <p id={`${fileInputId}-hint`} className="m-0 text-sm text-ink-3">
          {t('documents:upload.fileHint', { max: formatFileSize(MAX_DOCUMENT_FILE_BYTES) })}
          <span aria-hidden="true"> &middot; </span>
          {t('documents:upload.storageRemaining', { remaining: formatFileSize(remainingBytes) })}
        </p>
      </div>

      <TextField
        id="document-upload-label"
        label={t('documents:upload.labelLabel')}
        value={label}
        maxLength={200}
        disabled={disabled}
        onChange={(event) => setLabel(event.target.value)}
        error={errors.label}
      />

      <Select
        id="document-upload-category"
        label={t('documents:upload.categoryLabel')}
        options={categoryOptions}
        value={category}
        disabled={disabled}
        onChange={(event) => setCategory(event.target.value as DocumentCategory)}
        error={errors.category}
      />

      <TextArea
        id="document-upload-note"
        label={t('documents:upload.noteLabel')}
        value={note}
        rows={3}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => setNote(event.target.value)}
        error={errors.note}
        hint={t('documents:upload.noteHint')}
      />
    </Modal>
  );
}
