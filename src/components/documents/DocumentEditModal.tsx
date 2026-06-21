import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DOCUMENT_CATEGORIES,
  documentEditSchema,
  type CircleDocument,
  type DocumentCategory,
  type UpdateDocumentRequest,
} from '@/api/documents';
import { useUpdateDocument } from '@/hooks/useDocuments';
import { Button, Modal, Select, TextArea, TextField, useToast } from '@/components/ui';

// Plan Task 3.5 — edit a document's metadata (label / category / note). Mirrors
// backend updateDocumentSchema (all fields optional; label 1-200, note ≤500).
// Only the changed fields are sent in the PATCH. Gating is the caller's job
// (uploader-or-owner) — see DocumentsPage; the backend re-checks regardless.

export interface DocumentEditModalProps {
  circleId: string;
  doc: CircleDocument;
  onClose: () => void;
}

interface FieldErrors {
  label?: string;
  note?: string;
}

export function DocumentEditModal({ circleId, doc, onClose }: DocumentEditModalProps): ReactElement {
  const { t } = useTranslation(['documents', 'common']);
  const { showToast } = useToast();
  const update = useUpdateDocument(circleId);

  const [label, setLabel] = useState(doc.label);
  const [category, setCategory] = useState<DocumentCategory>(doc.category);
  const [note, setNote] = useState(doc.note ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const categoryOptions = useMemo(
    () =>
      DOCUMENT_CATEGORIES.map((value) => ({
        value,
        label: t(`documents:categories.${value}`),
      })),
    [t]
  );

  const handleSubmit = (): void => {
    if (update.isPending) return;

    const trimmedLabel = label.trim();
    const trimmedNote = note.trim();
    const next: FieldErrors = {};

    const parsed = documentEditSchema.safeParse({
      label: trimmedLabel,
      category,
      note: trimmedNote ? trimmedNote : null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'label' && !next.label) {
          next.label = t('documents:edit.errors.labelRequired');
        } else if (field === 'note' && !next.note) {
          next.note = t('documents:edit.errors.noteTooLong');
        }
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    // Send only the fields that actually changed.
    const data: UpdateDocumentRequest = {};
    if (trimmedLabel !== doc.label) data.label = trimmedLabel;
    if (category !== doc.category) data.category = category;
    const normalizedNote = trimmedNote ? trimmedNote : null;
    if (normalizedNote !== (doc.note ?? null)) data.note = normalizedNote;

    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }

    update.mutate(
      { documentId: doc.id, data },
      {
        onSuccess: () => {
          showToast(t('documents:edit.success'), 'success');
          onClose();
        },
        // Hook onError surfaces the toast; keep modal open for retry.
      }
    );
  };

  return (
    <Modal
      title={t('documents:edit.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending ? t('documents:edit.saving') : t('common:save')}
          </Button>
        </div>
      }
    >
      <TextField
        id="document-edit-label"
        label={t('documents:upload.labelLabel')}
        value={label}
        maxLength={200}
        onChange={(event) => setLabel(event.target.value)}
        error={errors.label}
      />

      <Select
        id="document-edit-category"
        label={t('documents:upload.categoryLabel')}
        options={categoryOptions}
        value={category}
        onChange={(event) => setCategory(event.target.value as DocumentCategory)}
      />

      <TextArea
        id="document-edit-note"
        label={t('documents:upload.noteLabel')}
        value={note}
        rows={3}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        error={errors.note}
        hint={t('documents:upload.noteHint')}
      />
    </Modal>
  );
}
