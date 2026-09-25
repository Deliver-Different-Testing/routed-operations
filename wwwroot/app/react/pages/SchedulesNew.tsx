import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  schedulesV2Keys,
  useSchedulesV2Bundles,
  useSchedulesV2List,
} from '../hooks/queries/useSchedulesV2';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import {
  schedulesV2Service,
  type ScheduleBundle,
  type SchedulesV2Type,
} from '../services/schedulesV2Service';
import {
  scheduleService,
  type ScheduleGroupSummary,
} from '../services/scheduleService';
import { recurringRouteService, type RecurringRoute } from '../services/recurringRouteService';
import { linehaulService, type TenantLinehaulRun, LinehaulMode } from '../services/linehaulService';
import { ScheduleDetailModal } from '../components/schedules-new/ScheduleDetailModal';
import { ClientMultiPicker } from '../components/schedules-new/ClientMultiPicker';
import { DepotMultiPicker } from '../components/schedules-new/DepotMultiPicker';
import { AttachClientsModal } from '../components/schedules-new/AttachClientsModal';
import { NewScheduleModal } from '../components/schedules-new/NewScheduleModal';
import { CopyScheduleModal } from '../components/schedules-new/CopyScheduleModal';

// Schedules NEW - Steve's 2026-09-08 id-keyed multi-client schedules
// view (KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08). Uses the
// standard Routed Operations light theme (matches Configurator +
// legacy Schedules); Steve's mockup was aspirational but every real
// content page in the shell is light, so we mirror that convention
// and add a per-tab theme toggle later if operators ask for one.
//
// Perf notes:
//  - Tables paginate at PAGE_SIZE rows. Rendering all 2000+ schedules
//    at once trashes layout on resize.
//  - Tab-count pills read from the ACTIVE tab's own React Query cache
//    only. Non-active tabs render a plain label; we do NOT prefetch a
//    count list per tab (that fanned out 3-4 heavy queries on mount).
//  - Detail modal query disables retry so a slow endpoint surfaces
//    the error immediately instead of blocking the spinner for the
//    full retry backoff.

type Tab = 'schedules' | 'bundles' | 'routes';

const DAY_LABELS: Array<{ n: number; label: string }> = [
  { n: 1, label: 'M' },
  { n: 2, label: 'T' },
  { n: 3, label: 'W' },
  { n: 4, label: 'T' },
  { n: 5, label: 'F' },
  { n: 6, label: 'S' },
  { n: 7, label: 'S' },
];

const PAGE_SIZE = 50;

export default function SchedulesNew() {
  const [tab, setTab] = useState<Tab>('schedules');
  const [searchParams, setSearchParams] = useSearchParams();
  // Sync openScheduleId with the ?edit=<id> query param so schedule
  // detail modals get sharable URLs and survive page reload.
  const openScheduleId = useMemo(() => {
    const raw = searchParams.get('edit');
    if (!raw) return null;
    const n = Number(raw);
    // Number.isInteger rejects 0.5 / NaN / Infinity - integer-only ids
    // per the DB PK contract. Audit HIGH #7 (2026-09-17).
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [searchParams]);
  const setOpenScheduleId = (id: number | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id == null) next.delete('edit');
        else next.set('edit', String(id));
        return next;
      },
      { replace: true },
    );
  };
  const [attachScheduleId, setAttachScheduleId] = useState<number | null>(null);
  const [newScheduleOpen, setNewScheduleOpen] = useState(false);

  // Tab count badges (Steve's mockup). Each tab shows its total row
  // count in a pill so operators see the workload at a glance.
  // - Schedules: total from the paginated list envelope (pageSize=1
  //   means we don't fetch the whole list just for the count; the
  //   Schedules tab itself has its own list query with the full
  //   pageSize=50, so this doesn't duplicate work meaningfully).
  // - Schedule Bundles + Recurring Routes: full-list length. Both are
  //   small enough (dozens, not thousands) that this is cheap.
  const schedulesCountQuery = useSchedulesV2List({ page: 0, pageSize: 1 });
  const bundlesCountQuery = useSchedulesV2Bundles();
  const routesCountQuery = useQuery({
    queryKey: ['schedules-v2-recurring-routes-count'],
    queryFn: () => recurringRouteService.list().then((r) => r.response),
    staleTime: 30_000,
  });
  const schedulesCount = schedulesCountQuery.data?.total ?? null;
  const bundlesCount = bundlesCountQuery.data?.length ?? null;
  const routesCount = routesCountQuery.data?.length ?? null;

  return (
    // AppLayout's <main> is `overflow-hidden` so each page owns its
    // own scroll container. Dashboard uses `h-full ... overflow-auto`;
    // we follow the same pattern.
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <header className="flex items-start justify-between gap-6 max-w-7xl">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-text-primary">Schedules</h1>
          <p className="text-xs text-text-secondary max-w-2xl">
            One schedule, many clients. Each schedule has its own id; clients
            are attached to it, overrides stay linked to their base, and the
            recurring routes and linehaul runs that deliver it sit alongside
            instead of on a separate page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewScheduleOpen(true)}
          className="shrink-0 px-4 py-2 text-sm font-medium rounded bg-brand-cyan text-brand-dark hover:bg-brand-cyan/90"
        >
          + New Schedule
        </button>
      </header>

      <div className="border-b border-border">
        <nav className="flex gap-6 -mb-px" aria-label="Schedules sections">
          <TabButton active={tab === 'schedules'} onClick={() => setTab('schedules')} count={schedulesCount}>
            Schedules
          </TabButton>
          <TabButton active={tab === 'bundles'} onClick={() => setTab('bundles')} count={bundlesCount}>
            Schedule Bundles
          </TabButton>
          <TabButton active={tab === 'routes'} onClick={() => setTab('routes')} count={routesCount}>
            Recurring Routes
          </TabButton>
        </nav>
      </div>

      {tab === 'schedules' && (
        <SchedulesTab
          onRowClick={setOpenScheduleId}
          onAttachClients={setAttachScheduleId}
        />
      )}
      {tab === 'bundles' && <ScheduleBundlesTab onScheduleClick={setOpenScheduleId} />}
      {tab === 'routes' && <RecurringRoutesTab />}

      <ScheduleDetailModal
        scheduleId={openScheduleId}
        onClose={() => setOpenScheduleId(null)}
        onAttachClients={setAttachScheduleId}
        onOpenSchedule={setOpenScheduleId}
      />
      <AttachClientsModal
        scheduleId={attachScheduleId}
        onClose={() => setAttachScheduleId(null)}
      />
      <NewScheduleModal
        open={newScheduleOpen}
        onClose={() => setNewScheduleOpen(false)}
      />
    </div>
  );
}

