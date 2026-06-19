import { useEffect, type ReactElement } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { router } from '@/router';

export default function App(): ReactElement {
  // Boot-time silent cookie refresh (Task 9/10 decision: bootstrap is called
  // once at app level, not in AuthGuard). Single-flight inside the store, so
  // StrictMode's double effect invocation is harmless.
  useEffect(() => {
    void useAuthStore.getState().bootstrap();
  }, []);

  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}
