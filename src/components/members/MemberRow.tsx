import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, type BadgeVariant } from '@/components/ui';
import type { CircleMember } from '@/api/circleMembers';
import { BellIcon, EyeIcon, HeartIcon } from '@/components/circles/icons';
import { useAuthStore } from '@/store/authStore';

export interface MemberRowProps {
  member: CircleMember;
  /** Owner-only action slot (set-med-responsible / remove). Rendered after the badges. */
  actions?: ReactNode;
}

type RoleKey = 'owner' | 'caregiver' | 'careRecipient';

const roleBadgeVariant: Record<RoleKey, BadgeVariant> = {
  owner: 'moss',
  careRecipient: 'terracotta',
  caregiver: 'neutral',
};

function getRoleKey(member: CircleMember): RoleKey {
  if (member.is_care_recipient) return 'careRecipient';
  return member.role === 'owner' ? 'owner' : 'caregiver';
}

function getDisplayName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

/**
 * Read-only member list row (plan Task 35). Mirrors mobile's member row:
 * avatar (initials — the backend members payload carries no per-member photo)
 * with overlaid role indicators (heart = care recipient, bell = med-responsible),
 * name with "(you)", and an email/role subtitle. No invite / remove actions on web.
 */
export function MemberRow({ member, actions }: MemberRowProps): ReactElement {
  const { t } = useTranslation('members');
  const currentUserId = useAuthStore((s) => s.user?.id);
  const roleKey = getRoleKey(member);

  const displayName = getDisplayName(member);
  const hasName = Boolean(member.first_name || member.last_name);
  const isCurrentUser = currentUserId != null && member.id === currentUserId;

  // Subtitle: prefer the email for named members (mobile convention); fall
  // back to the role label when there's no name. The role itself is also shown
  // as a Badge, so we never repeat the role label when an email is available.
  const subtitle = hasName
    ? member.email
    : member.is_care_recipient
      ? t('roles.careRecipient')
      : member.role === 'owner'
        ? t('roles.owner')
        : t('roles.caregiver');

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-cream px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative inline-flex shrink-0">
          <Avatar size="md" name={hasName ? displayName : member.email} />
          {member.is_care_recipient && (
            <span
              aria-label={t('roles.careRecipient')}
              role="img"
              className="absolute -bottom-0.5 -right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-cream bg-terracotta text-cream"
            >
              <HeartIcon />
            </span>
          )}
          {member.is_medication_responsible && !member.is_care_recipient && (
            <span
              aria-label={t('list.medResponsible')}
              role="img"
              className="absolute -bottom-0.5 -right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-cream bg-moss text-cream"
            >
              <BellIcon />
            </span>
          )}
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate font-medium text-ink">
            {displayName}
            {isCurrentUser ? ` ${t('list.you')}` : ''}
          </p>
          <p className="m-0 mt-1 truncate text-sm text-ink-3">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={roleBadgeVariant[roleKey]}>{t(`roles.${roleKey}`)}</Badge>
        {member.view_only && (
          <Badge variant="neutral">
            <EyeIcon />
            {t('access.viewOnly')}
          </Badge>
        )}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </li>
  );
}
