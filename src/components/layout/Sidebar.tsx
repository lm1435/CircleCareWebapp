import type { ReactElement } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { CreateMenu, type CreateKind } from '@/components/layout/CreateMenu';

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
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: props.className,
  };
}

function HomeIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function CalendarIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function TasksIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M9 11l2 2 4-4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function ActivityIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function EmergencyIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6l7-3z" />
      <path d="M12 9.5v4M10 11.5h4" />
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

function SettingsIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

function MembersIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex min-h-11 items-center gap-3 rounded-full px-4 py-2 text-sm no-underline transition-colors ${
    isActive ? 'bg-bg-2 font-medium text-ink' : 'text-ink-2 hover:bg-bg-2 hover:text-ink'
  }`;
}

export interface SidebarProps {
  /**
   * desktop — static left column, hidden below xl (hamburger drawer takes over).
   * drawer — fills the mobile drawer panel rendered by AppLayout.
   */
  variant?: 'desktop' | 'drawer';
  /** Called when a nav link is activated (the drawer closes itself). */
  onNavigate?: () => void;
  /** Opens the AI assistant modal (mounted by AppLayout). */
  onOpenAssistant?: () => void;
  /** Opens a create flow (modal mounted by AppLayout). When omitted, the Create menu is hidden. */
  onCreate?: (kind: CreateKind) => void;
  /** Requester can create calendar/vitals/document items (editable circle). */
  canCreate?: boolean;
  /** Requester can invite members (circle owner). */
  canInvite?: boolean;
}

function AssistantIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2M20 14h2M9 13v2M15 13v2" />
    </svg>
  );
}

const VARIANT_CLASS: Record<NonNullable<SidebarProps['variant']>, string> = {
  desktop: 'hidden w-72 border-r border-line xl:flex',
  drawer: 'flex w-full flex-1',
};

export function Sidebar({
  variant = 'desktop',
  onNavigate,
  onOpenAssistant,
  onCreate,
  canCreate = false,
  canInvite = false,
}: SidebarProps = {}): ReactElement {
  const { t } = useTranslation('common');
  const { circleId } = useParams<{ circleId: string }>();
  const base = `/circles/${circleId}`;

  return (
    <aside className={`shrink-0 flex-col gap-6 bg-bg p-4 ${VARIANT_CLASS[variant]}`}>
      {onCreate && <CreateMenu canCreate={canCreate} canInvite={canInvite} onSelect={onCreate} />}
      <nav aria-label={t('nav.label')}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <NavLink to={base} end className={navLinkClass} onClick={onNavigate}>
              <HomeIcon className="shrink-0" />
              {t('nav.home')}
            </NavLink>
          </li>
          <li>
            <NavLink to={`${base}/calendar`} className={navLinkClass} onClick={onNavigate}>
              <CalendarIcon className="shrink-0" />
              {t('nav.calendar')}
            </NavLink>
          </li>
          <li>
            <NavLink to={`${base}/tasks`} className={navLinkClass} onClick={onNavigate}>
              <TasksIcon className="shrink-0" />
              {t('nav.tasks')}
            </NavLink>
          </li>
          <li>
            <NavLink to={`${base}/activity`} className={navLinkClass} onClick={onNavigate}>
              <ActivityIcon className="shrink-0" />
              {t('nav.activity')}
            </NavLink>
          </li>
          {onOpenAssistant && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onOpenAssistant();
                  onNavigate?.();
                }}
                className={`${navLinkClass({ isActive: false })} w-full border-0 bg-transparent text-left`}
              >
                <AssistantIcon className="shrink-0" />
                {t('nav.assistant')}
              </button>
            </li>
          )}
          <li>
            <span className="eyebrow block px-4 pb-1 pt-4">{t('nav.health')}</span>
            <ul aria-label={t('nav.health')} className="m-0 flex list-none flex-col gap-1 p-0">
              <li>
                <NavLink to={`${base}/emergency`} className={navLinkClass} onClick={onNavigate}>
                  <EmergencyIcon className="shrink-0" />
                  {t('nav.emergency')}
                </NavLink>
              </li>
              <li>
                <NavLink to={`${base}/documents`} className={navLinkClass} onClick={onNavigate}>
                  <DocumentIcon className="shrink-0" />
                  {t('nav.documents')}
                </NavLink>
              </li>
              <li>
                <NavLink to={`${base}/vitals`} className={navLinkClass} onClick={onNavigate}>
                  <VitalsIcon className="shrink-0" />
                  {t('nav.vitals')}
                </NavLink>
              </li>
            </ul>
          </li>
          <li className="pt-3">
            <NavLink to={`${base}/members`} className={navLinkClass} onClick={onNavigate}>
              <MembersIcon className="shrink-0" />
              {t('nav.members')}
            </NavLink>
          </li>
          <li>
            <NavLink to={`${base}/settings`} className={navLinkClass} onClick={onNavigate}>
              <SettingsIcon className="shrink-0" />
              {t('nav.settings')}
            </NavLink>
          </li>
        </ul>
      </nav>

      {/* Promotional download card — styled like a heading but intentionally NOT
          an <h*>: the sidebar (<aside>) precedes <main> in the DOM, so a heading
          here would be the document's first heading (an h2 before the page's h1),
          tripping WCAG 1.3.1 heading-order. It's chrome in a complementary
          landmark, not a content section, so a styled <p> is the correct element. */}
      <div className="rounded-2xl border border-line bg-cream p-4">
        <p className="serif m-0 text-base text-ink">{t('downloadApp.title')}</p>
        <p className="mb-3 mt-1 text-sm text-ink-3">{t('downloadApp.subtitle')}</p>
        <StoreBadges layout="stack" />
      </div>
    </aside>
  );
}
