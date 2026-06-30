import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useMenu } from './useMenu';

export type CreateKind =
  | 'appointment'
  | 'medication'
  | 'task'
  | 'vitals'
  | 'document'
  | 'invite';

interface IconProps {
  className?: string;
}

function iconBase(props: IconProps): {
  'aria-hidden': true;
  focusable: 'false';
  width: number;
  height: number;
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  className?: string;
} {
  return {
    'aria-hidden': true,
    focusable: 'false',
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: props.className,
  };
}

function PlusIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function AppointmentIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function MedicationIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <path d="M12 8v8" />
    </svg>
  );
}

function TaskIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M9 11l2 2 4-4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function VitalsIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M3 12h4l2 5 4-12 2 7h6" />
    </svg>
  );
}

function DocumentIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function InviteIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

export interface CreateMenuProps {
  /** canEdit — controls med/appt/task/vitals/document. */
  canCreate: boolean;
  /** isOwner — controls invite. */
  canInvite: boolean;
  onSelect: (kind: CreateKind) => void;
}

interface MenuOption {
  kind: CreateKind;
  labelKey: string;
  Icon: (props: IconProps) => ReactElement;
}

const PANEL_CLASS =
  'absolute z-40 left-0 top-full mt-1 flex w-60 flex-col gap-1 rounded-2xl border border-line bg-bg p-1 shadow-xl xl:left-full xl:top-0 xl:ml-2 xl:mt-0';

const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-ink transition-colors hover:bg-bg-2';

/**
 * Global "Create" menu (WAI-ARIA menu-button, via useMenu). The terracotta pill
 * trigger opens a vertical option list — to the right of the trigger on desktop,
 * below it on smaller screens. Options are gated: create actions need `canCreate`
 * (editable circle), invite needs `canInvite` (owner). When no option is
 * available (read-only viewer who isn't the owner) the whole menu renders nothing.
 */
export function CreateMenu({ canCreate, canInvite, onSelect }: CreateMenuProps): ReactElement | null {
  const { t } = useTranslation('common');
  const menu = useMenu();

  const options: MenuOption[] = [];
  if (canCreate) {
    options.push(
      { kind: 'appointment', labelKey: 'create.appointment', Icon: AppointmentIcon },
      { kind: 'medication', labelKey: 'create.medication', Icon: MedicationIcon },
      { kind: 'task', labelKey: 'create.task', Icon: TaskIcon },
      { kind: 'vitals', labelKey: 'create.vitals', Icon: VitalsIcon },
      { kind: 'document', labelKey: 'create.document', Icon: DocumentIcon }
    );
  }
  if (canInvite) {
    options.push({ kind: 'invite', labelKey: 'create.invite', Icon: InviteIcon });
  }

  if (options.length === 0) return null;

  const select = (kind: CreateKind): void => {
    onSelect(kind);
    menu.close();
  };

  return (
    <div className="relative">
      <button
        ref={menu.buttonRef}
        type="button"
        onClick={menu.toggle}
        onKeyDown={menu.onButtonKeyDown}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        className="btn btn-terracotta w-full"
      >
        <PlusIcon className="shrink-0" />
        {t('create.button')}
      </button>

      {menu.open && (
        <div
          ref={menu.menuRef}
          role="menu"
          aria-label={t('create.menuLabel')}
          onKeyDown={menu.onMenuKeyDown}
          className={PANEL_CLASS}
        >
          {options.map(({ kind, labelKey, Icon }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => select(kind)}
              className={ITEM_CLASS}
            >
              <Icon className="shrink-0 text-ink-3" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
