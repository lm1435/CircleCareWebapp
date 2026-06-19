import type { ComponentType, ReactElement } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TodaysMeds } from '@/components/meds/TodaysMeds';

// TodaysMeds is owned by the meds agent (plan Task 22). Its final API takes a
// circleId prop; the current stub takes no props, so this cast keeps both
// versions type-compatible while still passing circleId from the route.
const TodaysMedsSection = TodaysMeds as ComponentType<{ circleId?: string }>;

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

function CalendarIcon(props: IconProps): ReactElement {
  return (
    <svg {...iconBase(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
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
   * desktop — static left column, hidden below lg (hamburger drawer takes over).
   * drawer — fills the mobile drawer panel rendered by AppLayout.
   */
  variant?: 'desktop' | 'drawer';
  /** Called when a nav link is activated (the drawer closes itself). */
  onNavigate?: () => void;
}

const VARIANT_CLASS: Record<NonNullable<SidebarProps['variant']>, string> = {
  desktop: 'hidden w-64 border-r border-line lg:flex',
  drawer: 'flex w-full flex-1',
};

export function Sidebar({ variant = 'desktop', onNavigate }: SidebarProps = {}): ReactElement {
  const { t } = useTranslation('common');
  const { circleId } = useParams<{ circleId: string }>();
  const base = `/circles/${circleId}`;

  return (
    <aside className={`shrink-0 flex-col gap-6 bg-bg p-4 ${VARIANT_CLASS[variant]}`}>
      <nav aria-label={t('nav.label')}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <NavLink to={`${base}/calendar`} className={navLinkClass} onClick={onNavigate}>
              <CalendarIcon className="shrink-0" />
              {t('nav.calendar')}
            </NavLink>
          </li>
          <li>
            <NavLink to={`${base}/activity`} className={navLinkClass} onClick={onNavigate}>
              <ActivityIcon className="shrink-0" />
              {t('nav.activity')}
            </NavLink>
          </li>
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
            </ul>
          </li>
          <li className="pt-3">
            <NavLink to={`${base}/members`} className={navLinkClass} onClick={onNavigate}>
              <MembersIcon className="shrink-0" />
              {t('nav.members')}
            </NavLink>
          </li>
        </ul>
      </nav>

      <TodaysMedsSection circleId={circleId} />

      <div className="mt-auto rounded-2xl border border-line bg-cream p-4">
        <h2 className="serif m-0 text-base text-ink">{t('downloadApp.title')}</h2>
        <p className="mb-3 mt-1 text-sm text-ink-3">{t('downloadApp.subtitle')}</p>
        {/* TODO: replace placeholder store URLs with the real CircleCare
            App Store / Play Store listing IDs once published. */}
        <div className="flex flex-col gap-2">
          <a
            href="https://apps.apple.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost min-h-11 w-full text-sm"
          >
            {t('downloadApp.appStore')}
          </a>
          <a
            href="https://play.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost min-h-11 w-full text-sm"
          >
            {t('downloadApp.googlePlay')}
          </a>
        </div>
      </div>
    </aside>
  );
}
