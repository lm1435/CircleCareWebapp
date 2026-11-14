// Care-assistant understanding fix (1.4.2, docs/plans/care-assistant-understanding-fix.md §9) on the
// web modal. Mobile twin: mobile/src/__tests__/components/AIChatModalUnderstanding.test.tsx.
// POSITIVE (P) and NEGATIVE (N):
//   P a chip tap sends its suggestion_id with the chip text (and circle_empty for analytics)
//   P the server's empty-circle starter set is what renders
//   P a not_understood / advice_refused reply re-renders its suggestion_items as chips; a tap sends
//     that chip's id; only the latest reply keeps them
//   P each new action renders and hands itself to the host; ai_reply_action_tapped carries kind+outcome
//   N a viewer who cannot create never sees add actions; a non-manager never sees invite; a member
//     never sees open_subscription; a host that says nothing gets the read-only set
//   N an unknown (malformed) suggestion id never crashes and is never sent
//   N an answered reply shows no chips; message text never reaches analytics
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import '@/i18n';
import { AIChatModal } from '../AIChatModal';
import { Analytics } from '@/lib/analytics';
import type { AIReplyAction } from '@/api/ai';

vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));

type SuggestionSet = { items: { id?: string; text: string }[]; circleEmpty: boolean | null };
let suggestionData: SuggestionSet | undefined;
vi.mock('@/hooks/useAiSuggestions', () => ({
  useAiSuggestions: () => ({ data: suggestionData, isLoading: false, isError: false }),
}));

// Each send answers with the next queued response; `mutate` records the variables.
const responses: Record<string, unknown>[] = [];
const mutate = vi.fn(
  (_vars: unknown, opts: { onSuccess?: (d: unknown) => void; onSettled?: () => void }) => {
    const next = responses.shift() ?? { message: 'ok' };
    opts.onSuccess?.({ conversation_id: 'conv', remaining_requests: 40, history_len: 0, ...next });
    opts.onSettled?.();
  }
);
vi.mock('@/hooks/useAiChat', () => ({
  useAiChat: () => ({
    mutation: { isPending: false, mutate: (v: unknown, o: never) => mutate(v, o) },
    errorKey: () => 'errors.sendFailed',
    resetConversation: vi.fn(),
  }),
}));

const EMPTY_SET: SuggestionSet = {
  items: [
    { id: 'capabilities', text: 'What can you help me with?' },
    { id: 'help_add_medication', text: 'How do I add a medication?' },
    { id: 'help_invite', text: 'How do I invite family to help?' },
    { id: 'help_emergency_info', text: 'What should go in the emergency info?' },
    { id: 'tips_first_weeks', text: 'Tips for the first weeks of caregiving' },
    { id: 'tips_medication_schedules', text: 'Give me tips for managing medication schedules' },
  ],
  circleEmpty: true,
};
const DATA_SET: SuggestionSet = {
  items: [
    { id: 'next_medication', text: "What's the next medication due?" },
    { id: 'doses_today', text: 'Did she take her medications today?' },
    { id: 'next_appointment', text: 'When is the next appointment?' },
    { id: 'what_changed', text: 'What changed this week?' },
    { id: 'schedule_week', text: "What's on the schedule this week?" },
    { id: 'allergies', text: 'What are her allergies?' },
  ],
  circleEmpty: false,
};

const SECRET_QUESTION = 'did mom take her warfarin 5mg at 8am';
const NOT_UNDERSTOOD = "I can answer questions about this circle's records.";
const OWNER = { isOwner: true, canCreate: true, canInvite: true };

function renderModal(props: Record<string, unknown> = {}, onOpenAction = vi.fn()) {
  render(<AIChatModal circleId="c1" isOpen onClose={vi.fn()} onOpenAction={onOpenAction} {...props} />);
  return { user: userEvent.setup(), onOpenAction };
}

async function typeAndSend(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('textbox'), text);
  await user.click(screen.getByRole('button', { name: i18n.t('ai:send') }));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  mutate.mockClear();
  responses.length = 0;
  suggestionData = DATA_SET;
  await i18n.changeLanguage('en');
});

