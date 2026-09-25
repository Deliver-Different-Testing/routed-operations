import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Global cross-jobs search (P1.4, legacy homeView.html:22-33 top bar).
 *
 * Two-way binding: Header renders the input and calls setQuery; CockpitPage
 * reads the query via useGlobalSearch() to filter its Jobs / Runs panes.
 * Kept intentionally lightweight (no debounce, no server round-trip) - the
 * legacy homeControl.runListCombined() was purely client-side too.
 *
 * A separate `resultsVisible` flag lets Header decide when to render its
 * result dropdown vs just tinting the input. Callers register a jump handler
 * via registerOnJump() so clicking a result in the Header can hop to the
 * matching job in the Jobs pane without a route change.
 */
type JumpHandler = (bulkJobId: number) => void;

/**
 * Slim shape carried through the header result dropdown. Keeps the context
 * decoupled from the full BulkJob type (which lives in the cockpit module).
 */
export interface SearchHit {
  bulkJobId: number;
  jobNumber: string | null;
  clientCode: string | null;
  toSuburb: string | null;
  toPostCode: number | null;
  runName: string | null;
}

interface GlobalSearchApi {
  query: string;
  setQuery: (q: string) => void;
  registerOnJump: (fn: JumpHandler | null) => void;
  jumpToJob: (bulkJobId: number) => void;
  results: SearchHit[];
  publishResults: (hits: SearchHit[]) => void;
}

const GlobalSearchContext = createContext<GlobalSearchApi>({
  query: '',
  setQuery: () => undefined,
  registerOnJump: () => undefined,
  jumpToJob: () => undefined,
  results: [],
  publishResults: () => undefined,
});

export function GlobalSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  // Ref-like slot: the current jump handler wins. Using a plain object cell
  // instead of useRef so the api value is stable across re-renders.
  const [jumpCell] = useState<{ fn: JumpHandler | null }>({ fn: null });

  const registerOnJump = useCallback((fn: JumpHandler | null) => {
    jumpCell.fn = fn;
  }, [jumpCell]);

  const jumpToJob = useCallback((bulkJobId: number) => {
    jumpCell.fn?.(bulkJobId);
  }, [jumpCell]);

  const publishResults = useCallback((hits: SearchHit[]) => {
    setResults(hits);
  }, []);

  const api = useMemo(
    () => ({ query, setQuery, registerOnJump, jumpToJob, results, publishResults }),
    [query, registerOnJump, jumpToJob, results, publishResults]
  );
  return (
    <GlobalSearchContext.Provider value={api}>
      {children}
    </GlobalSearchContext.Provider>
  );
}

export function useGlobalSearch() {
  return useContext(GlobalSearchContext);
}
