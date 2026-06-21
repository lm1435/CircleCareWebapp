import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useCircles } from '@/hooks/useCircles';
import { useAuth } from '@/hooks/useAuth';
import { Button, Card } from '@/components/ui';
import { CircleCard } from '@/components/circles/CircleCard';
import { CircleCardSkeleton } from '@/components/circles/CircleCardSkeleton';
import { EmptyCircles } from '@/components/circles/EmptyCircles';
import { CreateCircleModal } from '@/components/circles/CreateCircleModal';

/** Time-of-day greeting key (mirrors mobile's getGreeting). */
function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * Circle picker landing page (plan Tasks 15 + 39c): a warm greeting hero over a
 * card grid of the user's circles from `GET /circles`. Mirrors mobile's
 * CircleListScreen header (eyebrow greeting → big serif name → circle count) so
 * the title carries real hierarchy instead of sitting flat above the cards.
 */
export default function CirclePickerPage(): ReactElement {
  const { t } = useTranslation(['members', 'circles']);
  const { user } = useAuth();
  const { data: circles, isPending, isError, refetch } = useCircles();
  const [showCreate, setShowCreate] = useState(false);

  const firstName = user?.first_name?.trim();
  const circleCount = circles?.length ?? 0;

  let content: ReactElement;
  if (isPending) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-8 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2"
      >
        <CircleCardSkeleton />
        <CircleCardSkeleton />
        <CircleCardSkeleton />
      </ul>
    );
  } else if (isError) {
    content = (
      <Card role="alert" className="mx-auto mt-8 max-w-lg p-8 text-center">
        <h2 className="serif m-0 text-lg text-ink">{t('picker.errorTitle')}</h2>
        <p className="mt-2 text-ink-2">{t('picker.errorBody')}</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (!circles || circles.length === 0) {
    content = (
      <EmptyCircles
        action={
          <Button onClick={() => setShowCreate(true)}>{t('circles:create.create')}</Button>
        }
      />
    );
  } else {
    content = (
      <ul className="m-0 mt-8 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
        {circles.map((circle) => (
          <CircleCard key={circle.id} circle={circle} />
        ))}
      </ul>
    );
  }

  // The "Create circle" header action is shown once the list has loaded with at
  // least one circle (the empty state has its own create CTA, and loading/error
  // states have nothing to add alongside).
  const showHeaderCreate = !isPending && !isError && circleCount > 0;

  return (
    <section className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {firstName ? (
            <>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-moss" />
                {t(`picker.greeting.${greetingKey()}`)}
              </p>
              <h1 className="serif m-0 mt-2 text-4xl leading-[1.05] text-ink sm:text-5xl">
                {firstName}
              </h1>
            </>
          ) : (
            <h1 className="serif m-0 text-4xl leading-[1.05] text-ink sm:text-5xl">
              {t('picker.heading')}
            </h1>
          )}
          {showHeaderCreate && (
            <p className="mt-3 text-ink-3">{t('picker.careCircleCount', { count: circleCount })}</p>
          )}
        </div>
        {showHeaderCreate && (
          <Button className="shrink-0" onClick={() => setShowCreate(true)}>
            {t('circles:create.create')}
          </Button>
        )}
      </header>
      {content}

      {showCreate && <CreateCircleModal onClose={() => setShowCreate(false)} />}
    </section>
  );
}
