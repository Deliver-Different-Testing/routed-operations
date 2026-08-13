import { describe, expect, it } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import type { AppUser } from '../types';

describe('AuthContext', () => {
  it('AuthProvider renders its children', () => {
    render(
      <AuthProvider>
        <span data-testid="child">hello</span>
      </AuthProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
  });

  it('useAuth returns the window.__APP_USER__ bootstrap value', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
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
    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current).toEqual(custom);
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });

  it('useAuth falls back to the default shape when window.__APP_USER__ is missing', () => {
    const original = (window as any).__APP_USER__;
    delete (window as any).__APP_USER__;
    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });
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
});
