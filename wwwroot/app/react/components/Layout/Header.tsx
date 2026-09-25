import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useGlobalSearch } from '../../context/GlobalSearchContext';
import { routeViewerService } from '../../services/routeViewerService';

/**
 * Layout header. Renders the tenant / user identity strip plus a
 * centered global job search box on both `/routes` (Route Builder) and
 * `/route-viewer/*` (Route Viewer). On Route Builder the search
 * scopes to the current in-memory cockpit view via GlobalSearchContext.
 * On Route Viewer it queries the backend
 * (`GET /api/runviewer/jobs/search?jobNumber=`) with a 250ms debounce
 * and jumps the cockpit to the picked job by navigating to
 * `/route-viewer?jobNumber=...` which the RunViewer page's deep-link
 * chain resolves.
 */
// Path → display name mapping. Kept in sync with the sidebar labels
// in components/Layout/Sidebar.tsx. Deep paths under /route-viewer/*
// resolve to their child label so the header title always matches the
// currently-highlighted sidebar entry.
const PAGE_NAMES: Array<[string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/bulk-import', 'Bulk Import'],
  ['/routes', 'Route Builder'],
  ['/quoting', 'Quoting'],
  ['/recurring-routes', 'Recurring Routes'],
  ['/schedules', 'Schedules'],
  ['/polygon-builder', 'Polygon Builder'],
  ['/auto-assign-log', 'Auto-Assign Log'],
  ['/historic-archive', 'Historic Archive Upload'],
  ['/route-viewer/scans', 'Scan Manager'],
  ['/route-viewer/print', 'Print Manager'],
  ['/route-viewer/cs', 'Customer Services'],
  ['/route-viewer/linehaul', 'Linehaul'],
  ['/route-viewer', 'Route Viewer'], // must come AFTER the /route-viewer/* children
];

function resolvePageName(pathname: string): string {
  for (const [prefix, name] of PAGE_NAMES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return name;
  }
  return '';
}

