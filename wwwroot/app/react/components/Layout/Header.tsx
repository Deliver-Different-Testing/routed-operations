import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useGlobalSearch } from '../../context/GlobalSearchContext';

/**
 * Layout header. Renders the tenant / user identity strip plus the P1.4
 * global cross-jobs search box (legacy homeView.html:22-33). The search
 * only surfaces on the `/routes` page; other pages get a neutral header.
 * Filtering + result-jumping live in CockpitPage via useGlobalSearch().
 */
export function Header() {
  const user = useAuth();
  const location = useLocation();
  const { query, setQuery, results, jumpToJob } = useGlobalSearch();
  const [focused, setFocused] = useState(false);
  const onRoutes = location.pathname === '/routes' || location.pathname.startsWith('/routes/');

  return (
    <header className="h-14 bg-surface-white border-b border-border flex items-center gap-4 px-4">
      <div className="text-sm text-text-secondary">
        {user.currentTenantId ? `Tenant ${user.currentTenantId}` : 'Not signed in'}
        {user.timeZone && <span className="ml-2 text-text-muted">- {user.timeZone}</span>}
      </div>
      {onRoutes && (
        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-md">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              // Delay blur so a click on a result gets its onMouseDown / onClick
              // before the dropdown unmounts. 150ms matches the legacy pattern.
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Search jobs (job #, ref, client, suburb, run name)..."
              className="w-full border border-border rounded-lg px-3 py-1 text-xs bg-surface-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan"
              title="Search across every job in the current view. Click a result to jump to it."
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1 text-text-muted hover:text-text-primary text-xs px-1"
              >
                X
              </button>
            )}
            {focused && query.trim() && (
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
          </div>
        </div>
      )}
      {!onRoutes && <div className="flex-1" />}
      <div className="text-sm text-text-primary">
        {user.fullName ?? user.email ?? ' '}
      </div>
    </header>
  );
}
