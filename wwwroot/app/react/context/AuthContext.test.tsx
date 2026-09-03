import { describe, expect, it, vi } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { AuthProvider, useAuth } from './AuthContext';
import { server } from '../test/server';
import type { AppUser } from '../types';

function makeWrapper() {
  // AuthProvider's tenant-drift guard uses useQueryClient(), so every test
  // that mounts it must live inside a QueryClientProvider (matches the
  // production tree in index.tsx).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('AuthContext', () => {
  it('AuthProvider renders its children', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <span data-testid="child">hello</span>
        </AuthProvider>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
  });

  it('useAuth returns the window.__APP_USER__ bootstrap value', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    expect(result.current.currentTenantId).toBe(1);
    expect(result.current.fullName).toBe('Test User');
    expect(result.current.email).toBe('test@example.com');
    expect(result.current.countryCode).toBe('NZ');
    expect(result.current.isUsTenant).toBe(false);
  });

  it('useAuth reflects a custom window.__APP_USER__ override', () => {
    const original = (window as any).__APP_USER__;
    const custom: AppUser = {
      currentTenantId: 42,
      fullName: 'Override User',
      email: 'override@example.com',
      timeZone: 'America/New_York',
      countryCode: 'US',
      isUsTenant: true,
      isInternal: true,
      hereMapsApiKey: 'here-key',
      googleMapsKey: 'google-key',
      isNetworkPartner: true,
      npAgentId: 7,
      clientTypeId: 'A',
      contactId: 9,
      clientId: 11,
      clientCount: 3,
      clientString: '1,2,3',
      despatchWebBaseUrl: 'https://example.com',
    };
    (window as any).__APP_USER__ = custom;
    // Echo the same tenant id so the drift guard doesn't try to reload.
    server.use(
      http.get('/api/session/current', () =>
        HttpResponse.json({ currentTenantId: 42, email: 'override@example.com' })),
    );
    try {
      const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
      expect(result.current).toEqual(custom);
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });

  it('useAuth falls back to the default shape when window.__APP_USER__ is missing', () => {
    const original = (window as any).__APP_USER__;
    delete (window as any).__APP_USER__;
    try {
      const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
      expect(result.current.currentTenantId).toBeNull();
      expect(result.current.fullName).toBeNull();
      expect(result.current.email).toBeNull();
      expect(result.current.isUsTenant).toBe(false);
      expect(result.current.isInternal).toBe(false);
      expect(result.current.isNetworkPartner).toBe(false);
      expect(result.current.hereMapsApiKey).toBeNull();
      expect(result.current.googleMapsKey).toBeNull();
      expect(result.current.despatchWebBaseUrl).toBeNull();
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });

  it('useAuth without a Provider returns the module default shape', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.currentTenantId).toBeNull();
    expect(result.current.fullName).toBeNull();
    expect(result.current.isUsTenant).toBe(false);
    expect(result.current.isNetworkPartner).toBe(false);
  });

  it('purges stale rv-filters keys and reloads when /api/session/current echoes a different tenant', async () => {
    const original = (window as any).__APP_USER__;
    // Bootstrap says tenant 1. Server echo returns tenant 2 - drift detected.
    (window as any).__APP_USER__ = {
      ...(original ?? {}),
      currentTenantId: 1,
      email: 'test@example.com',
    };
    server.use(
      http.get('/api/session/current', () =>
        HttpResponse.json({ currentTenantId: 2, email: 'test@example.com' })),
    );

    // Seed localStorage with filter entries for two tenants: the OLD one
    // (should be purged) and the NEW one the drift guard is about to
    // reload us into (should be kept).
    window.localStorage.setItem('rv-filters:1:test@example.com', '{"clientIds":[99]}');
    window.localStorage.setItem('rv-filters:2:test@example.com', '{"clientIds":[7]}');
    window.localStorage.setItem('other:key', 'untouched');

    // jsdom's location.reload is not implemented by default - stub it out
    // and assert we called it (also prevents the "not implemented" throw).
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    try {
      renderHook(() => useAuth(), { wrapper: makeWrapper() });
      await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
      // Old-tenant filter entry gone; new-tenant entry preserved; unrelated
      // key untouched.
      expect(window.localStorage.getItem('rv-filters:1:test@example.com')).toBeNull();
      expect(window.localStorage.getItem('rv-filters:2:test@example.com')).toBe('{"clientIds":[7]}');
      expect(window.localStorage.getItem('other:key')).toBe('untouched');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
      window.localStorage.removeItem('rv-filters:2:test@example.com');
      window.localStorage.removeItem('other:key');
      (window as any).__APP_USER__ = original;
    }
  });

  it('does not reload when the echoed tenant matches the bootstrap tenant', async () => {
    // Default handler echoes tenant 1 which matches the bootstrap.
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
    try {
      renderHook(() => useAuth(), { wrapper: makeWrapper() });
      // Give the async drift-check time to run. If it were going to
      // reload, it would fire within a few ticks.
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});
