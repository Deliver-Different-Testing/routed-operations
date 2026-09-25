import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { recurringRouteService, type AssignableTargets } from '@/services/recurringRouteService';

// One fetch of `/api/recurring-routes/assignable-targets` shared across
// every tab that needs it (Linehaul, Route Roster, Linehaul Roster). Before
// this each tab fetched independently on first mount, so switching tabs
// hit the same endpoint 3 times. The shell now fetches once on page load
// and hands the value down via context.
interface SharedTargets {
  targets: AssignableTargets | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const SharedTargetsContext = createContext<SharedTargets>({
  targets: null,
  loading: false,
  error: null,
  refresh: async () => {},
});

export function SharedTargetsProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<AssignableTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await recurringRouteService.getAssignableTargets();
      setTargets(res.response ?? null);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to load assignable targets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <SharedTargetsContext.Provider value={{ targets, loading, error, refresh }}>
      {children}
    </SharedTargetsContext.Provider>
  );
}

export function useSharedTargets() {
  return useContext(SharedTargetsContext);
}