describe('starter chips', () => {
  it('P: an empty circle shows the empty starter set the server chose', () => {
    suggestionData = EMPTY_SET;
    renderModal();
    for (const chip of EMPTY_SET.items) {
      expect(screen.getByRole('button', { name: chip.text })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Did she take her medications today?' })).not.toBeInTheDocument();
  });

  it('P: a chip tap sends the chip text, its suggestion_id and circle_empty', async () => {
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Did she take her medications today?' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        message: 'Did she take her medications today?',
        usedSuggestion: true,
        suggestionId: 'doses_today',
        circleEmpty: false,
      },
      expect.any(Object)
    );
  });

  it('N: a chip without an id (older backend) never sends one', async () => {
    suggestionData = { items: [{ text: 'What can you help me with?' }], circleEmpty: null };
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'What can you help me with?' }));
    expect(mutate.mock.calls[0][0]).not.toHaveProperty('suggestionId');
  });
});

describe('a reply that did not understand', () => {
  it('P: not_understood re-renders the chips under the reply; a tap sends that chip id', async () => {
    responses.push(
      { message: NOT_UNDERSTOOD, outcome: 'not_understood', reason: 'unsupported_data', intent: 'UNKNOWN', suggestion_items: EMPTY_SET.items },
      { message: 'Open New, then Medication.', outcome: 'app_help', intent: 'APP_HELP' }
    );
    const { user } = renderModal();
    await typeAndSend(user, SECRET_QUESTION);
    expect(await screen.findByText(NOT_UNDERSTOOD)).toBeInTheDocument();
    const block = screen.getByTestId('ai-chat-reply-suggestions');
    expect(block).toBeInTheDocument();
    // A labelled list of real buttons (SC 1.3.1), like the empty state's.
    expect(screen.getByRole('list', { name: 'Suggested questions' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'How do I add a medication?' }));
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'How do I add a medication?', usedSuggestion: true, suggestionId: 'help_add_medication' }),
      expect.any(Object)
    );
    expect(await screen.findByText('Open New, then Medication.')).toBeInTheDocument();
    // Only the latest reply keeps chips.
    expect(screen.queryByTestId('ai-chat-reply-suggestions')).not.toBeInTheDocument();
  });

  it('P: advice_refused also offers the chips', async () => {
    responses.push({ message: 'I stick to caregiving.', outcome: 'advice_refused', intent: 'GENERAL_ADVICE', suggestion_items: DATA_SET.items });
    const { user } = renderModal();
    await typeAndSend(user, 'what stocks should I buy');
    expect(await screen.findByTestId('ai-chat-reply-suggestion-allergies')).toBeInTheDocument();
  });

  it('N: an answered reply shows no chips', async () => {
    responses.push({ message: 'Her next dose is at 8:00 PM.', outcome: 'answered' });
    const { user } = renderModal();
    await typeAndSend(user, 'next dose?');
    expect(await screen.findByText('Her next dose is at 8:00 PM.')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-reply-suggestions')).not.toBeInTheDocument();
  });

  it('N: an unknown suggestion id never crashes: the chip renders and goes as text only', async () => {
    responses.push({
      message: NOT_UNDERSTOOD,
      outcome: 'not_understood',
      suggestion_items: [{ id: 'Not A Valid Id!', text: 'What can you help me with?' }, { id: 7 }, 'junk'],
    });
    const { user } = renderModal();
    await typeAndSend(user, 'hmm');
    await user.click(await screen.findByTestId('ai-chat-reply-suggestion-0'));
    const vars = mutate.mock.calls[mutate.mock.calls.length - 1][0];
    expect(vars).toMatchObject({ message: 'What can you help me with?', usedSuggestion: true });
    expect(vars).not.toHaveProperty('suggestionId');
  });
});

