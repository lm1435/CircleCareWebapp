// FIND_NOTES: the assistant points to where notes are and offers buttons.
// Mobile twin: mobile/src/__tests__/components/AIChatModalReplyActions.test.tsx.
// Pins: one button per action under the reply (real UI labels), a click reports
// `ai_notes_path_action_tapped` and hands the action to the host, and every other
// reply (or an older backend with no `actions`) renders exactly as before.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import '@/i18n';
import { AIChatModal } from '../AIChatModal';
import { Analytics } from '@/lib/analytics';
import type { AIReplyAction } from '@/api/ai';

vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/hooks/useAiSuggestions', () => ({
  useAiSuggestions: () => ({ data: undefined, isLoading: false, isError: false }),
}));

let nextResponse: Record<string, unknown> = {};
vi.mock('@/hooks/useAiChat', () => ({
  useAiChat: () => ({
    mutation: {
      isPending: false,
      mutate: (_vars: unknown, opts: { onSuccess?: (d: unknown) => void; onSettled?: () => void }) => {
        opts.onSuccess?.({ conversation_id: 'conv', remaining_requests: 40, ...nextResponse });
        opts.onSettled?.();
      },
    },
    errorKey: () => 'errors.sendFailed',
    resetConversation: vi.fn(),
  }),
}));

const PATEL = '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const LEE = '1b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

async function ask(
  response: Record<string, unknown>,
  onOpenAction: ((action: AIReplyAction) => void) | null = vi.fn()
) {
  nextResponse = response;
  const user = userEvent.setup();
  render(<AIChatModal circleId="c1" isOpen onClose={vi.fn()} onOpenAction={onOpenAction ?? undefined} />);
  await user.type(screen.getByRole('textbox'), 'where are the notes?');
  await user.click(screen.getByRole('button', { name: i18n.t('ai:send') }));
  expect(await screen.findByText(String(response.message))).toBeInTheDocument();
  return { user, onOpenAction };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('AIChatModal — FIND_NOTES reply actions', () => {
  it('general answer: Notes + Doctors buttons; a click reports the kind and hands the action to the host', async () => {
    const tapped = vi.spyOn(Analytics, 'aiNotesPathActionTapped');
    const { user, onOpenAction } = await ask({
      message: 'Daily care notes are under Care > Notes.',
      intent: 'FIND_NOTES',
      actions: [{ type: 'open_notes' }, { type: 'open_doctors' }],
      notes_path: { target: 'notes', doctor_named: false, doctor_matched: false },
    });
    expect(screen.getByTestId('ai-chat-reply-actions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Notes' }));
    expect(tapped).toHaveBeenCalledWith({ action: 'open_notes' });
    expect(onOpenAction).toHaveBeenCalledWith({ type: 'open_notes' });
    await user.click(screen.getByRole('button', { name: 'See Doctors' }));
    expect(onOpenAction).toHaveBeenLastCalledWith({ type: 'open_doctors' });
  });

  it('one doctor matched: "<name>: Visits & notes" opens that doctor by id', async () => {
    const tapped = vi.spyOn(Analytics, 'aiNotesPathActionTapped');
    const { user, onOpenAction } = await ask({
      message: "Dr Patel's visits and notes are on their doctor page.",
      intent: 'FIND_NOTES',
      actions: [{ type: 'open_provider', provider_id: PATEL, provider_name: 'Dr Patel' }],
      notes_path: { target: 'doctor', doctor_named: true, doctor_matched: true },
    });
    await user.click(screen.getByRole('button', { name: 'Dr Patel: Visits & notes' }));
    expect(onOpenAction).toHaveBeenCalledWith({ type: 'open_provider', provider_id: PATEL, provider_name: 'Dr Patel' });
    expect(tapped).toHaveBeenCalledWith({ action: 'open_provider' });
    expect(JSON.stringify(tapped.mock.calls)).not.toContain('Patel');
  });

  it('several doctors: one button each, in server order', async () => {
    await ask({
      message: '2 saved doctors match.',
      intent: 'FIND_NOTES',
      actions: [
        { type: 'open_provider', provider_id: PATEL, provider_name: 'Dr Patel' },
        { type: 'open_provider', provider_id: LEE, provider_name: 'Dr Lee' },
      ],
    });
    const names = screen.getAllByRole('button', { name: /Visits & notes$/ }).map((b) => b.textContent);
    expect(names).toEqual(['Dr Patel: Visits & notes', 'Dr Lee: Visits & notes']);
  });

  it('other intents and older backends render no buttons', async () => {
    await ask({ message: 'Her next dose is at 8:00 PM.', intent: 'GET_NEXT_MEDICATION' });
    expect(screen.queryByTestId('ai-chat-reply-actions')).not.toBeInTheDocument();
  });

  it('unknown action types are dropped, not rendered', async () => {
    await ask({ message: 'Somewhere new.', intent: 'FIND_NOTES', actions: [{ type: 'open_somewhere_new' }] });
    expect(screen.queryByTestId('ai-chat-reply-actions')).not.toBeInTheDocument();
  });

  it('without a host handler the buttons are not offered (the text still names the place)', async () => {
    await ask(
      { message: 'Daily care notes are under Care > Notes.', intent: 'FIND_NOTES', actions: [{ type: 'open_notes' }] },
      null
    );
    expect(screen.queryByRole('button', { name: 'Open Notes' })).not.toBeInTheDocument();
  });

  it('Spanish labels come from the es locale', async () => {
    await i18n.changeLanguage('es');
    await ask({
      message: 'Las notas diarias de cuidado están en Cuidado > Notas.',
      intent: 'FIND_NOTES',
      actions: [{ type: 'open_notes' }, { type: 'open_provider', provider_id: PATEL, provider_name: 'Dr Patel' }],
    });
    expect(screen.getByRole('button', { name: 'Abrir notas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dr Patel: Visitas y notas' })).toBeInTheDocument();
  });
});