// ─── Schedules tab ──────────────────────────────────────────────────

function SchedulesTab({
  onRowClick,
  onAttachClients,
}: {
  onRowClick: (id: number) => void;
  onAttachClients: (id: number) => void;
}) {
  const user = useAuth();
  const tenantId = user.currentTenantId ?? 0;
  const [type, setType] = useState<SchedulesV2Type>('all');
  const [q, setQ] = useState('');
  // Debounced mirror of q, fed to the query key. Fires the backend
  // 250ms after the last keystroke instead of on every character.
  // Audit HIGH #13 (2026-09-17): the pickers already debounce, the
  // main list search did not.
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  // Multi-select depot filter. Empty array = "All depots" (no filter).
  // Was previously a single string 'all' | depot-name; changed to
  // string[] so operators can filter by multiple depots at once
  // (Kevin 2026-09-17).
  const [depotFilter, setDepotFilter] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [viewAsClientIds, setViewAsClientIds] = useState<number[]>([]);
  const [copySource, setCopySource] = useState<ScheduleGroupSummary | null>(null);
  const query = useSchedulesV2List({
    type,
    q: debouncedQ || undefined,
    clientIds: viewAsClientIds.length > 0 ? viewAsClientIds : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  // When viewing as a single client, tag each visible schedule with
  // why it's bookable (override / shared / default) per Steve's §5
  // resolution rule. Skip the query in multi-client mode - the source
  // tag is ambiguous when the union of two clients produces the row.
  const singleClientId = viewAsClientIds.length === 1 ? viewAsClientIds[0] : null;
  const sourceQuery = useQuery({
    queryKey: schedulesV2Keys.clientScheduleSources(tenantId, singleClientId ?? 0),
    queryFn: () =>
      singleClientId ? schedulesV2Service.clientSchedules(singleClientId) : Promise.resolve([]),
    enabled: singleClientId != null,
    staleTime: 30_000,
  });
  const sourceByScheduleId = useMemo(() => {
    const m = new Map<number, 'override' | 'shared' | 'default'>();
    for (const row of sourceQuery.data ?? []) m.set(row.scheduleId, row.source);
    return m;
  }, [sourceQuery.data]);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const retireMut = useMutation({
    mutationFn: (id: number) => schedulesV2Service.retire(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId)});
      toast.show('Schedule retired.', 'success');
    },
    onError: (e: Error) => toast.show(`Retire failed: ${e.message}`, 'error'),
  });

  // Row-level AutoBook toggle. Fires the same endpoint the detail
  // modal Save would use so no drift between the two write paths.
  // Optimistic - flip the cache immediately so the pill feels
  // instant, then invalidate on settle so the server value wins.
  const autoBookMut = useMutation({
    mutationFn: (id: number) => scheduleService.toggleAutoBook(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: schedulesV2Keys.listAll(tenantId)});
      const previous = qc.getQueriesData<{ rows: ScheduleGroupSummary[]; total: number }>(
        { queryKey: schedulesV2Keys.listAll(tenantId)},
      );
      for (const [key, data] of previous) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          rows: data.rows.map((r) =>
            r.scheduleId === id ? { ...r, autoBook: !r.autoBook } : r,
          ),
        });
      }
      return { previous };
    },
    onError: (e: Error, _id, ctx) => {
      // Roll back the optimistic flip if the server rejected.
      if (ctx?.previous) for (const [key, data] of ctx.previous) qc.setQueryData(key, data);
      toast.show(`Toggle failed: ${e.message}`, 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId)});
    },
  });
  const handleToggleAutoBook = (row: ScheduleGroupSummary) => autoBookMut.mutate(row.scheduleId);

  // F21 (Steve 2026-09-20): row-level Active toggle. Independent of the
  // AutoBook toggle above. Optimistic pattern mirrors AutoBook: flip
  // the cache immediately, roll back on failure, invalidate on settle.
  const isActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      schedulesV2Service.toggleIsActive(id, isActive),
    onMutate: async ({ id, isActive }) => {
      await qc.cancelQueries({ queryKey: schedulesV2Keys.listAll(tenantId)});
      const previous = qc.getQueriesData<{ rows: ScheduleGroupSummary[]; total: number }>(
        { queryKey: schedulesV2Keys.listAll(tenantId)},
      );
      for (const [key, data] of previous) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          rows: data.rows.map((r) =>
            r.scheduleId === id ? { ...r, isActive } : r,
          ),
        });
      }
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) for (const [key, data] of ctx.previous) qc.setQueryData(key, data);
      toast.show(`Toggle failed: ${e.message}`, 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId)});
    },
  });
  const handleToggleIsActive = (row: ScheduleGroupSummary) =>
    isActiveMut.mutate({ id: row.scheduleId, isActive: !row.isActive });

  // Copy is triggered via CopyScheduleModal (rendered below). The row
  // action just puts the source row into state; the modal owns the
  // mutation + POST wire.
  const handleCopy = (row: ScheduleGroupSummary) => setCopySource(row);

  const handleRetire = async (row: ScheduleGroupSummary) => {
    const ok = await confirm({
      title: 'Retire schedule?',
      message: `Retire "${row.name}" (#${row.scheduleId})? Sets RetiredUtc on the header - existing bookings + history stay; the schedule stops appearing on live paths immediately.`,
      confirmLabel: 'Retire',
      danger: true,
    });
    if (!ok) return;
    retireMut.mutate(row.scheduleId);
  };

  // Backend now returns a paged envelope; the server owns page + total.
  // Depot filter + nest-override remain client-side (only affects
  // the current page - documented compromise, worth revisiting if
  // Kevin wants a depot server-side filter param).
  const serverRows = query.data?.rows ?? [];
  const serverTotal = query.data?.total ?? 0;

  // Depot options: prefer the full tenant depot list from
  // /api/schedules/lookups so operators can filter by depots that
  // don't happen to be represented in the current page. Falls back to
  // the set-derived approach if lookups hasn't loaded.
  const lookupsQuery = useQuery({
    queryKey: schedulesV2Keys.lookups(tenantId),
    queryFn: () => scheduleService.lookups().then((r) => r.response),
    staleTime: 5 * 60_000,
  });
  const depotOptions = useMemo(() => {
    if (lookupsQuery.data?.depots?.length) {
      return lookupsQuery.data.depots
        .map((d) => d.name)
        .filter((n) => !!n)
        .sort((a, b) => a.localeCompare(b));
    }
    // Fallback: derive from the current page.
    const set = new Set<string>();
    for (const s of serverRows) {
      if (s.pickupDepotName) set.add(s.pickupDepotName);
      if (s.regionName) set.add(s.regionName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [lookupsQuery.data, serverRows]);

  const filtered = useMemo(() => {
    if (depotFilter.length === 0) return serverRows;
    const wanted = new Set(depotFilter);
    return serverRows.filter(
      (s) =>
        (s.pickupDepotName != null && wanted.has(s.pickupDepotName)) ||
        (s.regionName != null && wanted.has(s.regionName)),
    );
  }, [serverRows, depotFilter]);

  // Server pagination: total from server, page rows from current fetch.
  const pageCount = Math.max(1, Math.ceil(serverTotal / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered;

  return (
    <div className="space-y-3 bg-surface-white border border-border rounded-lg p-4">
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          placeholder="Search schedules by name, route, client or run..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); setDepotFilter([]); }}
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">View as</span>
          <ClientMultiPicker
            selected={viewAsClientIds}
            onChange={(ids) => { setViewAsClientIds(ids); setPage(0); setDepotFilter([]); }}
            placeholder="All schedules"
            panelTitle="View as clients"
          />
        </div>

        {/* Reset depotFilter on any server-side filter change (audit
            MEDIUM #12 2026-09-17). Depot filter is client-side over the
            CURRENT page; changing type / q / view-as swaps the row set,
            so a stale depot filter can silently narrow to zero rows. */}
        <div className="flex bg-surface-light border border-border rounded p-0.5">
          <SegmentPill active={type === 'all'} onClick={() => { setType('all'); setPage(0); setDepotFilter([]); }}>All</SegmentPill>
          <SegmentPill active={type === 'default'} onClick={() => { setType('default'); setPage(0); setDepotFilter([]); }}>Defaults</SegmentPill>
          <SegmentPill active={type === 'shared'} onClick={() => { setType('shared'); setPage(0); setDepotFilter([]); }}>Shared</SegmentPill>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">Depot</span>
          <DepotMultiPicker
            selected={depotFilter}
            options={depotOptions}
            onChange={(names) => { setDepotFilter(names); setPage(0); }}
            placeholder="All depots"
            panelTitle="Filter by depot"
            triggerWidth="w-44"
          />
        </div>

        <span className="ml-auto text-xs text-text-muted">
          {query.data
            ? viewAsClientIds.length > 0
              ? `View as ${viewAsClientIds.length} client${viewAsClientIds.length === 1 ? '' : 's'} - ${serverTotal} bookable`
              : `Showing ${pageRows.length} of ${serverTotal} schedule${serverTotal === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>

      {query.isLoading && (
        <div className="text-sm text-text-muted py-8 text-center">Loading schedules...</div>
      )}
      {query.isError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load schedules: {(query.error as Error).message}
        </div>
      )}
      {query.data && filtered.length === 0 && (
        <div className="text-sm text-text-muted py-8 text-center">
          No schedules match this filter.
        </div>
      )}
      {pageRows.length > 0 && (
        <>
          <SchedulesTable
            rows={pageRows}
            sourceByScheduleId={singleClientId ? sourceByScheduleId : null}
            onRowClick={onRowClick}
            onAttachClients={onAttachClients}
            onRetire={handleRetire}
            onCopy={handleCopy}
            onToggleAutoBook={handleToggleAutoBook}
            // Audit HIGH #4 (2026-09-17): rapid clicks on the toggle
            // fire concurrent mutations that race. Disable the toggle
            // for whichever id is currently in flight.
            autoBookPendingId={autoBookMut.isPending ? autoBookMut.variables : null}
            onToggleIsActive={handleToggleIsActive}
            isActivePendingId={isActiveMut.isPending ? isActiveMut.variables?.id ?? null : null}
          />
          <Pager
            page={boundedPage}
            pageCount={pageCount}
            total={serverTotal}
            onPage={setPage}
          />
        </>
      )}
      <CopyScheduleModal
        source={copySource}
        onClose={() => setCopySource(null)}
        onSuccess={() => toast.show('Schedule copied.', 'success')}
      />
    </div>
  );
}

// ─── Pagination ─────────────────────────────────────────────────────

function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (n: number) => void;
}) {
  if (pageCount <= 1) return null;
  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between text-xs text-text-muted pt-2 border-t border-border">
      <span>
        {start}-{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PagerBtn disabled={page === 0} onClick={() => onPage(0)}>« First</PagerBtn>
        <PagerBtn disabled={page === 0} onClick={() => onPage(page - 1)}>‹ Prev</PagerBtn>
        <span className="px-3">
          Page {page + 1} of {pageCount}
        </span>
        <PagerBtn disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>Next ›</PagerBtn>
        <PagerBtn disabled={page >= pageCount - 1} onClick={() => onPage(pageCount - 1)}>Last »</PagerBtn>
      </div>
    </div>
  );
}

function PagerBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-1 rounded border border-border hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

// ─── Table + row rendering ──────────────────────────────────────────

function SchedulesTable({
  rows,
  sourceByScheduleId,
  onRowClick,
  onAttachClients,
  onRetire,
  onCopy,
  onToggleAutoBook,
  autoBookPendingId,
  onToggleIsActive,
  isActivePendingId,
}: {
  rows: ScheduleGroupSummary[];
  sourceByScheduleId?: Map<number, 'override' | 'shared' | 'default'> | null;
  onRowClick: (id: number) => void;
  onAttachClients: (id: number) => void;
  onRetire: (row: ScheduleGroupSummary) => void;
  onCopy: (row: ScheduleGroupSummary) => void;
  onToggleAutoBook: (row: ScheduleGroupSummary) => void;
  autoBookPendingId: number | null | undefined;
  onToggleIsActive: (row: ScheduleGroupSummary) => void;
  isActivePendingId: number | null | undefined;
}) {
  return (
    // Scroll container gives the sticky <thead> something to stick
    // within. Height caps at the viewport so a 50-row page scrolls
    // internally while the surrounding page stays put.
    <div className="max-h-[calc(100vh-320px)] overflow-y-auto relative">
      <table className="w-full text-xs table-fixed">
        {/* Explicit column widths - without these, the table auto-layouts on
            intrinsic content and overflows the container (the reason we
            previously had a horizontal scrollbar). Percentages sum >100
            deliberately; table-fixed distributes the shortfall. */}
        <colgroup>
          {/* Column widths sum to 100%. Active column (Steve F21) added
              alongside AutoBook: Active gates whether the schedule is
              bookable at all; AutoBook gates book-now vs stage. Sizes
              trimmed from Name / Clients / Roster to make room. */}
          <col style={{ width: '22%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
        </colgroup>
        {/* Sticky header per audit HIGH #2 (2026-09-17). Was scrolling
            out of view once operators paged past ~15 rows. Wrapper div
            below gives it a scroll container to stick within. */}
        <thead className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border sticky top-0 bg-surface-white z-10">
          <tr>
            <th className="py-1.5 pr-2 font-medium">Name</th>
            <th className="py-1.5 pr-2 font-medium">Days</th>
            <th className="py-1.5 pr-2 font-medium">Origin</th>
            <th className="py-1.5 pr-2 font-medium">Dest</th>
            <th className="py-1.5 pr-2 font-medium">Window</th>
            <th className="py-1.5 pr-2 font-medium">Cut-off</th>
            <th className="py-1.5 pr-2 font-medium">Clients</th>
            <th className="py-1.5 pr-2 font-medium">Roster</th>
            <th className="py-1.5 pr-2 font-medium">Active</th>
            <th className="py-1.5 pr-2 font-medium">AutoBook</th>
            <th className="py-1.5 pr-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <ScheduleRow
              key={s.scheduleId}
              row={s}
              sourceTag={sourceByScheduleId?.get(s.scheduleId) ?? null}
              onOpen={onRowClick}
              onAttachClients={onAttachClients}
              onRetire={onRetire}
              onCopy={onCopy}
              onToggleAutoBook={onToggleAutoBook}
              autoBookPending={autoBookPendingId === s.scheduleId}
              onToggleIsActive={onToggleIsActive}
              isActivePending={isActivePendingId === s.scheduleId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleRow({
  row: s,
  sourceTag,
  onOpen,
  onAttachClients,
  onRetire,
  onCopy,
  onToggleAutoBook,
  autoBookPending,
  onToggleIsActive,
  isActivePending,
}: {
  row: ScheduleGroupSummary;
  sourceTag: 'override' | 'shared' | 'default' | null;
  onOpen: (id: number) => void;
  onAttachClients: (id: number) => void;
  onRetire: (row: ScheduleGroupSummary) => void;
  onCopy: (row: ScheduleGroupSummary) => void;
  onToggleAutoBook: (row: ScheduleGroupSummary) => void;
  autoBookPending: boolean;
  onToggleIsActive: (row: ScheduleGroupSummary) => void;
  isActivePending: boolean;
}) {
  const window = s.windowStart && s.windowEnd ? `${s.windowStart}-${s.windowEnd}` : '-';
  const cutoff = formatCutoff(s.monCutoffHours, s.otherCutoffHours);
  return (
    <tr
      onClick={() => onOpen(s.scheduleId)}
      className="border-b border-border/60 cursor-pointer align-top hover:bg-surface-light"
    >
      <td className="py-1.5 pr-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">{s.name ?? '(unnamed)'}</span>
          {sourceTag && <SourceTag source={sourceTag} />}
        </div>
        <div className="text-[11px] mt-0.5 leading-tight text-text-muted">
          {`#${s.scheduleId}${s.description ? ` · ${s.description}` : ''}`}
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <DayPills active={s.activeDays} />
      </td>
      <td className="py-1.5 pr-2 text-text-secondary">
        {s.pickupDepotName ?? 'Client address'}
      </td>
      <td className="py-1.5 pr-2 text-text-secondary">{s.regionName ?? <span className="text-text-muted">-</span>}</td>
      <td className="py-1.5 pr-2 text-text-secondary font-mono text-[11px]">{window}</td>
      <td className="py-1.5 pr-2 text-text-secondary font-mono text-[11px]">{cutoff}</td>
      <td className="py-1.5 pr-2"><ClientChips row={s} /></td>
      <td className="py-1.5 pr-2">
        <RosterChips routeCount={s.routeCount} linehaulHint={s.linehaulHint} />
      </td>
      <td
        className="py-1.5 pr-2"
        onClick={(e) => e.stopPropagation()}
        data-testid={`schedule-active-cell-${s.scheduleId}`}
      >
        <ToggleSwitch
          on={s.isActive === true}
          onClick={() => onToggleIsActive(s)}
          disabled={isActivePending}
        />
      </td>
      <td className="py-1.5 pr-2" onClick={(e) => e.stopPropagation()}>
        <ToggleSwitch
          on={s.autoBook === true}
          onClick={() => onToggleAutoBook(s)}
          disabled={autoBookPending}
        />
      </td>
      <td className="py-1.5 pr-2">
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <ActionIcon
            label="Attach clients"
            icon="user"
            onClick={() => onAttachClients(s.scheduleId)}
          />
          <ActionIcon
            label="Copy schedule"
            icon="copy"
            onClick={() => onCopy(s)}
          />
          <ActionIcon
            label="Retire schedule"
            icon="trash"
            onClick={() => onRetire(s)}
          />
        </div>
      </td>
    </tr>
  );
}

function formatCutoff(mon: number | null, other: number | null): string {
  if (mon == null && other == null) return '-';
  if (mon != null && other != null) return `${mon}/${other}h`;
  if (mon != null) return `${mon}h`;
  return `${other}h`;
}

function DayPills({ active }: { active: number[] }) {
  const set = new Set(active);
  return (
    <div className="flex gap-px">
      {DAY_LABELS.map(({ n, label }) => (
        <span
          key={n}
          className={`w-4 h-4 rounded-sm text-[9px] font-semibold flex items-center justify-center ${
            set.has(n)
              ? 'bg-brand-cyan text-brand-dark border border-brand-cyan'
              : 'bg-transparent text-text-muted border border-border'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function SourceTag({ source }: { source: 'override' | 'shared' | 'default' }) {
  const styles = source === 'override'
    ? 'bg-warning-bg text-warning border-warning/30'
    : source === 'shared'
      ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30'
      : 'bg-success-bg text-success border-success/30';
  const label = source === 'override' ? 'Own override' : source === 'shared' ? 'Shared' : 'Default';
  return (
    <span
      title="Why this schedule is bookable for the selected client (Steve's §5 resolution rule)."
      className={`text-[9px] font-medium border px-1.5 py-px rounded ${styles}`}
    >
      {label}
    </span>
  );
}

function ClientChips({ row }: { row: ScheduleGroupSummary }) {
  if (row.clientCount === 0 && row.legacyClientId == null) {
    return (
      <span className="text-[10px] bg-success-bg text-success border border-success/30 px-1.5 py-px rounded font-medium">
        All clients
      </span>
    );
  }
  const codes = row.linkedClientCodes.length > 0
    ? row.linkedClientCodes
    : row.legacyClientCode
      ? [row.legacyClientCode]
      : [];
  const overflow = row.clientCount - codes.length;
  return (
    <div className="flex gap-1 flex-wrap max-w-xs items-center">
      {codes.map((code) => (
        <span
          key={code}
          className="text-[10px] font-medium bg-surface-light text-text-secondary border border-border px-1.5 py-px rounded"
        >
          {code}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-text-muted">+{overflow}</span>
      )}
    </div>
  );
}

function RosterChips({ routeCount, linehaulHint }: { routeCount: number; linehaulHint: string | null }) {
  if (routeCount === 0 && !linehaulHint) {
    return <span className="text-[11px] text-text-muted">-</span>;
  }
  return (
    <div className="flex gap-1 flex-wrap items-center">
      {routeCount > 0 && (
        <span className="text-[10px] font-medium bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 px-1.5 py-px rounded">
          {routeCount} route{routeCount === 1 ? '' : 's'}
        </span>
      )}
      {linehaulHint && (
        <span className="text-[10px] font-medium bg-warning-bg text-warning border border-warning/30 px-1.5 py-px rounded">
          {linehaulHint}
        </span>
      )}
    </div>
  );
}

function ToggleSwitch({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  /** When set, the toggle becomes an interactive button. Click calls
   *  onClick with the target boolean (the value the toggle would flip
   *  to). Callers own the row's stopPropagation so a click here does
   *  not also trigger a row-level navigation. */
  onClick?: (next: boolean) => void;
  disabled?: boolean;
}) {
  const clickable = !!onClick && !disabled;
  const cls = `w-8 h-4 rounded-full relative transition-colors ${
    on ? 'bg-brand-cyan' : 'bg-surface-light border border-border'
  } ${clickable ? 'cursor-pointer' : ''} ${disabled ? 'opacity-60' : ''}`;
  const knob = (
    <span
      className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
        on ? 'translate-x-4' : ''
      }`}
    />
  );
  if (!clickable) {
    return (
      <div className={cls} title={on ? 'Auto-book on' : 'Auto-book off'}>
        {knob}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      title={on ? 'Auto-book on - click to disable' : 'Auto-book off - click to enable'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onClick!(!on);
      }}
      disabled={disabled}
    >
      {knob}
    </button>
  );
}

function ActionIcon({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: 'user' | 'copy' | 'trash';
  onClick?: () => void;
}) {
  const path = icon === 'user'
    ? <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>
    : icon === 'copy'
    ? <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>
    : <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></>;
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      title={label}
      className={`w-6 h-6 rounded flex items-center justify-center hover:bg-surface-light ${
        clickable
          ? 'text-text-secondary hover:text-text-primary cursor-pointer'
          : 'text-text-muted disabled:cursor-not-allowed'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {path}
      </svg>
    </button>
  );
}

// ─── Tab + pill bits ────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Row count pill rendered next to the label. Null hides the pill
   *  entirely (e.g. while the count query is still loading). */
  count?: number | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
        active
          ? 'text-text-primary border-brand-cyan'
          : 'text-text-secondary border-transparent hover:text-text-primary'
      }`}
    >
      <span>{children}</span>
      {count != null && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          active
            ? 'bg-brand-cyan/20 text-brand-dark'
            : 'bg-surface-light text-text-muted'
        }`}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function SegmentPill({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2.5 py-0.5 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-brand-cyan text-brand-dark'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Schedule Bundles tab ───────────────────────────────────────────

function ScheduleBundlesTab({ onScheduleClick }: { onScheduleClick: (id: number) => void }) {
  const user = useAuth();
  const tenantId = user.currentTenantId ?? 0;
  const query = useSchedulesV2Bundles();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [attachBundleId, setAttachBundleId] = useState<number | null>(null);
  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invalidateBundles = () =>
    qc.invalidateQueries({ queryKey: schedulesV2Keys.bundles(tenantId)});

  const deleteMut = useMutation({
    mutationFn: (bundleId: number) => schedulesV2Service.deleteBundle(bundleId),
    onSuccess: () => { invalidateBundles(); toast.show('Bundle deleted.', 'success'); },
    onError: (e: Error) => toast.show(`Delete failed: ${e.message}`, 'error'),
  });
  const renameMut = useMutation({
    mutationFn: (args: { bundleId: number; name: string; description?: string }) =>
      schedulesV2Service.updateBundle(args.bundleId, { name: args.name, description: args.description }),
    onSuccess: () => { invalidateBundles(); toast.show('Bundle updated.', 'success'); },
    onError: (e: Error) => toast.show(`Rename failed: ${e.message}`, 'error'),
  });
  const addMemberMut = useMutation({
    mutationFn: (args: { bundleId: number; scheduleIds: number[] }) =>
      schedulesV2Service.addBundleMembers(args.bundleId, args.scheduleIds),
    onSuccess: () => { invalidateBundles(); toast.show('Member added.', 'success'); },
    onError: (e: Error) => toast.show(`Add member failed: ${e.message}`, 'error'),
  });
  const removeMemberMut = useMutation({
    mutationFn: (args: { bundleId: number; scheduleId: number }) =>
      schedulesV2Service.removeBundleMember(args.bundleId, args.scheduleId),
    onSuccess: () => { invalidateBundles(); toast.show('Member removed.', 'success'); },
    onError: (e: Error) => toast.show(`Remove failed: ${e.message}`, 'error'),
  });

  const handleDelete = async (b: ScheduleBundle) => {
    const ok = await confirm({
      title: 'Delete bundle?',
      message: `Delete "${b.name}" (${b.scheduleCount} schedule${b.scheduleCount === 1 ? '' : 's'})? The underlying schedules and their link rows are NOT touched - only the bundle metadata is removed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteMut.mutate(b.bundleId);
  };

  const handleRename = (b: ScheduleBundle) => {
    const next = window.prompt(`Rename "${b.name}":`, b.name);
    if (!next || next.trim() === b.name) return;
    renameMut.mutate({ bundleId: b.bundleId, name: next.trim(), description: b.description ?? '' });
  };

  const handleAddMember = (b: ScheduleBundle) => {
    const raw = window.prompt(
      `Add a schedule to "${b.name}". Enter the schedule id (from #ScheduleId in the Schedules tab):`,
      '',
    );
    if (!raw) return;
    const id = parseInt(raw.trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      toast.show('Invalid schedule id.', 'error');
      return;
    }
    addMemberMut.mutate({ bundleId: b.bundleId, scheduleIds: [id] });
  };

  const handleRemoveMember = async (bundleId: number, scheduleId: number) => {
    const ok = await confirm({
      title: 'Remove member?',
      message: `Remove schedule #${scheduleId} from the bundle?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    removeMemberMut.mutate({ bundleId, scheduleId });
  };

  return (
    <div className="space-y-4 bg-surface-white border border-border rounded-lg p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted italic max-w-3xl">
          A bundle is a named collection of schedules. Attaching a client to a bundle
          writes one link row per non-default member; the link table stays the
          only record of who uses what.
        </p>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded bg-brand-cyan text-brand-dark hover:bg-brand-cyan/90"
        >
          + New bundle
        </button>
      </div>

      {query.isLoading && (
        <div className="text-sm text-text-muted py-8 text-center">Loading bundles...</div>
      )}
      {query.isError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load bundles: {(query.error as Error).message}
        </div>
      )}
      {query.data && query.data.length === 0 && (
        <div className="text-sm text-text-muted py-8 text-center">
          No schedule bundles yet. Click <strong>+ New bundle</strong> to create one.
        </div>
      )}
      {query.data && query.data.length > 0 && (
        <ul className="space-y-2">
          {query.data.map((b) => (
            <BundleCard
              key={b.bundleId}
              bundle={b}
              expanded={expanded.has(b.bundleId)}
              onToggle={() => toggle(b.bundleId)}
              onScheduleClick={onScheduleClick}
              onDelete={() => handleDelete(b)}
              onRename={() => handleRename(b)}
              onAttachClients={() => setAttachBundleId(b.bundleId)}
              onAddMember={() => handleAddMember(b)}
              onRemoveMember={(id) => handleRemoveMember(b.bundleId, id)}
            />
          ))}
        </ul>
      )}

      <CreateBundleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: schedulesV2Keys.bundles(tenantId)});
          setCreateOpen(false);
          toast.show('Bundle created.', 'success');
        }}
      />
      <BundleAttachClientsModal
        bundleId={attachBundleId}
        onClose={() => setAttachBundleId(null)}
      />
    </div>
  );
}

function BundleAttachClientsModal({
  bundleId,
  onClose,
}: {
  bundleId: number | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const toast = useToast();
  const [selected, setSelected] = useState<number[]>([]);
  const attachMut = useMutation({
    mutationFn: (ids: number[]) =>
      schedulesV2Service.attachClientsToBundle(bundleId!, ids),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.bundles(tenantId)});
      toast.show(`Attached to ${r.added} member link row${r.added === 1 ? '' : 's'}.`, 'success');
      setSelected([]);
      onClose();
    },
    onError: (e: Error) => toast.show(`Attach failed: ${e.message}`, 'error'),
  });
  if (bundleId == null) return null;
  return (
    <div className="fixed inset-0 bg-brand-dark/40 flex items-center justify-center z-40" onClick={onClose}>
      <div className="bg-surface-white rounded-lg shadow-lg max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-base font-semibold text-text-primary">Attach clients to bundle #{bundleId}</h3>
          <p className="text-xs text-text-muted mt-1">
            Each ticked client gets one link row per non-default member schedule.
            Default members (all-clients schedules) are skipped.
          </p>
        </div>
        <div className="px-4 py-4">
          <ClientMultiPicker
            selected={selected}
            onChange={setSelected}
            placeholder="Pick clients..."
            triggerWidth="w-full"
            panelTitle="Clients to attach"
          />
        </div>
        <div className="px-4 py-3 border-t border-border-light bg-surface-cream flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {selected.length === 0 ? 'Nothing selected' : `${selected.length} to attach`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => attachMut.mutate(selected)}
              disabled={selected.length === 0 || attachMut.isPending}
              className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
            >
              {attachMut.isPending ? 'Attaching...' : 'Attach'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateBundleModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      schedulesV2Service.createBundle({
        name: name.trim(),
        description: description.trim() || undefined,
        scheduleIds: [],
      }),
    onSuccess: () => {
      setName('');
      setDescription('');
      setError(null);
      onCreated();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-brand-dark/40 flex items-center justify-center z-40" onClick={onClose}>
      <div className="bg-surface-white rounded-lg shadow-lg max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-base font-semibold text-text-primary">New schedule bundle</h3>
        </div>
        <div className="px-4 py-4 space-y-3">
          {error && (
            <div className="text-xs text-error border border-error/30 bg-error-bg/40 rounded px-3 py-2">
              {error}
            </div>
          )}
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-text-muted">Name</span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
              placeholder="AKL medical overnight bundle"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-text-muted">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
              placeholder="What a new medical client gets on day one..."
            />
          </label>
          <p className="text-xs text-text-muted italic">
            Members can be added via a follow-up "Add schedule" step - or attach clients
            in bulk from the bundle card once members are linked.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-border-light bg-surface-cream flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { setName(''); setDescription(''); setError(null); onClose(); }}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || name.trim().length === 0}
            className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
          >
            {createMut.isPending ? 'Creating...' : 'Create bundle'}
          </button>
        </div>
      </div>
    </div>
  );
  // toast import kept for downstream extensions (attach clients etc)
  void toast;
}

function BundleCard({
  bundle,
  expanded,
  onToggle,
  onScheduleClick,
  onDelete,
  onRename,
  onAttachClients,
  onAddMember,
  onRemoveMember,
}: {
  bundle: ScheduleBundle;
  expanded: boolean;
  onToggle: () => void;
  onScheduleClick: (id: number) => void;
  onDelete: () => void;
  onRename: () => void;
  onAttachClients: () => void;
  onAddMember: () => void;
  onRemoveMember: (scheduleId: number) => void;
}) {
  return (
    <li className="border border-border rounded">
      <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-light">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-start text-left"
        >
          <div>
            <div className="text-sm font-medium text-text-primary flex items-center gap-2">
              <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
              {bundle.name}
            </div>
            {bundle.description && (
              <div className="text-xs text-text-muted mt-0.5">{bundle.description}</div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-6 text-xs text-text-muted">
          <span>{bundle.scheduleCount} schedules</span>
          <span>{bundle.clientCount} clients</span>
          <span
            className={`px-2 py-0.5 rounded ${
              bundle.isActive
                ? 'bg-success-bg text-success border border-success/30'
                : 'bg-surface-light text-text-muted border border-border'
            }`}
          >
            {bundle.isActive ? 'Active' : 'Inactive'}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRename(); }}
            title="Rename or redescribe"
            className="text-text-secondary hover:text-text-primary hover:underline"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAttachClients(); }}
            title="Attach clients to all non-default members"
            className="text-brand-cyan hover:underline"
          >
            Attach clients
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete bundle"
            className="text-error hover:text-error-dark hover:underline"
          >
            Delete
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-border-light space-y-2">
          <ul className="space-y-1">
            {bundle.scheduleIds.map((id, i) => (
              <li key={id} className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => onScheduleClick(id)}
                  className="text-text-secondary hover:text-brand-cyan text-left"
                >
                  #{id} - {bundle.scheduleNames[i] ?? '(unknown)'}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveMember(id)}
                  title="Remove from bundle"
                  className="text-error hover:text-error-dark hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
            {bundle.scheduleIds.length === 0 && (
              <li className="text-xs text-text-muted italic">
                No members yet. Add one below.
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={onAddMember}
            className="text-xs text-brand-cyan hover:underline"
          >
            + Add schedule
          </button>
        </div>
      )}
    </li>
  );
}

// ─── Recurring Routes tab ───────────────────────────────────────────

type RouteType = 'all' | 'first' | 'middle' | 'final';

/** Unified row shape backing the Recurring Routes tab. Routes and
 *  linehaul runs render into the same table with different content
 *  in a handful of columns; using one type simplifies the table body
 *  and lets the search / pager work uniformly. */
interface RecurringRow {
  key: string;
  kind: 'first' | 'middle' | 'final';
  name: string;
  subtitle: string;
  area: string;
  defaultTargetName: string | null;
  defaultTargetType: number | string | null;
  schedules: { scheduleId: number | null; name: string }[];
  zipCount: number | null;
  active: boolean;
  masterBookingLabel: string | null;
  mode: 'Road' | 'Flight' | null;
  clientCodes: string[];
}

function RecurringRoutesTab() {
  const user = useAuth();
  const [type, setType] = useState<RouteType>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const routesQuery = useQuery({
    queryKey: ['schedules-v2-recurring-routes', user.currentTenantId ?? 0],
    queryFn: () => recurringRouteService.list().then((r) => r.response),
    staleTime: 30_000,
  });

  const linehaulQuery = useQuery({
    queryKey: ['schedules-v2-linehaul-runs', user.currentTenantId ?? 0],
    queryFn: () => linehaulService.list(),
    staleTime: 30_000,
  });

  // For "Clients via schedule" we need the schedule -> client list.
  // The Schedules list summary already carries linkedClientCodes[] +
  // clientCount; use it as the source instead of a fresh query.
  const schedSummary = useQuery({
    queryKey: ['schedules-v2-summary-for-routes', user.currentTenantId ?? 0],
    queryFn: () => schedulesV2Service.list({ type: 'all', pageSize: 0 }).then((p) => p.rows ?? []),
    staleTime: 30_000,
  });

  const codesBySched = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const s of (schedSummary.data ?? [])) map.set(s.scheduleId, s.linkedClientCodes ?? []);
    return map;
  }, [schedSummary.data]);

  const routeKind = (r: RecurringRoute): 'first' | 'final' => {
    const name = `${r.name} ${r.area}`.toLowerCase();
    return /deliver|final|pm\b|home/.test(name) ? 'final' : 'first';
  };

  const rows = useMemo<RecurringRow[]>(() => {
    const out: RecurringRow[] = [];
    for (const r of routesQuery.data ?? []) {
      const kind = routeKind(r);
      const clientCodes = Array.from(new Set(
        r.schedules.flatMap((s) => (s.scheduleId ? codesBySched.get(s.scheduleId) ?? [] : []))
      )).sort();
      out.push({
        key: `route-${r.routeId}`,
        kind,
        name: r.name,
        subtitle: `#${r.routeId}`,
        area: r.area,
        defaultTargetName: r.defaultTargetName,
        defaultTargetType: r.defaultTargetType,
        schedules: r.schedules.map((s) => ({ scheduleId: s.scheduleId ?? null, name: s.name })),
        zipCount: r.zipcodes.length,
        active: r.active,
        masterBookingLabel: null,
        mode: null,
        clientCodes,
      });
    }
    for (const lh of linehaulQuery.data ?? []) {
      out.push({
        key: `linehaul-${lh.id}`,
        kind: 'middle',
        name: lh.runName,
        subtitle: `${lh.fromDepotName} → ${lh.toDepotName}`,
        area: `${lh.fromDepotName} → ${lh.toDepotName}`,
        defaultTargetName: lh.defaultTargetName,
        defaultTargetType: lh.defaultTargetType,
        // Linehaul runs bind by LinehaulRunId on the schedule's linehaul
        // leg. The listing does not expose that map today; render a
        // placeholder pill so the column stays populated visually.
        schedules: lh.usedBySchedulesCount > 0
          ? [{ scheduleId: null, name: `${lh.usedBySchedulesCount} schedule${lh.usedBySchedulesCount === 1 ? '' : 's'}` }]
          : [],
        zipCount: null,
        active: lh.active,
        masterBookingLabel: lh.masterBookingLabel,
        mode: lh.mode === LinehaulMode.Flight ? 'Flight' : 'Road',
        clientCodes: [],
      });
    }
    return out;
  }, [routesQuery.data, linehaulQuery.data, codesBySched]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (type === 'all' ? true : r.kind === type))
      .filter((r) => {
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle) ||
          r.area.toLowerCase().includes(needle) ||
          r.schedules.some((s) => s.name.toLowerCase().includes(needle))
        );
      });
  }, [rows, type, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(boundedPage * PAGE_SIZE, (boundedPage + 1) * PAGE_SIZE);
  const isLoading = routesQuery.isLoading || linehaulQuery.isLoading;
  const anyError = routesQuery.error ?? linehaulQuery.error;

  return (
    <div className="space-y-4 bg-surface-white border border-border rounded-lg p-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <input
          type="search"
          placeholder="Search routes by name, area, or schedule..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          className="w-96 px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />
        <div className="flex gap-1 p-1 bg-surface-light border border-border rounded">
          <SegmentPill active={type === 'all'} onClick={() => { setType('all'); setPage(0); }}>All types</SegmentPill>
          <SegmentPill active={type === 'first'} onClick={() => { setType('first'); setPage(0); }}>First mile</SegmentPill>
          <SegmentPill active={type === 'middle'} onClick={() => { setType('middle'); setPage(0); }}>Middle mile</SegmentPill>
          <SegmentPill active={type === 'final'} onClick={() => { setType('final'); setPage(0); }}>Final mile</SegmentPill>
        </div>
        <span className="text-xs text-text-muted">
          {!isLoading ? `Showing ${pageRows.length} of ${filtered.length}` : ''}
        </span>
      </div>

      <p className="text-xs text-text-muted italic max-w-3xl">
        Same rows as the Recurring Routes page, anchored to the schedules that
        deliver them. Middle-mile rows are linehaul runs, showing their master
        job (or a red flag if none set).
      </p>

      {isLoading && <div className="text-sm text-text-muted py-8 text-center">Loading routes...</div>}
      {anyError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load routes: {(anyError as Error).message}
        </div>
      )}
      {filtered.length === 0 && !isLoading && (
        <div className="text-sm text-text-muted py-8 text-center">No routes match.</div>
      )}
      {pageRows.length > 0 && (
        <>
          <RecurringRoutesTable rows={pageRows} />
          <Pager
            page={boundedPage}
            pageCount={pageCount}
            total={filtered.length}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function RecurringRoutesTable({ rows }: { rows: RecurringRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
          <tr>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Default target</th>
            <th className="py-2 pr-3 font-medium">Schedule(s)</th>
            <th className="py-2 pr-3 font-medium">Clients via schedule</th>
            <th className="py-2 pr-3 font-medium">Master job</th>
            <th className="py-2 pr-3 font-medium">Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60 hover:bg-surface-light">
              <td className="py-2 pr-3">
                <div className="font-medium text-text-primary">{r.name}</div>
                <div className="text-xs text-text-muted">{r.subtitle}</div>
              </td>
              <td className="py-2 pr-3">
                <span className={`text-[10px] px-2 py-0.5 rounded border ${
                  r.kind === 'middle'
                    ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30'
                    : 'bg-surface-light text-text-secondary border-border'
                }`}>
                  {r.kind === 'first' ? 'First mile' : r.kind === 'middle' ? `Middle mile · ${r.mode ?? 'Road'}` : 'Final mile'}
                </span>
              </td>
              <td className="py-2 pr-3">
                {r.defaultTargetName ? (
                  <>
                    <span className="text-text-primary">{r.defaultTargetName}</span>
                    <span className="text-xs text-text-muted ml-1">
                      ({typeof r.defaultTargetType === 'number'
                        ? targetTypeLabel(r.defaultTargetType)
                        : (r.defaultTargetType ?? '-')})
                    </span>
                  </>
                ) : (
                  <span className="text-text-muted">-</span>
                )}
              </td>
              <td className="py-2 pr-3">
                {r.schedules.length === 0 ? (
                  <span className="text-xs bg-warning-bg text-warning border border-warning/30 px-2 py-0.5 rounded">
                    Unbound
                  </span>
                ) : (
                  <div className="flex gap-1 flex-wrap max-w-md">
                    {r.schedules.slice(0, 3).map((s, i) => (
                      <span
                        key={s.scheduleId ?? `${s.name}-${i}`}
                        className="text-[10px] bg-surface-light text-text-secondary border border-border px-2 py-0.5 rounded"
                        title={s.name}
                      >
                        {s.name}
                      </span>
                    ))}
                    {r.schedules.length > 3 && (
                      <span className="text-[10px] text-text-muted">
                        +{r.schedules.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="py-2 pr-3">
                {r.clientCodes.length === 0 ? (
                  <span className="text-text-muted">-</span>
                ) : (
                  <div className="flex gap-1 flex-wrap max-w-md">
                    {r.clientCodes.slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="text-[10px] bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 px-2 py-0.5 rounded"
                      >
                        {c}
                      </span>
                    ))}
                    {r.clientCodes.length > 3 && (
                      <span className="text-[10px] text-text-muted">
                        +{r.clientCodes.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="py-2 pr-3">
                {r.kind !== 'middle' ? (
                  <span className="text-text-muted">-</span>
                ) : r.masterBookingLabel ? (
                  <span className="text-xs font-mono text-brand-cyan" title="Run's master booking (IsLinehaulMaster=1)">
                    {r.masterBookingLabel}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-error" title="Without a master job the driver sees every item as its own job.">
                    <span className="w-1.5 h-1.5 rounded-full bg-error inline-block" />
                    <span className="font-medium">Missing</span>
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">
                <ToggleSwitch on={r.active} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function targetTypeLabel(t: number | null): string {
  if (t === 1) return 'Courier';
  if (t === 2) return 'Agent';
  if (t === 3) return 'NP';
  return '-';
}
