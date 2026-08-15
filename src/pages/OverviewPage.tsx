import { type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircle } from '@/hooks/useCircle';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useAuthStore } from '@/store/authStore';
import { Avatar, Card, Skeleton, SectionHeader } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { OpenTasksCard } from '@/components/tasks/OpenTasksCard';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { GettingStartedChecklist } from '@/components/circles/GettingStartedChecklist';
import type { CircleMember } from '@/api/circleMembers';

function memberName(member: CircleMember): string {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email;
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

      {/* Get-started checklist — self-hides once complete, dismissed, or when
          the viewer can't edit (view-only member); gating is by write
          CAPABILITY, not ownership, and there is deliberately no circle-age
          window (see GettingStartedChecklist's docstring). `empty:hidden`
          drops this wrapper's margin in those cases, so a hidden checklist
          leaves no stray gap above the card grid. */}
      <div className="mt-6 empty:hidden">
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

        {/* Open tasks — self-contained section (own heading + the shared
            TaskRow, so a task can be completed/undone/edited straight from
            here, exactly as on the Tasks page and on mobile's home screen). */}
        <Card className="p-6">
          <OpenTasksCard circleId={circleId} limit={3} />
        </Card>

        {/* Recent activity */}
        <Card className="p-6">
          <SectionHeader
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
          <SectionHeader
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
