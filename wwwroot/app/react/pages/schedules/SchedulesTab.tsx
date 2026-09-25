import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  scheduleService,
  type ScheduleGroup,
  type ScheduleGroupSummary,
  type ScheduleLookups,
} from '../../services/scheduleService';
import { RowActionsMenu } from '../../components/tenant/RowActionsMenu';
import { ScheduleEditModal } from '../../components/schedules/ScheduleEditModal';
import { ScheduleCopyModal } from '../../components/schedules/ScheduleCopyModal';
import { DataTable, type DataTableColumn } from '../../components/common/DataTable';

// One row per schedule GROUP (all tblBulkRunSchedule rows sharing Name +
// LegacyClientId). Day-of-week chip strip shows which days have windows
// on the group.

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

function DayChips({ activeDays }: { activeDays: Set<number> }) {
  return (
    <div className="flex gap-0.5">
      {DAY_LABELS_SHORT.map((d, i) => {
        const active = activeDays.has(i + 1);
        return (
          <span
            key={i}
            className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold ${
              active ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-surface-cream text-text-muted'
            }`}
            title={active ? 'Active' : 'Inactive'}
          >
            {d}
          </span>
        );
      })}
    </div>
  );
}

export function SchedulesTab() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [groups, setGroups] = useState<ScheduleGroupSummary[]>([]);
  const [lookups, setLookups] = useState<ScheduleLookups | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  /** Edit modal state. 'new' = create; ScheduleGroup = full detail loaded
   *  from GET /schedules/detail after the operator opens a row. The
   *  summary from the list never goes to the modal directly - modal fields
   *  need the full DayWindows / Zones / Linehauls / junction ids. */
  const [editing, setEditing] = useState<ScheduleGroup | 'new' | null>(null);
  /** True while GET /schedules/detail is in flight after a row click but
   *  before the edit modal opens. Cheap UX guard; the request is fast
   *  (single-group query with two includes). */
  const [loadingDetail, setLoadingDetail] = useState(false);
  /** Copy modal source. Null = closed. Full detail fetched lazily on
   *  Copy... action, then handed to the modal. */
  const [copying, setCopying] = useState<ScheduleGroup | null>(null);
  const [clientCodeFilter, setClientCodeFilter] = useState<string | undefined>(undefined);
  const [clientInput, setClientInput] = useState('');
  /** When true, the default (no-client) list expands to include
   *  client-specific groups (legacy or junction bindings). Off by
   *  default because the widened result set can be 40x larger on tenants
   *  where every schedule is client-bound (2050 vs 42 groups on NZ
   *  Urgent staging). Steve requested this so the search box can find
   *  any schedule regardless of its client scope. */
  const [includeClientSpecific, setIncludeClientSpecific] = useState(false);

  const load = async (clientCode?: string, includeAll: boolean = includeClientSpecific) => {
    setLoading(true);
    try {
      const [listRes, lookupRes] = await Promise.all([
        scheduleService.list({ clientCode, includeClientSpecific: includeAll }),
        scheduleService.lookups(),
      ]);
      setGroups(listRes.response ?? []);
      setLookups(lookupRes.response);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(clientCodeFilter, includeClientSpecific); }, [clientCodeFilter, includeClientSpecific]);

  // ?edit=<value> deep-link (used by RecurringRoutes -> Schedules chip
  // click). Prefer numeric scheduleId; fall back to legacy name for
  // existing deep links (e.g. bookmarks).
  useEffect(() => {
    if (groups.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editValue = params.get('edit');
    if (!editValue) return;
    const asId = Number.parseInt(editValue, 10);
    const target = Number.isFinite(asId) && asId > 0
      ? groups.find((g) => g.scheduleId === asId)
      : (groups.find((g) => g.name === editValue && g.legacyClientId == null)
         ?? groups.find((g) => g.name === editValue));
    if (target) {
      void openEdit(target);
      params.delete('edit');
      const nextQs = params.toString();
      const nextUrl = window.location.pathname + (nextQs ? `?${nextQs}` : '') + window.location.hash;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [groups]);

  const openEdit = async (g: ScheduleGroupSummary) => {
    setLoadingDetail(true);
    try {
      const res = await scheduleService.detail(g.scheduleId);
      setEditing(res.response);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoadingDetail(false); }
  };

  const openCopy = async (g: ScheduleGroupSummary) => {
    setLoadingDetail(true);
    try {
      const res = await scheduleService.detail(g.scheduleId);
      setCopying(res.response);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoadingDetail(false); }
  };

  const applyClientFilter = () => {
    const trimmed = clientInput.trim();
    setClientCodeFilter(trimmed || undefined);
  };
  const clearClientFilter = () => { setClientInput(''); setClientCodeFilter(undefined); };

  const filtered = useMemo(() => {
    if (!q.trim()) return groups;
    const needle = q.trim().toLowerCase();
    return groups.filter((g) =>
      (g.name ?? '').toLowerCase().includes(needle) ||
      (g.regionName ?? '').toLowerCase().includes(needle) ||
      (g.speedName ?? '').toLowerCase().includes(needle));
  }, [groups, q]);

  const toggleAutoBook = async (g: ScheduleGroupSummary) => {
    try {
      const res = await scheduleService.toggleAutoBook(g.scheduleId);
      setGroups((prev) => prev.map((x) =>
        x.scheduleId === g.scheduleId
          ? { ...x, autoBook: res.response.autoBook } : x));
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const removeGroup = async (g: ScheduleGroupSummary) => {
    const dayCount = g.activeDays.length;
    const ok = await askConfirm({
      title: 'Delete schedule group?',
      message: `Delete "${g.name}"? Retires the schedule (soft delete via RetiredUtc on the header) - existing bookings + history are preserved; nightly prebook + booking availability lookups stop returning this schedule immediately. Applies to all ${dayCount} day-window row${dayCount === 1 ? '' : 's'} in the group.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await scheduleService.remove(g.scheduleId);
      setGroups((prev) => prev.filter((x) => x.scheduleId !== g.scheduleId));
      toast.show('Schedule deleted', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  // Splice a saved / copied ScheduleGroup back into the list by derived
  // summary shape. Avoids a full list refetch.
  const onSaved = (row: ScheduleGroup) => {
    const summary = detailToSummary(row);
    setGroups((prev) => {
      const idx = prev.findIndex((x) => x.scheduleId === row.scheduleId);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = summary;
        return next;
      }
      return [...prev, summary];
    });
  };

  const columns: DataTableColumn<ScheduleGroupSummary>[] = [
    {
      key: 'name', label: 'Name', sortable: true,
      sortValue: (g) => g.name ?? '',
      render: (g) => {
        const linked = g.linkedClientCodes ?? [];
        const extra = Math.max(0, (g.clientCount ?? 0) - linked.length);
        return (
          <span className="font-medium text-text-primary">
            {g.name}
            {linked.length > 0 && (
              <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
                {linked.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-orange/15 text-brand-orange"
                    title={`Client bound to this schedule: ${code}`}
                  >
                    {code}
                  </span>
                ))}
                {extra > 0 && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-neutral-200 text-neutral-700"
                    title={`${extra} more client${extra === 1 ? '' : 's'} bound (open the edit modal to see the full list)`}
                  >
                    +{extra} more
                  </span>
                )}
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'region', label: 'Destination', sortable: true, sortValue: (g) => g.regionName ?? '',
      render: (g) => <span className="text-text-secondary">{g.regionName ?? '-'}</span> },
    { key: 'speed', label: 'Speed', sortable: true, sortValue: (g) => g.speedName ?? '',
      render: (g) => <span className="text-text-secondary">{g.speedName ?? '-'}</span> },
    { key: 'days', label: 'Mon-Sun', sortable: true,
      // Sort by count of active days as a reasonable proxy - operators
      // grouping "which schedules run daily" find that useful.
      sortValue: (g) => g.activeDays.length,
      render: (g) => <DayChips activeDays={new Set(g.activeDays)} /> },
    { key: 'clients', label: 'Clients', sortable: true, align: 'right',
      sortValue: (g) => g.clientCount,
      render: (g) => <span className="text-text-primary font-semibold">{g.clientCount}</span> },
    { key: 'postcodes', label: 'Postcodes', sortable: true, align: 'right',
      sortValue: (g) => g.postcodeCount,
      render: (g) => <span className="text-text-primary font-semibold">{g.postcodeCount}</span> },
    { key: 'polygons', label: 'Polygons', sortable: true, align: 'right',
      sortValue: (g) => g.polygonCount,
      render: (g) => <span className="text-text-primary font-semibold">{g.polygonCount}</span> },
    { key: 'zones', label: 'Zones', sortable: true, align: 'right',
      sortValue: (g) => g.activeZonesCount,
      render: (g) => <span className="text-text-primary font-semibold">{g.activeZonesCount}</span> },
    { key: 'autoBook', label: 'Auto Book', sortable: true,
      sortValue: (g) => g.autoBook ? 1 : 0,
      render: (g) => (
        <button
          type="button"
          title="Toggle Auto Book"
          onClick={(e) => { e.stopPropagation(); void toggleAutoBook(g); }}
          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium hover:opacity-80 ${
            g.autoBook ? 'bg-green-100 text-green-800' : 'bg-surface-cream text-text-muted'
          }`}
        >
          {g.autoBook ? 'On' : 'Off'}
        </button>
      ),
    },
    { key: 'linehaul', label: 'Linehaul', sortable: true,
      sortValue: (g) => g.hasActiveLinehaul ? 1 : 0,
      render: (g) => (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
          g.hasActiveLinehaul ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-surface-cream text-text-muted'
        }`}>
          {g.hasActiveLinehaul ? 'Yes' : 'No'}
        </span>
      ),
    },
    { key: 'actions', label: 'Actions', align: 'right',
      render: (g) => (
        <RowActionsMenu
          actions={[
            { label: 'Edit', onClick: () => void openEdit(g) },
            { label: 'Copy...', onClick: () => void openCopy(g) },
            { label: g.autoBook ? 'Disable Auto Book' : 'Enable Auto Book', onClick: () => toggleAutoBook(g) },
            { label: 'Delete', onClick: () => removeGroup(g), danger: true },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs text-text-secondary">
          {loading ? 'Loading...' : `${filtered.length} schedule group${filtered.length === 1 ? '' : 's'}${q.trim() ? ` (filtered from ${groups.length})` : ' configured'}`}
          {clientCodeFilter !== undefined && (
            <span className="ml-2 text-text-muted">Client: <span className="font-semibold text-text-secondary">{clientCodeFilter}</span></span>
          )}
          {clientCodeFilter === undefined && includeClientSpecific && (
            <span className="ml-2 text-text-muted">Scope: <span className="font-semibold text-text-secondary">client-specific only</span></span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={clientInput}
            onChange={(e) => setClientInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyClientFilter()}
            placeholder="Client Code"
            title="Filter by client code (blank = default schedules)"
            className="border border-border rounded-lg px-3 py-1.5 text-xs w-28 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan uppercase"
          />
          <button
            onClick={applyClientFilter}
            className="border border-border rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-cream"
            type="button"
          >
            Load
          </button>
          {clientCodeFilter !== undefined && (
            <button onClick={clearClientFilter} className="text-[11px] text-text-muted hover:text-text-primary underline" type="button">
              Clear
            </button>
          )}
          {clientCodeFilter === undefined && (
            <label
              className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer select-none"
              title="Tick to switch the browse to per-client (legacy override) schedules only. Off = default schedules only. Type a client code above to see what a specific client actually resolves to."
            >
              <input
                type="checkbox"
                checked={includeClientSpecific}
                onChange={(e) => setIncludeClientSpecific(e.target.checked)}
                className="accent-brand-cyan"
              />
              Client-specific only
            </label>
          )}
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search schedules..."
            className="border border-border rounded-lg px-3 py-1.5 text-xs w-56 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
          <button
            onClick={() => setEditing('new')}
            className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
          >
            + Add Schedule
          </button>
        </div>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(g) => String(g.scheduleId)}
        onRowClick={(g) => void openEdit(g)}
        loading={loading || loadingDetail}
        emptyMessage={'No schedules yet. Click "+ Add Schedule" to create one.'}
        minWidth="min-w-[1000px]"
        defaultSort={{ key: 'name', dir: 'asc' }}
      />

      {editing !== null && (
        <ScheduleEditModal
          open={true}
          group={editing === 'new' ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={(row) => { onSaved(row); setEditing(null); }}
        />
      )}

      {copying !== null && (
        <ScheduleCopyModal
          open={true}
          source={copying}
          lookups={lookups}
          onClose={() => setCopying(null)}
          onCopied={(row) => {
            // Insert the copy into the list, close copy modal, open the
            // new group in edit mode so the operator can review + tweak.
            onSaved(row);
            setCopying(null);
            setEditing(row);
          }}
        />
      )}
    </div>
  );
}

/** Derive the list-view summary from a full ScheduleGroup detail. Used
 *  after upsert / copy to splice the fresh record into the list without
 *  a full refetch. */
function detailToSummary(g: ScheduleGroup): ScheduleGroupSummary {
  const activeDays = Array.from(new Set(g.dayWindows.map((w) => w.dayOfWeek))).sort((a, b) => a - b);
  return {
    scheduleId: g.scheduleId,
    name: g.name,
    legacyClientId: g.legacyClientId,
    legacyClientCode: g.legacyClientCode,
    regionId: g.regionId,
    regionName: g.regionName,
    speedId: g.speedId,
    speedName: g.speedName,
    activeDays,
    activeZonesCount: g.zones.filter((z) => z.active === true).length,
    clientCount: g.clientIds.length,
    postcodeCount: g.postcodeIds.length,
    polygonCount: g.polygonIds.length,
    autoBook: g.autoBook,
    hasActiveLinehaul: g.linehauls.some((l) => l.active === true),
    // Row chip strip: alphabetically top 3 of the freshly-saved link
    // set. Matches ListSummaryAsync's projection so the row rerenders
    // consistently after an in-place splice.
    linkedClientCodes: [...g.clientCodes]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 3),
    // Legacy Schedules page does not surface overrides so this stays
    // null. Override nesting lives on the Schedules NEW page only.
    baseScheduleId: null,
    // Steve's 2026-09-08 v2 summary extras. Legacy page does not
    // render these columns; only /api/v2/schedules populates them.
    description: null,
    pickupDepotId: null,
    pickupDepotName: null,
    windowStart: null,
    windowEnd: null,
    monCutoffHours: null,
    otherCutoffHours: null,
    overrideCount: 0,
    routeCount: 0,
    linehaulHint: null,
    overriddenFields: [],
    // Legacy page does not surface F13 / F21; keep the fields present
    // so the type checks but leave them at their neutral defaults.
    displayName: g.displayName ?? null,
    displayDescription: g.displayDescription ?? null,
    isActive: g.isActive ?? true,
  };
}
