import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { AppLayout } from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import InviteLandingPage from '@/pages/InviteLandingPage';
import CirclePickerPage from '@/pages/CirclePickerPage';
import CalendarPage from '@/pages/CalendarPage';
import ActivityFeedPage from '@/pages/ActivityFeedPage';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';
import DocumentsPage from '@/pages/DocumentsPage';
import MembersPage from '@/pages/MembersPage';

export const router = createBrowserRouter([
  // Public routes — no auth required
  { path: '/login', element: <LoginPage /> },
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
      { path: '/circles', element: <CirclePickerPage /> },
      {
        path: '/circles/:circleId',
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="calendar" replace /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'activity', element: <ActivityFeedPage /> },
          { path: 'emergency', element: <EmergencyInfoPage /> },
          { path: 'documents', element: <DocumentsPage /> },
          { path: 'members', element: <MembersPage /> },
        ],
      },
    ],
  },

  // Fallback
  { path: '*', element: <Navigate to="/circles" replace /> },
]);
