import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useCircles } from '@/hooks/useCircles';
import { Button, Card } from '@/components/ui';
import { CircleCard } from '@/components/circles/CircleCard';
import { CircleCardSkeleton } from '@/components/circles/CircleCardSkeleton';
import { EmptyCircles } from '@/components/circles/EmptyCircles';

/**
 * Circle picker landing page (plan Tasks 15 + 39c): card grid of the user's
 * circles from `GET /circles`. Click navigates to that circle's calendar.
 */
export default function CirclePickerPage(): ReactElement {
  const { t } = useTranslation('members');
  const { data: circles, isPending, isError, refetch } = useCircles();

  let content: ReactElement;
  if (isPending) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-8 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3"
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
    content = <EmptyCircles />;
  } else {
    content = (
      <ul className="m-0 mt-8 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {circles.map((circle) => (
          <CircleCard key={circle.id} circle={circle} />
        ))}
      </ul>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl p-8">
      <h1 className="serif m-0 text-2xl text-ink">{t('picker.heading')}</h1>
      <p className="mt-2 text-ink-3">{t('picker.subheading')}</p>
      {content}
    </section>
  );
}
