import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Sheet, Text } from '@/components/ui';
import type { SettingsRowId } from '@/lib/settingsSections';

export interface SettingsListRow {
  id: SettingsRowId;
  label: string;
  /** Current value, shown in grey before the chevron. Omitted = no value text. */
  value?: ReactNode;
  to: string;
  state?: unknown;
}

export interface SettingsListGroup {
  key: string;
  title: string;
  rows: SettingsListRow[];
}

/**
 * Profile > the four grouped settings lists (design pass 2026-11-08, mobile parity).
 * Each group is a labelled list in one Sheet; each row is a real link showing its
 * label, its current value in grey and a chevron. The value sits inside the link,
 * so the link's accessible name carries it ("Alerts All on").
 */
export function SettingsList({ groups }: { groups: SettingsListGroup[] }): ReactElement {
  return (
    <div className="mt-8 flex flex-col gap-6">
      {groups.map((group) => {
        const headingId = `settings-group-${group.key}-title`;
        return (
          <section key={group.key} data-testid={`settings-group-${group.key}`}>
            <Text variant="sectionLabel" as="h2" id={headingId} className="px-1">
              {group.title}
            </Text>
            <Sheet as="ul" aria-labelledby={headingId} className="mt-2 list-none overflow-hidden p-0">
              {group.rows.map((row) => (
                <li key={row.id} className="border-t border-line-2 first:border-t-0">
                  <Link
                    to={row.to}
                    state={row.state}
                    data-testid={`settings-row-${row.id}`}
                    className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-bg-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                  >
                    <span
                      data-testid="settings-row-label"
                      className="min-w-0 text-base font-medium text-ink"
                    >
                      {row.label}
                    </span>
                    <span className="flex min-w-0 shrink items-center gap-1.5">
                      {row.value !== undefined && row.value !== '' ? (
                        <span
                          data-testid="settings-row-value"
                          className="truncate text-sm text-ink-2 tabular-nums"
                        >
                          {row.value}
                        </span>
                      ) : null}
                      <Icon name="chevron-forward" size="meta" className="shrink-0 text-ink-2" />
                    </span>
                  </Link>
                </li>
              ))}
            </Sheet>
          </section>
        );
      })}
    </div>
  );
}
