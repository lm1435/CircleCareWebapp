import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Centered single-card layout shared by all auth pages. */
export function AuthShell({ title, subtitle, children }: AuthShellProps): ReactElement {
  const { t } = useTranslation('common');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <p className="serif mb-6 text-center text-lg text-ink">{t('appName')}</p>
        <Card>
          <h1 className="serif m-0 mb-2 text-xl leading-tight text-ink">{title}</h1>
          {subtitle ? <p className="m-0 mb-6 text-sm text-ink-3">{subtitle}</p> : null}
          {children}
        </Card>
      </div>
    </main>
  );
}
