import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { isMapsOpenable, mapsUrl, singleLineAddress } from '@/lib/maps';

/**
 * A saved address / appointment location shown read-only. When it looks like a real street
 * address (isMapsOpenable: same rule as mobile, for address fields and locations alike) it is a
 * link that opens a maps site in a new tab (no geocoding, no embedded map). Anything else
 * ("Mom's house", "Room 3", a Zoom link) is plain text with no link role or new-tab hint;
 * nothing when it is empty.
 * Styled like PhoneLink (terracotta-deep, medium weight, 44px target).
 */
export function MapsLink({ address }: { address?: string | null }): ReactElement | null {
  const { t } = useTranslation('common');
  const hintId = useId();
  if (!address || !address.trim()) return null;
  const mapsHref = isMapsOpenable(address) ? mapsUrl(address) : null;
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
