import { useRef, useState, type ReactElement } from 'react';
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
  const posterUrl = poster ? helpMediaUrl(poster) : undefined;

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
      data-testid="help-video"
      className="aspect-video w-full rounded-xl bg-bg-2"
      src={helpMediaUrl(file)}
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
      onError={() => {
        Analytics.helpVideoFailed(slug);
        setFailed(true);
      }}
    />
  );
}
