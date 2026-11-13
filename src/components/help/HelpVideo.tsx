import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Analytics } from '@/lib/analytics';
import { helpMediaUrl } from '@/help/media';

export interface HelpVideoProps {
  slug: string;
  title: string;
  file: string;
  poster?: string;
}

/**
 * Article video: muted autoplay (the videos have no sound), inline, controls,
 * no loop. If it cannot load, the poster stays with a short line and the text
 * article still works.
 */
export function HelpVideo({ slug, title, file, poster }: HelpVideoProps): ReactElement {
  const { t } = useTranslation('help');
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const retried = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posterUrl = poster ? helpMediaUrl(poster) : undefined;
  const src = helpMediaUrl(file);

  // iOS Safari keeps a <video> that was playing alive after a client-side navigation removes it, and
  // the NEXT help video then fails to play (owner repro on the public help pages 2026-11-12). Release
  // the element on unmount. StrictMode (dev) re-runs setup after cleanup: put the source back.
  useEffect(() => {
    const v = videoRef.current;
    if (v && !v.getAttribute('src')) v.setAttribute('src', src);
    return () => {
      if (!v) return;
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        // Releasing is best effort.
      }
    };
  }, [src]);

  if (failed) {
    return (
      <figure className="m-0" data-testid="help-video-failed">
        {posterUrl && (
          <img
            src={posterUrl}
            alt=""
            className="aspect-video w-full rounded-xl bg-bg-2 object-cover"
          />
        )}
        <figcaption role="status" className="mt-2 text-sm text-ink-2">
          {t('center.videoUnavailable')}
        </figcaption>
      </figure>
    );
  }

  return (
    <video
      ref={videoRef}
      data-testid="help-video"
      className="aspect-video w-full rounded-xl bg-bg-2"
      src={src}
      poster={posterUrl}
      aria-label={t('center.videoLabel', { title })}
      muted
      autoPlay
      playsInline
      controls
      preload="metadata"
      onPlaying={() => {
        if (started.current) return;
        started.current = true;
        Analytics.helpVideoStarted(slug);
      }}
      onEnded={() => Analytics.helpVideoCompleted(slug)}
      onError={(e) => {
        const v = e.currentTarget;
        // One silent retry before giving up: a transient decoder/network failure should not strand the user.
        if (!retried.current && v.getAttribute('src')) {
          retried.current = true;
          v.load();
          // play() returns undefined on old engines; never let the retry throw.
          void Promise.resolve()
            .then(() => v.play())
            .catch(() => {});
          return;
        }
        Analytics.helpVideoFailed(slug);
        setFailed(true);
      }}
    />
  );
}
