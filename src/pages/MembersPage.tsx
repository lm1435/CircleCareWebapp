import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { Button, Card, Skeleton } from '@/components/ui';
import { MemberRow } from '@/components/members/MemberRow';

function MemberRowSkeleton(): ReactElement {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-cream px-6 py-4">
      <div>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-4 w-28" />
      </div>
      <Skeleton className="h-6 w-24 rounded-full" />
    </li>
  );
}

/**
 * Read-only members page (plan Tasks 35-36): member list with role badges,
 * join dates, and view-only indicators, derived from `GET /circles/:circleId`.
 */
export default function MembersPage(): ReactElement {
  const { t } = useTranslation('members');
  const { circleId } = useParams<{ circleId: string }>();
  const { members, isPending, isError, refetch } = useCircleMembers(circleId ?? '');

  let content: ReactElement;
  if (isPending) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
      >
        <MemberRowSkeleton />
        <MemberRowSkeleton />
        <MemberRowSkeleton />
      </ul>
    );
  } else if (isError) {
    content = (
      <Card role="alert" className="mt-6 max-w-lg p-8 text-center">
        <h2 className="serif m-0 text-lg text-ink">{t('list.errorTitle')}</h2>
        <p className="mt-2 text-ink-2">{t('list.errorBody')}</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (members.length === 0) {
    content = (
      <Card className="mt-6 max-w-lg p-8 text-center">
        <p className="m-0 text-ink-2">{t('list.empty')}</p>
      </Card>
    );
  } else {
    content = (
      <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} />
        ))}
      </ul>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl p-8">
      <h1 className="serif m-0 text-2xl text-ink">{t('list.heading')}</h1>
      <p className="mt-2 text-ink-3">{t('list.subheading')}</p>
      {content}
    </section>
  );
}
