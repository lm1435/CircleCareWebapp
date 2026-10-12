import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { isMapsOpenable, mapsUrl, singleLineAddress } from '@/lib/maps';

/**
 * A saved address / appointment location shown read-only, as a link that opens
 * a maps site in a new tab (no geocoding, no embedded map). Renders plain text
 * when a free-text location looks virtual (URL, Zoom, phone call...), and nothing when it is empty.
 * Styled like PhoneLink (terracotta-deep, medium weight, 44px target).
 */
export function MapsLink({
  address,
  freeText = false,
}: {
  address?: string | null;
  /** Appointment/task location (free text): virtual-looking values stay plain text. */
  freeText?: boolean;
}): ReactElement | null {
  const { t } = useTranslation('common');
  const hintId = useId();
  if (!address || !address.trim()) return null;
  const mapsHref = freeText && !isMapsOpenable(address) ? null : mapsUrl(address);
  if (!mapsHref) return <span className="whitespace-pre-wrap break-words">{address}</span>;
  const line = singleLineAddress(address);
  return (
    <>
      <a
        href={mapsHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('maps.openAria', { address: line })}
        aria-describedby={hintId}
        className="inline-flex min-h-[44px] max-w-full items-center gap-1.5 break-words font-medium text-terracotta-deep [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-deep"
      >
        <Icon name="location-outline" size="inline" className="shrink-0" />
        <span>{line}</span>
      </a>
      <span id={hintId} className="sr-only">
        {t('maps.newTab')}
      </span>
    </>
  );
}
