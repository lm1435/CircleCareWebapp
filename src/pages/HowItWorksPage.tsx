import { useEffect, useRef, useState, type ReactElement } from 'react';
import { previewVideoSource, type PreviewVideoSource } from '@/lib/previewVideo';
import { prefersReducedMotion } from '@/components/ui/motion';
import { Icon } from '@/components/ui';
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
 * 1.4.3 video (mobile parity): the FIXED 16:9 file for the app language
 * (lib/previewVideo.ts; no app config). Muted, looping, inline, with a
 * poster and a pause / play control; never autoplays under
 * prefers-reduced-motion (poster + Play). A source that fails to load hands
 * over to the carousel (the network safety net). Mock: docs/mocks-143/preview-video.
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

/** The video layout (docs/mocks-143/preview-video, web panel). */
function PreviewVideo({
  video,
  onFailed,
}: {
  video: PreviewVideoSource;
  onFailed: () => void;
}): ReactElement {
  const { t } = useTranslation('auth');
  const ref = useRef<HTMLVideoElement>(null);
  // Read once on mount: a reader who asked for less motion gets the poster + Play.
  const [reduced] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);
  const completed = useRef(false);
  const failed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    // Muted autoplay can still be refused (data saver, a policy): stay on the poster.
    const p = el.play?.();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }, [reduced]);

  const toggle = (): void => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    const p = el.play?.();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  };

  return (
    <>
      <Text variant="pageTitle" as="h1" id="preview-video-title" tabIndex={-1}>
        {t('preview.videoTitle')}
      </Text>
      <Text variant="pageSubtitle" className="mt-2" id="preview-video-subtitle">
        {t('preview.videoSubtitle')}
      </Text>
      <div className="relative mt-4 aspect-video overflow-hidden rounded-2xl bg-inset" data-testid="preview-video">
        <video
          ref={ref}
          className="block h-full w-full object-contain"
          src={video.src}
          poster={video.poster}
          muted
          loop
          playsInline
          preload={reduced ? 'none' : 'auto'}
          aria-labelledby="preview-video-title"
          aria-describedby="preview-video-subtitle"
          onPlay={() => {
            setPlaying(true);
            if (!started.current) {
              started.current = true;
              Analytics.previewVideoStarted(video.language, 'web');
            }
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            // `ended` never fires on a looping video: count the first pass near the end.
            const el = e.currentTarget;
            if (completed.current || !(el.duration > 0)) return;
            if (el.currentTime >= el.duration - 0.5) {
              completed.current = true;
              Analytics.previewVideoCompleted(video.language, 'web');
            }
          }}
          onError={() => {
            if (failed.current) return;
            failed.current = true;
            Analytics.previewVideoFailed(video.language, 'web');
            onFailed();
          }}
        />
        {/* WCAG 2.2.2: looping motion can be paused. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? t('preview.pauseVideo') : t('preview.playVideo')}
          className="absolute right-3 bottom-3 inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-ink shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-deep"
        >
          <Icon name={playing ? 'pause' : 'play'} size="inline" />
        </button>
      </div>
    </>
  );
}

export default function HowItWorksPage(): ReactElement {
  const { t, i18n } = useTranslation('auth');
  const [videoFailed, setVideoFailed] = useState(false);
  const video = videoFailed ? null : previewVideoSource(i18n.language, '16x9');
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

  if (video) {
    return (
      <AuthShell>
        <AuthTopBar onBack={goBack} />
        <PreviewVideo video={video} onFailed={() => setVideoFailed(true)} />
        <div className="mt-8 border-t border-line-2 pt-4">
          <Text variant="caption" className="mb-3 text-center text-ink-3!">
            {t('preview.trialNote')}
          </Text>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => {
              Analytics.previewGetStartedTapped(1);
              navigate('/signup');
            }}
          >
            {t('preview.getStarted')}
          </Button>
        </div>
      </AuthShell>
    );
  }

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
                className={`h-2 rounded-full bg-selected-fill transition-all ${
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
