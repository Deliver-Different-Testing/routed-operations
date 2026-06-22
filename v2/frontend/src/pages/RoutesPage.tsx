import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CockpitPage from '../components/CockpitPage';
import { fetchJobs, fetchRuns, fetchFleets, fetchJobGroups } from '../lib/api';
import { mockJobs, mockGroupsDelivery, mockRunsDelivery, mockFleetsDelivery, mockRecurringRoutes, zipPolygons } from '../lib/mockData';
import type { Job, JobGroup, Run, Fleet } from '../lib/mockData';

/**
 * Routes — wired to the .NET 9 backend via /api endpoints.
 *
 * Falls back to mock data while the backend is unreachable so the cockpit still
 * renders in the demo. Once `/api/jobs` returns 200, the mocks are replaced.
 *
 * Pattern Kevin should follow for Quoting + ScheduledRoutes:
 *   1. useState({ live: false }) so a loading state is visible.
 *   2. useEffect to fetch + setState.
 *   3. catch blocks fall back to mock + console.warn.
 */
export default function RoutesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>(mockJobs);
  const [groups, setGroups] = useState<JobGroup[]>(mockGroupsDelivery);
  const [runs, setRuns] = useState<Run[]>(mockRunsDelivery);
  const [fleets, setFleets] = useState<Fleet[]>(mockFleetsDelivery);
  const [live, setLive] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const mode = searchParams.get('mode') === 'dynamic' ? 'dynamic' : 'batch';
  const setMode = (next: 'batch' | 'dynamic') => {
    const updated = new URLSearchParams(searchParams);
    if (next === 'dynamic') updated.set('mode', 'dynamic');
    else updated.delete('mode');
    setSearchParams(updated, { replace: true });
  };

  useEffect(() => {
    const today = new Date();
    let cancelled = false;
    (async () => {
      try {
        const [jobsResp, groupsResp, runsResp, fleetsResp] = await Promise.all([
          fetchJobs({ date: today }),
          fetchJobGroups(today),
          fetchRuns(today),
          fetchFleets(),
        ]);
        if (cancelled) return;
        if (jobsResp.length > 0)   setJobs(jobsResp);
        if (groupsResp.length > 0) setGroups(groupsResp);
        if (runsResp.length > 0)   setRuns(runsResp);
        if (fleetsResp.length > 0) setFleets(fleetsResp);
        setLive(true);
      } catch (e) {
        console.warn('Routes API unreachable — falling back to mock data', e);
        setShowOfflineBanner(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      {!live && showOfflineBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1 text-[11px] text-amber-800">
          ⚠️ Live API unavailable — showing mock data for demo.
        </div>
      )}
      <CockpitPage
        title="Route Building"
        subtitle={mode === 'dynamic'
          ? (live ? 'Dynamic mode — draft-route planning on live job data.' : 'Dynamic mode mockup — using the scheduled-route board patterns as the first pass for rolling route building.')
          : (live ? 'Batch mode — live data from /api/* with pickups auto-matched by zip.' : 'Batch mode mockup — backend not wired in this environment.')} 
        extraHeaderActions={
          <div className="inline-flex items-center rounded-md border border-gray-300 bg-white overflow-hidden shadow-sm">
            <button
              onClick={() => setMode('batch')}
              className={`px-3 py-1.5 text-xs font-medium transition ${mode === 'batch' ? 'bg-brand-dark text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              Batch
            </button>
            <button
              onClick={() => setMode('dynamic')}
              className={`px-3 py-1.5 text-xs font-medium transition border-l border-gray-300 ${mode === 'dynamic' ? 'bg-brand-cyan text-brand-dark' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              Dynamic
            </button>
          </div>
        }
        jobs={jobs}
        groups={groups}
        runs={runs}
        fleets={fleets}
        mapCenter={[-43.56, 172.50]}
        mapZoom={11}
        regularRoutes={mode === 'dynamic' ? mockRecurringRoutes : undefined}
        zipPolygons={mode === 'dynamic' ? zipPolygons : undefined}
      />
    </>
  );
}
