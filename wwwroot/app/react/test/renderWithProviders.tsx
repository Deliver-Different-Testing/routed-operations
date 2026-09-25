// Test render helper. Wraps a component in every context provider the app
// mounts at root so components under test see the same providers they see
// in production. Individual tests should use this instead of render()
// from @testing-library/react directly.
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ConfirmProvider } from '../context/ConfirmContext';
import { ToastProvider } from '../context/ToastContext';
import { GlobalSearchProvider } from '../context/GlobalSearchContext';

interface Options extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL for MemoryRouter. Defaults to '/'. */
  initialRoute?: string;
}

export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { initialRoute = '/', ...rest } = options;
  // Fresh QueryClient per render so cache state cannot leak between tests.
  // AuthProvider's tenant-drift guard uses useQueryClient() internally so
  // this must wrap AuthProvider, matching the production tree in index.tsx.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <GlobalSearchProvider>{children}</GlobalSearchProvider>
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    ),
    ...rest,
  });
}
