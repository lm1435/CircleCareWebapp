import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Icon, SheetRow, type BadgeVariant } from '@/components/ui';
import type { CircleMember } from '@/api/circleMembers';
import { useAuthStore } from '@/store/authStore';

export interface MemberRowProps {
  member: CircleMember;
  /** Owner-only action slot (a `MoreMenu`: set/clear med-responsible, remove). */
  actions?: ReactNode;
}

type RoleKey = 'owner' | 'caregiver' | 'careRecipient';

/** Spec §6.7: owner `primary`, care recipient `coral`, caregiver `default`. */
const roleBadgeVariant: Record<RoleKey, BadgeVariant> = {
  owner: 'primary',
  careRecipient: 'coral',
  caregiver: 'default',
};

function getRoleKey(member: CircleMember): RoleKey {
  if (member.is_care_recipient) return 'careRecipient';
  return member.role === 'owner' ? 'owner' : 'caregiver';
}

function getDisplayName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

/** Spec §6.3.7 / §6.7: 16×16 ring-2 badge, care recipient coral + heart, medication manager moss + bell. */
const OVERLAY_BASE =
  'absolute -bottom-0.5 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-cream';

/**
 * Read-only member list row (mirrors mobile's members sheet, ~CircleDetailScreen
 * L1384-1470). Avatar (initials — the backend members payload carries no
 * per-member photo) with an overlaid role indicator (heart = care recipient,
 * bell = medication manager), name + role `Badge`, and an email/role subtitle.
 * Owner-only management (set/clear medication manager, remove) is the caller's
 * `actions` slot — a `MoreMenu` — so this component stays a pure display row.
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
    <SheetRow as="li" className="gap-3 px-[18px] py-3.5">
      <div className="relative shrink-0">
        <Avatar size="sm" name={hasName ? displayName : member.email} />
        {member.is_care_recipient ? (
          // Decorative: the role Badge right next to the name already
          // announces "Care recipient" — an aria-label here would repeat it.
          <span aria-hidden="true" className={`${OVERLAY_BASE} bg-coral`}>
            <Icon name="heart-outline" size={10} className="text-cream" />
          </span>
        ) : member.is_medication_responsible ? (
          <span
            role="img"
            aria-label={t('list.medResponsible')}
            className={`${OVERLAY_BASE} bg-moss`}
          >
            <Icon name="notifications-outline" size={10} className="text-cream" />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 truncate text-md font-semibold text-ink">
            {displayName}
            {isCurrentUser ? ` ${t('list.you')}` : ''}
          </p>
          <Badge variant={roleBadgeVariant[roleKey]} size="sm">
            {t(`roles.${roleKey}`)}
          </Badge>
          {member.view_only && (
            <Badge variant="default" size="sm" icon="eye-outline">
              {t('access.viewOnly')}
            </Badge>
          )}
        </div>
        <p className="m-0 mt-0.5 truncate text-sm text-ink-2">{subtitle}</p>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </SheetRow>
  );
}
