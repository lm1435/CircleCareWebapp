import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import { registerDraft, takeDraft } from '@/lib/sessionDraft';
import { useAuthStore } from '@/store/authStore';

/**
 * PK9: opt a form into surviving a FORCED sign-out (see lib/sessionDraft.ts).
 *
 * - `getSnapshot` returns the JSON-serializable draft, or null when the form is
 *   empty/untouched (nothing is saved). Read lazily at save time, so a form
 *   that optimistically cleared itself can still hand back the in-flight value.
 * - `restore` receives the saved draft on the form's mount (same user, <30 min);
 *   the entry is deleted as it is read and the "restored" notice shows.
 * - `draftKey` null disables the hook (e.g. an edit of a saved record).
 */
export function useSessionDraft<T>(
  draftKey: string | null,
  getSnapshot: () => T | null,
  restore: (draft: T) => void
): void {
  const { t } = useTranslation('common');
  // Tolerate a missing provider (isolated component tests): the notice is
  // then skipped, the restore itself still happens.
  let showToast: ((message: string, type?: 'info') => void) | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    showToast = useToast().showToast;
  } catch {
    showToast = null;
  }
  const getRef = useRef(getSnapshot);
  const restoreRef = useRef(restore);
  const toastRef = useRef({ showToast, text: t('draftRestored') });
  getRef.current = getSnapshot;
  restoreRef.current = restore;
  toastRef.current = { showToast, text: t('draftRestored') };

  // Re-runs when the user id arrives: on a full page load the form can mount
  // before bootstrap has restored the session.
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!draftKey || !userId) return undefined;
    const saved = takeDraft<T>(userId, draftKey);
    if (saved !== null) {
      restoreRef.current(saved);
      toastRef.current.showToast?.(toastRef.current.text, 'info');
    }
    return registerDraft(draftKey, () => getRef.current());
  }, [draftKey, userId]);
}
