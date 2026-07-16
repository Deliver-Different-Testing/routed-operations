import { createContext, useContext } from 'react';
import type { AppUser } from '../types';

const defaultUser: AppUser = {
  currentTenantId: null,
  fullName: null,
  email: null,
  timeZone: null,
  countryCode: null,
  isUsTenant: false,
  hereMapsApiKey: null,
  googleMapsKey: null,
};

const AuthContext = createContext<AppUser>(defaultUser);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = (typeof window !== 'undefined' && window.__APP_USER__) || defaultUser;
  return <AuthContext.Provider value={bootstrap}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
