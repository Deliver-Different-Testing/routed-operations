import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useSchedulesV2Groups,
  useSchedulesV2List,
} from '../hooks/queries/useSchedulesV2';
import { useAuth } from '../context/AuthContext';
import type {
  ScheduleGroupBundle,
  SchedulesV2Type,
} from '../services/schedulesV2Service';
import {
  scheduleService,
  type ScheduleGroupSummary,
} from '../services/scheduleService';
import { recurringRouteService, type RecurringRoute } from '../services/recurringRouteService';
import { ScheduleDetailModal } from '../components/schedules-new/ScheduleDetailModal';
import { ClientMultiPicker } from '../components/schedules-new/ClientMultiPicker';
import { AttachClientsModal } from '../components/schedules-new/AttachClientsModal';

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

type Tab = 'schedules' | 'groups' | 'routes';

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
  const [openScheduleId, setOpenScheduleId] = useState<number | null>(null);
  const [attachScheduleId, setAttachScheduleId] = useState<number | null>(null);

  return (
    // AppLayout's <main> is `overflow-hidden` so each page owns its
    // own scroll container. Dashboard uses `h-full ... overflow-auto`;
    // we follow the same pattern.
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-6 max-w-7xl">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-text-primary">Schedules</h1>
          <p className="text-sm text-text-secondary max-w-2xl">
            One schedule, many clients. Each schedule has its own id; clients
            are attached to it, overrides stay linked to their base, and the
            recurring routes and linehaul runs that deliver it sit alongside
            instead of on a separate page.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="shrink-0 px-4 py-2 text-sm font-medium rounded bg-brand-cyan text-brand-dark disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
          title="Phase 1 is read-only. Writes land in Phase 3."
        >
          + New Schedule
        </button>
      </header>

      <div className="border-b border-border">
        <nav className="flex gap-6 -mb-px" aria-label="Schedules sections">
          <TabButton active={tab === 'schedules'} onClick={() => setTab('schedules')}>
            Schedules
          </TabButton>
          <TabButton active={tab === 'groups'} onClick={() => setTab('groups')}>
            Schedule Groups
          </TabButton>
          <TabButton active={tab === 'routes'} onClick={() => setTab('routes')}>
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
      {tab === 'groups' && <ScheduleGroupsTab onScheduleClick={setOpenScheduleId} />}
      {tab === 'routes' && <RecurringRoutesTab />}

      <ScheduleDetailModal
        scheduleId={openScheduleId}
        onClose={() => setOpenScheduleId(null)}
      />
      <AttachClientsModal
        scheduleId={attachScheduleId}
        onClose={() => setAttachScheduleId(null)}
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
  const [type, setType] = useState<SchedulesV2Type>('all');
  const [q, setQ] = useState('');
  const [depotFilter, setDepotFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [viewAsClientIds, setViewAsClientIds] = useState<number[]>([]);
  const query = useSchedulesV2List({
    type,
    q: q.trim() || undefined,
    clientIds: viewAsClientIds.length > 0 ? viewAsClientIds : undefined,
  });

  // Depot options - unique origin depot + destination region names
  // seen across the loaded set.
  const depotOptions = useMemo(() => {
    if (!query.data) return [];
    const set = new Set<string>();
    for (const s of query.data) {
      if (s.pickupDepotName) set.add(s.pickupDepotName);
      if (s.regionName) set.add(s.regionName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [query.data]);

  const filtered = useMemo(() => {
    if (!query.data) return [];
    if (depotFilter === 'all') return query.data;
    return query.data.filter(
      (s) => s.pickupDepotName === depotFilter || s.regionName === depotFilter,
    );
  }, [query.data, depotFilter]);

  const nested = useMemo(() => nestOverrides(filtered), [filtered]);

  // Paginate at the nested-row level so override rows always render
  // with their base on the same page. Steve's mockup shows nested
  // overrides so paginating on the flat list would separate them.
  const pageCount = Math.max(1, Math.ceil(nested.length / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount - 1);
  const pageRows = nested.slice(boundedPage * PAGE_SIZE, (boundedPage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4 bg-surface-white border border-border rounded-lg p-5">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          placeholder="Search schedules by name, route, client or run..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">View as</span>
          <ClientMultiPicker
            selected={viewAsClientIds}
            onChange={(ids) => { setViewAsClientIds(ids); setPage(0); }}
            placeholder="All schedules"
            panelTitle="View as clients"
          />
        </div>

        <div className="flex bg-surface-light border border-border rounded p-0.5">
          <SegmentPill active={type === 'all'} onClick={() => { setType('all'); setPage(0); }}>All</SegmentPill>
          <SegmentPill active={type === 'default'} onClick={() => { setType('default'); setPage(0); }}>Defaults</SegmentPill>
          <SegmentPill active={type === 'shared'} onClick={() => { setType('shared'); setPage(0); }}>Shared</SegmentPill>
          <SegmentPill active={type === 'override'} onClick={() => { setType('override'); setPage(0); }}>Overrides</SegmentPill>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">Depot</span>
          <select
            value={depotFilter}
            onChange={(e) => { setDepotFilter(e.target.value); setPage(0); }}
            className="w-44 pl-3 pr-2 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
          >
            <option value="all">All depots</option>
            {depotOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <span className="ml-auto text-xs text-text-muted">
          {query.data
            ? viewAsClientIds.length > 0
              ? `View as ${viewAsClientIds.length} client${viewAsClientIds.length === 1 ? '' : 's'} - ${filtered.length} bookable`
              : `Showing ${pageRows.length} of ${filtered.length} schedule${filtered.length === 1 ? '' : 's'}`
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
          {type === 'override'
            ? 'No overrides yet. Overrides appear here once a base schedule has a client-specific variant (BaseScheduleId).'
            : 'No schedules match this filter.'}
        </div>
      )}
      {pageRows.length > 0 && (
        <>
          <SchedulesTable
            rows={pageRows}
            onRowClick={onRowClick}
            onAttachClients={onAttachClients}
          />
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

type NestedRow = { row: ScheduleGroupSummary; isOverride: boolean };

function nestOverrides(rows: ScheduleGroupSummary[]): NestedRow[] {
  const byId = new Map<number, ScheduleGroupSummary>();
  rows.forEach((r) => byId.set(r.scheduleId, r));
  const overridesByBase = new Map<number, ScheduleGroupSummary[]>();
  const bases: ScheduleGroupSummary[] = [];
  const orphanOverrides: ScheduleGroupSummary[] = [];
  for (const r of rows) {
    if (r.baseScheduleId != null) {
      if (byId.has(r.baseScheduleId)) {
        const list = overridesByBase.get(r.baseScheduleId) ?? [];
        list.push(r);
        overridesByBase.set(r.baseScheduleId, list);
      } else {
        orphanOverrides.push(r);
      }
    } else {
      bases.push(r);
    }
  }
  const out: NestedRow[] = [];
  for (const base of bases) {
    out.push({ row: base, isOverride: false });
    for (const ov of overridesByBase.get(base.scheduleId) ?? []) {
      out.push({ row: ov, isOverride: true });
    }
  }
  for (const ov of orphanOverrides) {
    out.push({ row: ov, isOverride: true });
  }
  return out;
}

function SchedulesTable({
  rows,
  onRowClick,
  onAttachClients,
}: {
  rows: NestedRow[];
  onRowClick: (id: number) => void;
  onAttachClients: (id: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
          <tr>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Days</th>
            <th className="py-2 pr-3 font-medium">Origin</th>
            <th className="py-2 pr-3 font-medium">Dest</th>
            <th className="py-2 pr-3 font-medium">Window</th>
            <th className="py-2 pr-3 font-medium">Cut-off</th>
            <th className="py-2 pr-3 font-medium">Clients</th>
            <th className="py-2 pr-3 font-medium">Roster</th>
            <th className="py-2 pr-3 font-medium">AutoBook</th>
            <th className="py-2 pr-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row: s, isOverride }) => (
            <ScheduleRow
              key={s.scheduleId}
              row={s}
              isOverride={isOverride}
              onOpen={onRowClick}
              onAttachClients={onAttachClients}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleRow({
  row: s,
  isOverride,
  onOpen,
  onAttachClients,
}: {
  row: ScheduleGroupSummary;
  isOverride: boolean;
  onOpen: (id: number) => void;
  onAttachClients: (id: number) => void;
}) {
  const window = s.windowStart && s.windowEnd ? `${s.windowStart}-${s.windowEnd}` : '-';
  const cutoff = formatCutoff(s.monCutoffHours, s.otherCutoffHours);
  return (
    <tr
      onClick={() => onOpen(s.scheduleId)}
      className={`border-b border-border/60 hover:bg-surface-light cursor-pointer align-top ${
        isOverride ? 'bg-warning-bg/30' : ''
      }`}
    >
      <td className={`py-3 pr-3 ${isOverride ? 'pl-6' : ''}`}>
        <div className="flex items-center gap-2">
          {isOverride && (
            <span
              title="Client override"
              className="text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full bg-warning text-white shrink-0"
            >
              O
            </span>
          )}
          <span className="font-medium text-text-primary">{s.name ?? '(unnamed)'}</span>
          {!isOverride && s.overrideCount > 0 && (
            <span
              title={`${s.overrideCount} override${s.overrideCount === 1 ? '' : 's'}`}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan"
            >
              +{s.overrideCount}
            </span>
          )}
        </div>
        <div className={`text-xs mt-0.5 ${isOverride ? 'text-warning' : 'text-text-muted'}`}>
          {isOverride && s.baseScheduleId != null
            ? `Based on #${s.baseScheduleId}${s.description ? ` · ${s.description}` : ''}`
            : `#${s.scheduleId}${s.description ? ` · ${s.description}` : ''}`}
        </div>
      </td>
      <td className="py-3 pr-3">
        {isOverride ? <span className="text-text-muted">-</span> : <DayPills active={s.activeDays} />}
      </td>
      <td className="py-3 pr-3 text-text-secondary">
        {isOverride ? '-' : (s.pickupDepotName ?? 'Client address')}
      </td>
      <td className="py-3 pr-3 text-text-secondary">{isOverride ? '-' : (s.regionName ?? '-')}</td>
      <td className="py-3 pr-3 text-text-secondary font-mono text-xs">{window}</td>
      <td className="py-3 pr-3 text-text-secondary font-mono text-xs">{cutoff}</td>
      <td className="py-3 pr-3"><ClientChips row={s} /></td>
      <td className="py-3 pr-3">
        {isOverride ? (
          <span className="text-xs text-text-muted">as base</span>
        ) : (
          <RosterChips routeCount={s.routeCount} linehaulHint={s.linehaulHint} />
        )}
      </td>
      <td className="py-3 pr-3">
        <ToggleSwitch on={s.autoBook === true} />
      </td>
      <td className="py-3 pr-3">
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <ActionIcon
            label="Attach clients"
            icon="user"
            onClick={() => onAttachClients(s.scheduleId)}
          />
          <ActionIcon label="Copy schedule" icon="copy" />
          <ActionIcon label="Retire schedule" icon="trash" />
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
    <div className="flex gap-0.5">
      {DAY_LABELS.map(({ n, label }) => (
        <span
          key={n}
          className={`w-6 h-6 rounded text-[10px] font-semibold flex items-center justify-center ${
            set.has(n)
              ? 'bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/40'
              : 'bg-surface-light text-text-muted border border-border'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function ClientChips({ row }: { row: ScheduleGroupSummary }) {
  if (row.clientCount === 0 && row.legacyClientId == null) {
    return (
      <span className="text-xs bg-success-bg text-success border border-success/30 px-2 py-0.5 rounded font-medium">
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
          className="text-[10px] font-medium bg-surface-light text-text-secondary border border-border px-2 py-0.5 rounded"
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
    return <span className="text-xs text-text-muted">-</span>;
  }
  return (
    <div className="flex gap-1 flex-wrap items-center">
      {routeCount > 0 && (
        <span className="text-[10px] font-medium bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 px-2 py-0.5 rounded">
          {routeCount} route{routeCount === 1 ? '' : 's'}
        </span>
      )}
      {linehaulHint && (
        <span className="text-[10px] font-medium bg-warning-bg text-warning border border-warning/30 px-2 py-0.5 rounded">
          {linehaulHint}
        </span>
      )}
    </div>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <div
      className={`w-9 h-5 rounded-full relative transition-colors ${
        on ? 'bg-brand-cyan' : 'bg-surface-light border border-border'
      }`}
      title={on ? 'Auto-book on' : 'Auto-book off'}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-4' : ''
        }`}
      />
    </div>
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
  // Actions that have a wired handler (e.g. Attach clients opens the
  // preview modal in Phase 1) are clickable. Write-only actions
  // (Copy, Retire) stay disabled until Phase 3 lands the endpoints.
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      title={clickable ? label : `${label} - Phase 3 write`}
      className={`w-7 h-7 rounded flex items-center justify-center hover:bg-surface-light ${
        clickable
          ? 'text-text-secondary hover:text-text-primary cursor-pointer'
          : 'text-text-muted disabled:cursor-not-allowed'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'text-text-primary border-brand-cyan'
          : 'text-text-secondary border-transparent hover:text-text-primary'
      }`}
    >
      {children}
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
      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-brand-cyan text-brand-dark'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Schedule Groups tab ────────────────────────────────────────────

function ScheduleGroupsTab({ onScheduleClick }: { onScheduleClick: (id: number) => void }) {
  const query = useSchedulesV2Groups();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4 bg-surface-white border border-border rounded-lg p-5">
      <p className="text-xs text-text-muted italic max-w-3xl">
        A group is a named bundle of schedules. Attaching a client to a group
        writes one link row per member; the link table stays the only record
        of who uses what.
      </p>

      {query.isLoading && (
        <div className="text-sm text-text-muted py-8 text-center">Loading groups...</div>
      )}
      {query.isError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load groups: {(query.error as Error).message}
        </div>
      )}
      {query.data && query.data.length === 0 && (
        <div className="text-sm text-text-muted py-8 text-center">
          No schedule groups yet. Groups become creatable once the Phase 3 write
          endpoints land alongside POST /api/v2/schedule-groups.
        </div>
      )}
      {query.data && query.data.length > 0 && (
        <ul className="space-y-2">
          {query.data.map((g) => (
            <GroupCard
              key={g.groupId}
              group={g}
              expanded={expanded.has(g.groupId)}
              onToggle={() => toggle(g.groupId)}
              onScheduleClick={onScheduleClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupCard({
  group,
  expanded,
  onToggle,
  onScheduleClick,
}: {
  group: ScheduleGroupBundle;
  expanded: boolean;
  onToggle: () => void;
  onScheduleClick: (id: number) => void;
}) {
  return (
    <li className="border border-border rounded">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-light"
      >
        <div>
          <div className="text-sm font-medium text-text-primary flex items-center gap-2">
            <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
            {group.name}
          </div>
          {group.description && (
            <div className="text-xs text-text-muted mt-0.5">{group.description}</div>
          )}
        </div>
        <div className="flex items-center gap-6 text-xs text-text-muted">
          <span>{group.scheduleCount} schedules</span>
          <span>{group.clientCount} clients</span>
          <span
            className={`px-2 py-0.5 rounded ${
              group.isActive
                ? 'bg-success-bg text-success border border-success/30'
                : 'bg-surface-light text-text-muted border border-border'
            }`}
          >
            {group.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </button>
      {expanded && group.scheduleIds.length > 0 && (
        <div className="px-4 pb-3 pt-1 border-t border-border-light">
          <ul className="space-y-1">
            {group.scheduleIds.map((id, i) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onScheduleClick(id)}
                  className="text-xs text-text-secondary hover:text-brand-cyan"
                >
                  #{id} - {group.scheduleNames[i] ?? '(unknown)'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

// ─── Recurring Routes tab ───────────────────────────────────────────

type RouteType = 'all' | 'first' | 'final';

function RecurringRoutesTab() {
  const user = useAuth();
  const [type, setType] = useState<RouteType>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['schedules-v2-recurring-routes', user.currentTenantId ?? 0],
    queryFn: () => recurringRouteService.list().then((r) => r.response),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!query.data) return [];
    const needle = q.trim().toLowerCase();
    return query.data
      .filter((r) => {
        if (type === 'all') return true;
        const name = `${r.name} ${r.area}`.toLowerCase();
        if (type === 'first') return /pickup|collect|first|am\b/.test(name);
        if (type === 'final') return /deliver|final|pm\b|home/.test(name);
        return true;
      })
      .filter((r) => {
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle) ||
          r.area.toLowerCase().includes(needle) ||
          r.schedules.some((s) => s.name.toLowerCase().includes(needle))
        );
      });
  }, [query.data, type, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(boundedPage * PAGE_SIZE, (boundedPage + 1) * PAGE_SIZE);

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
          <SegmentPill
            active={false}
            onClick={() => { /* middle mile lands with linehaul-runs join */ }}
            title="Middle mile (linehaul runs) lands once the v2 join with TblbulkLinehaulRun is added."
          >
            Middle mile
          </SegmentPill>
          <SegmentPill active={type === 'final'} onClick={() => { setType('final'); setPage(0); }}>Final mile</SegmentPill>
        </div>
        <span className="text-xs text-text-muted">
          {query.data ? `Showing ${pageRows.length} of ${filtered.length}` : ''}
        </span>
      </div>

      <p className="text-xs text-text-muted italic max-w-3xl">
        Same rows as the Recurring Routes page, anchored to the schedules that
        deliver them. First/Final mile filtering is a name heuristic today; the
        typed column lands with the v2 route join.
      </p>

      {query.isLoading && <div className="text-sm text-text-muted py-8 text-center">Loading routes...</div>}
      {query.isError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load routes: {(query.error as Error).message}
        </div>
      )}
      {filtered.length === 0 && !query.isLoading && (
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

function RecurringRoutesTable({ rows }: { rows: RecurringRoute[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
          <tr>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Area</th>
            <th className="py-2 pr-3 font-medium">Default target</th>
            <th className="py-2 pr-3 font-medium">Schedule(s)</th>
            <th className="py-2 pr-3 font-medium">Zips</th>
            <th className="py-2 pr-3 font-medium">Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.routeId} className="border-b border-border/60 hover:bg-surface-light">
              <td className="py-2 pr-3">
                <div className="font-medium text-text-primary">{r.name}</div>
                <div className="text-xs text-text-muted">#{r.routeId}</div>
              </td>
              <td className="py-2 pr-3 text-text-secondary">{r.area || '-'}</td>
              <td className="py-2 pr-3">
                {r.defaultTargetName ? (
                  <>
                    <span className="text-text-primary">{r.defaultTargetName}</span>
                    <span className="text-xs text-text-muted ml-1">
                      ({targetTypeLabel(r.defaultTargetType)})
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
                    {r.schedules.slice(0, 3).map((s) => (
                      <span
                        key={s.scheduleId ?? s.name}
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
              <td className="py-2 pr-3 text-text-secondary">{r.zipcodes.length}</td>
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
