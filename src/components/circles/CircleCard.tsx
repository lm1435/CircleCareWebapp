import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, type BadgeVariant } from '@/components/ui';
import type { Circle } from '@/api/circles';
import { EyeIcon, LockIcon } from './icons';

export interface CircleCardProps {
  circle: Circle;
}

type RoleKey = 'owner' | 'caregiver' | 'careRecipient';

const roleBadgeVariant: Record<RoleKey, BadgeVariant> = {
  owner: 'moss',
  careRecipient: 'terracotta',
  caregiver: 'neutral',
};

function getRoleKey(circle: Circle): RoleKey {
  if (circle.is_care_recipient) return 'careRecipient';
  return circle.role === 'owner' ? 'owner' : 'caregiver';
}

/**
 * Circle picker card (plan Tasks 15 + 39c). The whole card is a link to the
 * circle's calendar. Restricted circles (`read_only` / `view_only`) get a
 * lock / eye badge plus mobile's subtitle copy, subdued surface styling, and
 * remain clickable (read access is allowed).
 */
export function CircleCard({ circle }: CircleCardProps): ReactElement {
  const { t } = useTranslation('members');

  const isReadOnly = Boolean(circle.read_only);
  const isViewOnly = circle.view_only;
  const restricted = isReadOnly || isViewOnly;
  const roleKey = getRoleKey(circle);

  // Mirrors mobile CircleListScreen subtitle precedence: read_only first
  // (owner vs member copy), then view_only.
  const accessSubtitle = isReadOnly
    ? circle.role === 'owner'
      ? t('access.readOnlyOwnerSubtitle')
      : t('access.readOnlyMemberSubtitle')
    : isViewOnly
      ? t('access.viewOnlySubtitle')
      : null;

  const surface = restricted
    ? 'border-line-2 bg-bg-2'
    : 'border-line bg-cream hover:border-ink/25 hover:shadow-sm';

  return (
    <li className="list-none">
      <Link
        to={`/circles/${circle.id}/calendar`}
        aria-label={t('picker.open', { name: circle.name })}
        data-restricted={restricted || undefined}
        className={`block h-full rounded-2xl border p-6 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss-deep ${surface}`}
      >
        <div className="flex items-start gap-4">
          <Avatar
            size="lg"
            name={circle.recipient_name}
            photoUrl={circle.recipient_photo_url}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 className="serif m-0 text-lg text-ink">{circle.name}</h2>
              <Badge variant={roleBadgeVariant[roleKey]}>{t(`roles.${roleKey}`)}</Badge>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              {t('picker.caringFor', { name: circle.recipient_name })}
            </p>
            <p className="mt-1 text-sm text-ink-3">
              {t('picker.memberCount', { count: circle.member_count })}
            </p>
          </div>
        </div>

        {restricted && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              {isReadOnly && (
                <Badge variant="neutral">
                  <LockIcon />
                  {t('access.readOnly')}
                </Badge>
              )}
              {isViewOnly && (
                <Badge variant="neutral">
                  <EyeIcon />
                  {t('access.viewOnly')}
                </Badge>
              )}
            </div>
            {accessSubtitle && <p className="mt-2 text-sm text-ink-3">{accessSubtitle}</p>}
          </div>
        )}
      </Link>
    </li>
  );
}
