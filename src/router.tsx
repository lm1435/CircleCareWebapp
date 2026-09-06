import { lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { PageviewTracker } from '@/components/PageviewTracker';
import { RouteTitle } from '@/components/RouteTitle';
import { AppLayout } from '@/components/layout/AppLayout';
import { StandalonePageLayout } from '@/components/layout/StandalonePageLayout';
// Public / pre-auth routes stay EAGER: a signed-out visitor's very first paint
// is one of these, so lazy-loading them would trade entry-chunk size for a
// network round trip on the critical path. NotFoundPage is unauthenticated
// too (see the route table below) so it stays eager alongside them.
import LoginPage from '@/pages/LoginPage';
import SignUpPage from '@/pages/SignUpPage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import InviteLandingPage from '@/pages/InviteLandingPage';
import NotFoundPage from '@/pages/NotFoundPage';
// Authenticated routes are `React.lazy`: none of this code is reachable (or
// needed) until AuthGuard has confirmed a session, so it ships as separate
// chunks instead of bloating the entry bundle every visitor pays for. Caught
// by the single <Suspense> boundary in src/App.tsx.
const CirclePickerPage = lazy(() => import('@/pages/CirclePickerPage'));
const PendingInvitesPage = lazy(() => import('@/pages/PendingInvitesPage'));
const OverviewPage = lazy(() => import('@/pages/OverviewPage'));
const CalendarPage = lazy(() => import('@/pages/CalendarPage'));
const MedicationsPage = lazy(() => import('@/pages/MedicationsPage'));
const TasksPage = lazy(() => import('@/pages/TasksPage'));
const NotesPage = lazy(() => import('@/pages/NotesPage'));
const ActivityFeedPage = lazy(() => import('@/pages/ActivityFeedPage'));
const EmergencyInfoPage = lazy(() => import('@/pages/EmergencyInfoPage'));
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'));
const MembersPage = lazy(() => import('@/pages/MembersPage'));
const VitalsPage = lazy(() => import('@/pages/VitalsPage'));
const EditCirclePage = lazy(() => import('@/pages/EditCirclePage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const UpgradePage = lazy(() => import('@/pages/UpgradePage'));

export const router = createBrowserRouter([
  // Root layout: keeps the per-route document <title> (RouteTitle) in sync and
  // fires sanitized $pageview events (PageviewTracker) for every path while
  // leaving each page's own rendering untouched (WCAG 2.4.2).
  {
    element: (
      <>
        <RouteTitle />
        <PageviewTracker />
        <Outlet />
      </>
    ),
    children: [
  // Public routes — no auth required
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/invite/:code', element: <InviteLandingPage /> },
  // Deep-link target for the "Open CircleCare" email CTAs. On devices with the app installed,
  // the OS intercepts https://my.circlecare.app/open via Universal/App Links and opens the app;
  // on the web it falls back to home (AuthGuard sends signed-out users to login).
  { path: '/open', element: <Navigate to="/" replace /> },

  // Authenticated routes
  {
    element: (
      <AuthGuard>
        <Outlet />
      </AuthGuard>
    ),
    children: [
      { path: '/', element: <Navigate to="/circles" replace /> },
      // These standalone pages render without AppLayout, so they need their own
      // <main> landmark (provided by StandalonePageLayout) for a11y.
      {
        element: <StandalonePageLayout />,
        children: [
          { path: '/circles', element: <CirclePickerPage /> },
          { path: '/invites', element: <PendingInvitesPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/upgrade', element: <UpgradePage /> },
          { path: '/help', element: <HelpPage /> },
        ],
      },
      {
        path: '/circles/:circleId',
        element: <AppLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'meds', element: <MedicationsPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'notes', element: <NotesPage /> },
          { path: 'activity', element: <ActivityFeedPage /> },
          { path: 'emergency', element: <EmergencyInfoPage /> },
          { path: 'documents', element: <DocumentsPage /> },
          { path: 'vitals', element: <VitalsPage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'settings', element: <EditCirclePage /> },
        ],
      },
    ],
  },

  // Fallback — a real 404 instead of silently redirecting broken links home.
  // Public: signed-out visitors see it too; its CTA goes through AuthGuard.
  { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
