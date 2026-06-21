import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { AppLayout } from '@/components/layout/AppLayout';
import { StandalonePageLayout } from '@/components/layout/StandalonePageLayout';
import LoginPage from '@/pages/LoginPage';
import SignUpPage from '@/pages/SignUpPage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import InviteLandingPage from '@/pages/InviteLandingPage';
import CirclePickerPage from '@/pages/CirclePickerPage';
import PendingInvitesPage from '@/pages/PendingInvitesPage';
import OverviewPage from '@/pages/OverviewPage';
import CalendarPage from '@/pages/CalendarPage';
import TasksPage from '@/pages/TasksPage';
import ActivityFeedPage from '@/pages/ActivityFeedPage';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';
import DocumentsPage from '@/pages/DocumentsPage';
import MembersPage from '@/pages/MembersPage';
import VitalsPage from '@/pages/VitalsPage';
import EditCirclePage from '@/pages/EditCirclePage';
import ProfilePage from '@/pages/ProfilePage';
import HelpPage from '@/pages/HelpPage';

export const router = createBrowserRouter([
  // Public routes — no auth required
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/invite/:code', element: <InviteLandingPage /> },

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
          { path: '/help', element: <HelpPage /> },
        ],
      },
      {
        path: '/circles/:circleId',
        element: <AppLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'tasks', element: <TasksPage /> },
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

  // Fallback
  { path: '*', element: <Navigate to="/circles" replace /> },
]);
