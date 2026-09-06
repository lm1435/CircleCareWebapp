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
import {
  Badge,
  Button,
  Card,
  Icon,
  IconTile,
  INPUT_TEXT,
  Modal,
  Sheet,
  Spinner,
  Text,
} from '@/components/ui';
import { useAiChat } from '@/hooks/useAiChat';
import { useAiSuggestions } from '@/hooks/useAiSuggestions';
import { usePremiumGate } from '@/hooks/usePremiumGate';

// Web port of mobile/src/components/ai/AIChatModal.tsx (the core chat exchange
// plus the server suggestions list). Mirrors mobile 1:1 for behavior; drops
// mobile-only affordances that have no web analog (voice input, bottom-sheet
// drag). Spec §6.7: 40×40 r20 coral header tile, single-column staggered
// suggestion chips, ink/bg-2 message bubbles, a pinned 44 coral send circle.
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
  // The AI assistant is a premium-only surface — FEATURE (mobile sends the
  // same value from its own AI gate).
  const { promptUpgrade } = usePremiumGate('feature');
  // Server-owned suggestion chips — fetched only while the modal is open. Any
  // failure (402 free tier, 403 non-member, network) leaves `data` undefined and
  // the block simply does not render: no error text, no fallback strings.
  const suggestionsQuery = useAiSuggestions(circleId, isOpen);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);

  // Clears the in-memory conversation without closing the modal — both the
  // "New chat" header button and the reset-on-open effect below share it.
  const resetChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setRemaining(null);
    resetConversation();
  }, [resetConversation]);

  // Reset the in-memory conversation each time the modal is opened so a new
  // session never inherits a stale thread (mirrors mobile's reset-on-open).
  useEffect(() => {
    if (isOpen) resetChat();
    // resetChat is stable for the modal's lifetime; intentionally not a dep.
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
  const lowRemaining = remaining !== null && remaining <= 10;

  return (
    <Modal
      // `title` still names the dialog for aria-labelledby (via the sr-only
      // h2 `hideTitle` renders); the rich header (tile + subtitle + badge +
      // New chat) rides in the shell's title row beside the × through the
      // `header` slot, so the close control is not stranded on a row of its own.
      title={t('title')}
      hideTitle
      header={
        <div className="flex items-start gap-3">
          <IconTile tone="coral" filled size={40} name="sparkles" />
          <div className="min-w-0 flex-1">
            {/* NOT a heading: Modal's own `hideTitle` h2 (sr-only, same text)
                already supplies the dialog's accessible name. A second real
                heading with the identical text would make every
                `getByRole('heading', { name: title })` query ambiguous, and
                would read as a duplicated heading to a screen-reader user
                navigating by headings. */}
            <Text variant="h3" as="p">
              {t('title')}
            </Text>
            <Text variant="caption">{t('subtitle')}</Text>
          </div>
          {lowRemaining ? (
            <Badge variant="coral" size="sm">
              {t('remainingCount', { count: remaining })}
            </Badge>
          ) : null}
          {messages.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={resetChat}>
              {t('newChat')}
            </Button>
          ) : null}
        </div>
      }
      onClose={onClose}
      closeLabel={t('common:close')}
      size="lg"
    >

      {/* card-shell-ok: scrollable transcript region (role="log"), not a card */}
      <div
        className="flex max-h-[50vh] min-h-[12rem] flex-col gap-3 overflow-y-auto rounded-xl border border-line-2 bg-bg p-3"
        role="log"
        aria-live="polite"
        aria-label={t('title')}
      >
        {messages.length === 0 ? (
          <div className="m-auto flex w-full max-w-2xl flex-col gap-3">
            {/* Hero mark: a warm coral tile with a cream sparkle, sitting above
                the greeting so the empty state welcomes rather than just
                labels itself. */}
            <div
              aria-hidden="true"
              className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-xl bg-coral shadow-warm"
            >
              <Icon name="sparkles" size="chrome" className="text-cream" />
            </div>
            {/* The intro spans the full width rather than a narrow measure: at
                ~384px the Spanish copy wrapped to 3 lines, and the extra line
                (plus a roomier gap) was pushing the modal into a scroll. */}
            <div className="text-center">
              <Text variant="h2">{t('emptyTitle')}</Text>
              {/* `intro` restates the subtitle rendered directly above the log
                  and lists the capabilities the chips already demonstrate, so
                  it only earns its wrapped lines when there are NO chips — i.e.
                  exactly when the fetch failed and the user has nothing else to
                  go on. Dropping it when chips exist is what keeps the modal
                  under Modal's max-h-[90vh] without an inner scrollbar. */}
              {suggestions.length === 0 ? (
                <Text variant="caption" className="mt-2">
                  {t('intro')}
                </Text>
              ) : null}
            </div>

            {/* Server-authored suggestions. NEVER hardcode these strings: the
                backend's BASE_SUGGESTIONS list also seeds the intent
                classifier's few-shot examples, so a client-invented question
                classifies as UNKNOWN and the chip answers itself with "I didn't
                quite understand that". */}
            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Text variant="label" as="p" id={SUGGESTIONS_LABEL_ID}>
                  {t('suggestedQuestions')}
                </Text>
                {/* Single column, 40ms-staggered fade-in per spec §6.7. Full
                    text always readable — no truncation/clamping. */}
                <ul
                  aria-labelledby={SUGGESTIONS_LABEL_ID}
                  className="m-0 flex list-none flex-col gap-2 p-0"
                >
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion}>
                      <Card
                        variant="outlined"
                        padding="sm"
                        onPress={() => handleSend(suggestion)}
                        // `rounded-lg!`: Card's own `rounded-xl` is emitted
                        // LATER in the compiled stylesheet (verified against
                        // dist/assets/*.css), so a plain override loses.
                        className="min-h-[44px] w-full rounded-lg! text-sm text-ink animate-[fade-in_200ms_ease-out] [animation-fill-mode:both] motion-reduce:animate-none"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        {suggestion}
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          messages.map((message) =>
            message.role === 'user' ? (
              <p
                key={message.id}
                className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-cream"
              >
                {message.content}
              </p>
            ) : (
              <p
                key={message.id}
                className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-bl-sm bg-bg-2 px-4 py-2.5 text-sm text-ink"
              >
                {message.content}
              </p>
            )
          )
        )}

        {mutation.isPending ? (
          <div
            className="flex max-w-[85%] items-center gap-2 rounded-xl rounded-bl-sm bg-bg-2 px-4 py-2.5 text-sm text-ink"
            role="status"
          >
            <Spinner decorative size={16} />
            <span>{t('thinking')}</span>
          </div>
        ) : null}

        <div ref={listEndRef} />
      </div>

      {/* Composer. `Sheet` (not a hand-rolled div) supplies the white/r20/
          hairline/shadow-sm wrapper so this file draws no card shell by hand. */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Sheet padding="none" className="flex items-end gap-1 pl-2 pr-1 py-1">
          <textarea
            aria-label={t('inputLabel')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('inputPlaceholder')}
            maxLength={MESSAGE_MAX}
            rows={1}
            disabled={mutation.isPending}
            className={`${INPUT_TEXT} max-h-40 resize-none py-2`}
          />
          <button
            type="submit"
            aria-label={mutation.isPending ? t('sending') : t('send')}
            disabled={!canSend}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-coral text-cream disabled:bg-line"
          >
            <Icon name="send" size="row" />
          </button>
        </Sheet>
      </form>

      <Text variant="caption" className="text-center mt-2">
        {t('disclaimer')}
      </Text>
    </Modal>
  );
}
