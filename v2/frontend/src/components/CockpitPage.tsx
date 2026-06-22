import { useState, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Panel from './Panel';
import HereMap, { MapPolygon } from './HereMap';
import JobDetailModal from './JobDetailModal';
import ContextMenu, { MenuItem } from './ContextMenu';
import EditRunScopeModal from './EditRunScopeModal';
import SettingsDrawer from './SettingsDrawer';
import { Job, JobGroup, Run, Fleet, RecurringRoute, mockCouriersByFleet } from '../lib/mockData';

interface MenuState { x: number; y: number; items: MenuItem[] }

const VHandle = () => (
  <PanelResizeHandle className="h-1.5 bg-brand-light hover:bg-brand-cyan transition-colors data-[resize-handle-state=drag]:bg-brand-cyan cursor-row-resize" />
);
const HHandle = () => (
  <PanelResizeHandle className="w-1.5 bg-brand-light hover:bg-brand-cyan transition-colors data-[resize-handle-state=drag]:bg-brand-cyan cursor-col-resize" />
);

interface Props {
  title: string;
  subtitle: string;
  jobs: Job[];
  groups: JobGroup[];
  runs: Run[];
  fleets: Fleet[];
  mapCenter: [number, number];
  mapZoom: number;
  mapPolygons?: MapPolygon[];
  extraHeaderActions?: React.ReactNode;
  // Optional: replace the Grouped Jobs panel with a Regular Routes panel
  regularRoutes?: RecurringRoute[];
  zipPolygons?: Record<string, [number, number][]>;
}

export default function CockpitPage({
  title, subtitle, jobs, groups, runs, fleets, mapCenter, mapZoom,
  mapPolygons, extraHeaderActions, regularRoutes, zipPolygons,
}: Props) {
  const useRegularRoutes = !!regularRoutes && regularRoutes.length > 0;
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>(
    () => regularRoutes?.slice(0, 2).map(r => r.id) ?? [],
  );

  const toggleRouteId = (id: string) =>
    setSelectedRouteIds(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  // Derived polygons from selected regular routes (overrides mapPolygons if set)
  const derivedMapPolygons = useMemo<MapPolygon[] | undefined>(() => {
    if (!useRegularRoutes || !regularRoutes || !zipPolygons) return undefined;
    return regularRoutes
      .filter(r => selectedRouteIds.includes(r.id))
      .flatMap(r =>
        r.zips
          .filter(z => zipPolygons[z])
          .map(z => ({
            id: z,
            name: `${r.name} · ${z}`,
            points: zipPolygons[z],
            color: r.color,
          })),
      );
  }, [useRegularRoutes, regularRoutes, zipPolygons, selectedRouteIds]);

  const effectiveMapPolygons = derivedMapPolygons ?? mapPolygons;

  // Selected route zips for Jobs List filtering when regularRoutes mode is on
  const selectedRouteZips = useMemo<Set<string>>(() => {
    if (!useRegularRoutes || !regularRoutes) return new Set();
    const s = new Set<string>();
    regularRoutes.filter(r => selectedRouteIds.includes(r.id)).forEach(r => r.zips.forEach(z => s.add(z)));
    return s;
  }, [useRegularRoutes, regularRoutes, selectedRouteIds]);
  // Pickup → run zip-match. Pickups auto-assign to the run whose delivery jobs share their zip.
  const [pickupOverrides, setPickupOverrides] = useState<Record<string, string | null>>(() => {
    const init: Record<string, string | null> = {};
    jobs.filter(j => j.type === 'pickup').forEach(p => {
      const match = jobs.find(d => d.type === 'delivery' && d.runId && d.zipCode === p.zipCode);
      init[p.id] = match?.runId ?? null;
    });
    return init;
  });

  // Effective jobs apply the pickup overrides so map/tables react in lock-step
  const effectiveJobs = useMemo<Job[]>(
    () => jobs.map(j => j.type === 'pickup' ? { ...j, runId: pickupOverrides[j.id] ?? undefined } : j),
    [jobs, pickupOverrides],
  );

  // Augment groups with a synthetic "Unmatched pickups" row at the top
  const unmatchedCount = useMemo(
    () => effectiveJobs.filter(j => j.type === 'pickup' && !j.runId).length,
    [effectiveJobs],
  );
  const groupsWithUnmatched = useMemo<JobGroup[]>(
    () => (unmatchedCount > 0 ? [{ readyAt: 'UNMATCHED', count: unmatchedCount }, ...groups] : groups),
    [groups, unmatchedCount],
  );

  const [selectedGroup, setSelectedGroup] = useState<string | null>(groupsWithUnmatched[0]?.readyAt ?? null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const [selectedFleet, setSelectedFleet] = useState<string | null>(fleets[0]?.name ?? null);

  const visibleJobs = useMemo(() => {
    let pool = effectiveJobs;
    if (selectedGroup === 'UNMATCHED') {
      pool = pool.filter(j => j.type === 'pickup' && !j.runId);
    } else if (selectedGroup) {
      pool = pool.filter(j => j.readyAt === selectedGroup);
    }
    if (useRegularRoutes && selectedRouteZips.size > 0) {
      pool = pool.filter(j => j.zipCode && selectedRouteZips.has(j.zipCode));
    }
    return pool;
  }, [effectiveJobs, selectedGroup, useRegularRoutes, selectedRouteZips]);

  const jobDetail = effectiveJobs.find(j => j.id === selectedJob) ?? effectiveJobs[0] ?? null;
  const focusedRun = runs.find(r => selectedRuns.includes(r.id)) ?? null;
  const focusedScheduledRoute = useRegularRoutes && regularRoutes
    ? regularRoutes.find(r => selectedRouteIds.includes(r.id)) ?? null
    : null;
  const scheduledRouteJobs = useMemo(
    () => (focusedScheduledRoute
      ? effectiveJobs.filter(j => j.zipCode && focusedScheduledRoute.zips.includes(j.zipCode))
      : []),
    [focusedScheduledRoute, effectiveJobs],
  );
  const couriers = selectedFleet ? mockCouriersByFleet[selectedFleet] ?? [] : [];
  const runJobs = focusedRun ? effectiveJobs.filter(j => j.runId === focusedRun.id) : [];

  const toggleRun = (id: string) =>
    setSelectedRuns(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [layoutNonce, setLayoutNonce] = useState(0);

  // Slot-based layout for cross-column panel swap.
  // 8 slots: 0,1,2 = col1 / 3,4 = col2 / 5,6 = col3 / 7 = col4.
  // The slot positions are fixed; what changes is which panel ID lives in which slot.
  type PanelId = 'grouped' | 'jobs' | 'detail' | 'runlist' | 'run' | 'fleets' | 'couriers' | 'map';
  const DEFAULT_SLOTS: PanelId[] = ['grouped', 'jobs', 'detail', 'runlist', 'run', 'fleets', 'couriers', 'map'];
  const SLOT_COLUMN: number[] = [0, 0, 0, 1, 1, 2, 2, 3];
  const slotsStorageKey = `rb-slots-state::${title}`;
  const [slots, setSlots] = useState<PanelId[]>(() => {
    try {
      const stored = localStorage.getItem(slotsStorageKey);
      if (stored) return JSON.parse(stored);
    } catch (_) { /* ignore */ }
    return DEFAULT_SLOTS;
  });

  const slotOfPanel = (panelId: PanelId): number => slots.indexOf(panelId);
  const colOfPanel = (panelId: PanelId): number => SLOT_COLUMN[slotOfPanel(panelId)];

  const moveToColumn = (panelId: PanelId, targetCol: number) => {
    setSlots(prev => {
      const fromIdx = prev.indexOf(panelId);
      if (fromIdx < 0) return prev;
      if (SLOT_COLUMN[fromIdx] === targetCol) return prev;
      // Swap with the last slot in the target column
      let toIdx = -1;
      for (let i = SLOT_COLUMN.length - 1; i >= 0; i--) {
        if (SLOT_COLUMN[i] === targetCol) { toIdx = i; break; }
      }
      if (toIdx < 0) return prev;
      const next = [...prev];
      [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
      try { localStorage.setItem(slotsStorageKey, JSON.stringify(next)); } catch (_) { /* ignore */ }
      return next;
    });
    setMovePopover(null);
  };

  // react-resizable-panels persists per-PanelGroup via autoSaveId in localStorage.
  // Reset clears sizes AND slot assignments and re-mounts.
  const layoutKeyPrefix = `rb-cols::${title}`;
  const resetLayout = () => {
    Object.keys(localStorage)
      .filter(k => k.startsWith(layoutKeyPrefix) || k.startsWith(`react-resizable-panels:${title}`) || k === slotsStorageKey)
      .forEach(k => localStorage.removeItem(k));
    setSlots(DEFAULT_SLOTS);
    setLayoutNonce(n => n + 1);
    setLayoutMenuOpen(false);
  };

  // Move handle button — opens a small popover with "Move to column N" options.
  const [movePopover, setMovePopover] = useState<{ panelId: PanelId; x: number; y: number } | null>(null);
  const MoveHandle = ({ panelId }: { panelId: PanelId }) => {
    return (
      <button
        title="Move panel to another column"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMovePopover({ panelId, x: r.left, y: r.bottom + 4 });
        }}
        onMouseDown={e => e.stopPropagation()}
        className="text-[12px] text-white/80 hover:text-white px-0.5 leading-none cursor-pointer"
      >
        <span style={{ letterSpacing: '-1px' }}>⠿</span>
      </button>
    );
  };

  const openMenu = (e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const assignPickup = (pickupId: string, runId: string | null) =>
    setPickupOverrides(o => ({ ...o, [pickupId]: runId }));

  const groupMenu = (group: JobGroup): MenuItem[] => [
    { label: 'Edit Group Date', onClick: () => setScopeOpen(true) },
    { label: 'Open these times', onClick: () => setSelectedGroup(group.readyAt) },
  ];

  const runMenu = (run: Run): MenuItem[] => [
    { label: 'Edit Name' },
    { label: 'Edit Route Date', onClick: () => setScopeOpen(true) },
    { label: 'Merge selected run to another run', disabled: selectedRuns.length < 2 },
    { label: 'Route and Lock Run' },
    { label: 'Toggle Run Lock' },
    { label: 'Remove', disabled: true },
    { divider: true, label: '' },
    { label: 'Send Selected Runs To Live', onClick: () => alert(`Send ${selectedRuns.length || 1} run(s) to live (mock)`) },
  ];

  const jobInRunMenu = (job: Job): MenuItem[] => {
    if (job.type === 'pickup') {
      return [
        { label: 'Unassign pickup', onClick: () => assignPickup(job.id, null) },
        { label: 'Toggle end point' },
        { label: 'Void' },
      ];
    }
    return [
      { label: 'Toggle end point' },
      { label: 'Remove' },
      { label: 'Void' },
    ];
  };

  const jobListMenu = (job: Job): MenuItem[] => {
    if (job.type === 'pickup') {
      const isAssigned = !!job.runId;
      return [
        ...(isAssigned ? [
          { label: `Currently on ${job.runId}`, disabled: true },
          { label: 'Unassign pickup', onClick: () => assignPickup(job.id, null) },
          { divider: true, label: '' },
        ] : []),
        ...runs.map(r => ({
          label: `Assign to run ${r.id} — ${r.area.split(' ').slice(0, 2).join(' ')}`,
          onClick: () => assignPickup(job.id, r.id),
          disabled: r.id === job.runId,
        })),
        { divider: true, label: '' },
        { label: 'Void' },
      ];
    }
    return [{ label: 'Void' }];
  };

  // ────────────────────────────────────────────────────────────────────
  // Panel content map — keyed by PanelId. Each slot in the cockpit grid
  // renders {panelMap[slots[N]]} so panels can swap between columns when
  // the user picks "Move to Column X" from the ⠿ handle popover.
  // ────────────────────────────────────────────────────────────────────
  const panelMap: Record<PanelId, JSX.Element> = {
    grouped: (
      <Panel
        title="Grouped Jobs"
        actions={
          <>
            <MoveHandle panelId="grouped" />
            <button title="Sync EH/HD" className="text-[10px] bg-cyan-500 text-white px-1.5 py-0.5 rounded">⟳ Sync EH/HD</button>
            <button title="Click to edit run scope" onClick={() => setScopeOpen(true)} className="text-[10px] text-white/90 hover:text-white hover:underline cursor-pointer flex items-center gap-1">📅 2026-06-15</button>
            <button title="Upload" className="text-[10px]">↑</button>
            <button title="Auto Runbuild" className="text-[10px]" aria-label="auto runbuild">⚡</button>
          </>
        }
      >
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-2 py-1 font-medium">Group</th>
              <th className="px-2 py-1 font-medium text-right">Jobs</th>
            </tr>
          </thead>
          <tbody>
            {groupsWithUnmatched.map(g => (
              <tr key={g.readyAt} onClick={() => setSelectedGroup(g.readyAt)} onContextMenu={e => openMenu(e, groupMenu(g))}
                  className={`cursor-pointer ${selectedGroup === g.readyAt ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                <td className={`px-2 py-1 ${g.readyAt === 'UNMATCHED' ? 'text-gray-600 italic flex items-center gap-1' : ''}`}>
                  {g.readyAt === 'UNMATCHED' ? <>⚪ Unmatched pickups</> : g.readyAt}
                </td>
                <td className="px-2 py-1 text-right">{g.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    ),

    jobs: (
      <Panel title="Jobs List" actions={<MoveHandle panelId="jobs" />}>
        {visibleJobs.length === 0 ? (
          <div className="text-xs text-gray-400 text-center p-4">No jobs in this group.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 sticky top-0">
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-1.5 py-1 font-medium w-5"></th>
                <th className="px-1.5 py-1 font-medium">Job</th>
                <th className="px-1.5 py-1 font-medium">Customer</th>
                <th className="px-1.5 py-1 font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {visibleJobs.map(j => (
                <tr key={j.id} onClick={() => setSelectedJob(j.id)} onContextMenu={e => openMenu(e, jobListMenu(j))}
                    className={`cursor-pointer ${selectedJob === j.id ? 'bg-amber-50' : 'hover:bg-gray-50'} ${j.type === 'pickup' && !j.runId ? 'text-gray-400 italic' : ''}`}
                    title={j.type === 'pickup' && !j.runId ? 'Right-click → Assign to run' : undefined}>
                  <td className="px-1.5 py-1 text-center">{j.type === 'pickup' ? <span title="Pickup">🔄</span> : <span title="Delivery">📦</span>}</td>
                  <td className="px-1.5 py-1 font-medium">{j.jobNo ?? j.id}</td>
                  <td className="px-1.5 py-1 truncate max-w-[110px]">{j.customer}</td>
                  <td className="px-1.5 py-1 text-gray-500">{j.runId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    ),

    detail: (
      <div className="flex flex-col h-full border border-gray-200 rounded-lg shadow-sm bg-white overflow-hidden">
        <div className="panel-drag-handle bg-gray-600 text-white px-3 py-1.5 flex items-center justify-between shrink-0 rounded-t-lg">
          <span className="text-xs font-semibold uppercase tracking-wide">Detail</span>
          <MoveHandle panelId="detail" />
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {jobDetail ? <JobDetailModal job={jobDetail} /> : (
            <div className="text-xs text-gray-400 text-center p-6">Please select a job</div>
          )}
        </div>
      </div>
    ),

    runlist: useRegularRoutes && regularRoutes ? (
      <Panel
        title="Dynamic Routes"
        actions={
          <>
            <MoveHandle panelId="runlist" />
            <button onClick={() => setSelectedRouteIds([])} className="text-[10px]" title="Clear selection">⌫</button>
            <button onClick={() => setSelectedRouteIds(regularRoutes.map(r => r.id))} className="text-[10px]" title="Select all">☑</button>
            <button className="text-[10px]" title="Add new">+</button>
          </>
        }
      >
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-2 py-1 font-medium w-5"></th>
              <th className="px-2 py-1 font-medium">Route</th>
              <th className="px-2 py-1 font-medium">Time Window</th>
              <th className="px-2 py-1 font-medium">Frequency</th>
              <th className="px-2 py-1 font-medium">Zips</th>
              <th className="px-2 py-1 font-medium text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {regularRoutes.map(r => {
              const sel = selectedRouteIds.includes(r.id);
              return (
                <tr key={r.id} onClick={() => toggleRouteId(r.id)} className="cursor-pointer hover:bg-gray-50"
                    style={sel ? { backgroundColor: `${r.color}26` } : undefined}>
                  <td className="px-2 py-1">
                    <span className="block w-3 h-3 rounded-sm border-2"
                          style={{ background: sel ? r.color : 'transparent', borderColor: r.color }} />
                  </td>
                  <td className="px-2 py-1 font-medium">{r.name}</td>
                  <td className="px-2 py-1 text-gray-700 font-mono text-[11px]">{r.timeWindow}</td>
                  <td className="px-2 py-1 text-gray-600">{r.frequency}</td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-0.5">
                      {r.zips.map(z => (
                        <span key={z} className="text-[9px] font-mono px-1 rounded"
                              style={{ color: r.color, background: `${r.color}1a` }}>{z}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right text-gray-600">{r.avgJobs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    ) : (
      <Panel
        title="Run List"
        actions={
          <>
            <MoveHandle panelId="runlist" />
            <span className="text-[10px] bg-amber-400 text-brand-dark px-1.5 py-0.5 rounded font-semibold">⚡ Auto Routing</span>
            <button className="text-[10px]">+</button>
            <button className="text-[10px]">ⓘ</button>
            <button className="text-[10px]">➤</button>
          </>
        }
      >
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-1.5 py-1 font-medium">Run</th>
              <th className="px-1.5 py-1 font-medium">Area</th>
              <th className="px-1.5 py-1 font-medium text-right">Jobs</th>
              <th className="px-1.5 py-1 font-medium text-right">Mins</th>
              <th className="px-1.5 py-1 font-medium text-right">KMs</th>
              <th className="px-1.5 py-1 font-medium text-right">%</th>
              <th className="px-1.5 py-1 font-medium">Courier</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => {
              const sel = selectedRuns.includes(r.id);
              return (
                <tr key={r.id} onClick={() => toggleRun(r.id)} onContextMenu={e => openMenu(e, runMenu(r))}
                    className="cursor-pointer hover:bg-gray-50"
                    style={sel ? { backgroundColor: `${r.color}30` } : undefined}>
                  <td className="px-1.5 py-1 font-medium flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: r.color }} />
                    {r.id}
                  </td>
                  <td className="px-1.5 py-1 text-gray-600 truncate max-w-[160px]">{r.area}</td>
                  <td className="px-1.5 py-1 text-right">{r.jobs}</td>
                  <td className="px-1.5 py-1 text-right">{r.mins}</td>
                  <td className="px-1.5 py-1 text-right">{r.km}</td>
                  <td className="px-1.5 py-1 text-right">{r.marginPct.toFixed(2)}%</td>
                  <td className="px-1.5 py-1 text-gray-600">{r.courier ?? 'Unassigned'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    ),

    run: (
      <Panel
        title={useRegularRoutes
          ? (focusedScheduledRoute ? `Dynamic Route — ${focusedScheduledRoute.name}` : 'Dynamic Route')
          : (focusedRun ? `Run - ${focusedRun.id}` : 'Run')}
        actions={<MoveHandle panelId="run" />}
      >
        {useRegularRoutes ? (
          !focusedScheduledRoute ? (
            <div className="text-xs text-gray-400 text-center p-6">Select a dynamic route above to inspect its stops + financials.</div>
          ) : (
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-4 gap-1.5 text-xs">
                <Stat k="Time Window" v={focusedScheduledRoute.timeWindow} />
                <Stat k="Frequency" v={focusedScheduledRoute.frequency} />
                <Stat k="Total Stops" v={scheduledRouteJobs.length.toString()} />
                <Stat k="Avg Mins" v={`${Math.round(scheduledRouteJobs.length * 6)}`} />
                <Stat k="Total KMs" v={`${(scheduledRouteJobs.length * 3.8).toFixed(1)}`} />
                <Stat k="Revenue" v={`$${(scheduledRouteJobs.length * 12.5 + scheduledRouteJobs.length * 3.8 * 1.2).toFixed(2)}`} tone="positive" />
                <Stat k="Total Exp" v={`$${(scheduledRouteJobs.length * 3.8 * 1.6).toFixed(2)}`} />
                <Stat k="Margin" v={`28.0%`} tone="emerald" />
              </div>
              <table className="w-full text-[11px]">
                <thead className="bg-gray-100 sticky top-0">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="px-1.5 py-1">#</th><th className="px-1.5 py-1 w-5"></th>
                    <th className="px-1.5 py-1">Client</th><th className="px-1.5 py-1">Job #</th>
                    <th className="px-1.5 py-1">D Date</th><th className="px-1.5 py-1">R Time</th>
                    <th className="px-1.5 py-1">To</th><th className="px-1.5 py-1">Suburb</th>
                    <th className="px-1.5 py-1">Zip</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledRouteJobs.length === 0 ? (
                    <tr><td colSpan={9} className="px-2 py-3 text-center text-gray-400 italic text-[10px]">No stops in this dynamic route zone today.</td></tr>
                  ) : scheduledRouteJobs.map((j, i) => (
                    <tr key={j.id} onContextMenu={e => openMenu(e, jobInRunMenu(j))} className={`hover:bg-gray-50 ${j.type === 'pickup' ? 'bg-purple-50/40' : ''}`}>
                      <td className="px-1.5 py-1">{i + 1}</td>
                      <td className="px-1.5 py-1 text-center" title={j.type}>{j.type === 'pickup' ? '🔄' : '📦'}</td>
                      <td className="px-1.5 py-1">{j.client}</td>
                      <td className="px-1.5 py-1">{j.jobNo}</td>
                      <td className="px-1.5 py-1">{j.dDate}</td>
                      <td className="px-1.5 py-1">{j.rTime}</td>
                      <td className="px-1.5 py-1 truncate max-w-[140px]">{j.type === 'pickup' ? j.pickup : j.delivery}</td>
                      <td className="px-1.5 py-1">{j.suburb}</td>
                      <td className="px-1.5 py-1">{j.zipCode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : !focusedRun ? (
          <div className="text-xs text-gray-400 text-center p-6">Click a run in the list above to inspect.</div>
        ) : (
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              <Stat k="Total Mins" v={focusedRun.mins.toString()} />
              <Stat k="Total KMs" v={focusedRun.km.toString()} />
              <Stat k="Total Drops" v={focusedRun.jobs.toString()} />
              <Stat k="Hours %" v={(focusedRun.mins / 60).toFixed(2)} />
              <Stat k="Revenue" v={`$${(focusedRun.jobs * 12.5 + focusedRun.km * 1.2).toFixed(2)}`} tone="positive" />
              <Stat k="Total Exp" v={`$${(focusedRun.km * 1.6).toFixed(2)}`} />
              <Stat k="Courier %" v={`${focusedRun.marginPct.toFixed(2)}%`} tone="emerald" />
              <Stat k="Hourly Rate" v={`$25.00`} />
              <Stat k="Total Payout" v={`$${(focusedRun.km * 1.85).toFixed(2)}`} tone="emerald" />
            </div>
            <table className="w-full text-[11px]">
              <thead className="bg-gray-100 sticky top-0">
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-1.5 py-1">#</th><th className="px-1.5 py-1 w-5"></th>
                  <th className="px-1.5 py-1">Client</th><th className="px-1.5 py-1">Job #</th>
                  <th className="px-1.5 py-1">D Date</th><th className="px-1.5 py-1">R Time</th>
                  <th className="px-1.5 py-1">To</th><th className="px-1.5 py-1">Suburb</th>
                  <th className="px-1.5 py-1">ZipCode</th><th className="px-1.5 py-1">Courier</th>
                </tr>
              </thead>
              <tbody>
                {runJobs.map((j, i) => (
                  <tr key={j.id} onContextMenu={e => openMenu(e, jobInRunMenu(j))} className={`hover:bg-gray-50 ${j.type === 'pickup' ? 'bg-purple-50/40' : ''}`}>
                    <td className="px-1.5 py-1">{i + 1}</td>
                    <td className="px-1.5 py-1 text-center" title={j.type}>{j.type === 'pickup' ? '🔄' : '📦'}</td>
                    <td className="px-1.5 py-1">{j.client}</td>
                    <td className="px-1.5 py-1">{j.jobNo}</td>
                    <td className="px-1.5 py-1">{j.dDate}</td>
                    <td className="px-1.5 py-1">{j.rTime}</td>
                    <td className="px-1.5 py-1 truncate max-w-[140px]">{j.type === 'pickup' ? j.pickup : j.delivery}</td>
                    <td className="px-1.5 py-1">{j.suburb}</td>
                    <td className="px-1.5 py-1">{j.zipCode}</td>
                    <td className="px-1.5 py-1">{j.courier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    ),

    fleets: (
      <Panel title="Courier Fleets" actions={<><MoveHandle panelId="fleets" /><button className="text-[10px]">⋮</button></>}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr><th className="px-2 py-1 text-left text-[10px] uppercase tracking-wider text-gray-500 font-medium">Fleet Name</th></tr>
          </thead>
          <tbody>
            {fleets.map(f => (
              <tr key={f.name} onClick={() => setSelectedFleet(f.name)} className={`cursor-pointer ${selectedFleet === f.name ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                <td className="px-2 py-1">{f.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    ),

    couriers: (
      <Panel title="Couriers" actions={<MoveHandle panelId="couriers" />}>
        {couriers.length === 0 ? (
          <div className="text-xs text-gray-400 text-center p-6">Please select a group with courier fleets.</div>
        ) : (
          <ul className="divide-y divide-gray-100 text-xs">
            {couriers.map(c => (
              <li key={c.id} className="px-2 py-1.5 flex items-center justify-between hover:bg-gray-50 cursor-pointer">
                <span>{c.name}</span>
                <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                  c.status === 'available' ? 'bg-emerald-50 text-emerald-700' :
                  c.status === 'on-run' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
                }`}>{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    ),

    map: (
      <Panel
        title="Here Map"
        actions={
          <>
            <MoveHandle panelId="map" />
            <span className="text-[10px] bg-white text-gray-700 px-2 py-0.5 rounded">Map</span>
            <span className="text-[10px] text-white/70">Satellite</span>
            <span className="text-[10px] text-white/70">Auto Zoom: <span className="text-emerald-300 font-semibold">On</span></span>
          </>
        }
      >
        <HereMap
          jobs={effectiveJobs}
          runs={runs}
          selectedRunIds={selectedRuns}
          center={mapCenter}
          zoom={mapZoom}
          polygons={effectiveMapPolygons}
        />
      </Panel>
    ),
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-brand-light">
      {/* Page title + subtitle */}
      <div className="bg-white border-b border-gray-200 px-4 py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-bold text-brand-dark">{title}</h1>
          <span className="text-[11px] text-gray-500">{subtitle}</span>
        </div>
        <div className="flex items-center gap-1 relative">
          {extraHeaderActions}
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-[11px] font-medium text-gray-600 hover:text-brand-dark hover:bg-gray-100 px-2.5 py-1 rounded flex items-center gap-1"
            title="Build Settings"
          >
            ⚙ Settings
          </button>
          <button
            onClick={() => setLayoutMenuOpen(o => !o)}
            className="text-[11px] font-medium text-gray-600 hover:text-brand-dark hover:bg-gray-100 px-2.5 py-1 rounded flex items-center gap-1"
            title="Layout"
          >
            ▦ Layout ▾
          </button>
          {layoutMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 shadow-lg z-[2000] min-w-[180px]">
              <button onClick={resetLayout} className="w-full text-left text-xs px-3 py-1.5 text-brand-dark hover:bg-amber-50">↺ Reset layout to default</button>
              <div className="border-t border-gray-100" />
              <div className="text-[10px] text-gray-400 italic px-3 py-1.5">Column-locked. Sizes auto-save. Drag the splits to resize. Use the ⠿ handle on each panel header to move a panel to another column.</div>
            </div>
          )}
        </div>
      </div>

      {/* Cockpit — column-locked layout (react-resizable-panels) */}
      <div className="flex-1 min-h-0 overflow-hidden p-1.5 bg-brand-light">
      <PanelGroup key={layoutNonce} direction="horizontal" autoSaveId={`${layoutKeyPrefix}::row`}>
        {/* Column 1 — Grouped Jobs / Jobs List / Detail */}
        <ResizablePanel defaultSize={25} minSize={15}>
          <PanelGroup direction="vertical" autoSaveId={`${layoutKeyPrefix}::col1`}>
            <ResizablePanel defaultSize={25} minSize={10}>
        <div className="h-full">
          {panelMap[slots[0]]}
        </div>
        </ResizablePanel>
        <VHandle />
        <ResizablePanel defaultSize={35} minSize={10}>
        <div className="h-full">
          {panelMap[slots[1]]}
        </div>
        </ResizablePanel>
        <VHandle />
        <ResizablePanel defaultSize={40} minSize={10}>
        <div className="h-full">
          {panelMap[slots[2]]}
        </div>
        </ResizablePanel>
          </PanelGroup>
        </ResizablePanel>

        <HHandle />

        {/* Column 2 — Scheduled Routes (or Run List) / Run */}
        <ResizablePanel defaultSize={33} minSize={15}>
          <PanelGroup direction="vertical" autoSaveId={`${layoutKeyPrefix}::col2`}>
            <ResizablePanel defaultSize={30} minSize={10}>
        <div className="h-full">
          {panelMap[slots[3]]}
        </div>
        </ResizablePanel>
        <VHandle />
        <ResizablePanel defaultSize={70} minSize={10}>
        <div className="h-full">
          {panelMap[slots[4]]}
        </div>
        </ResizablePanel>
          </PanelGroup>
        </ResizablePanel>

        <HHandle />

        {/* Column 3 — Courier Fleets / Couriers */}
        <ResizablePanel defaultSize={17} minSize={10}>
          <PanelGroup direction="vertical" autoSaveId={`${layoutKeyPrefix}::col3`}>
            <ResizablePanel defaultSize={40} minSize={10}>
        <div className="h-full">
          {panelMap[slots[5]]}
        </div>
        </ResizablePanel>
        <VHandle />
        <ResizablePanel defaultSize={60} minSize={10}>
        <div className="h-full">
          {panelMap[slots[6]]}
        </div>
        </ResizablePanel>
          </PanelGroup>
        </ResizablePanel>

        <HHandle />

        {/* Column 4 — Here Map */}
        <ResizablePanel defaultSize={25} minSize={15}>
        <div className="h-full">
          {panelMap[slots[7]]}
        </div>
        </ResizablePanel>
      </PanelGroup>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      <EditRunScopeModal open={scopeOpen} onClose={() => setScopeOpen(false)} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {movePopover && (
        <>
          <div className="fixed inset-0 z-[1900]" onClick={() => setMovePopover(null)} />
          <div
            className="fixed z-[2000] bg-white border border-gray-300 shadow-xl rounded-md py-1 min-w-[180px]"
            style={{ left: movePopover.x, top: movePopover.y }}
          >
            <div className="text-[10px] uppercase tracking-wider text-gray-500 px-3 py-1 border-b border-gray-100">Move panel to…</div>
            {[0, 1, 2, 3].map(c => {
              const isHere = colOfPanel(movePopover.panelId) === c;
              return (
                <button
                  key={c}
                  onClick={() => moveToColumn(movePopover.panelId, c)}
                  disabled={isHere}
                  className={`w-full text-left text-xs px-3 py-1.5 flex items-center justify-between ${
                    isHere ? 'text-gray-300 cursor-not-allowed' : 'text-brand-dark hover:bg-amber-50'
                  }`}
                >
                  <span>Column {c + 1}</span>
                  {isHere && <span className="text-[10px] italic">currently here</span>}
                </button>
              );
            })}
            <div className="border-t border-gray-100 px-3 py-1 text-[9px] text-gray-400 italic">
              Swaps with the bottom panel in the target column.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'positive' | 'emerald' }) {
  const colour =
    tone === 'positive' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
    tone === 'emerald' ? 'bg-emerald-100 border-emerald-300 text-emerald-800' :
    'bg-gray-50 border-gray-200 text-gray-700';
  return (
    <div className={`border rounded px-2 py-1.5 ${colour}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-70">{k}</div>
      <div className="text-sm font-bold">{v}</div>
    </div>
  );
}
