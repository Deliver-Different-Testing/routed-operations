import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { useRouteViewerRuns } from '../../hooks/queries/useRouteViewerRuns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { RvBox } from '../../components/route-viewer/RvBox';

// Mobile RunViewer surface (master Section 13). Single-column layout
// tuned for handheld / tablet operators. Nav flow:
//   Overview -> region tile
//   Runs list -> tap run -> Jobs -> tap job -> Detail
// Bottom-nav tabs (Overview / Runs) let the driver hop between the
// region roll-up and the run list without back-tracking through the
// drill hierarchy.
//
// Overview tab powered by /api/runviewer/runs/overview and a
// courier-GPS strip on the job Detail (25s poll of
// /api/runviewer/couriers/position). Google Maps embed marker is
// deferred pending Section U.3 key rotation - the GPS strip today
// shows the coordinates + last-fix timestamp + an Open-in-Maps link
// so drivers can hand off to a native maps app.

type Tab = 'runs' | 'overview';
type Drill = 'list' | 'jobs' | 'detail';

export default function Mobile() {
  const user = useAuth();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  const [tab, setTab] = useState<Tab>('runs');
  const [drill, setDrill] = useState<Drill>('list');
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  // Filters + group toggles - persist on the handheld across nav so
  // drivers don't have to re-apply after each drill. Filters popup is
  // a slide-up drawer on the mobile surface only.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [regionIds, setRegionIds] = useState<number[]>([]);
  const [speedIds, setSpeedIds] = useState<number[]>([]);
  const [groupRuns, setGroupRuns] = useState(false);

  const { clientInternal, multipleClients, regions, speeds } = useRouteViewerLookups(runDate, false);
  const runsQuery = useRouteViewerRuns({
    runDate, clientInternal, multipleClients,
    clientIds: [], regionIds, speedIds, group: 'Combined',
  });

  const overviewQ = useQuery({
    queryKey: ['mob-overview', runDate],
    queryFn: () => routeViewerService.getRegionOverview(runDate),
    enabled: tab === 'overview' && !!runDate,
    staleTime: 15_000,
  });

  const runJobsQuery = useQuery({
    queryKey: ['mob-run-jobs', selectedRunId, runDate],
    queryFn: () => routeViewerService.getRunJobs(selectedRunId!, runDate, 'Combined'),
    enabled: selectedRunId != null && !!runDate,
    staleTime: 5_000,
  });

  const jobDetailQuery = useQuery({
    queryKey: ['mob-job-detail', selectedJobId],
    queryFn: () => routeViewerService.getBulkJob(selectedJobId!),
    enabled: selectedJobId != null,
    staleTime: 5_000,
  });

  // v2: 25s poll of the courier's GPS position for the current
  // job. Feeds the driver-GPS strip on the Detail view. Null-safe
  // when the SP has no fix on file.
  const gpsQ = useQuery({
    queryKey: ['mob-courier-gps', selectedJobId],
    queryFn: () => routeViewerService.getCourierPosition(selectedJobId!),
    enabled: drill === 'detail' && selectedJobId != null,
    staleTime: 20_000,
  });

  const qc = useQueryClient();
  useAutoPoll(() => {
    runsQuery.refetch();
    if (selectedRunId != null) qc.invalidateQueries({ queryKey: ['mob-run-jobs', selectedRunId] });
    if (drill === 'detail' && selectedJobId != null) qc.invalidateQueries({ queryKey: ['mob-courier-gps', selectedJobId] });
  }, 25, true);

  const runs = runsQuery.data ?? [];
  const jobs = runJobsQuery.data ?? [];
  const job = jobDetailQuery.data;

  const totals = useMemo(() => {
    if (tab === 'overview') return `${(overviewQ.data ?? []).length} regions`;
    if (drill === 'list') return `${runs.length} runs`;
    if (drill === 'jobs') return `${jobs.length} jobs`;
    return '';
  }, [tab, drill, runs, jobs, overviewQ.data]);

  const goBack = () => {
    if (drill === 'detail') { setDrill('jobs'); setSelectedJobId(null); return; }
    if (drill === 'jobs') { setDrill('list'); setSelectedRunId(null); return; }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden max-w-2xl mx-auto bg-surface-cream">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-white">
        {tab === 'runs' && drill !== 'list' && (
          <button
            type="button"
            onClick={goBack}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-black/5"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <input
          type="date"
          value={runDate}
          onChange={(e) => setRunDate(e.target.value)}
          className="border border-border rounded px-2 py-1 text-xs bg-surface-white"
        />
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-black/5"
          title="Filters"
          aria-label="Filters"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
        <label className="flex items-center gap-1 text-[10px] text-text-muted" title="Group jobs by delivery suburb">
          <input
            type="checkbox"
            checked={groupRuns}
            onChange={(e) => setGroupRuns(e.target.checked)}
            className="accent-brand-cyan"
          />
          Group
        </label>
        <div className="ml-auto text-xs text-text-muted">{totals}</div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'overview' && (
          <RvBox title="Overview">
            <ul className="divide-y divide-border">
              {(overviewQ.data ?? []).map((r) => (
                <li
                  key={r.regionId}
                  className="px-3 py-3 cursor-pointer hover:bg-surface-cream/60 active:bg-brand-cyan/10"
                  onClick={() => {
                    // Tap a region tile -> jump to Runs tab and rely
                    // on the region filter default (driver rarely
                    // needs a hard filter; keeping the full list open).
                    setTab('runs');
                    setDrill('list');
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{r.region ?? '-'}</span>
                    <span className="text-xs text-text-muted">{r.total} jobs</span>
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5 flex gap-3 flex-wrap">
                    <span>Sort {r.sortScan}</span>
                    <span>Run {r.runScan}</span>
                    <span>Pick {r.pickedUp}</span>
                    <span className="text-brand-orange">To do {r.toDo}</span>
                  </div>
                </li>
              ))}
              {(overviewQ.data ?? []).length === 0 && !overviewQ.isLoading && (
                <li className="px-3 py-6 text-center text-text-muted text-sm">No regions with jobs.</li>
              )}
            </ul>
          </RvBox>
        )}

        {tab === 'runs' && drill === 'list' && (
          <RvBox title="Runs">
            <ul className="divide-y divide-border">
              {runs.map((r) => (
                <li
                  key={r.id}
                  onClick={() => { setSelectedRunId(r.id); setDrill('jobs'); }}
                  className="cursor-pointer px-3 py-3 hover:bg-surface-cream/60 active:bg-brand-cyan/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.name ?? '-'}</span>
                    <span className="text-xs text-text-muted">{r.jobs} jobs</span>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {r.area ?? '-'} - {r.courierName ?? 'unassigned'}
                  </div>
                </li>
              ))}
              {runs.length === 0 && !runsQuery.isLoading && (
                <li className="px-3 py-6 text-center text-text-muted text-sm">No runs.</li>
              )}
            </ul>
          </RvBox>
        )}

        {tab === 'runs' && drill === 'jobs' && (
          <RvBox title={runs.find((r) => r.id === selectedRunId)?.name ?? 'Jobs'}>
            {!groupRuns && (
              <ul className="divide-y divide-border">
                {jobs.map((j) => (
                  <li
                    key={j.bulkJobId}
                    onClick={() => { setSelectedJobId(j.bulkJobId); setDrill('detail'); }}
                    className="cursor-pointer px-3 py-3 hover:bg-surface-cream/60 active:bg-brand-cyan/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm">{j.jobNumber ?? '-'}</span>
                      <span className="text-xs text-text-muted">
                        {tenantTimeFromSpString(j.bookTime, user.isUsTenant)}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5 truncate">
                      {j.toAddress ?? '-'}
                      {j.toCity && `, ${j.toCity}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {groupRuns && (
              <div>
                {Object.entries(
                  jobs.reduce((acc, j) => {
                    const key = (j.toSuburb || j.toCity || 'Unknown').trim() || 'Unknown';
                    (acc[key] ||= []).push(j);
                    return acc;
                  }, {} as Record<string, typeof jobs>),
                ).sort(([a], [b]) => a.localeCompare(b)).map(([suburb, group]) => (
                  <div key={suburb}>
                    <div className="sticky top-0 bg-surface-cream/95 px-3 py-1 text-[10px] uppercase text-text-muted font-medium border-b border-border">
                      {suburb} - {group.length} job{group.length === 1 ? '' : 's'}
                    </div>
                    <ul className="divide-y divide-border">
                      {group.map((j) => (
                        <li
                          key={j.bulkJobId}
                          onClick={() => { setSelectedJobId(j.bulkJobId); setDrill('detail'); }}
                          className="cursor-pointer px-3 py-3 hover:bg-surface-cream/60 active:bg-brand-cyan/10"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-sm">{j.jobNumber ?? '-'}</span>
                            <span className="text-xs text-text-muted">
                              {tenantTimeFromSpString(j.bookTime, user.isUsTenant)}
                            </span>
                          </div>
                          <div className="text-xs text-text-muted mt-0.5 truncate">
                            {j.toAddress ?? '-'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {jobs.length === 0 && !runJobsQuery.isLoading && (
              <div className="px-3 py-6 text-center text-text-muted text-sm">No jobs on this run.</div>
            )}
          </RvBox>
        )}

        {tab === 'runs' && drill === 'detail' && job && (
          <RvBox title={`Job ${job.jobNumber ?? job.bulkJobId}`}>
            <div className="p-3 space-y-3 text-sm">
              <MobileRow k="Client" v={job.clientCode ?? '-'} />
              <MobileRow k="Ready" v={`${tenantDateFromSpString(job.bookDate, user.isUsTenant)} ${tenantTimeFromSpString(job.bookTime, user.isUsTenant)}`} />
              <MobileRow k="From" v={job.fromAddress ?? '-'} />
              <MobileRow k="To" v={job.toAddress ?? '-'} />
              <MobileRow k="Contact" v={job.contact ?? '-'} />
              <MobileRow k="Phone" v={job.phone ?? '-'} />
              <MobileRow k="Courier" v={job.courierName ?? 'unassigned'} />
              <MobileRow k="Speed" v={job.speedName ?? '-'} />
              {job.deliveryNotes && (
                <div>
                  <div className="text-xs text-text-muted mb-0.5">Delivery notes</div>
                  <div className="whitespace-pre-wrap">{job.deliveryNotes}</div>
                </div>
              )}
              {gpsQ.data && gpsQ.data.latitude != null && gpsQ.data.longitude != null && (
                <div className="border-t border-border pt-2 mt-2">
                  <div className="text-xs text-text-muted mb-1">Courier GPS (25s poll)</div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">
                      {gpsQ.data.latitude.toFixed(5)}, {gpsQ.data.longitude.toFixed(5)}
                    </span>
                    <a
                      href={`https://www.google.com/maps?q=${gpsQ.data.latitude},${gpsQ.data.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-cyan hover:underline"
                    >
                      Open in Maps
                    </a>
                  </div>
                  {gpsQ.data.timestamp && (
                    <div className="text-[10px] text-text-muted mt-0.5">
                      Last fix: {new Date(gpsQ.data.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}
              {gpsQ.data === null && !gpsQ.isLoading && (
                <div className="border-t border-border pt-2 mt-2 text-xs text-text-muted">
                  No courier GPS fix on file.
                </div>
              )}
            </div>
          </RvBox>
        )}
        {tab === 'runs' && drill === 'detail' && !job && jobDetailQuery.isLoading && (
          <div className="p-6 text-center text-text-muted">Loading job...</div>
        )}
      </div>

      {/* Bottom nav. Visible only at the top of a drill so back
          navigation stays predictable (don't tab-switch mid-drill). */}
      <div className={`border-t border-border bg-surface-white flex-shrink-0 ${
        drill !== 'list' ? 'opacity-60 pointer-events-none' : ''
      }`}>
        <div className="grid grid-cols-2">
          <BottomTab
            active={tab === 'overview'}
            label="Overview"
            onClick={() => { setTab('overview'); setDrill('list'); }}
          />
          <BottomTab
            active={tab === 'runs'}
            label="Runs"
            onClick={() => { setTab('runs'); setDrill('list'); }}
          />
        </div>
      </div>

      {filtersOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 flex items-end sm:items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setFiltersOpen(false); }}
        >
          <div className="bg-surface-white w-full max-w-md rounded-t-lg sm:rounded-lg shadow-lg border-t sm:border border-border p-4 max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Filters</h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="text-xs text-text-muted"
              >
                Close
              </button>
            </div>

            <label className="block text-xs text-text-muted mb-1">Regions</label>
            <select
              multiple
              value={regionIds.map(String)}
              onChange={(e) => setRegionIds(
                Array.from(e.target.selectedOptions).map((o) => Number(o.value))
              )}
              className="w-full border border-border rounded p-2 text-sm mb-3 h-24"
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>

            <label className="block text-xs text-text-muted mb-1">Speeds</label>
            <select
              multiple
              value={speedIds.map(String)}
              onChange={(e) => setSpeedIds(
                Array.from(e.target.selectedOptions).map((o) => Number(o.value))
              )}
              className="w-full border border-border rounded p-2 text-sm mb-3 h-24"
            >
              {speeds.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setRegionIds([]); setSpeedIds([]); }}
                className="text-xs px-3 py-1 rounded border border-border"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="text-xs px-3 py-1 rounded bg-brand-cyan text-brand-dark font-medium"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="w-20 text-xs text-text-muted flex-shrink-0">{k}</div>
      <div className="flex-1">{v}</div>
    </div>
  );
}

function BottomTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-3 text-xs font-medium ${active ? 'text-brand-cyan border-t-2 border-brand-cyan' : 'text-text-muted'}`}
    >
      {label}
    </button>
  );
}
