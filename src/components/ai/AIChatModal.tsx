import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, TextArea, Button, Spinner } from '@/components/ui';
import { useAiChat } from '@/hooks/useAiChat';

// Web port of mobile/src/components/ai/AIChatModal.tsx (the core chat exchange).
// Mirrors mobile 1:1 for behavior; drops mobile-only affordances that have no
// web analog (voice input, bottom-sheet drag, server suggestions list).
//
// PHI-conservative: the disclaimer mirrors mobile's `aiAssistant.disclaimer`
// plus the "no personal health details are sent to the AI" note that matches
// the backend's zero-PHI intent-classification design. Conversation is kept in
// component state for the modal session only (mobile does the same) — the
// server stores user messages only, never assistant responses.

const MESSAGE_MAX = 2000; // backend chatSchema: message.max(2000)

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
}

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg-${messageSeq}`;
}

export function AIChatModal({ circleId, isOpen, onClose }: AIChatModalProps): ReactElement | null {
  const { t } = useTranslation('ai');
  const { mutation, errorKey, resetConversation } = useAiChat(circleId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);

  // Reset the in-memory conversation each time the modal is opened so a new
  // session never inherits a stale thread (mirrors mobile's reset-on-open).
  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setInput('');
      setRemaining(null);
      resetConversation();
    }
    // resetConversation is stable for the modal's lifetime; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Keep the latest turn in view.
  useEffect(() => {
    listEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || mutation.isPending) return;

    setMessages((prev) => [...prev, { id: nextMessageId(), role: 'user', content: text }]);
    setInput('');

    mutation.mutate(text, {
      onSuccess: (data) => {
        setRemaining(data.remaining_requests);
        setMessages((prev) => [
          ...prev,
          { id: nextMessageId(), role: 'assistant', content: data.message },
        ]);
      },
      onError: (error) => {
        setMessages((prev) => [
          ...prev,
          { id: nextMessageId(), role: 'assistant', content: t(errorKey(error)) },
        ]);
      },
    });
  }, [input, mutation, errorKey, t]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handleSend();
    },
    [handleSend]
  );

  // Enter sends; Shift+Enter inserts a newline (standard chat composer behavior).
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!isOpen) return null;

  const canSend = input.trim().length > 0 && !mutation.isPending;

  return (
    <Modal title={t('title')} onClose={onClose} closeLabel={t('common:close')} size="lg">
      <p className="m-0 text-sm text-ink-3">{t('subtitle')}</p>

      {remaining !== null && remaining <= 10 ? (
        <p className="m-0 text-xs font-medium text-terracotta-deep" role="status">
          {t('remainingCount', { count: remaining })}
        </p>
      ) : null}

      {/* Message list */}
      <div
        className="flex max-h-[50vh] min-h-[12rem] flex-col gap-3 overflow-y-auto rounded-xl border border-line-2 bg-cream p-4"
        role="log"
        aria-live="polite"
        aria-label={t('title')}
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-sm text-center">
            <p className="serif m-0 mb-2 text-lg text-ink">{t('emptyTitle')}</p>
            <p className="m-0 text-sm text-ink-3">{t('intro')}</p>
          </div>
        ) : (
          messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="flex justify-end">
                <p className="m-0 max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-cream">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start">
                <p className="m-0 max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-line-2 bg-terracotta-soft px-4 py-2.5 text-sm text-ink">
                  {message.content}
                </p>
              </div>
            )
          )
        )}

        {mutation.isPending ? (
          <div className="flex items-center gap-2 text-sm text-ink-3" role="status">
            <Spinner size={16} label={t('thinking')} />
            <span>{t('thinking')}</span>
          </div>
        ) : null}

        <div ref={listEndRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TextArea
          id="ai-chat-input"
          label={t('inputLabel')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('inputPlaceholder')}
          maxLength={MESSAGE_MAX}
          rows={2}
          disabled={mutation.isPending}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!canSend}>
            {mutation.isPending ? t('sending') : t('send')}
          </Button>
        </div>
      </form>

      <p className="m-0 text-xs text-ink-3">{t('disclaimer')}</p>
    </Modal>
  );
}
