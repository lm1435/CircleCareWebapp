import { useState, type ReactElement } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { AddMenu, type AddMenuType } from '@/components/layout/AddMenu';
import { Button, Eyebrow, Icon, Sheet, Text, type IconName } from '@/components/ui';

/**
 * Active-state classes, one literal per section (spec §5.2). Static map, never
 * `bg-${section}-soft`: Tailwind scans source text and cannot see an
 * interpolation, so a computed name compiles to nothing.
 */
const ACTIVE_DUSK = 'bg-dusk-soft text-dusk-deep';
const ACTIVE_MOSS = 'bg-moss-soft text-moss-deep';
const ACTIVE_CLAY = 'bg-clay-soft text-clay-deep';
const ACTIVE_TERRACOTTA = 'bg-terracotta-soft text-terracotta-deep';
const ACTIVE_NEUTRAL = 'bg-bg-2 text-ink';

const LINK_BASE =
  'flex min-h-[44px] items-center gap-3 rounded-full px-4 py-2 text-md font-medium no-underline transition-colors duration-fast';
const LINK_INACTIVE = 'text-ink-2 hover:bg-bg-2 hover:text-ink';

interface NavItem {
  /** Path segment appended to `/circles/:id` — empty string is the index route. */
  segment: string;
  labelKey: string;
  icon: IconName;
  /** Filled counterpart, painted while the route is active. */
  activeIcon?: IconName;
  active: string;
}

interface NavGroup {
  /** `common` key for the eyebrow, or `null` for the unlabelled middle group. */
  labelKey: string | null;
  items: NavItem[];
}

/** Mobile's nav pill, grouped (spec §5.2). */
const GROUPS: readonly NavGroup[] = [
  {
    labelKey: 'nav.home',
    items: [
      {
        segment: '',
        labelKey: 'nav.home',
        icon: 'home-outline',
        activeIcon: 'home',
        active: ACTIVE_NEUTRAL,
      },
    ],
  },
  {
    labelKey: 'nav.careShort',
    items: [
      {
        segment: 'calendar',
        labelKey: 'nav.calendar',
        icon: 'calendar-outline',
        activeIcon: 'calendar',
        active: ACTIVE_DUSK,
      },
      { segment: 'meds', labelKey: 'nav.meds', icon: 'medkit-outline', active: ACTIVE_CLAY },
      {
        segment: 'tasks',
        labelKey: 'nav.tasks',
        icon: 'checkbox-outline',
        activeIcon: 'checkbox',
        active: ACTIVE_MOSS,
      },
      {
        segment: 'notes',
        labelKey: 'nav.notes',
        icon: 'document-text-outline',
        active: ACTIVE_DUSK,
      },
    ],
  },
  {
    labelKey: 'nav.healthShort',
    items: [
      {
        segment: 'emergency',
        labelKey: 'nav.emergency',
        icon: 'medical-outline',
        activeIcon: 'medical',
        active: ACTIVE_TERRACOTTA,
      },
      {
        segment: 'documents',
        labelKey: 'nav.documents',
        icon: 'document-text-outline',
        active: ACTIVE_TERRACOTTA,
      },
    ],
  },
  {
    labelKey: null,
    items: [
      { segment: 'activity', labelKey: 'nav.activity', icon: 'pulse-outline', active: ACTIVE_DUSK },
      { segment: 'vitals', labelKey: 'nav.vitals', icon: 'heart-outline', active: ACTIVE_NEUTRAL },
      {
        segment: 'members',
        labelKey: 'nav.members',
        icon: 'people-outline',
        active: ACTIVE_NEUTRAL,
      },
      {
        segment: 'settings',
        labelKey: 'nav.settings',
        icon: 'settings-outline',
        active: ACTIVE_NEUTRAL,
      },
    ],
  },
];

export interface SidebarProps {
  /** Static left column, hidden below xl (1024px) — the only layout AppLayout renders. */
  variant?: 'desktop';
  /** Called when a nav link is activated. */
  onNavigate?: () => void;
  /** Opens the AI assistant modal (mounted by AppLayout). */
  onOpenAssistant?: () => void;
  /** Opens a create flow (modal mounted by AppLayout). When omitted, New is hidden. */
  onCreate?: (kind: AddMenuType) => void;
  /** Requester can create calendar/med/task/note items (editable circle). */
  canCreate?: boolean;
}