describe('new reply actions', () => {
  const BATCHES: AIReplyAction[][] = [
    [
      { type: 'open_activity' },
      { type: 'open_medications' },
      { type: 'open_emergency_info' },
      { type: 'open_vitals' },
      { type: 'open_members' },
      { type: 'open_add_medication' },
    ],
    [
      { type: 'open_add_event', event_type: 'appointment' },
      { type: 'open_invite' },
      { type: 'open_settings_notifications' },
      { type: 'open_subscription' },
    ],
  ];

  async function askWithActions(props: Record<string, unknown>, actions: unknown[]) {
    responses.push({ message: 'Here is where.', outcome: 'action_redirect', intent: 'ACTION_REQUEST', actions });
    const r = renderModal(props);
    await typeAndSend(r.user, 'add tylenol at 8pm');
    expect(await screen.findByText('Here is where.')).toBeInTheDocument();
    return r;
  }

  it.each(BATCHES.map((b, i) => [i, b] as const))(
    'P: batch %s: each action is a button; a click hands it to the host and reports kind + outcome',
    async (_i, batch) => {
      const tapped = vi.spyOn(Analytics, 'aiReplyActionTapped');
      const notes = vi.spyOn(Analytics, 'aiNotesPathActionTapped');
      const { user, onOpenAction } = await askWithActions(OWNER, batch);
      for (const action of batch) {
        const key = action.type === 'open_add_event' ? `open_add_event-${action.event_type}` : action.type;
        await user.click(screen.getByTestId(`ai-chat-action-${key}`));
        expect(onOpenAction).toHaveBeenLastCalledWith(action);
        expect(tapped).toHaveBeenLastCalledWith({ action: action.type, outcome: 'action_redirect' });
      }
      expect(notes).not.toHaveBeenCalled();
    }
  );

  it('N: a viewer who cannot create (view-only seat) never sees add or invite actions', async () => {
    await askWithActions({ isOwner: false, canCreate: false, canInvite: false }, [
      { type: 'open_add_medication' },
      { type: 'open_add_event', event_type: 'task' },
      { type: 'open_invite' },
      { type: 'open_vitals' },
    ]);
    expect(screen.queryByRole('button', { name: 'Add a medication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite someone' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Vitals' })).toBeInTheDocument();
  });

  it('N: a member (not the owner) never sees open_subscription; without manage rights, no invite', async () => {
    await askWithActions({ isOwner: false, canCreate: true, canInvite: false }, [
      { type: 'open_subscription' },
      { type: 'open_invite' },
      { type: 'open_add_medication' },
    ]);
    expect(screen.queryByRole('button', { name: 'See Subscription' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite someone' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a medication' })).toBeInTheDocument();
  });

  it('N: a host that does not say what the viewer can do gets the read-only set (fail-closed)', async () => {
    await askWithActions({}, [{ type: 'open_add_medication' }, { type: 'open_subscription' }, { type: 'open_members' }]);
    expect(screen.queryByRole('button', { name: 'Add a medication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See Subscription' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See Care team' })).toBeInTheDocument();
  });

  it('N: unknown action types are still dropped', async () => {
    await askWithActions(OWNER, [{ type: 'open_teleport' }, { type: 'delete_everything' }]);
    expect(screen.queryByTestId('ai-chat-reply-actions')).not.toBeInTheDocument();
  });

  it('N: the question, the reply and chip text never reach analytics', async () => {
    const spies = Object.keys(Analytics).map((k) =>
      vi.spyOn(Analytics as unknown as Record<string, (...a: unknown[]) => unknown>, k)
    );
    responses.push({
      message: NOT_UNDERSTOOD,
      outcome: 'not_understood',
      suggestion_items: EMPTY_SET.items,
      actions: [{ type: 'open_activity' }],
    });
    const { user } = renderModal(OWNER);
    await typeAndSend(user, SECRET_QUESTION);
    await user.click(await screen.findByTestId('ai-chat-action-open_activity'));
    const everything = JSON.stringify(spies.map((s) => s.mock.calls));
    expect(everything).not.toContain('warfarin');
    expect(everything).not.toContain(NOT_UNDERSTOOD);
    expect(everything).not.toContain('How do I add a medication?');
  });
});
