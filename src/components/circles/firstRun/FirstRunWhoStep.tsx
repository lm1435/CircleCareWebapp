import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, TEXT_CLASS, Text, TextField } from '@/components/ui';
import { prefersReducedMotion } from '@/components/ui/motion';
import { Analytics } from '@/lib/analytics';
import { setFirstRunDraft } from '@/lib/firstRunDraft';
import { firstRunFunnel } from '@/lib/firstRunFunnel';

/**
 * First run v2, screen 2 (docs/mocks-144/first-run-v2/02-start.png): "Who are you caring for?".
 * ONE question. Continue (primary) is disabled until a non-blank name is typed; "It's for me" (outline,
 * same size) continues as a self-care circle with no name to type. The answer goes to the IN-MEMORY
 * draft only (lib/firstRunDraft), never storage, router state or analytics (only `is_self_care`).
 *
 * Presentation + the draft write; the host decides what comes next (`onDone`).
 */
export interface FirstRunWhoStepProps {
  /** `first_run_recipient_viewed.entry`. Web always reports 'web'. */
  entry?: 'welcome' | 'web';
  onDone: (answer: { isSelfCare: boolean }) => void;
  /** Initial value (coming back from the account step in the same page). */
  initialName?: string;
}

export function FirstRunWhoStep({ entry = 'web', onDone, initialName = '' }: FirstRunWhoStepProps): ReactElement {
  const { t } = useTranslation('circles');
  const [name, setName] = useState(initialName);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const trimmed = name.trim();
  const still = prefersReducedMotion();

  useEffect(() => {
    Analytics.firstRunRecipientViewed(entry);
    firstRunFunnel.viewed('who');
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const submit = (event?: FormEvent): void => {
    event?.preventDefault();
    // NEGATIVE GUARD: an empty or whitespace-only name never continues (Enter included).
    if (!trimmed) return;
    setFirstRunDraft({ recipientName: trimmed, isSelfCare: false });
    Analytics.firstRunRecipientSubmitted(false);
    firstRunFunnel.completed('who');
    onDone({ isSelfCare: false });
  };

  const forMe = (): void => {
    setFirstRunDraft({ recipientName: null, isSelfCare: true });
    Analytics.firstRunRecipientSubmitted(true);
    firstRunFunnel.completed('who');
    onDone({ isSelfCare: true });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="first-run-who">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className={`${TEXT_CLASS.pageTitle} m-0 outline-none`}>
          {t('create.whoCaringFor')}
        </h1>
        <Text variant="body" className="mt-3 text-ink-2!">
          {t('firstRun.who.sub')}
        </Text>
      </div>

      <TextField
        id="first-run-recipient-name"
        name="recipient_name"
        label={t('firstRun.who.label')}
        placeholder={t('create.personalizedPlaceholder.parent')}
        autoComplete="off"
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {/* M1: the preview row fades up once the first letter is typed. Nothing is sent yet. */}
      <div aria-live="polite">
        {trimmed ? (
          <Card
            variant="elevated"
            padding="sm"
            className={`flex items-center gap-3 ${still ? '' : 'cc-fr-rise'}`}
            data-testid="first-run-who-preview"
          >
            <Avatar name={trimmed} size="sm" />
            <span className="min-w-0">
              <span className="block break-words text-md font-semibold text-ink">
                {t('firstRun.who.preview', { name: trimmed })}
              </span>
              <span className="block text-sm text-ink-2">{t('firstRun.who.previewSub')}</span>
            </span>
          </Card>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col gap-3">
        <Button type="submit" size="lg" fullWidth disabled={!trimmed} data-testid="first-run-who-continue">
          {t('firstRun.continue')}
        </Button>
        <Button type="button" variant="outline" size="lg" fullWidth onClick={forMe} data-testid="first-run-who-for-me">
          {t('firstRun.who.forMe')}
        </Button>
      </div>
    </form>
  );
}