export function Header() {
  const user = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { query, setQuery, results, jumpToJob } = useGlobalSearch();
  const [focused, setFocused] = useState(false);
  const onRoutes = location.pathname === '/routes' || location.pathname.startsWith('/routes/');
  const onRouteViewer = location.pathname === '/route-viewer' || location.pathname.startsWith('/route-viewer/');
  const pageName = resolvePageName(location.pathname);

  // Route Viewer search state (kept local - GlobalSearchContext is scoped
  // to Route Builder's in-memory job list, not the Route Viewer backend
  // job-number lookup).
  const [rvQuery, setRvQuery] = useState('');
  const [rvHits, setRvHits] = useState<any[]>([]);
  const [rvSearching, setRvSearching] = useState(false);
  const rvDebounceRef = useRef<number | null>(null);
  const rvTokenRef = useRef(0);

  useEffect(() => {
    if (!onRouteViewer) return;
    if (rvDebounceRef.current) window.clearTimeout(rvDebounceRef.current);
    const q = rvQuery.trim();
    if (!q) { setRvHits([]); return; }
    rvDebounceRef.current = window.setTimeout(async () => {
      const token = ++rvTokenRef.current;
      setRvSearching(true);
      try {
        const hit = await routeViewerService.searchByJobNumber(q);
        if (rvTokenRef.current === token) setRvHits(hit ? [hit] : []);
      } catch {
        if (rvTokenRef.current === token) setRvHits([]);
      } finally {
        if (rvTokenRef.current === token) setRvSearching(false);
      }
    }, 250);
    return () => { if (rvDebounceRef.current) window.clearTimeout(rvDebounceRef.current); };
  }, [rvQuery, onRouteViewer]);

  const jumpToRvJob = (job: any) => {
    const jobNumber = job.jobNumber ?? '';
    const params = new URLSearchParams(location.search);
    params.set('jobNumber', jobNumber);
    if (location.pathname !== '/route-viewer') navigate(`/route-viewer?${params.toString()}`);
    else navigate(`/route-viewer?${params.toString()}`, { replace: true });
    setRvQuery('');
    setRvHits([]);
    setFocused(false);
  };

  const showSearch = onRoutes || onRouteViewer;

  return (
    <header className="h-14 bg-surface-white border-b border-border flex items-center gap-4 px-4">
      {/* Left: current page / menu name. Populated from the pathname so
          it matches the highlighted sidebar entry. Empty on unknown
          routes so the search still centers cleanly. */}
      <div className="text-base font-semibold text-text-primary min-w-0 truncate">
        {pageName}
      </div>
      {showSearch && (
        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-md">
            <input
              type="text"
              value={onRoutes ? query : rvQuery}
              onChange={(e) => (onRoutes ? setQuery(e.target.value) : setRvQuery(e.target.value))}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder={
                onRoutes
                  ? 'Search jobs (job #, ref, client, suburb, run name)...'
                  : 'Search jobs (job #)...'
              }
              className="w-full border border-border rounded-lg px-3 py-1 text-xs bg-surface-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan"
              title="Search across every job in the current view. Click a result to jump to it."
            />
            {(onRoutes ? query : rvQuery) && (
              <button
                type="button"
                onClick={() => (onRoutes ? setQuery('') : setRvQuery(''))}
                aria-label="Clear search"
                className="absolute right-1.5 top-1 text-text-muted hover:text-text-primary text-xs px-1"
              >
                X
              </button>
            )}
            {focused && onRoutes && query.trim() && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-surface-white border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto z-30">
                {results.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-muted italic">
                    No matches in the current view.
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-muted bg-surface-cream border-b border-border-light">
                      {results.length} match{results.length === 1 ? '' : 'es'}{results.length >= 25 ? ' (first 25)' : ''}
                    </div>
                    <ul className="divide-y divide-border-light">
                      {results.map((hit) => (
                        <li key={hit.bulkJobId}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              jumpToJob(hit.bulkJobId);
                              setQuery('');
                              setFocused(false);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan/10 text-xs"
                          >
                            <div className="font-medium text-text-primary">
                              {hit.jobNumber ?? `Job #${hit.bulkJobId}`}
                              {hit.clientCode && (
                                <span className="ml-2 text-text-muted font-normal">{hit.clientCode}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-text-muted">
                              {[hit.toSuburb, hit.toPostCode, hit.runName ? `Run: ${hit.runName}` : null]
                                .filter(Boolean)
                                .join(' - ')}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {focused && onRouteViewer && rvQuery.trim() && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-surface-white border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto z-30">
                {rvSearching && (
                  <div className="px-3 py-2 text-xs text-text-muted italic">Searching...</div>
                )}
                {!rvSearching && rvHits.length === 0 && (
                  <div className="px-3 py-2 text-xs text-text-muted italic">No matches.</div>
                )}
                <ul className="divide-y divide-border-light">
                  {rvHits.map((hit) => (
                    <li key={hit.bulkJobId}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); jumpToRvJob(hit); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan/10 text-xs"
                      >
                        <div className="font-medium text-text-primary">
                          {hit.jobNumber ?? `Job #${hit.bulkJobId}`}
                          {hit.clientCode && (
                            <span className="ml-2 text-text-muted font-normal">{hit.clientCode}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          {[hit.toSuburb, hit.toAddress].filter(Boolean).join(' - ')}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      {!showSearch && <div className="flex-1" />}
      {/* Right: tenant identity + user name. Tenant moved here from the
          left 2026-08-08 so the freed left slot can host the page
          title, which saves a vertical row on every screen. */}
      <div className="flex items-center gap-3">
        <div className="text-xs text-text-muted whitespace-nowrap">
          {user.currentTenantId ? `Tenant ${user.currentTenantId}` : 'Not signed in'}
          {user.timeZone && <span className="ml-1">- {user.timeZone}</span>}
        </div>
        <div className="text-sm text-text-primary whitespace-nowrap">
          {user.fullName ?? user.email ?? ' '}
        </div>
      </div>
    </header>
  );
}
