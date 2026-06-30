import { type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircle } from '@/hooks/useCircle';
import { useTasks } from '@/hooks/useTasks';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useAuthStore } from '@/store/authStore';
import { Avatar, Card, Skeleton } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { GettingStartedChecklist } from '@/components/circles/GettingStartedChecklist';
import type { CircleMember } from '@/api/circleMembers';

function memberName(member: CircleMember): string {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email;
}

/** Small section heading + "view all" link, shared by the at-a-glance cards. */
function CardHeader({ title, to, linkLabel }: { title: string; to?: string; linkLabel?: string }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="section-title m-0">{title}</h2>
      {to && linkLabel ? (
        <Link
          to={to}
          className="shrink-0 text-sm font-medium text-terracotta-deep underline-offset-4 hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Circle Overview — the landing page when you open a circle (mirrors mobile's
 * home tab). A "what's going on with my person" surface: a recipient hero, the
 * get-started checklist while setup is incomplete, then at-a-glance cards
 * (today's meds, open tasks, recent activity, care team) that each link into
 * their full section. The calendar is now one nav item among others, not the
 * default landing.
 */
export default function OverviewPage(): ReactElement {
  const { t } = useTranslation(['overview', 'common']);
  const { circleId = '' } = useParams<{ circleId: string }>();
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { circle, members, isLoading } = useCircle(circleId);
  const isOwner = circle != null && currentUserId != null && circle.owner_id === currentUserId;
  const isSelfCare = circle?.is_self_care === true;
  const base = `/circles/${circleId}`;

  const tasksQuery = useTasks(circleId, { status: 'open' });
  const openTasks = tasksQuery.data?.tasks ?? [];

  const activityQuery = useActivityFeed(circleId, { pageSize: 5 });
  const activities = activityQuery.data?.pages.flatMap((page) => page.activities) ?? [];

  // People besides you, excluding the care recipient — "helping coordinate care".
  const helperCount = members.filter(
    (m) => m.id !== currentUserId && !m.is_care_recipient
  ).length;

  const heroTitle = isSelfCare
    ? t('hero.selfCareTitle')
    : t('hero.caringFor', { name: circle?.recipient_name ?? '' });
  const heroSubtitle =
    helperCount === 0 ? t('hero.subtitleSolo') : t('hero.subtitleTeam', { count: helperCount });

  return (
    <section className="mx-auto w-full max-w-5xl p-6 md:p-8">
      {/* Hero */}
      <header>
        <p className="eyebrow m-0">{t('hero.eyebrow')}</p>
        {isLoading && !circle ? (
          <Skeleton className="mt-2 h-9 w-64" />
        ) : (
          <h1 className="serif m-0 mt-1.5 text-3xl leading-tight text-ink">{heroTitle}</h1>
        )}
        <p className="m-0 mt-2 text-ink-3">{heroSubtitle}</p>
      </header>

      {/* Get-started checklist — self-hides once complete or dismissed. */}
      <div className="mt-6">
        <GettingStartedChecklist
          circleId={circleId}
          onAddEvent={() => navigate(`${base}/calendar`)}
        />
      </div>

      {/* At-a-glance */}
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Today's medications — self-contained section (own heading + confirm flow). */}
        <Card className="p-6">
          <TodaysMeds circleId={circleId} limit={5} />
        </Card>

        {/* Open tasks */}
        <Card className="p-6">
          <CardHeader title={t('tasks.title')} to={`${base}/tasks`} linkLabel={t('tasks.viewAll')} />
          {tasksQuery.isLoading ? (
            <div className="mt-4 flex flex-col gap-2" aria-busy="true">
              <span role="status" className="sr-only">
                {t('common:loading')}
              </span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : openTasks.length === 0 ? (
            <p className="m-0 mt-4 text-sm text-ink-3">{t('tasks.empty')}</p>
          ) : (
            <>
              <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
                {openTasks.slice(0, 3).map((task) => (
                  <li
                    key={task.id}
                    className="truncate rounded-xl border border-line-2 bg-cream px-3 py-2.5 text-sm text-ink"
                  >
                    {task.title}
                  </li>
                ))}
              </ul>
              {openTasks.length > 3 ? (
                <p className="m-0 mt-2 text-xs text-ink-3">
                  {t('tasks.more', { count: openTasks.length - 3 })}
                </p>
              ) : null}
            </>
          )}
        </Card>

        {/* Recent activity */}
        <Card className="p-6">
          <CardHeader
            title={t('activity.title')}
            to={`${base}/activity`}
            linkLabel={t('activity.viewAll')}
          />
          {activityQuery.isLoading ? (
            <div className="mt-4 flex flex-col gap-2" aria-busy="true">
              <span role="status" className="sr-only">
                {t('common:loading')}
              </span>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : activities.length === 0 ? (
            <p className="m-0 mt-4 text-sm text-ink-3">{t('activity.empty')}</p>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col p-0">
              {activities.slice(0, 3).map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </ul>
          )}
        </Card>

        {/* Care team */}
        <Card className="p-6">
          <CardHeader
            title={t('team.title')}
            to={`${base}/members`}
            linkLabel={isOwner ? t('team.invite') : t('team.manage')}
          />
          <p className="m-0 mt-1 text-sm text-ink-3">{t('team.count', { count: members.length })}</p>
          {members.length > 0 ? (
            <ul className="m-0 mt-4 flex list-none flex-wrap gap-2 p-0">
              {members.slice(0, 8).map((member) => (
                <li key={member.id}>
                  <Avatar name={memberName(member)} size="md" />
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
