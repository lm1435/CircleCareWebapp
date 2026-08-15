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
import { useAiSuggestions } from '@/hooks/useAiSuggestions';
import { usePremiumGate } from '@/hooks/usePremiumGate';

// Web port of mobile/src/components/ai/AIChatModal.tsx (the core chat exchange
// plus the server suggestions list). Mirrors mobile 1:1 for behavior; drops
// mobile-only affordances that have no web analog (voice input, bottom-sheet
// drag) and mobile's decorative icon circles (editorial typography instead).
//
// PHI-conservative: the disclaimer mirrors mobile's `aiAssistant.disclaimer`
// plus the "no personal health details are sent to the AI" note that matches
// the backend's zero-PHI intent-classification design. Conversation is kept in
// component state for the modal session only (mobile does the same) — the
// server stores user messages only, never assistant responses.

const MESSAGE_MAX = 2000; // backend chatSchema: message.max(2000)

/** Ties the "Suggested questions" label to the list it names (SC 1.3.1). */
const SUGGESTIONS_LABEL_ID = 'ai-chat-suggestions-label';

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
  const { promptUpgrade } = usePremiumGate();
  // Server-owned suggestion chips — fetched only while the modal is open. Any
  // failure (402 free tier, 403 non-member, network) leaves `data` undefined and
  // the block simply does not render: no error text, no fallback strings.
  const suggestionsQuery = useAiSuggestions(circleId, isOpen);

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

  /**
   * Send one turn. `suggestion` is the tapped chip's text — passing it routes
   * the message through this exact same path (rate limiting, the 402
   * `promptUpgrade()` flow, `errorKey` handling and the `remaining` counter all
   * behave identically to a typed message) and flags the turn for analytics.
   * Mirrors mobile's `handleSend(messageText?)` / `usedSuggestion: !!messageText`.
   */
  const handleSend = useCallback(
    (suggestion?: string) => {
      const usedSuggestion = typeof suggestion === 'string';
      const text = (usedSuggestion ? suggestion : input).trim();
      if (!text || mutation.isPending) return;

      setMessages((prev) => [...prev, { id: nextMessageId(), role: 'user', content: text }]);
      setInput('');

      mutation.mutate(
        { message: text, usedSuggestion },
        {
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
            // Premium-gated: also surface the shared upgrade affordance (toast
            // with an "Upgrade" action → /upgrade), consistent with every other
            // gate. `errorKey` returns the NAMESPACED key ('errors.<kind>'), so
            // compare against that — an unprefixed compare never matched and the
            // toast silently never fired.
            if (errorKey(error) === 'errors.subscriptionRequired') {
              promptUpgrade();
            }
          },
        }
      );
    },
    [input, mutation, errorKey, t, promptUpgrade]
  );

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
  // Render ONLY on success with at least one string. On any error the query's
  // `data` stays undefined, so this is empty and nothing below renders — the
  // empty state reads fine on its own. Nothing is rendered while loading either:
  // the endpoint returns 0–6 items, so any placeholder row count would be a
  // guess, and on the terminal 402/403 path a skeleton would flash and vanish.
  const suggestions = suggestionsQuery.data ?? [];

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
        className="flex max-h-[50vh] min-h-[12rem] flex-col gap-3 overflow-y-auto rounded-xl border border-line-2 bg-cream p-3"
        role="log"
        aria-live="polite"
        aria-label={t('title')}
      >
        {messages.length === 0 ? (
          <div className="m-auto flex w-full max-w-2xl flex-col gap-3">
            {/* The intro spans the full width rather than a narrow measure: at
                ~384px the Spanish copy wrapped to 3 lines, and the extra line
                (plus a roomier gap) was pushing the modal into a scroll. */}
            <div className="text-center">
              <p className="serif m-0 text-lg text-ink">{t('emptyTitle')}</p>
              {/* `intro` restates the subtitle rendered directly above the log
                  and lists the capabilities the chips already demonstrate, so
                  it only earns its wrapped lines when there are NO chips — i.e.
                  exactly when the fetch failed and the user has nothing else to
                  go on. Dropping it when chips exist is what keeps the modal
                  under Modal's max-h-[90vh] without an inner scrollbar. */}
              {suggestions.length === 0 ? (
                <p className="m-0 mt-2 text-sm text-ink-3">{t('intro')}</p>
              ) : null}
            </div>

            {/* Server-authored suggestions. NEVER hardcode these strings: the
                backend's BASE_SUGGESTIONS list also seeds the intent
                classifier's few-shot examples, so a client-invented question
                classifies as UNKNOWN and the chip answers itself with "I didn't
                quite understand that". */}
            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p
                  id={SUGGESTIONS_LABEL_ID}
                  className="m-0 text-xs font-medium uppercase tracking-wide text-ink-3"
                >
                  {t('suggestedQuestions')}
                </p>
                {/* Two columns from `sm` up so six chips occupy three rows
                    instead of six — the empty state then fits the log's
                    max-h-[50vh] without scrolling. Stays single-column on
                    phone widths, where half-width chips would be too narrow
                    to read. DOM order is the reading order, so keyboard tab
                    order still runs left-to-right, top-to-bottom. */}
                <ul
                  aria-labelledby={SUGGESTIONS_LABEL_ID}
                  className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2"
                >
                  {suggestions.map((suggestion) => (
                    /* `flex` on the cell: a stretched grid item has an `auto`
                       computed height, so the button's `h-full` is only
                       reliable when its parent is a flex container that
                       stretches it. Belt and braces for equal-height rows. */
                    <li key={suggestion} className="flex">
                      <button
                        type="button"
                        onClick={() => handleSend(suggestion)}
                        disabled={mutation.isPending}
                        /* h-full: grid cells stretch, so a chip whose text wraps
                           to 2-3 lines (Spanish runs 15-30% longer) sets the row
                           height and its neighbour matches it. Text is never
                           truncated — the full question stays readable. */
                        /* py-2 (not py-2.5) trims ~4px per row; `min-h-11`
                           still guarantees the 44px target on one-line chips. */
                        className="flex h-full min-h-11 w-full items-center rounded-xl border border-line bg-bg px-4 py-2 text-left text-sm text-ink transition-colors hover:border-terracotta-deep hover:bg-terracotta-soft disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