const DESKTOP_CLASS =
  // Sticky under the (sticky, 60px) header, exactly one viewport tall, with
  // its own scroll: the rail stays put while <main> scrolls, so the AI entry
  // and the store badges at its foot are reachable from anywhere on a long
  // page without scrolling the page back up. `self-start` keeps the grid from
  // stretching it to the row (a stretched sticky child never sticks); the
  // fixed height keeps its right-hand rule running the full window and lets
  // a rail taller than the window scroll inside itself.
  'hidden xl:flex w-[272px] shrink-0 flex-col gap-6 border-r border-line bg-bg p-4 xl:sticky xl:top-[60px] xl:self-start xl:h-[calc(100vh-60px)] xl:overflow-y-auto';

export function Sidebar({
  onNavigate,
  onOpenAssistant,
  onCreate,
  canCreate = false,
}: SidebarProps = {}): ReactElement {
  const { t } = useTranslation('common');
  const { circleId } = useParams<{ circleId: string }>();
  const [addOpen, setAddOpen] = useState(false);
  const base = `/circles/${circleId}`;

  return (
    <aside className={DESKTOP_CLASS}>
      {onCreate && (
        // `relative` is the AddMenu's `sidebar` anchor: the pill positions
        // itself off this box's right edge (`left-full`), not the viewport.
        <div className="relative">
          <Button
            variant="primary"
            fullWidth
            leftIcon={<Icon name="add-outline" size="row" />}
            aria-haspopup="menu"
            aria-expanded={addOpen}
            aria-disabled={!canCreate}
            disabled={!canCreate}
            onClick={() => setAddOpen((prev) => !prev)}
          >
            {t('nav.new')}
          </Button>
          <AddMenu
            anchor="sidebar"
            open={addOpen}
            canCreate={canCreate}
            onClose={() => setAddOpen(false)}
            onSelect={(kind: AddMenuType) => onCreate(kind)}
          />
        </div>
      )}

      <nav aria-label={t('nav.label')} className="flex flex-col">
        {GROUPS.map((group) => {
          const label = group.labelKey ? t(group.labelKey) : undefined;
          return (
            <div key={group.labelKey ?? 'more'}>
              {label && (
                <Eyebrow as="p" className="px-4 pb-1 pt-4">
                  {label}
                </Eyebrow>
              )}
              <ul
                aria-label={label}
                className={`m-0 flex list-none flex-col gap-1 p-0 ${label ? '' : 'pt-4'}`}
              >
                {group.items.map((item) => (
                  <li key={item.segment || 'index'}>
                    <NavLink
                      to={item.segment ? `${base}/${item.segment}` : base}
                      end={item.segment === ''}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `${LINK_BASE} ${isActive ? item.active : LINK_INACTIVE}`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            name={isActive ? (item.activeIcon ?? item.icon) : item.icon}
                            size="row"
                          />
                          {t(item.labelKey)}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {onOpenAssistant && (
          <div>
            <Eyebrow as="p" className="px-4 pb-1 pt-4">
              {t('nav.aiShort')}
            </Eyebrow>
            <ul aria-label={t('nav.aiShort')} className="m-0 flex list-none flex-col gap-1 p-0">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onOpenAssistant();
                    onNavigate?.();
                  }}
                  className={`${LINK_BASE} w-full border-0 bg-transparent text-left text-coral-deep hover:bg-bg-2`}
                >
                  <Icon name="sparkles-outline" size="row" />
                  {t('nav.assistant')}
                </button>
              </li>
            </ul>
          </div>
        )}
      </nav>

      {/* Promotional download card — styled like a heading but intentionally NOT
          an <h*>: the sidebar (<aside>) precedes <main> in the DOM, so a heading
          here would be the document's first heading (an h2 before the page's h1),
          tripping WCAG 1.3.1 heading-order. It's chrome in a complementary
          landmark, not a content section, so a styled <p> is the correct element. */}
      <Sheet padding="sm">
        <Text variant="h3" as="p">
          {t('downloadApp.title')}
        </Text>
        <Text variant="caption" className="mb-3 mt-1">
          {t('downloadApp.subtitle')}
        </Text>
        <StoreBadges layout="stack" />
      </Sheet>
    </aside>
  );
}
