import { createContext, useContext } from 'react';
import type { AppUser } from '../types';

const defaultUser: AppUser = {
  currentTenantId: null,
  fullName: null,
  email: null,
  timeZone: null,
  countryCode: null,
  isUsTenant: false,
  isInternal: false,
  hereMapsApiKey: null,
  googleMapsKey: null,
  // Route Viewer defaults - safe values that behave as "no NP scope, no
  // client scope" so an unauthenticated pre-bootstrap render never
  // surfaces cross-tenant data.
  isNetworkPartner: false,
  npAgentId: null,
  clientTypeId: null,
  contactId: null,
  clientId: null,
  clientCount: null,
  clientString: null,
};

const AuthContext = createContext<AppUser>(defaultUser);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = (typeof window !== 'undefined' && window.__APP_USER__) || defaultUser;
  return <AuthContext.Provider value={bootstrap}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
