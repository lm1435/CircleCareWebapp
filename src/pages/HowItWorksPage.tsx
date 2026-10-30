import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Analytics } from '@/lib/analytics';
import { Button, Text } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { useAuthBack } from '@/components/auth/useAuthBack';
import { PreviewMedicationStep } from '@/components/preview/PreviewMedicationStep';
import { PreviewActivityStep } from '@/components/preview/PreviewActivityStep';

/**
 * /how-it-works — the web twin of mobile's pre-auth Preview walkthrough
 * (mobile/src/screens/onboarding/PreviewScreen.tsx): two steps over fabricated
 * sample data (a day of doses, then the activity feed they produce), Next /
 * Back (the top bar's back button steps back, then leaves), a "Screen N of M" indicator, a trial note on the last step and a final
 * "Get started" that goes to Sign up. Public: no session, no circle, no API.
 *
 * The mobile screen's video branch (app config `preview_video_url`) is not
 * mirrored: the web has no app-config hook, and the carousel is the default on
 * mobile too.
 *
 * Opened from Sign up / Log in with `state.previewSource`; anything else
 * (typed URL, bookmark) is reported as 'direct'.
 */

export type PreviewSource = 'signup' | 'login' | 'welcome' | 'direct';
const SOURCES: readonly PreviewSource[] = ['signup', 'login', 'welcome', 'direct'];

const STEPS = [
  { id: 'medication', Component: PreviewMedicationStep },
  { id: 'activity', Component: PreviewActivityStep },
] as const;

function readSource(state: unknown): PreviewSource {
  const raw = (state as { previewSource?: unknown } | null)?.previewSource;
  return SOURCES.includes(raw as PreviewSource) ? (raw as PreviewSource) : 'direct';
}

export default function HowItWorksPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { goBack } = useAuthBack('/signup');
  const [step, setStep] = useState(0);

  // `preview_opened`, exactly once per visit (the ref survives StrictMode's
  // simulated remount).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    Analytics.previewOpened(readSource(location.state));
  }, [location.state]);

  // WCAG 2.4.3: a step change replaces the content the visitor was on, so
  // focus moves to the new step's heading (not on first paint — RouteFocus
  // owns arrival).
  const stepChanged = useRef(false);
  useEffect(() => {
    if (!stepChanged.current) return;
    document.getElementById(`preview-step-${STEPS[step]!.id}-title`)?.focus();
  }, [step]);

  const goToStep = (next: number): void => {
    stepChanged.current = true;
    setStep(next);
    window.scrollTo?.({ top: 0 });
  };

  const isLast = step === STEPS.length - 1;
  const { id, Component } = STEPS[step]!;

  const handlePrimary = (): void => {
    if (!isLast) {
      goToStep(step + 1);
      return;
    }
    Analytics.previewGetStartedTapped(step + 1);
    navigate('/signup');
  };

  return (
    <AuthShell>
      {/* ONE Back control: it steps back through the walkthrough, and leaves
          it from the first step (mobile swipes between pages; the web needs a
          keyboard way back, and two buttons both named "Back" that did
          different things would be ambiguous to a screen reader). */}
      <AuthTopBar onBack={step > 0 ? () => goToStep(step - 1) : goBack} />

      <section aria-labelledby={`preview-step-${id}-title`} data-testid={`preview-step-${id}`}>
        <Component headingId={`preview-step-${id}-title`} />
      </section>

      <div className="mt-8 border-t border-line-2 pt-4">
        <div className="mb-3 flex flex-col items-center gap-2">
          <div aria-hidden="true" className="flex items-center gap-2">
            {STEPS.map((s, index) => (
              <span
                key={s.id}
                className={`h-2 rounded-full bg-primary-fill transition-all ${
                  index === step ? 'w-6' : 'w-2 opacity-30'
                }`}
              />
            ))}
          </div>
          <Text variant="caption" className="text-ink-3!">
            {t('preview.screenOf', { current: step + 1, total: STEPS.length })}
          </Text>
        </div>

        {isLast ? (
          <Text variant="caption" className="mb-3 text-center text-ink-3!">
            {t('preview.trialNote')}
          </Text>
        ) : null}

        <Button variant="primary" size="lg" fullWidth onClick={handlePrimary}>
          {isLast ? t('preview.getStarted') : t('preview.next')}
        </Button>
      </div>
    </AuthShell>
  );
}
