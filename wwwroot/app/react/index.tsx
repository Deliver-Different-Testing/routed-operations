import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { GlobalSearchProvider } from './context/GlobalSearchContext';
import './index.css';

// Phase 4 perf: TanStack Query for client-side dedup, stale-while-revalidate,
// and window-focus refetch. Cockpit lookups (couriers, speeds, regions,
// vehicle sizes) go through useQuery hooks so filter toggles no longer
// re-fetch on every render. See wwwroot/app/react/hooks/queries/.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // 5 min - trust cached data for this long
      gcTime: 30 * 60 * 1000,       // 30 min - keep in memory this long after unmount
      refetchOnWindowFocus: true,   // refetch when tab regains focus (stale data)
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

const container = document.getElementById('routed-operations-root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <GlobalSearchProvider>
                  <App />
                </GlobalSearchProvider>
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
